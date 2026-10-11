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
  email: `another-${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `another-${crypto.randomUUID()}@example.com`,
  name: "乙",
};
let directory: string;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
  directory = await mkdtemp(join(tmpdir(), "verlark-another-attempt-"));
});
afterAll(async () => {
  await connection.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture(
  recognize: Transcription["recognize"] = async () => ({
    kind: "recognized",
    text: "I will read tomorrow.",
  }),
) {
  const files = createRecordingFiles({ development: true, directory });
  const service = createPractice(
    connection.db,
    content,
    files,
    { mode: "development", recognize },
    { now: () => new Date() },
    {
      mode: "development",
      generate: async () => ({
        kind: "generated",
        summary: "表达清楚，读者能理解你的计划。",
        issues: [],
        alternatives: [],
        provenance: { provider: "test", model: "fixture" },
      }),
    },
  );
  const material = await content.publish({
    materialKey: `another-${crypto.randomUUID()}`,
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
  const initial = await submit(1);
  const first = await feedback(initial.id);
  return { service, practice, first, recording, submit, feedback };
}

test("同一练习保留成功、失败、待核对和处理中作答，再次识别不覆盖旧结果或增加次数", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let retry = false;
  const { service, practice, first, submit } = await fixture(
    async ({ recording }) => {
      if (recording.bytes[0] === 2 && !retry) return { kind: "failed" };
      if (recording.bytes[0] === 4) {
        started();
        await gate;
      }
      return {
        kind: "recognized",
        text:
          recording.bytes[0] === 1
            ? "I will read tomorrow."
            : "I will swim this weekend.",
      };
    },
  );
  const second = await submit(2);
  const failed = await service.recognize(alice, practice.id, second.id);
  const third = await submit(3);
  const review = await service.recognize(alice, practice.id, third.id);
  const fourth = await submit(4);
  const processing = service.recognize(alice, practice.id, fourth.id);
  await entered;
  try {
    const detail = await service.read(alice, practice.id);
    expect(detail.status).toBe("in-progress");
    expect(detail.attempts).toHaveLength(4);
    expect(detail.attempts[0]).toEqual(first);
    expect(detail.attempts[0]!.currentValidFeedback?.status).toBe("succeeded");
    expect(detail.attempts[1]).toEqual(failed);
    expect(detail.attempts[1]!.status).toBe("failed");
    expect(detail.attempts[2]).toEqual(review);
    expect(detail.attempts[2]!.confirmations).toEqual([]);
    expect(detail.attempts[2]!.status).toBe("recognized");
    expect(detail.attempts[3]!.status).toBe("processing");
    retry = true;
    const recovered = await service.recognize(alice, practice.id, second.id);
    expect(recovered.id).toBe(second.id);
    expect(recovered.submissionId).toBe(second.submissionId);
    expect(recovered.status).toBe("recognized");
    const unchanged = await service.requestFeedback(
      alice,
      practice.id,
      first.id,
      first.confirmations[0]!.id,
    );
    expect(unchanged).toEqual(first);
    expect((await service.read(alice, practice.id)).attempts).toHaveLength(4);
  } finally {
    release();
    await processing;
  }
  const final = await service.read(alice, practice.id);
  expect(final.attempts[0]).toEqual(first);
  expect(final.attempts[3]!.status).toBe("recognized");
});

test("再次作答并发重发只接收一次，跨账号与不同录音复用标识被拒绝且旧反馈保留", async () => {
  const { service, practice, first, recording } = await fixture();
  const saved = await recording(2);
  const submissionId = crypto.randomUUID();
  const [accepted, duplicate] = await Promise.all([
    service.submit(alice, practice.id, submissionId, saved.reference),
    service.submit(alice, practice.id, submissionId, saved.reference),
  ]);
  expect(duplicate).toEqual(accepted);
  expect(accepted.id).not.toBe(first.id);
  expect(accepted.submissionId).not.toBe(first.submissionId);
  expect(
    await service.findSubmission(alice, practice.id, submissionId),
  ).toEqual(accepted);
  const otherRecording = await recording(3);
  await expect(
    service.submit(alice, practice.id, submissionId, otherRecording.reference),
  ).rejects.toMatchObject({ code: "conflict" });
  for (const operation of [
    () => service.read(bob, practice.id),
    () => service.findSubmission(bob, practice.id, submissionId),
    () =>
      service.saveRecording(bob, practice.id, {
        bytes: new Uint8Array([9]),
        mediaType: "audio/webm",
      }),
    () =>
      service.submit(bob, practice.id, crypto.randomUUID(), saved.reference),
    () => service.recognize(bob, practice.id, accepted.id),
    () =>
      service.confirmTranscript(bob, practice.id, first.id, {
        rawTranscriptId: first.rawTranscript!.id,
        expectedConfirmationId: first.confirmations[0]!.id,
        text: "I will swim.",
      }),
    () =>
      service.requestFeedback(
        bob,
        practice.id,
        first.id,
        first.confirmations[0]!.id,
      ),
  ])
    await expect(operation()).rejects.toMatchObject({ code: "not-found" });
  expect((await service.read(alice, practice.id)).attempts).toEqual([
    first,
    accepted,
  ]);
});
