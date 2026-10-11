import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase } from "../../db/client";
import { user } from "../identity/schema";
import { createLearningContent } from "../learning-content/server";
import type { Transcription } from "../../integrations/transcription/contracts";
import { createPractice } from "./server";
import { createRecordingFiles } from "../../integrations/files/server";

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
  email: `transcription-${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `transcription-${crypto.randomUUID()}@example.com`,
  name: "乙",
};
let directory: string;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
  directory = await mkdtemp(join(tmpdir(), "verlark-transcription-"));
});
afterAll(async () => {
  await connection.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture(
  recognize: Transcription["recognize"] = async () => ({
    kind: "recognized" as const,
    text: "I will reed tomorrow.",
  }),
  now = () => new Date(),
) {
  const files = createRecordingFiles({ development: true, directory });
  const service = createPractice(
    connection.db,
    content,
    files,
    { mode: "development", recognize },
    { now },
  );
  const material = await content.publish({
    materialKey: `transcribe-${crypto.randomUUID()}`,
    revision: 1,
    title: "计划",
    summary: "周末",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说你的计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I will …"],
    example: "I will swim.",
    audioPath: "/audio/weekend-v1.wav",
  });
  const practice = await service.start(
    alice,
    material.materialKey,
    crypto.randomUUID(),
  );
  const recording = await service.saveRecording(alice, practice.id, {
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/webm",
  });
  const attempt = await service.submit(
    alice,
    practice.id,
    crypto.randomUUID(),
    recording.reference,
  );
  return { service, practice, attempt, files };
}
test("整次删除持久化清理结果，拒绝跨账号，删除后不可读取或重发提交", async () => {
  const { service, practice, attempt, files } = await fixture();
  await expect(service.delete(bob, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  await expect(service.delete(null, practice.id)).rejects.toMatchObject({
    code: "unauthorized",
  });
  expect((await service.read(alice, practice.id)).attempts).toHaveLength(1);
  const result = await service.delete(alice, practice.id);
  expect(result).toMatchObject({ id: practice.id, status: "succeeded" });
  await expect(service.read(alice, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  await expect(
    service.findSubmission(alice, practice.id, attempt.submissionId),
  ).rejects.toMatchObject({ code: "not-found" });
  const resumed = createPractice(connection.db, content, files);
  expect(await resumed.readDeletion(alice, practice.id)).toEqual(result);
  expect(await resumed.delete(alice, practice.id)).toMatchObject({
    status: "succeeded",
  });
  expect(
    (await resumed.list(alice)).some((item) => item.id === practice.id),
  ).toBe(false);
});

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("部分文件清理失败不谎报成功，新实例可重试；跨账号无法读取清理状态", async () => {
  const { practice, files } = await fixture();
  let fail = true;
  const service = createPractice(connection.db, content, {
    ...files,
    async removePractice(scope) {
      if (fail) {
        fail = false;
        throw new Error("Provider failure");
      }
      await files.removePractice(scope);
    },
  });
  expect(await service.delete(alice, practice.id)).toMatchObject({
    status: "failed",
    failure: expect.stringContaining("未完成"),
  });
  await expect(service.readDeletion(bob, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  const resumed = createPractice(connection.db, content, files);
  expect(await resumed.readDeletion(alice, practice.id)).toMatchObject({
    status: "failed",
  });
  expect(await resumed.retryDeletion(alice, practice.id)).toMatchObject({
    status: "succeeded",
    failure: null,
  });
  expect(await resumed.retryDeletion(alice, practice.id)).toMatchObject({
    status: "succeeded",
  });
});

test("识别迟到结果不能恢复已删除的作答", async () => {
  const entered = gate<void>();
  const remote = gate<{ kind: "recognized"; text: string }>();
  const { service, practice, attempt } = await fixture(async () => {
    entered.resolve();
    return remote.promise;
  });
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await entered.promise;
  await service.delete(alice, practice.id);
  remote.resolve({ kind: "recognized", text: "I will read." });
  expect(await pending).toMatchObject({ code: "not-found" });
  await expect(service.read(alice, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
});

test("反馈迟到结果不能挂回已删除的确认文本", async () => {
  const { service, practice, attempt, files } = await fixture();
  const recognized = await service.recognize(alice, practice.id, attempt.id);
  const confirmed = await service.confirmTranscript(
    alice,
    practice.id,
    attempt.id,
    {
      rawTranscriptId: recognized.rawTranscript!.id,
      expectedConfirmationId: null,
      text: "I will read.",
    },
  );
  const entered = gate<void>();
  const remote = gate<void>();
  const working = createPractice(
    connection.db,
    content,
    files,
    undefined,
    undefined,
    {
      mode: "development",
      async generate() {
        entered.resolve();
        await remote.promise;
        return {
          kind: "generated",
          summary: "表达清楚。",
          issues: [],
          alternatives: [],
          provenance: { provider: "test", model: "test" },
        };
      },
    },
  );
  const pending = working
    .requestFeedback(
      alice,
      practice.id,
      attempt.id,
      confirmed.confirmations[0]!.id,
    )
    .catch((error) => error);
  await entered.promise;
  await service.delete(alice, practice.id);
  remote.resolve();
  expect(await pending).toMatchObject({ code: "not-found" });
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, {
      rawTranscriptId: recognized.rawTranscript!.id,
      expectedConfirmationId: confirmed.confirmations[0]!.id,
      text: "I will swim.",
    }),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("删除赢过提交，稍后文件检查返回也不能新增作答", async () => {
  const { service, practice, files } = await fixture();
  const recording = await service.saveRecording(alice, practice.id, {
    mediaType: "audio/webm",
    bytes: new Uint8Array([8]),
  });
  const entered = gate<void>();
  const resume = gate<void>();
  const racing = createPractice(connection.db, content, {
    ...files,
    async inspect(reference) {
      const found = await files.inspect(reference);
      entered.resolve();
      await resume.promise;
      return found;
    },
  });
  const pending = racing
    .submit(alice, practice.id, crypto.randomUUID(), recording.reference)
    .catch((error) => error);
  await entered.promise;
  await service.delete(alice, practice.id);
  resume.resolve();
  expect(await pending).toMatchObject({ code: "not-found" });
  expect(await files.read(recording.reference)).toBeNull();
});

test.each(["before", "after"])(
  "删除与上传并发（%s save），保存结果不能恢复文件",
  async (position) => {
    const { service, practice, files } = await fixture();
    const entered = gate<void>();
    const resume = gate<void>();
    let reference: string | undefined;
    const racing = createPractice(connection.db, content, {
      ...files,
      async save(input) {
        if (position === "before") {
          entered.resolve();
          await resume.promise;
        }
        const saved = await files.save(input);
        reference = saved.reference;
        if (position === "after") {
          entered.resolve();
          await resume.promise;
        }
        return saved;
      },
    });
    const pending = racing
      .saveRecording(alice, practice.id, {
        mediaType: "audio/webm",
        bytes: new Uint8Array([99]),
      })
      .catch((error) => error);
    await entered.promise;
    await service.delete(alice, practice.id);
    resume.resolve();
    expect(await pending).toBeInstanceOf(Error);
    if (reference) expect(await files.read(reference)).toBeNull();
    expect(await service.readDeletion(alice, practice.id)).toMatchObject({
      status: "succeeded",
    });
  },
);

test("清理进程失联后可以恢复，旧清理失败不覆盖新成功结果", async () => {
  const { practice, files } = await fixture();
  let time = new Date();
  const entered = gate<void>();
  const resume = gate<void>();
  const stalled = createPractice(
    connection.db,
    content,
    {
      ...files,
      async removePractice() {
        entered.resolve();
        await resume.promise;
        throw new Error("late provider failure");
      },
    },
    undefined,
    { now: () => time },
  );
  const pending = stalled.delete(alice, practice.id);
  await entered.promise;
  const recovered = createPractice(connection.db, content, files, undefined, {
    now: () => time,
  });
  expect(await recovered.readDeletion(alice, practice.id)).toMatchObject({
    status: "processing",
  });
  time = new Date(time.getTime() + 60001);
  expect(await recovered.retryDeletion(alice, practice.id)).toMatchObject({
    status: "succeeded",
  });
  resume.resolve();
  expect(await pending).toMatchObject({ status: "succeeded" });
});

test("零作答及旧内容版本练习可以删除，同一开始请求不能复活它", async () => {
  const { service, practice } = await fixture();
  const request = crypto.randomUUID();
  const empty = await service.start(
    alice,
    practice.content.materialKey,
    request,
  );
  const {
    materialKey,
    summary,
    materialText,
    translation,
    task,
    keywords,
    sentenceStarters,
    example,
    audioPath,
  } = practice.content;
  await content.publish({
    materialKey,
    summary,
    materialText,
    translation,
    task,
    keywords,
    sentenceStarters,
    example,
    audioPath,
    revision: 2,
    title: "新版",
  });
  expect(await service.delete(alice, empty.id)).toMatchObject({
    status: "succeeded",
  });
  await expect(
    service.start(alice, practice.content.materialKey, request),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("清理处理权过期后迟到成功也不能宣称已完成；刷新后可恢复", async () => {
  const { practice, files } = await fixture();
  let time = new Date();
  const entered = gate<void>();
  const resume = gate<void>();
  const service = createPractice(
    connection.db,
    content,
    {
      ...files,
      async removePractice(scope) {
        entered.resolve();
        await resume.promise;
        await files.removePractice(scope);
      },
    },
    undefined,
    { now: () => time },
  );
  const pending = service.delete(alice, practice.id);
  await entered.promise;
  time = new Date(time.getTime() + 60001);
  resume.resolve();
  expect(await pending).toMatchObject({ status: "processing" });
  const restarted = createPractice(connection.db, content, files, undefined, {
    now: () => time,
  });
  expect(await restarted.retryDeletion(alice, practice.id)).toMatchObject({
    status: "succeeded",
  });
});

test("删除与重练保持独立：删除重练记录不可重放复活，删除原练习不能再重练", async () => {
  const { service, practice } = await fixture();
  const requestId = crypto.randomUUID();
  const repeated = await service.repeat(alice, practice.id, requestId);
  await service.delete(alice, repeated.id);
  await expect(
    service.repeat(alice, practice.id, requestId),
  ).rejects.toMatchObject({ code: "not-found" });
  expect((await service.read(alice, practice.id)).attempts).toHaveLength(1);
  const another = await service.repeat(alice, practice.id, crypto.randomUUID());
  await service.delete(alice, practice.id);
  await expect(
    service.repeat(alice, practice.id, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "not-found" });
  expect((await service.read(alice, another.id)).id).toBe(another.id);
});

test("删除与重练竞争同一原记录，允许已创建的独立练习但原记录不会复活", async () => {
  const { service, practice } = await fixture();
  const [removed, repeated] = await Promise.allSettled([
    service.delete(alice, practice.id),
    service.repeat(alice, practice.id, crypto.randomUUID()),
  ]);
  expect(removed.status).toBe("fulfilled");
  await expect(service.read(alice, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  if (repeated.status === "fulfilled") {
    expect((await service.read(alice, repeated.value.id)).id).not.toBe(
      practice.id,
    );
  } else {
    expect(repeated.reason).toMatchObject({ code: "not-found" });
  }
});
