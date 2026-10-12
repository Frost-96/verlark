import { createHash } from "node:crypto";
import { and, eq, lte, gt, isNull, or, count, min, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import type { Recording, RecordingFiles } from "./contracts";
import { recordingAsset, recordingMaintenance } from "./schema";
import {
  uploadInventorySchema,
  deletionMarkerSchema,
  type UploadInventory,
  type DeletionMarker,
  type RecoveryJournal,
} from "../recovery/contracts";

export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
type Scope = { learnerId: string; practiceId: string };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type ValidateAudio = (
  bytes: Uint8Array,
) => Promise<{ mediaType: string; durationMs: number }>;
/** External provider seam: all reads go to private origin, never a public cache. */
export interface PrivateObjectStore {
  authorize(path: string, mediaType: string, validUntil: Date): Promise<string>;
  read(path: string): Promise<Uint8Array | null>;
  put(path: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  remove(path: string): Promise<void>;
}
export function createPrivateRecordingFiles(
  db: Database,
  store: PrivateObjectStore,
  validate: ValidateAudio,
  clock = { now: () => new Date() },
  options = { uploadsEnabled: true, requireMaintenance: false },
  journal?: RecoveryJournal,
) {
  type Row = typeof recordingAsset.$inferSelect;
  function inventory(row: Row): UploadInventory {
    return {
      kind: "upload",
      id: row.id,
      learnerId: row.learnerId,
      practiceId: row.practiceId,
      temporaryPath: row.temporaryPath,
      finalPath: row.finalPath,
      requestedMediaType: row.requestedMediaType,
      createdAt: row.createdAt.toISOString(),
      permitExpiresAt: row.permitExpiresAt.toISOString(),
    };
  }
  function id(reference: string) {
    if (
      !/^recording:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        reference,
      )
    )
      throw new Error("录音引用无效。");
    return reference.slice(10);
  }
  function recording(row: Row): Recording {
    if (
      !row.digest ||
      !row.size ||
      !row.mediaType ||
      row.sealed ||
      row.expiresAt <= clock.now()
    )
      throw new Error("录音尚未就绪或已到期。");
    return {
      reference: `recording:${row.id}`,
      learnerId: row.learnerId,
      practiceId: row.practiceId,
      mediaType: row.mediaType,
      digest: row.digest,
      size: row.size,
    };
  }
  async function lookup(
    reference: string,
    reader: Pick<Database, "select"> = db,
  ) {
    return (
      await reader
        .select()
        .from(recordingAsset)
        .where(eq(recordingAsset.id, id(reference)))
    )[0];
  }
  async function clean(row: Row) {
    await Promise.all([
      store.remove(row.finalPath),
      store.remove(row.temporaryPath),
    ]);
    const remaining = await Promise.all([
      store.read(row.finalPath),
      store.read(row.temporaryPath),
    ]);
    if (remaining.some(Boolean)) throw new Error("对象仍存在，清理未完成。");
    // This is deliberately incomplete until the provider supplies verifiable upload quiescence.
    return "已删除已知对象；尚未核实在途或分段上传，清理未完成。";
  }
  const adapter = {
    mode: "private" as const,
    async recoveryInventory(): Promise<UploadInventory[]> {
      return (await db.select().from(recordingAsset)).map(inventory);
    },
    /** Restores metadata only. Never reads or deletes production objects during a drill. */
    async replayInventory(
      entries: UploadInventory[],
      deletions: DeletionMarker[],
    ) {
      for (const input of entries) {
        const entry = uploadInventorySchema.parse(input);
        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(recordingAsset)
            .where(eq(recordingAsset.id, entry.id))
            .for("update");
          if (existing) {
            if (
              JSON.stringify(
                uploadInventorySchema.parse(inventory(existing)),
              ) !== JSON.stringify(entry)
            )
              throw new Error("恢复文件清单归属或路径冲突。");
          } else {
            await tx.insert(recordingAsset).values({
              id: entry.id,
              learnerId: entry.learnerId,
              practiceId: entry.practiceId,
              temporaryPath: entry.temporaryPath,
              finalPath: entry.finalPath,
              requestedMediaType: entry.requestedMediaType,
              createdAt: new Date(entry.createdAt),
              permitExpiresAt: new Date(entry.permitExpiresAt),
              expiresAt: new Date(
                Math.min(
                  clock.now().getTime(),
                  new Date(entry.createdAt).getTime() + 86400000,
                ),
              ),
              cleanupAfter: clock.now(),
              sealed: true,
            });
          }
        });
      }
      for (const input of deletions) {
        const marker = deletionMarkerSchema.parse(input);
        await db
          .update(recordingAsset)
          .set({
            sealed: true,
            leaseToken: null,
            leaseExpiresAt: null,
            expiresAt: sql`least(${recordingAsset.expiresAt}, ${marker.deletedAt}::timestamptz)`,
            cleanupAfter: clock.now(),
          })
          .where(
            and(
              eq(recordingAsset.practiceId, marker.practiceId),
              eq(recordingAsset.learnerId, marker.learnerId),
            ),
          );
      }
    },
    async issueUpload(input: Scope & { uploadId: string; mediaType: string }) {
      if (!options.uploadsEnabled)
        throw new Error("新增上传已暂停，等待维护者核实服务额度。");
      if (options.requireMaintenance) {
        const status = await adapter.maintenanceStatus();
        if (status.scanOverdue || status.cleanupOverdue || status.due > 20)
          throw new Error("清理扫描逾期或积压，已暂停新增上传。");
      }
      const now = clock.now();
      const expires = new Date(now.getTime() + 86400000);
      await db
        .insert(recordingAsset)
        .values({
          id: input.uploadId,
          learnerId: input.learnerId,
          practiceId: input.practiceId,
          requestedMediaType: input.mediaType,
          temporaryPath: `temporary/${crypto.randomUUID()}/${input.uploadId}`,
          finalPath: `recordings/${crypto.randomUUID()}/${input.uploadId}`,
          createdAt: now,
          permitExpiresAt: new Date(now.getTime() + 300000),
          expiresAt: expires,
          cleanupAfter: expires,
        })
        .onConflictDoNothing();
      const row = await lookup(`recording:${input.uploadId}`);
      if (
        !row ||
        row.learnerId !== input.learnerId ||
        row.practiceId !== input.practiceId ||
        row.requestedMediaType !== input.mediaType ||
        row.sealed ||
        row.permitExpiresAt <= now
      )
        throw new Error("上传标识冲突或许可已到期，请重新录音。");
      await journal?.recordUpload(inventory(row));
      const current = await lookup(`recording:${row.id}`);
      if (!current || current.sealed || current.permitExpiresAt <= clock.now())
        throw new Error("上传许可已失效。");
      return {
        reference: `recording:${row.id}`,
        pathname: row.temporaryPath,
        clientToken: await store.authorize(
          row.temporaryPath,
          input.mediaType,
          row.permitExpiresAt,
        ),
      };
    },
    async completeUpload(scope: Scope, reference: string) {
      const claim = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(recordingAsset)
          .where(eq(recordingAsset.id, id(reference)))
          .for("update");
        if (
          !row ||
          row.learnerId !== scope.learnerId ||
          row.practiceId !== scope.practiceId ||
          row.sealed ||
          row.expiresAt <= clock.now()
        )
          throw new Error("上传不属于本次练习或已到期。");
        if (row.digest) return { row, token: null };
        if (row.leaseExpiresAt && row.leaseExpiresAt > clock.now())
          throw new Error("上传仍在校验，请稍后核对。");
        const token = crypto.randomUUID();
        await tx
          .update(recordingAsset)
          .set({
            leaseToken: token,
            leaseExpiresAt: new Date(clock.now().getTime() + 60000),
          })
          .where(eq(recordingAsset.id, row.id));
        return { row, token };
      });
      const { row, token } = claim;
      if (!token) return recording(row);
      try {
        const bytes = await store.read(row.temporaryPath);
        if (!bytes?.length || bytes.length > MAX_RECORDING_BYTES)
          throw new Error("上传未完成或录音大小无效。");
        const media = await validate(bytes);
        const digest = createHash("sha256").update(bytes).digest("hex");
        // Recover an uncertain final write without overwriting it. The client never receives a write permit for this path.
        const existing = await store.read(row.finalPath);
        if (!existing) await store.put(row.finalPath, bytes, media.mediaType);
        const final = await store.read(row.finalPath);
        if (
          !final ||
          createHash("sha256").update(final).digest("hex") !== digest
        )
          throw new Error("最终录音内容冲突，不能接收。");
        const [saved] = await db
          .update(recordingAsset)
          .set({
            ...media,
            digest,
            size: final.length,
            leaseToken: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(recordingAsset.id, row.id),
              eq(recordingAsset.leaseToken, token),
              gt(recordingAsset.leaseExpiresAt, clock.now()),
              eq(recordingAsset.sealed, false),
              gt(recordingAsset.expiresAt, clock.now()),
            ),
          )
          .returning();
        if (!saved) throw new Error("上传处理权已失效，不能接收迟到结果。");
        return recording(saved!);
      } catch (error) {
        await db
          .update(recordingAsset)
          .set({ leaseToken: null, leaseExpiresAt: null })
          .where(
            and(
              eq(recordingAsset.id, row.id),
              eq(recordingAsset.leaseToken, token),
            ),
          );
        throw error;
      }
    },
    async accept(reference: string, acceptedAt: Date, tx: Transaction) {
      const [row] = await tx
        .select()
        .from(recordingAsset)
        .where(eq(recordingAsset.id, id(reference)))
        .for("update");
      if (!row) throw new Error("录音不存在。");
      recording(row);
      if (row.acceptedAt) throw new Error("录音已被接收，不能另计作答。");
      const expires = new Date(acceptedAt.getTime() + 30 * 86400000);
      await tx
        .update(recordingAsset)
        .set({ acceptedAt, expiresAt: expires, cleanupAfter: expires })
        .where(eq(recordingAsset.id, row.id));
    },
    async save(): Promise<Recording> {
      throw new Error("正式录音须通过私有直传。");
    },
    async inspect(reference: string) {
      try {
        const row = await lookup(reference);
        return row ? recording(row) : null;
      } catch {
        return null;
      }
    },
    async read(reference: string) {
      const row = await lookup(reference);
      if (!row) return null;
      let metadata: Recording;
      try {
        metadata = recording(row);
      } catch {
        return null;
      }
      const bytes = await store.read(row.finalPath);
      if (
        !bytes ||
        bytes.length !== row.size ||
        createHash("sha256").update(bytes).digest("hex") !== row.digest
      )
        return null;
      const current = await lookup(reference);
      if (!current || current.sealed || current.expiresAt <= clock.now())
        return null;
      return { ...metadata, bytes };
    },
    async removePractice(scope: Scope) {
      await db
        .update(recordingAsset)
        .set({
          sealed: true,
          expiresAt: sql`least(${recordingAsset.expiresAt}, ${clock.now().toISOString()}::timestamptz)`,
          cleanupAfter: clock.now(),
        })
        .where(
          and(
            eq(recordingAsset.learnerId, scope.learnerId),
            eq(recordingAsset.practiceId, scope.practiceId),
            eq(recordingAsset.sealed, false),
          ),
        );
      await db
        .update(recordingAsset)
        .set({ sealed: true, leaseToken: null, leaseExpiresAt: null })
        .where(
          and(
            eq(recordingAsset.learnerId, scope.learnerId),
            eq(recordingAsset.practiceId, scope.practiceId),
          ),
        );
      const rows = await db
        .select()
        .from(recordingAsset)
        .where(
          and(
            eq(recordingAsset.learnerId, scope.learnerId),
            eq(recordingAsset.practiceId, scope.practiceId),
          ),
        )
        .orderBy(recordingAsset.cleanupAfter, recordingAsset.id)
        .limit(20);
      const deadline = Date.now() + 20000;
      for (const row of rows) {
        if (Date.now() >= deadline) break;
        let failure: string;
        try {
          failure = await clean(row);
        } catch {
          failure = "对象删除失败或结果未知，等待重试。";
        }
        await db
          .update(recordingAsset)
          .set({
            cleanupAfter: new Date(clock.now().getTime() + 3600000),
            cleanupFailure: failure,
          })
          .where(eq(recordingAsset.id, row.id));
      }
      // Token expiry alone cannot prove in-flight uploads stopped. Do not report completed.
      if (rows.length)
        throw new Error(
          "已封闭录音访问；仍需核实可能晚到的上传，清理尚未完成。",
        );
    },
    async cleanupBatch(limit = 20) {
      const deadline = Date.now() + 20000;
      let processed = 0;
      let pending = 0;
      while (
        processed < Math.max(1, Math.min(limit, 20)) &&
        Date.now() < deadline
      ) {
        const claim = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(recordingAsset)
            .where(
              and(
                lte(recordingAsset.cleanupAfter, clock.now()),
                or(
                  isNull(recordingAsset.leaseExpiresAt),
                  lte(recordingAsset.leaseExpiresAt, clock.now()),
                ),
              ),
            )
            .orderBy(recordingAsset.cleanupAfter, recordingAsset.id)
            .limit(1)
            .for("update", { skipLocked: true });
          if (!row) return null;
          const token = crypto.randomUUID();
          await tx
            .update(recordingAsset)
            .set({
              sealed: true,
              leaseToken: token,
              leaseExpiresAt: new Date(clock.now().getTime() + 60000),
            })
            .where(eq(recordingAsset.id, row.id));
          return { row, token };
        });
        if (!claim) break;
        // All provider calls run outside the short lease/CAS transactions.
        let failure: string;
        try {
          failure = await clean(claim.row);
        } catch {
          failure = "对象删除失败或结果未知，等待重试。";
        }
        await db
          .update(recordingAsset)
          .set({
            cleanupAfter: new Date(clock.now().getTime() + 3600000),
            cleanupFailure: failure,
            leaseToken: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(recordingAsset.id, claim.row.id),
              eq(recordingAsset.leaseToken, claim.token),
              gt(recordingAsset.leaseExpiresAt, clock.now()),
            ),
          );
        pending++;
        processed++;
      }
      const [remaining] = await db
        .select({ count: count() })
        .from(recordingAsset)
        .where(lte(recordingAsset.cleanupAfter, clock.now()));
      await db
        .insert(recordingMaintenance)
        .values({
          id: 1,
          lastRunAt: clock.now(),
          lastCompletedScanAt: remaining?.count === 0 ? clock.now() : null,
        })
        .onConflictDoUpdate({
          target: recordingMaintenance.id,
          set: {
            lastRunAt: clock.now(),
            ...(remaining?.count === 0
              ? { lastCompletedScanAt: clock.now() }
              : {}),
          },
        });
      return { processed, pending };
    },
    async maintenanceStatus() {
      const [state] = await db
        .select()
        .from(recordingMaintenance)
        .where(eq(recordingMaintenance.id, 1));
      const [backlog] = await db
        .select({ count: count() })
        .from(recordingAsset)
        .where(lte(recordingAsset.cleanupAfter, clock.now()));
      const [pending] = await db
        .select({ oldest: min(recordingAsset.expiresAt), count: count() })
        .from(recordingAsset)
        .where(lte(recordingAsset.expiresAt, clock.now()));
      return {
        lastRunAt: state?.lastRunAt.toISOString() ?? null,
        lastCompletedScanAt: state?.lastCompletedScanAt?.toISOString() ?? null,
        due: backlog?.count ?? 0,
        pending: pending?.count ?? 0,
        scanOverdue:
          !state?.lastCompletedScanAt ||
          state.lastCompletedScanAt.getTime() + 26 * 3600000 <
            clock.now().getTime(),
        cleanupOverdue:
          !!pending?.oldest &&
          new Date(pending.oldest).getTime() + 48 * 3600000 <
            clock.now().getTime(),
      };
    },
  } satisfies RecordingFiles & {
    recoveryInventory(): Promise<UploadInventory[]>;
    replayInventory(
      entries: UploadInventory[],
      deletions: DeletionMarker[],
    ): Promise<void>;
  };
  return adapter;
}
