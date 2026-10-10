import "dotenv/config";
import { z } from "zod";
import { infrastructureConfig, kafkaClient } from "../server/infrastructure.js";

const cfg = infrastructureConfig();
const replicationFactor = z.coerce
  .number()
  .int()
  .min(1)
  .max(9)
  .parse(process.env.KAFKA_TOPIC_REPLICATION_FACTOR || 1);
const minISR = z.coerce
  .number()
  .int()
  .min(1)
  .max(replicationFactor)
  .parse(process.env.KAFKA_TOPIC_MIN_ISR || 1);
if (
  process.env.NODE_ENV === "production" &&
  (replicationFactor < 3 || minISR < 2)
)
  throw new Error(
    "Production yêu cầu replication factor >= 3 và min ISR >= 2.",
  );
const admin = kafkaClient(cfg).admin();
try {
  await admin.connect();
  const created = await admin.createTopics({
    waitForLeaders: true,
    topics: [
      {
        topic: cfg.topic,
        numPartitions: 12,
        replicationFactor,
        configEntries: [
          { name: "min.insync.replicas", value: String(minISR) },
          { name: "unclean.leader.election.enable", value: "false" },
          { name: "retention.ms", value: "604800000" },
          { name: "cleanup.policy", value: "delete" },
        ],
      },
    ],
  });
  console.log(
    created
      ? "Payment topic created (12 partitions, 7-day retention)."
      : "Topic already exists. Existing settings were NOT changed; inspect replication, ISR and retention before use.",
  );
} catch {
  console.error(
    "Topic setup failed; check broker connection, ACL and replication factor.",
  );
  process.exitCode = 1;
} finally {
  await admin.disconnect();
}
