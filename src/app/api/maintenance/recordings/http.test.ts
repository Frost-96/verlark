import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../../../db/client";
import { createPrivateRecordingFiles } from "../../../../integrations/files/private";
import {
  recordingAsset,
  recordingMaintenance,
} from "../../../../integrations/files/schema";
import { createLearningContent } from "../../../../modules/learning-content/server";
import { createPractice } from "../../../../modules/practice/server";
import {
  inspectMaterialWav,
  reviewContentDigest,
} from "../../../../integrations/material-audio/preparation";
import { handleRecordingMaintenance } from "./http";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("需要隔离 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
const secret = "maintenance-test-secret-at-least-32-characters";
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(() => connection.close());
beforeEach(async () => {
  await connection.db.delete(recordingAsset);
  await connection.db.delete(recordingMaintenance);
  // Reconcile prior withdrawn test fixtures through the module's maintenance API.
  const old = createLearningContent(connection.db, {
    files: {
      async putImmutable() {
        throw new Error("not used");
      },
      async read() {
        return null;
      },
      async remove() {},
    },
    now: () => new Date("2100-01-01T00:00:00Z"),
  });
  for (let batch = 0; batch < 20; batch++) {
    const result = await old.cleanupAudio(100);
    if (!result.cleaned && !result.failed) break;
  }
});
function request(mode?: string, authorized = true) {
  return new Request(
    `https://example.test/api/maintenance/recordings${mode ? `?mode=${mode}` : ""}`,
    {
      headers: authorized ? { authorization: `Bearer ${secret}` } : {},
    },
  );
}
async function fixture() {
  let now = new Date();
  const objects = new Map<string, Uint8Array>();
  let failRemoval = false;
  const store = {
    async authorize() {
      return "fixture-only";
    },
    async put(path: string, bytes: Uint8Array) {
      objects.set(path, bytes);
    },
    async putImmutable(bytes: Uint8Array) {
      const path = `materials/${crypto.randomUUID()}.wav`;
      objects.set(path, bytes);
      return path;
    },
    async read(path: string) {
      return objects.get(path) ?? null;
    },
    async remove(path: string) {
      if (failRemoval) throw new Error("provider-secret-must-not-leak");
      objects.delete(path);
    },
  };
  const files = createPrivateRecordingFiles(
    connection.db,
    store,
    async () => ({ mediaType: "audio/wav", durationMs: 1 }),
    { now: () => now },
  );
  const content = createLearningContent(connection.db, {
    files: store,
    now: () => now,
  });
  const practice = createPractice(connection.db, content, files, undefined, {
    now: () => now,
  });
  const bytes = Buffer.alloc(46);
  bytes.write("RIFF");
  bytes.writeUInt32LE(38, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(2, 40);
  async function material(withdraw: boolean) {
    const source = {
      materialKey: `maintenance-${crypto.randomUUID()}`,
      revision: 1,
      title: "测试材料",
      summary: "测试",
      materialText: "Hello.",
      translation: "你好。",
      task: "问候",
      keywords: ["hello"],
      sentenceStarters: ["Hello"],
      example: "Hello!",
    };
    const audio = inspectMaterialWav(bytes);
    const reference = await store.putImmutable(bytes);
    const published = await content.publish({
      ...source,
      privateAudio: {
        ...audio,
        reference,
        model: "fixture",
        voice: "fixture",
        parameters: {},
        review: {
          reviewer: "test fixture",
          reviewedAt: now.toISOString(),
          contentDigest: reviewContentDigest(source),
          audioDigest: audio.digest,
          note: "Fixture, not human quality evidence",
        },
      },
    });
    const practiceId = crypto.randomUUID();
    await connection.db.transaction((tx) =>
      content.retainPracticeReference(published.id, practiceId, tx),
    );
    if (withdraw) {
      await content.withdraw(published.id);
      await connection.db.transaction((tx) =>
        content.releasePracticeReference(published.id, practiceId, tx),
      );
    }
    return { id: published.id, reference };
  }
  return {
    services: { files, content, practice },
    objects,
    material,
    advance: (days: number) => {
      now = new Date(now.getTime() + days * 86400000);
    },
    failRemoval: (value: boolean) => {
      failRemoval = value;
    },
  };
}

test("未授权维护请求不能装配服务或访问数据库", async () => {
  const response = await handleRecordingMaintenance(
    request(undefined, false),
    () => {
      throw new Error("must not execute");
    },
    secret,
  );
  expect(response.status).toBe(401);
});
test("配置失败返回可恢复的中文 503，不泄露底层配置", async () => {
  const response = await handleRecordingMaintenance(
    request(),
    () => {
      throw new Error("database-secret-must-not-leak");
    },
    secret,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("database-secret");
});
test("每日入口清理撤下且零引用满 30 天的材料，同时保留在用材料和录音的未完成状态", async () => {
  const f = await fixture();
  const expired = await f.material(true);
  const retained = await f.material(false);
  const permit = await f.services.files.issueUpload({
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    mediaType: "audio/wav",
  });
  f.objects.set(permit.pathname, new Uint8Array([1]));
  f.advance(31);
  const response = await handleRecordingMaintenance(
    request(),
    () => f.services,
    secret,
  );
  expect(response.status).toBe(200);
  expect(f.objects.has(expired.reference)).toBe(false);
  expect(f.objects.has(retained.reference)).toBe(true);
  expect(await f.services.content.readVersion(expired.id)).toMatchObject({
    audioStatus: "cleaned",
  });
  expect(await response.json()).toMatchObject({
    materials: { cleaned: 1, failed: 0, pending: 0 },
    pending: 1,
    attentionRequired: true,
  });
});
test("只读日检不会执行清理或刷新扫描时间，并能看到等待重试的材料", async () => {
  const f = await fixture();
  const expired = await f.material(true);
  f.advance(31);
  f.failRemoval(true);
  await f.services.content.cleanupAudio();
  const before = await f.services.files.maintenanceStatus();
  const response = await handleRecordingMaintenance(
    request("status"),
    () => f.services,
    secret,
  );
  expect(await response.json()).toMatchObject({
    materials: { pending: 1 },
    scanOverdue: true,
    attentionRequired: true,
  });
  expect(f.objects.has(expired.reference)).toBe(true);
  expect(await f.services.files.maintenanceStatus()).toEqual(before);
  f.failRemoval(false);
  f.advance(1);
  await f.services.content.cleanupAudio();
});
test("材料删除失败会要求维护者处理，真实存储恢复后下一次扫描可以接手", async () => {
  const f = await fixture();
  const expired = await f.material(true);
  f.advance(31);
  f.failRemoval(true);
  const failed = await handleRecordingMaintenance(
    request(),
    () => f.services,
    secret,
  );
  expect(await failed.json()).toMatchObject({
    materials: { failed: 1, pending: 1 },
    attentionRequired: true,
  });
  expect(f.objects.has(expired.reference)).toBe(true);
  f.failRemoval(false);
  f.advance(1);
  const recovered = await handleRecordingMaintenance(
    request(),
    () => f.services,
    secret,
  );
  expect(await recovered.json()).toMatchObject({
    materials: { cleaned: 1, failed: 0, pending: 0 },
    attentionRequired: false,
  });
  expect(f.objects.has(expired.reference)).toBe(false);
});

test("录音清理等待重试期间仍显示未完成，不能在下次重试前报告健康", async () => {
  const f = await fixture();
  const permit = await f.services.files.issueUpload({
    learnerId: crypto.randomUUID(),
    practiceId: crypto.randomUUID(),
    uploadId: crypto.randomUUID(),
    mediaType: "audio/wav",
  });
  f.objects.set(permit.pathname, new Uint8Array([1]));
  f.advance(1);
  await handleRecordingMaintenance(request(), () => f.services, secret);
  const status = await handleRecordingMaintenance(
    request("status"),
    () => f.services,
    secret,
  );
  expect(await status.json()).toMatchObject({
    due: 0,
    pending: 1,
    cleanupOverdue: false,
    attentionRequired: true,
  });
});
