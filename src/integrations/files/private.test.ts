import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import {
  createPrivateRecordingFiles,
  type PrivateObjectStore,
} from "./private";
import { recordingAsset, recordingMaintenance } from "./schema";
import { eq } from "drizzle-orm";
import type { UploadInventory } from "../recovery/contracts";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
// Isolated technical inventory fixture; behavior assertions use the adapter's public interface.
beforeEach(async () => {
  await connection.db.delete(recordingAsset);
  await connection.db.delete(recordingMaintenance);
});
afterAll(() => connection.close());
function storeFixture() {
  const objects = new Map<string, Uint8Array>();
  const store: PrivateObjectStore = {
    async authorize(path) {
      return `test-permit:${path}`;
    },
    async read(path) {
      return objects.get(path) ?? null;
    },
    async put(path, bytes) {
      if (objects.has(path)) throw new Error("immutable");
      objects.set(path, bytes.slice());
    },
    async remove(path) {
      objects.delete(path);
    },
  };
  return { objects, store };
}
test("独立清单写入失败不签发许可，重试保留相同上传路径", async () => {
  const { store } = storeFixture();
  let failed = true;
  let authorizations = 0;
  const logged: UploadInventory[] = [];
  const files = createPrivateRecordingFiles(
    connection.db,
    {
      ...store,
      async authorize(...args) {
        authorizations++;
        return store.authorize(...args);
      },
    },
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    undefined,
    undefined,
    {
      async recordUpload(entry) {
        logged.push(entry);
        if (failed) throw new Error("journal offline");
      },
      async recordDeletion(entry) {
        return entry;
      },
    },
  );
  const input = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  };
  await expect(files.issueUpload(input)).rejects.toThrow("journal offline");
  expect(authorizations).toBe(0);
  failed = false;
  const permit = await files.issueUpload(input);
  expect(authorizations).toBe(1);
  expect(logged[0]).toEqual(logged[1]);
  expect(permit.pathname).toBe(logged[0]!.temporaryPath);
});

test("恢复备份后新增的清单时封闭孤立文件，重放不重置到期时间且不操作对象", async () => {
  const { store } = storeFixture();
  let now = new Date("2000-01-01T00:00:00Z");
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const input = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  };
  const permit = await files.issueUpload(input);
  const inventory = await files.recoveryInventory();
  // Simulate an inventory row absent from an older backup. Full pg_dump drill is separate.
  await connection.db
    .delete(recordingAsset)
    .where(eq(recordingAsset.id, input.uploadId));
  const forbidden = async (): Promise<never> => {
    throw new Error("audio I/O during recovery");
  };
  const recovery = createPrivateRecordingFiles(
    connection.db,
    {
      authorize: forbidden,
      read: forbidden,
      put: forbidden,
      remove: forbidden,
    },
    forbidden,
    { now: () => now },
  );
  now = new Date("2000-01-05T00:00:00Z");
  await recovery.replayInventory(inventory, []);
  const [first] = await connection.db.select().from(recordingAsset);
  expect(first).toMatchObject({
    sealed: true,
    digest: null,
    createdAt: new Date("2000-01-01T00:00:00Z"),
    expiresAt: new Date("2000-01-02T00:00:00Z"),
  });
  expect(await recovery.read(permit.reference)).toBeNull();
  await expect(
    recovery.completeUpload(input, permit.reference),
  ).rejects.toThrow("已到期");
  now = new Date("2000-01-06T00:00:00Z");
  await recovery.replayInventory(inventory, []);
  expect(
    (await connection.db.select().from(recordingAsset))[0]!.expiresAt,
  ).toEqual(first!.expiresAt);
  await expect(
    recovery.replayInventory([{ ...inventory[0]!, learnerId: "other" }], []),
  ).rejects.toThrow("冲突");
});
test("私有上传校验后固定最终字节，临时键被改写不能改变引用；隔离所有权", async () => {
  const { objects, store } = storeFixture();
  const files = createPrivateRecordingFiles(connection.db, store, async () => ({
    mediaType: "audio/webm",
    durationMs: 1000,
  }));
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const permit = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  expect(permit.reference).not.toContain("https:");
  expect(await files.inspect(permit.reference)).toBeNull();
  objects.set(permit.pathname, new Uint8Array([1, 2, 3]));
  const ready = await files.completeUpload(scope, permit.reference);
  objects.set(permit.pathname, new Uint8Array([4, 5, 6]));
  expect(await files.completeUpload(scope, permit.reference)).toEqual(ready);
  expect(Array.from((await files.read(ready.reference))!.bytes)).toEqual([
    1, 2, 3,
  ]);
  await expect(
    files.completeUpload({ ...scope, learnerId: "other" }, permit.reference),
  ).rejects.toThrow();
});

test("未接收上传 24 小时后不可接收，删除封闭迟到完成，未知在途上传不能谎报清理完成", async () => {
  const { objects, store } = storeFixture();
  let now = new Date();
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const permit = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  objects.set(permit.pathname, new Uint8Array([1, 2, 3]));
  await files.completeUpload(scope, permit.reference);
  now = new Date(now.getTime() + 86400000);
  expect(await files.read(permit.reference)).toBeNull();
  await expect(files.completeUpload(scope, permit.reference)).rejects.toThrow();
  await expect(files.removePractice(scope)).rejects.toThrow("晚到");
  objects.set(permit.pathname, new Uint8Array([9]));
  await expect(files.completeUpload(scope, permit.reference)).rejects.toThrow();
  now = new Date(now.getTime() + 3600000);
  const report = await files.cleanupBatch(10);
  expect(report.pending).toBeGreaterThan(0);
  expect(objects.has(permit.pathname)).toBe(false);
});

test("校验在外部写入时删除不阻塞，迟到处理权不能发布最终录音", async () => {
  const { objects, store } = storeFixture();
  let release!: () => void;
  let writing!: () => void;
  const started = new Promise<void>((resolve) => {
    writing = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files = createPrivateRecordingFiles(
    connection.db,
    {
      ...store,
      async put(path, bytes, mediaType) {
        writing();
        await gate;
        await store.put(path, bytes, mediaType);
      },
    },
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const permit = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  objects.set(permit.pathname, new Uint8Array([1, 2, 3]));
  const completing = files.completeUpload(scope, permit.reference);
  await started;
  await expect(files.removePractice(scope)).rejects.toThrow("晚到");
  release();
  await expect(completing).rejects.toThrow("失效");
  expect(await files.read(permit.reference)).toBeNull();
});

test("已接受限制超过 48 小时且超过一批仍可上传，真实删除失败继续阻断", async () => {
  const { objects, store } = storeFixture();
  let now = new Date("2000-01-01T00:00:00Z");
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  for (let i = 0; i < 21; i++) {
    const permit = await files.issueUpload({
      ...scope,
      uploadId: crypto.randomUUID(),
      mediaType: "audio/webm",
    });
    objects.set(permit.pathname, new Uint8Array([1]));
  }
  now = new Date("2000-01-02T00:00:00Z");
  expect((await files.cleanupBatch()).processed).toBe(20);
  expect(objects.size).toBe(1);
  expect((await files.cleanupBatch()).processed).toBe(1);
  expect(objects.size).toBe(0);
  now = new Date("2000-01-04T01:00:00Z");
  await files.cleanupBatch();
  await files.cleanupBatch();
  expect(await files.maintenanceStatus()).toMatchObject({
    due: 0,
    scanOverdue: false,
    cleanupOverdue: false,
    providerUnverified: 21,
    actionablePending: 0,
  });
  const gated = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
    { uploadsEnabled: true, requireMaintenance: true },
  );
  await expect(
    gated.issueUpload({
      ...scope,
      uploadId: crypto.randomUUID(),
      mediaType: "audio/webm",
    }),
  ).resolves.toHaveProperty("clientToken");
  store.remove = async () => {
    throw new Error("provider unavailable");
  };
  now = new Date("2000-01-04T03:00:00Z");
  await files.cleanupBatch();
  expect(await files.maintenanceStatus()).toMatchObject({
    cleanupOverdue: true,
    actionablePending: 20,
  });
  await expect(
    gated.issueUpload({
      ...scope,
      uploadId: crypto.randomUUID(),
      mediaType: "audio/webm",
    }),
  ).rejects.toThrow("暂停新增上传");
});

test("删除已到期但尚未扫描的录音不能重置 48 小时清理时钟", async () => {
  const { store } = storeFixture();
  let now = new Date("2000-01-01T00:00:00Z");
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  now = new Date("2000-01-05T00:00:00Z");
  expect((await files.maintenanceStatus()).cleanupOverdue).toBe(true);
  store.remove = async () => {
    throw new Error("provider unavailable");
  };
  await expect(files.removePractice(scope)).rejects.toThrow("晚到");
  expect((await files.maintenanceStatus()).cleanupOverdue).toBe(true);
});

test("存储停用时保留清理清单与超期状态，恢复后可删除已知对象但不伪造最终完成", async () => {
  const { store, objects } = storeFixture();
  let suspended = false;
  let now = new Date("2000-01-01T00:00:00Z");
  const guarded: PrivateObjectStore = {
    ...store,
    async read(path) {
      if (suspended) throw new Error("provider suspended");
      return store.read(path);
    },
    async remove(path) {
      if (suspended) throw new Error("provider suspended");
      return store.remove(path);
    },
  };
  const files = createPrivateRecordingFiles(
    connection.db,
    guarded,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const upload = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  objects.set(upload.pathname, new Uint8Array([1, 2, 3]));
  await files.completeUpload(scope, upload.reference);
  suspended = true;
  await expect(files.read(upload.reference)).rejects.toThrow(
    "provider suspended",
  );
  await expect(files.removePractice(scope)).rejects.toThrow("清理尚未完成");
  expect(await files.inspect(upload.reference)).toBeNull();
  expect(objects.size).toBe(2);
  now = new Date("2000-01-04T00:00:00Z");
  await files.cleanupBatch();
  expect(await files.maintenanceStatus()).toMatchObject({
    pending: 1,
    cleanupOverdue: true,
  });
  suspended = false;
  now = new Date("2000-01-04T02:00:00Z");
  await files.cleanupBatch();
  expect(objects.size).toBe(0);
  expect(await files.maintenanceStatus()).toMatchObject({
    pending: 1,
    providerUnverified: 1,
    actionablePending: 0,
    cleanupOverdue: false,
  });
  expect(await files.read(upload.reference)).toBeNull();
});

test("上传校验租约到期可接手，旧处理者不能清除新处理者的结果", async () => {
  const { objects, store } = storeFixture();
  let now = new Date();
  let release!: () => void;
  let writing!: () => void;
  let first = true;
  const started = new Promise<void>((resolve) => {
    writing = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files = createPrivateRecordingFiles(
    connection.db,
    {
      ...store,
      async put(path, bytes, mediaType) {
        if (first) {
          first = false;
          writing();
          await gate;
        }
        await store.put(path, bytes, mediaType);
      },
    },
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const permit = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  objects.set(permit.pathname, new Uint8Array([1, 2, 3]));
  const old = files.completeUpload(scope, permit.reference);
  await started;
  now = new Date(now.getTime() + 60001);
  await files.completeUpload(scope, permit.reference);
  release();
  await expect(old).rejects.toThrow();
  expect(Array.from((await files.read(permit.reference))!.bytes)).toEqual([
    1, 2, 3,
  ]);
});

test("已知对象证据过期或仍有有效上传许可时不得豁免保护", async () => {
  const { store } = storeFixture();
  let now = new Date("2000-01-01T00:00:00Z");
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
    { now: () => now },
  );
  const scope = {
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
  };
  const permit = await files.issueUpload({
    ...scope,
    uploadId: crypto.randomUUID(),
    mediaType: "audio/webm",
  });
  await expect(files.removePractice(scope)).rejects.toThrow();
  expect(await files.maintenanceStatus()).toMatchObject({
    providerUnverified: 0,
    actionablePending: 1,
  });
  now = new Date("2000-01-01T00:06:00Z");
  expect(await files.maintenanceStatus()).toMatchObject({
    providerUnverified: 1,
    actionablePending: 0,
  });
  now = new Date("2000-01-04T00:00:00Z");
  expect(await files.maintenanceStatus()).toMatchObject({
    providerUnverified: 0,
    actionablePending: 1,
    cleanupOverdue: true,
    scanOverdue: true,
  });
  expect(await files.read(permit.reference)).toBeNull();
});
