import { config } from "./config.js";
import { SupabaseStore } from "./supabase-store.js";
import { createBankPayments } from "./bank-payments.js";
import {
  infrastructureConfig,
  kafkaClient,
  paymentHandler,
} from "./infrastructure.js";

const cfg = infrastructureConfig();
if (!cfg.kafka || config.mode !== "supabase")
  throw new Error("Worker yêu cầu KAFKA_ENABLED=true và APP_MODE=supabase.");
const bankPayments = createBankPayments({ config, store: new SupabaseStore() });
bankPayments.assertReady();
const consumer = kafkaClient(cfg).consumer({
  groupId: cfg.group,
  allowAutoTopicCreation: false,
  sessionTimeout: 60000,
  retry: { restartOnFailure: async () => false },
});
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(1), 30000);
  force.unref();
  try {
    await consumer.disconnect();
  } finally {
    clearTimeout(force);
    process.exitCode = code;
  }
}
consumer.on(consumer.events.CRASH, () => {
  console.error(
    "Payment worker stopped; inspect consumer lag and restart after resolving the failure. No failed event was acknowledged.",
  );
  void shutdown(1);
});
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
try {
  await consumer.connect();
  await consumer.subscribe({ topic: cfg.topic, fromBeginning: true });
  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: cfg.concurrency,
    eachMessage: paymentHandler({
      bankPayments,
      consumer,
      onFailure: (event) => console.error(JSON.stringify(event)),
    }),
  });
  console.log("Payment worker running. SQL deduplication enabled.");
} catch {
  console.error(
    "Payment worker failed to start; verify Kafka and database configuration.",
  );
  await shutdown(1);
}
