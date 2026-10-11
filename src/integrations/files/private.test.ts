import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import {
  createPrivateRecordingFiles,
  type PrivateObjectStore,
} from "./private";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
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
