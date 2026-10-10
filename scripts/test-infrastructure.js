// Explicit integration test: real Kafka/Redis, isolated temporary topic/keys.
// Does not load application credentials, call banks or modify store balances.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  infrastructureConfig,
  kafkaClient,
  createInfrastructure,
  deadline,
} from "../server/infrastructure.js";
const suffix = randomUUID();
const cfg = infrastructureConfig({
  ...process.env,
  APP_MODE: "supabase",
  KAFKA_ENABLED: "true",
  REDIS_ENABLED: "true",
  REDIS_PREFIX: `keynest-test:${suffix}:`,
});
cfg.topic = `keynest-test-${suffix}`;
const admin = kafkaClient(cfg).admin();
const consumer = kafkaClient(cfg).consumer({
  groupId: cfg.topic,
  allowAutoTopicCreation: false,
});
let a,
  b,
  created = false;
try {
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: cfg.topic,
        numPartitions: 2,
        replicationFactor: 1,
        configEntries: [{ name: "retention.ms", value: "3600000" }],
      },
    ],
  });
  created = true;
  a = await createInfrastructure(cfg);
  b = await createInfrastructure(cfg);
  const first = a.rateStore("shared"),
    second = b.rateStore("shared");
  await first.init({ windowMs: 60000 });
  await second.init({ windowMs: 60000 });
  const counts = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      (i % 2 ? first : second).increment("same-client"),
    ),
  );
  assert.deepEqual(
    counts.map((c) => c.totalHits).sort((x, y) => x - y),
    Array.from({ length: 100 }, (_, i) => i + 1),
  );
  console.log("PASS Redis shares atomic counters across two API clients");
  const seen = new Set();
  let complete;
  const done = new Promise((r) => {
    complete = r;
  });
  await consumer.connect();
  await consumer.subscribe({ topic: cfg.topic, fromBeginning: true });
  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      seen.add(message.value.toString());
      await consumer.commitOffsets([
        { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
      ]);
      if (seen.size === 100) complete();
    },
  });
  await a.producer.send({
    topic: cfg.topic,
    acks: -1,
    messages: Array.from({ length: 100 }, (_, i) => ({
      key: String(i % 2),
      value: String(i),
    })),
  });
  await deadline(done, 30000);
  assert.equal(seen.size, 100);
  console.log("PASS Kafka receives and commits 100 messages on isolated topic");
  await first.resetKey("same-client");
} catch {
  console.error(
    "Infrastructure integration test failed. Ensure Kafka/Redis are running and test-topic ACLs permit create/delete.",
  );
  process.exitCode = 1;
} finally {
  await consumer.disconnect().catch(() => {});
  await Promise.allSettled([a?.close(), b?.close()]);
  if (created)
    await admin.deleteTopics({ topics: [cfg.topic] }).catch(() => {
      console.error(
        "Temporary test topic cleanup failed; remove only the keynest-test topic created by this run.",
      );
    });
  await admin.disconnect().catch(() => {});
}
