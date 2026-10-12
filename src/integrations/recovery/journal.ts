import { createHash } from "node:crypto";
import { z } from "zod";
import {
  recoveryEntrySchema,
  type RecoveryEntry,
  type RecoveryJournal,
} from "./contracts";

export interface JournalObjects {
  read(key: string): Promise<Uint8Array | null>;
  putIfAbsent(key: string, bytes: Uint8Array): Promise<void>;
  keys(prefix: string): AsyncIterable<string>;
}
const baselineSchema = z
  .object({
    version: z.literal(1),
    initializedAt: z.iso.datetime(),
    entries: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value));
}
function digest(value: unknown) {
  return createHash("sha256").update(encode(value)).digest("hex");
}

export function createRecoveryJournal(
  objects: JournalObjects,
  namespace: string,
) {
  if (!/^[a-z0-9-]{1,64}$/.test(namespace))
    throw new Error("恢复日志命名空间无效。");
  const root = `recovery/${namespace}/`;
  const baselineKey = `${root}baseline.json`;
  const keyOf = (entry: RecoveryEntry) =>
    `${root}${entry.kind}/${entry.kind === "upload" ? entry.id : entry.practiceId}.json`;
  async function baseline() {
    const bytes = await objects.read(baselineKey);
    if (!bytes) throw new Error("独立恢复日志尚未初始化，不能上传或删除。");
    return baselineSchema.parse(
      JSON.parse(Buffer.from(bytes).toString("utf8")),
    );
  }
  async function append(input: RecoveryEntry): Promise<RecoveryEntry> {
    const entry = recoveryEntrySchema.parse(input);
    const key = keyOf(entry);
    const existing = await objects.read(key);
    if (!existing) {
      // A lost response may still mean a durable write. Only same-key read-back resolves it.
      try {
        await objects.putIfAbsent(key, encode(entry));
      } catch {
        /* read-back decides */
      }
    }
    const bytes = existing ?? (await objects.read(key));
    if (!bytes) throw new Error("独立恢复日志写入未确认，操作未完成。");
    const saved = recoveryEntrySchema.parse(
      JSON.parse(Buffer.from(bytes).toString("utf8")),
    );
    if (
      keyOf(saved) !== key ||
      saved.kind !== entry.kind ||
      saved.learnerId !== entry.learnerId ||
      saved.practiceId !== entry.practiceId
    )
      throw new Error("独立恢复日志存在归属冲突。");
    if (saved.kind === "upload" && digest(saved) !== digest(entry))
      throw new Error("独立上传清单内容冲突。");
    return saved;
  }
  const journal = {
    async recordUpload(entry) {
      await baseline();
      await append(entry);
    },
    async recordDeletion(entry) {
      await baseline();
      const saved = await append(entry);
      if (saved.kind !== "deletion") throw new Error("删除标记无效。");
      return saved;
    },
  } satisfies RecoveryJournal;
  return {
    ...journal,
    /** Requires all application writers to be stopped. Never replaces a baseline. */
    async initialize(entries: RecoveryEntry[]) {
      if (await objects.read(baselineKey))
        throw new Error("恢复日志已初始化，不能覆盖基线。");
      const hashes: Record<string, string> = {};
      for (const entry of entries) {
        const saved = await append(entry);
        hashes[keyOf(saved)] = digest(saved);
      }
      const value = {
        version: 1 as const,
        initializedAt: new Date().toISOString(),
        entries: hashes,
      };
      try {
        await objects.putIfAbsent(baselineKey, encode(value));
      } catch {
        /* verify same-key read-back */
      }
      if (digest(await baseline()) !== digest(value))
        throw new Error("恢复日志基线读回不一致。");
      return value.initializedAt;
    },
    /** Exhaustive offline read. Missing or unreadable objects block recovery. */
    async readAll() {
      const initial = await baseline();
      const entries: RecoveryEntry[] = [];
      const seen = new Set<string>();
      for await (const key of objects.keys(root)) {
        if (key === baselineKey) continue;
        if (seen.has(key)) throw new Error("恢复日志分页重复。");
        const bytes = await objects.read(key);
        if (!bytes) throw new Error("恢复日志对象缺失，必须保持恢复目标关闭。");
        const entry = recoveryEntrySchema.parse(
          JSON.parse(Buffer.from(bytes).toString("utf8")),
        );
        if (keyOf(entry) !== key) throw new Error("恢复日志路径与内容不一致。");
        if (initial.entries[key] && initial.entries[key] !== digest(entry))
          throw new Error("恢复日志基线校验失败。");
        seen.add(key);
        entries.push(entry);
      }
      if (Object.keys(initial.entries).some((key) => !seen.has(key)))
        throw new Error("恢复日志基线不完整。");
      return { initializedAt: initial.initializedAt, entries };
    },
  };
}
