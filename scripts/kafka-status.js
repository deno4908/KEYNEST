import "dotenv/config";
import { infrastructureConfig, kafkaClient } from "../server/infrastructure.js";
const cfg = infrastructureConfig();
const admin = kafkaClient(cfg).admin();
try {
  await admin.connect();
  const [heads, committed, groups] = await Promise.all([
    admin.fetchTopicOffsets(cfg.topic),
    admin.fetchOffsets({ groupId: cfg.group, topics: [cfg.topic] }),
    admin.describeGroups([cfg.group]),
  ]);
  const offsets =
    committed.find((t) => t.topic === cfg.topic)?.partitions || [];
  const partitions = heads.map((p) => {
    const saved =
      offsets.find((o) => o.partition === p.partition)?.offset || "-1";
    const start = saved === "-1" ? BigInt(p.low) : BigInt(saved);
    const lag = BigInt(p.high) - start;
    return {
      partition: p.partition,
      committed: saved,
      high: p.high,
      lag: (lag < 0n ? 0n : lag).toString(),
    };
  });
  console.log(
    JSON.stringify(
      {
        group: cfg.group,
        state: groups.groups[0]?.state,
        members: groups.groups[0]?.members.length || 0,
        partitions,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Cannot inspect payment lag; check Kafka connection, topic/group and read ACLs.",
  );
  process.exitCode = 1;
} finally {
  await admin.disconnect().catch(() => {});
}
