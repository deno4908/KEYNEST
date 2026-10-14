import { Kafka, logLevel, Partitioners } from "kafkajs";
import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";
import { z } from "zod";
import { bankTransaction } from "./bank-payments.js";
import { bankSourceEnabled } from './payment-routing.js';
import { AppError, digest, webhookCode } from "./security.js";

export function infrastructureConfig(env = process.env) {
  const enabled = (name) =>
    z.enum(["true", "false"]).parse(env[name] || "false") === "true";
  const cfg = {
    kafka: enabled("KAFKA_ENABLED"),
    redis: enabled("REDIS_ENABLED"),
    brokers: (env.KAFKA_BROKERS || "localhost:9092")
      .split(",")
      .map((s) => s.trim()),
    topic: env.KAFKA_PAYMENT_TOPIC || "keynest.payments.v1",
    group: env.KAFKA_PAYMENT_GROUP || "keynest-settlement-v1",
    clientId: env.KAFKA_CLIENT_ID || "keynest",
    ssl: enabled("KAFKA_SSL"),
    sasl: env.KAFKA_USERNAME
      ? {
          mechanism: z
            .enum(["plain", "scram-sha-256", "scram-sha-512"])
            .parse(env.KAFKA_SASL_MECHANISM || "scram-sha-512"),
          username: env.KAFKA_USERNAME,
          password: env.KAFKA_PASSWORD,
        }
      : undefined,
    redisUrl: env.REDIS_URL || "redis://localhost:6379",
    prefix: env.REDIS_PREFIX || "keynest:",
    concurrency: z.coerce
      .number()
      .int()
      .min(1)
      .max(32)
      .parse(env.KAFKA_WORKER_CONCURRENCY || 4),
  };
  if (
    !cfg.brokers.every(Boolean) ||
    !/^[a-zA-Z0-9._-]{1,200}$/.test(cfg.topic) ||
    !cfg.group ||
    (cfg.sasl && !cfg.sasl.password)
  )
    throw new Error("Cấu hình Kafka chưa hợp lệ.");
  if (cfg.kafka && env.APP_MODE !== "supabase")
    throw new Error(
      "Kafka cần APP_MODE=supabase; không chạy worker trên file demo dùng chung.",
    );
  return cfg;
}

export const paymentEvent = z
  .object({
    version: z.literal(1),
    source: z.enum(["pay2s", "sepay"]),
    received_at: z.iso.datetime(),
    transaction: bankTransaction,
  })
  .strict();

export function kafkaClient(cfg) {
  // Do not log connection credentials or transaction payloads.
  return new Kafka({
    clientId: cfg.clientId,
    brokers: cfg.brokers,
    ssl: cfg.ssl,
    sasl: cfg.sasl,
    logLevel: logLevel.NOTHING,
    connectionTimeout: 5000,
    requestTimeout: 10000,
    retry: { retries: 4, initialRetryTime: 300, maxRetryTime: 3000 },
  });
}

export function createPaymentIngress({
  config,
  bankPayments,
  producer,
  topic,
}) {
  return {
    async accept(source, input) {
      return this.acceptBatch(source, [input]);
    },
    async acceptBatch(source, inputs) {
      // Validate the entire callback before writing any message.
      if (!bankSourceEnabled(config,source))
        throw new AppError("Nguồn thanh toán không được bật.", 503);
      const transactions = z
        .array(bankTransaction)
        .min(1)
        .max(100)
        .parse(inputs);
      if (transactions.some((t) => t.account !== config.account))
        throw new AppError("Sai tài khoản thụ hưởng.", 422);
      if (!producer) {
        let result;
        for (const transaction of transactions)
          result = await bankPayments.accept(source, transaction);
        return result;
      }
      const received_at = new Date().toISOString();
      const messages = transactions
        .filter((t) => t.direction === "in")
        .map((transaction) => {
          let key;
          try {
            key = webhookCode(transaction);
          } catch {
            key = transaction.id;
          }
          return {
            key: digest(`${source}:${transaction.account}:${key}`),
            value: JSON.stringify(
              paymentEvent.parse({
                version: 1,
                source,
                received_at,
                transaction,
              }),
            ),
          };
        });
      if (!messages.length) return { ignored: true };
      try {
        await producer.send({ topic, messages, acks: -1, timeout: 10000 });
      } catch {
        // Delivery is ambiguous on timeout; provider retry is deduplicated in SQL.
        throw new AppError(
          "Chưa thể lưu giao dịch vào hàng đợi. Vui lòng gửi lại.",
          503,
        );
      }
      return { queued: true };
    },
  };
}

export async function createInfrastructure(
  cfg,
  { redisFactory = createClient, kafkaFactory = kafkaClient } = {},
) {
  let redis, producer;
  try {
    if (cfg.redis) {
      redis = redisFactory({
        url: cfg.redisUrl,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => Math.min(250 * (retries + 1), 3000),
        },
      });
      redis.on("error", () => {}); // Readiness exposes outages without secrets.
      await deadline(redis.connect(), 10000);
    }
    if (cfg.kafka) {
      producer = kafkaFactory(cfg).producer({
        allowAutoTopicCreation: false,
        idempotent: true,
        maxInFlightRequests: 1,
        createPartitioner: Partitioners.DefaultPartitioner,
        retry: { retries: 4, maxRetryTime: 3000 },
      });
      await producer.connect();
    }
  } catch {
    if (redis?.isOpen) redis.destroy();
    await producer?.disconnect().catch(() => {});
    throw new Error(
      "Không kết nối được Kafka/Redis. Kiểm tra cấu hình hạ tầng.",
    );
  }
  return {
    producer,
    rateStore(scope) {
      if (!redis) return undefined;
      return new RedisStore({
        prefix: `${cfg.prefix}rate:${scope}:`,
        sendCommand: async (...args) => {
          try {
            if (!redis.isReady) throw new Error("offline");
            return await deadline(redis.sendCommand(args), 3000);
          } catch (error) {
            // Redis may lose its script cache after restart/failover. Preserve
            // only this safe marker so RedisStore can reload and retry the Lua.
            if (error?.message?.startsWith("NOSCRIPT"))
              throw new Error("NOSCRIPT No matching script");
            throw new AppError(
              "Giới hạn truy cập tạm thời không khả dụng. Vui lòng thử lại.",
              503,
            );
          }
        },
      });
    },
    status: () => ({
      kafka_enabled: cfg.kafka,
      redis_enabled: cfg.redis,
      redis_ready: !cfg.redis || !!redis?.isReady,
      payment_processing: cfg.kafka ? "queued" : "direct",
    }),
    async close() {
      await producer?.disconnect();
      if (redis?.isOpen) redis.destroy();
    },
  };
}

export async function deadline(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Offset is advanced only after SQL commits. A crash in between causes a safe replay.
export function paymentHandler({
  bankPayments,
  consumer,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 6,
  onFailure = () => {},
}) {
  return async ({ topic, partition, message, heartbeat }) => {
    let event;
    try {
      event = paymentEvent.parse(JSON.parse(message.value.toString("utf8")));
    } catch {
      onFailure({
        topic,
        partition,
        offset: message.offset,
        reason: "invalid_event",
      });
      throw new Error("Invalid payment event; offset remains uncommitted.");
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await bankPayments.accept(event.source, event.transaction);
        break;
      } catch {
        onFailure({
          topic,
          partition,
          offset: message.offset,
          reason: "settlement_failed",
          attempt: attempt + 1,
        });
        if (attempt + 1 >= attempts)
          throw new Error(
            "Settlement unavailable; offset remains uncommitted.",
          );
        await heartbeat();
        await sleep(Math.min(250 * 2 ** attempt, 4000));
        await heartbeat();
      }
    }
    await consumer.commitOffsets([
      { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
    ]);
  };
}
