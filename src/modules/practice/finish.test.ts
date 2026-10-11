import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase } from "../../db/client";
import { user } from "../identity/schema";
import { createLearningContent } from "../learning-content/server";
import { createRecordingFiles } from "../../integrations/files/server";
import type { Transcription } from "../../integrations/transcription/contracts";
import type { ExpressionFeedback } from "../../integrations/expression-feedback/contracts";
import type { RecordingFiles } from "../../integrations/files/contracts";
import { createPractice } from "./server";

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
  email: `finish-${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `finish-${crypto.randomUUID()}@example.com`,
  name: "乙",
};
let directory: string;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
  directory = await mkdtemp(join(tmpdir(), "verlark-finish-attempt-"));
});
afterAll(async () => {
  await connection.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture(
  options: {
    recognize?: Transcription["recognize"];
    generate?: ExpressionFeedback["generate"];
    now?: () => Date;
    files?: RecordingFiles;
    empty?: boolean;
  } = {},
) {
  const files =
    options.files ?? createRecordingFiles({ development: true, directory });
  const service = createPractice(
    connection.db,
    content,
    files,
    {
      mode: "development",
      recognize:
        options.recognize ??
        (async () => ({ kind: "recognized", text: "I will read tomorrow." })),
    },
    { now: options.now ?? (() => new Date()) },
    {
      mode: "development",
      generate:
        options.generate ??
        (async () => ({
          kind: "generated",
          summary: "表达清楚，读者能理解你的计划。",
          issues: [],
          alternatives: [],
          provenance: { provider: "test", model: "fixture" },
        })),
    },
  );
  const material = await content.publish({
    materialKey: `finish-${crypto.randomUUID()}`,
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
  async function recording(value: number) {
    return service.saveRecording(alice, practice.id, {
      bytes: new Uint8Array([value]),
      mediaType: "audio/webm",
    });
  }
  async function submit(value: number) {
    const saved = await recording(value);
    return service.submit(
      alice,
      practice.id,
      crypto.randomUUID(),
      saved.reference,
    );
  }
  async function feedback(attemptId: string) {
    const recognized = await service.recognize(alice, practice.id, attemptId);
    const confirmed = await service.confirmTranscript(
      alice,
      practice.id,
      attemptId,
      {
        rawTranscriptId: recognized.rawTranscript!.id,
        expectedConfirmationId: null,
        text: recognized.rawTranscript!.text,
      },
    );
    return service.requestFeedback(
      alice,
      practice.id,
      attemptId,
      confirmed.confirmations[0]!.id,
    );
  }
  const initial = options.empty ? null : await submit(1);
  const first = initial ? await feedback(initial.id) : null;
  return { service, practice, first, recording, submit, feedback };
}

test("无当前有效反馈拒绝结束，零纠错反馈可结束且重复结束稳定", async () => {
  const { service, practice, submit, feedback } = await fixture({
    empty: true,
  });
  await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
    code: "feedback-required",
  });
  const accepted = await submit(1);
  await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
    code: "feedback-required",
  });
  const valid = await feedback(accepted.id);
  expect(valid.currentValidFeedback?.result?.issues).toEqual([]);
  const ended = await service.finish(alice, practice.id);
  expect(ended.status).toBe("ended");
  expect(ended.attempts).toEqual([valid]);
  expect(await service.finish(alice, practice.id)).toEqual(ended);
  expect(await service.read(alice, practice.id)).toEqual(ended);
  expect(
    (await service.list(alice)).find((item) => item.id === practice.id)?.status,
  ).toBe("ended");
});

function gate() {
  let release!: () => void;
  let enter!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  return {
    release,
    entered,
    async hold() {
      enter();
      await waiting;
    },
  };
}

test("上传期间结束后不返回可提交录音，已结束记录拒绝所有写操作但可重练与删除", async () => {
  const held = gate();
  const realFiles = createRecordingFiles({ development: true, directory });
  let holdUpload = false;
  const { service, practice, first, recording } = await fixture({
    files: {
      ...realFiles,
      async save(input) {
        const saved = await realFiles.save(input);
        if (holdUpload) await held.hold();
        return saved;
      },
    },
  });
  const draft = await recording(2);
  holdUpload = true;
  const upload = recording(3).catch((error: unknown) => error);
  await held.entered;
  const ended = await service.finish(alice, practice.id);
  held.release();
  expect(await upload).toMatchObject({ code: "ended" });
  for (const operation of [
    () =>
      service.saveRecording(alice, practice.id, {
        bytes: new Uint8Array([4]),
        mediaType: "audio/webm",
      }),
    () =>
      service.submit(alice, practice.id, crypto.randomUUID(), draft.reference),
    () => service.recognize(alice, practice.id, first!.id),
    () => service.recoverRecognition(alice, practice.id, first!.id),
    () =>
      service.confirmTranscript(alice, practice.id, first!.id, {
        rawTranscriptId: first!.rawTranscript!.id,
        expectedConfirmationId: first!.confirmations[0]!.id,
        text: "I will swim.",
      }),
    () =>
      service.requestFeedback(
        alice,
        practice.id,
        first!.id,
        first!.confirmations[0]!.id,
      ),
    () =>
      service.recoverFeedback(
        alice,
        practice.id,
        first!.id,
        first!.confirmations[0]!.id,
      ),
  ])
    await expect(operation()).rejects.toMatchObject({ code: "ended" });
  expect(await service.read(alice, practice.id)).toEqual(ended);
  expect(
    await service.findSubmission(alice, practice.id, first!.submissionId),
  ).toEqual(first);
  const repeated = await service.repeat(
    alice,
    practice.id,
    crypto.randomUUID(),
  );
  expect(repeated.status).toBe("in-progress");
  expect(repeated.attempts).toEqual([]);
  expect(repeated.id).not.toBe(practice.id);
  await service.delete(alice, practice.id);
  await expect(service.read(alice, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
});

test("最后作答失败或尚未核对不阻止结束，所有作答保留真实状态", async () => {
  const { service, practice, first, submit } = await fixture({
    recognize: async ({ recording }) =>
      recording.bytes[0] === 2
        ? { kind: "failed" }
        : { kind: "recognized", text: "I will read tomorrow." },
  });
  const failed = await submit(2);
  await service.recognize(alice, practice.id, failed.id);
  const review = await submit(3);
  await service.recognize(alice, practice.id, review.id);
  await submit(4);
  const before = await service.read(alice, practice.id);
  const ended = await service.finish(alice, practice.id);
  expect(ended.attempts).toEqual(before.attempts);
  expect(ended.attempts.map((item) => item.status)).toEqual([
    "recognized",
    "failed",
    "recognized",
    "pending-identification",
  ]);
  expect(ended.attempts[0]).toEqual(first);
  expect(ended.attempts[2]!.confirmations).toEqual([]);
});

test("唯一反馈因更正成为历史反馈时拒绝结束，另一次当前有效反馈可允许结束", async () => {
  const { service, practice, first, submit, feedback } = await fixture();
  const corrected = await service.confirmTranscript(
    alice,
    practice.id,
    first!.id,
    {
      rawTranscriptId: first!.rawTranscript!.id,
      expectedConfirmationId: first!.confirmations[0]!.id,
      text: "I will swim.",
    },
  );
  expect(corrected.currentValidFeedback).toBeNull();
  expect(corrected.feedback[0]).toEqual(first!.currentValidFeedback);
  await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
    code: "feedback-required",
  });
  const next = await submit(2);
  await feedback(next.id);
  const ended = await service.finish(alice, practice.id);
  expect(ended.status).toBe("ended");
  expect(ended.attempts[0]).toEqual(corrected);
});

test("跨账号、未登录和无效标识不能结束或探知练习", async () => {
  const { service, practice } = await fixture();
  await expect(service.finish(bob, practice.id)).rejects.toMatchObject({
    code: "not-found",
  });
  await expect(service.finish(null, practice.id)).rejects.toMatchObject({
    code: "unauthorized",
  });
  await expect(service.finish(alice, "missing")).rejects.toMatchObject({
    code: "not-found",
  });
  expect((await service.read(alice, practice.id)).status).toBe("in-progress");
});

test("识别处理中拒绝结束，超时恢复后允许结束且迟到结果不能修改已结束记录", async () => {
  const held = gate();
  let now = Date.now();
  const { service, practice, submit } = await fixture({
    now: () => new Date(now),
    recognize: async ({ recording }) => {
      if (recording.bytes[0] === 2) await held.hold();
      return { kind: "recognized", text: "I will read tomorrow." };
    },
  });
  const pending = await submit(2);
  const processing = service
    .recognize(alice, practice.id, pending.id)
    .catch((error: unknown) => error);
  await held.entered;
  try {
    await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
      code: "processing",
    });
    await expect(
      service.recoverRecognition(alice, practice.id, pending.id),
    ).rejects.toMatchObject({ code: "processing" });
    now += 60_001;
    await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
      code: "processing",
    });
    const recovered = await service.recoverRecognition(
      alice,
      practice.id,
      pending.id,
    );
    expect(recovered.status).toBe("unknown");
    expect(recovered.failure).toContain("不表示远端已取消");
    const ended = await service.finish(alice, practice.id);
    held.release();
    expect(await processing).toMatchObject({ code: "ended" });
    expect(await service.read(alice, practice.id)).toEqual(ended);
  } finally {
    held.release();
    await processing;
  }
});

test("历史文本的反馈处理中也阻止结束，恢复超时反馈后结束会拒绝迟到回写", async () => {
  const held = gate();
  let now = Date.now();
  const { service, practice, submit } = await fixture({
    now: () => new Date(now),
    generate: async ({ text }) => {
      if (text === "I will swim.") await held.hold();
      return {
        kind: "generated",
        summary: "表达清楚。",
        issues: [],
        alternatives: [],
        provenance: { provider: "test", model: "fixture" },
      };
    },
  });
  const pending = await submit(2);
  const recognized = await service.recognize(alice, practice.id, pending.id);
  const confirmed = await service.confirmTranscript(
    alice,
    practice.id,
    pending.id,
    {
      rawTranscriptId: recognized.rawTranscript!.id,
      expectedConfirmationId: null,
      text: "I will swim.",
    },
  );
  const confirmationId = confirmed.confirmations[0]!.id;
  const processing = service
    .requestFeedback(alice, practice.id, pending.id, confirmationId)
    .catch((error: unknown) => error);
  await held.entered;
  try {
    await service.confirmTranscript(alice, practice.id, pending.id, {
      rawTranscriptId: recognized.rawTranscript!.id,
      expectedConfirmationId: confirmationId,
      text: "I will walk.",
    });
    await expect(service.finish(alice, practice.id)).rejects.toMatchObject({
      code: "processing",
    });
    await expect(
      service.recoverFeedback(alice, practice.id, pending.id, confirmationId),
    ).rejects.toMatchObject({ code: "processing" });
    now += 60_001;
    const recovered = await service.recoverFeedback(
      alice,
      practice.id,
      pending.id,
      confirmationId,
    );
    expect(recovered.feedback[0]!.status).toBe("unknown");
    expect(recovered.feedback[0]!.failure).toContain("不表示远端已取消");
    const ended = await service.finish(alice, practice.id);
    held.release();
    expect(await processing).toMatchObject({ code: "ended" });
    expect(await service.read(alice, practice.id)).toEqual(ended);
  } finally {
    held.release();
    await processing;
  }
});

test("结束与提交竞争：先在外部检查录音的提交不能在结束后被接收", async () => {
  const held = gate();
  let holdInspect = false;
  const files = createRecordingFiles({ development: true, directory });
  const { service, practice, recording } = await fixture({
    files: {
      ...files,
      async inspect(reference) {
        const value = await files.inspect(reference);
        if (holdInspect) await held.hold();
        return value;
      },
    },
  });
  const draft = await recording(2);
  holdInspect = true;
  const submissionId = crypto.randomUUID();
  const submitting = service
    .submit(alice, practice.id, submissionId, draft.reference)
    .catch((error: unknown) => error);
  await held.entered;
  try {
    await service.finish(alice, practice.id);
    held.release();
    expect(await submitting).toMatchObject({ code: "ended" });
    expect(
      await service.findSubmission(alice, practice.id, submissionId),
    ).toBeNull();
    expect((await service.read(alice, practice.id)).attempts).toHaveLength(1);
  } finally {
    held.release();
    await submitting;
  }
});

test("结束与提交、识别、反馈和更正并发只能形成串行合法结果", async () => {
  for (const action of [
    "submit",
    "recognize",
    "feedback",
    "correct",
  ] as const) {
    for (let iteration = 0; iteration < 5; iteration++) {
      const held = gate();
      let block = false;
      const { service, practice, first, submit, recording } = await fixture({
        recognize: async () => {
          if (block) await held.hold();
          return { kind: "recognized", text: "I will read tomorrow." };
        },
        generate: async () => {
          if (block) await held.hold();
          return {
            kind: "generated",
            summary: "表达清楚。",
            issues: [],
            alternatives: [],
            provenance: { provider: "test", model: "fixture" },
          };
        },
      });
      const next =
        action === "recognize" || action === "feedback"
          ? await submit(2)
          : null;
      const draft = action === "submit" ? await recording(3) : null;
      let confirmationId = "";
      if (action === "feedback") {
        const recognized = await service.recognize(
          alice,
          practice.id,
          next!.id,
        );
        const confirmed = await service.confirmTranscript(
          alice,
          practice.id,
          next!.id,
          {
            rawTranscriptId: recognized.rawTranscript!.id,
            expectedConfirmationId: null,
            text: "I will swim.",
          },
        );
        confirmationId = confirmed.confirmations[0]!.id;
      }
      block = true;
      const mutation = () =>
        action === "submit"
          ? service.submit(
              alice,
              practice.id,
              crypto.randomUUID(),
              draft!.reference,
            )
          : action === "recognize"
            ? service.recognize(alice, practice.id, next!.id)
            : action === "feedback"
              ? service.requestFeedback(
                  alice,
                  practice.id,
                  next!.id,
                  confirmationId,
                )
              : service.confirmTranscript(alice, practice.id, first!.id, {
                  rawTranscriptId: first!.rawTranscript!.id,
                  expectedConfirmationId: first!.confirmations[0]!.id,
                  text: "I will swim.",
                });
      let work: Promise<unknown>;
      let finishing: Promise<unknown>;
      if (iteration % 2) {
        work = mutation().catch((e: unknown) => e);
        finishing = service.finish(alice, practice.id).catch((e: unknown) => e);
      } else {
        finishing = service.finish(alice, practice.id).catch((e: unknown) => e);
        work = mutation().catch((e: unknown) => e);
      }
      try {
        const result = await finishing;
        const current = await service.read(alice, practice.id);
        if (current.status === "ended") {
          expect(result).toMatchObject({ status: "ended" });
          expect(
            current.attempts.some((item) => item.currentValidFeedback),
          ).toBe(true);
          expect(
            current.attempts.some(
              (item) =>
                item.status === "processing" ||
                item.feedback.some((value) => value.status === "processing"),
            ),
          ).toBe(false);
          held.release();
          const changed = await work;
          if (action !== "submit")
            expect(changed).toMatchObject({ code: "ended" });
          expect(await service.read(alice, practice.id)).toEqual(current);
        } else {
          expect(result).toMatchObject({
            code: action === "correct" ? "feedback-required" : "processing",
          });
        }
      } finally {
        held.release();
        await work;
      }
    }
  }
});
