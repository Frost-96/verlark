import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase } from "../../db/client";
import { user } from "../identity/schema";
import { createLearningContent } from "../learning-content/server";
import { createPractice } from "./server";
import { createRecordingFiles } from "../../integrations/files/server";
import { createPrivateRecordingFiles } from "../../integrations/files/private";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
const content = createLearningContent(connection.db);
const alice = {
  id: crypto.randomUUID(),
  email: `${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `${crypto.randomUUID()}@example.com`,
  name: "乙",
};
let directory: string;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
  directory = await mkdtemp(join(tmpdir(), "verlark-private-audio-"));
});

test("上传许可只授予练习所有者，确认上传与原子接收分开，删除后许可不能形成作答", async () => {
  const objects = new Map<string, Uint8Array>();
  const files = createPrivateRecordingFiles(
    connection.db,
    {
      authorize: async () => "test-token",
      read: async (path) => objects.get(path) ?? null,
      put: async (path, bytes) => {
        objects.set(path, bytes);
      },
      remove: async (path) => {
        objects.delete(path);
      },
    },
    async () => ({ mediaType: "audio/webm", durationMs: 1000 }),
  );
  const service = createPractice(connection.db, content, files);
  const source = await content.publish({
    materialKey: `private-${crypto.randomUUID()}`,
    revision: 1,
    title: "计划",
    summary: "周末",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说你的计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I will …"],
    example: "I will read.",
    audioPath: "/audio/weekend-v1.wav",
  });
  const practice = await service.start(
    alice,
    source.materialKey,
    crypto.randomUUID(),
  );
  const input = { uploadId: crypto.randomUUID(), mediaType: "audio/webm" };
  await expect(
    service.issueRecordingUpload(bob, practice.id, input),
  ).rejects.toMatchObject({ code: "not-found" });
  const permit = await service.issueRecordingUpload(alice, practice.id, input);
  await expect(
    service.completeRecordingUpload(bob, practice.id, permit.reference),
  ).rejects.toMatchObject({ code: "not-found" });
  objects.set(permit.pathname, new Uint8Array([1, 2, 3]));
  await service.completeRecordingUpload(alice, practice.id, permit.reference);
  expect((await service.read(alice, practice.id)).attempts).toHaveLength(0);
  const submissionId = crypto.randomUUID();
  const accepted = await Promise.all([
    service.submit(alice, practice.id, submissionId, permit.reference),
    service.submit(alice, practice.id, submissionId, permit.reference),
  ]);
  expect(accepted[0].id).toBe(accepted[1].id);
  await service.delete(alice, practice.id);
  await expect(
    service.completeRecordingUpload(alice, practice.id, permit.reference),
  ).rejects.toMatchObject({ code: "not-found" });
  await expect(
    service.readRecording(alice, practice.id, accepted[0].id),
  ).rejects.toMatchObject({ code: "not-found" });
});
afterAll(async () => {
  await connection.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("作答录音由所有者回放，30 天到期立即拒绝新回放和识别，保留文字历史", async () => {
  let now = new Date();
  const service = createPractice(
    connection.db,
    content,
    createRecordingFiles({ development: true, directory }),
    {
      mode: "development",
      recognize: async () => ({ kind: "recognized", text: "I will read." }),
    },
    { now: () => now },
  );
  const source = await content.publish({
    materialKey: `audio-${crypto.randomUUID()}`,
    revision: 1,
    title: "计划",
    summary: "周末",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说你的计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I will …"],
    example: "I will read.",
    audioPath: "/audio/weekend-v1.wav",
  });
  const practice = await service.start(
    alice,
    source.materialKey,
    crypto.randomUUID(),
  );
  const recording = await service.saveRecording(alice, practice.id, {
    bytes: new Uint8Array([1, 2, 3, 4]),
    mediaType: "audio/webm",
  });
  const attempt = await service.submit(
    alice,
    practice.id,
    crypto.randomUUID(),
    recording.reference,
  );
  expect(
    Array.from(
      (await service.readRecording(alice, practice.id, attempt.id)).bytes,
    ),
  ).toEqual([1, 2, 3, 4]);
  await expect(
    service.readRecording(bob, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "not-found" });
  await expect(
    service.readRecording(null, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "unauthorized" });
  now = new Date(new Date(attempt.acceptedAt).getTime() + 30 * 86400000);
  await expect(
    service.readRecording(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "recording-expired" });
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "recording-expired" });
  expect((await service.read(alice, practice.id)).attempts).toMatchObject([
    { id: attempt.id, recordingStatus: "expired" },
  ]);
  await service.delete(alice, practice.id);
  now = new Date(now.getTime() + 30 * 86400000);
  await service.pruneDeletionReceipts();
  expect(await service.readDeletion(alice, practice.id)).toMatchObject({
    status: "receipt-expired",
    failure: null,
    leaseExpiresAt: null,
  });
  await expect(service.readDeletion(bob, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
});
