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
  production = false,
  allowanceSeconds = 240,
  budgetKey = crypto.randomUUID(),
) {
  const files = createRecordingFiles({ development: true, directory });
  const service = createPractice(
    connection.db,
    content,
    files,
    { mode: production ? "bailian" : "development", recognize },
    { now },
    undefined,
    undefined,
    production
      ? {
          allowanceSeconds,
          expiresAt: new Date("2099-01-01"),
          budgetKey,
        }
      : undefined,
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
test("原始转写与确认文本分别持久化，核对不增加作答，材料原文保持独立", async () => {
  const { service, practice, attempt } = await fixture();
  const recognized = await service.recognize(alice, practice.id, attempt.id);
  expect(recognized).toMatchObject({
    status: "recognized",
    rawTranscript: { text: "I will reed tomorrow." },
    confirmations: [],
  });
  const confirmed = await service.confirmTranscript(
    alice,
    practice.id,
    attempt.id,
    {
      rawTranscriptId: recognized.rawTranscript!.id,
      expectedConfirmationId: null,
      text: "I will read tomorrow.",
    },
  );
  expect(confirmed.confirmations).toMatchObject([
    { revision: 1, text: "I will read tomorrow." },
  ]);
  const resumed = await service.read(alice, practice.id);
  expect(resumed.attempts).toEqual([confirmed]);
  expect(resumed.attempts[0]!.rawTranscript!.text).toBe(
    "I will reed tomorrow.",
  );
  expect(resumed.content.materialText).toBe("Any plans?");
});

test("过期处理中作答可在新进程恢复为结果未知；并发重试及迟到结果不能覆盖有效识别", async () => {
  let time = new Date("2026-10-10T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<{ kind: "recognized"; text: string }>();
  const { service, practice, attempt, files } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  expect((await service.read(alice, practice.id)).attempts[0]!.status).toBe(
    "processing",
  );
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "processing" });
  await expect(
    service.recoverRecognition(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "processing" });
  time = new Date(time.getTime() + 60_001);
  const resumed = createPractice(
    connection.db,
    content,
    files,
    {
      mode: "development",
      recognize: async () => ({ kind: "recognized", text: "I will read." }),
    },
    { now: () => time },
  );
  const recovered = await resumed.recoverRecognition(
    alice,
    practice.id,
    attempt.id,
  );
  expect(recovered).toMatchObject({ status: "unknown", rawTranscript: null });
  expect(recovered.failure).toContain("不表示远端已取消");
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      resumed.recognize(alice, practice.id, attempt.id),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  remote.resolve({ kind: "recognized", text: "Old delayed text." });
  expect(await pending).toMatchObject({ code: "stale" });
  expect((await resumed.read(alice, practice.id)).attempts).toMatchObject([
    { status: "recognized", rawTranscript: { text: "I will read." } },
  ]);
});

test("识别读取已接收的原录音字节；文件丢失不伪造转写且仍保留原作答", async () => {
  const { service, practice, attempt } = await fixture(async (input) => ({
    kind: "recognized",
    text:
      input.recording.bytes.join(",") === "1,2,3" &&
      input.recording.mediaType === "audio/webm"
        ? "I read."
        : "Wrong recording.",
  }));
  expect(
    (await service.recognize(alice, practice.id, attempt.id)).rawTranscript
      ?.text,
  ).toBe("I read.");
  const missing = await fixture();
  await rm(directory, { recursive: true, force: true });
  expect(
    await missing.service.recognize(
      alice,
      missing.practice.id,
      missing.attempt.id,
    ),
  ).toMatchObject({ status: "failed", rawTranscript: null });
  expect(
    (await missing.service.read(alice, missing.practice.id)).attempts,
  ).toHaveLength(1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("明确失败、空内容和结果未知保留真实状态，重试始终处理同一作答", async () => {
  const outcomes: Awaited<ReturnType<Transcription["recognize"]>>[] = [
    { kind: "failed" },
    { kind: "no-content" },
    { kind: "recognized", text: "  " },
    { kind: "unknown" },
    { kind: "recognized", text: "I will read." },
  ];
  const { service, practice, attempt } = await fixture(async () =>
    outcomes.shift()!,
  );
  for (const status of ["failed", "no-content", "no-content", "unknown"]) {
    expect(
      await service.recognize(alice, practice.id, attempt.id),
    ).toMatchObject({
      id: attempt.id,
      status,
      rawTranscript: null,
      confirmations: [],
    });
    expect((await service.read(alice, practice.id)).attempts).toHaveLength(1);
  }
  expect(
    (await service.recognize(alice, practice.id, attempt.id)).rawTranscript
      ?.text,
  ).toBe("I will read.");
});

test("并发确认只接受一份版本；更正保留原文及旧确认；过期页面不能静默覆盖", async () => {
  const { service, practice, attempt } = await fixture();
  const recognized = await service.recognize(alice, practice.id, attempt.id);
  const base = {
    rawTranscriptId: recognized.rawTranscript!.id,
    expectedConfirmationId: null,
    text: "I will read.",
  };
  const results = await Promise.allSettled([
    service.confirmTranscript(alice, practice.id, attempt.id, base),
    service.confirmTranscript(alice, practice.id, attempt.id, {
      ...base,
      text: "I will write.",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "stale" },
  });
  const current = (await service.read(alice, practice.id)).attempts[0]!;
  const next = await service.confirmTranscript(alice, practice.id, attempt.id, {
    ...base,
    expectedConfirmationId: current.confirmations[0]!.id,
    text: "I will read tomorrow.",
  });
  expect(next.confirmations).toHaveLength(2);
  expect(next.confirmations[0]).toEqual(current.confirmations[0]);
  expect(next.confirmations[1]).toMatchObject({
    revision: 2,
    text: "I will read tomorrow.",
  });
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, base),
  ).rejects.toMatchObject({ code: "stale" });
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, {
      ...base,
      rawTranscriptId: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "stale" });
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, {
      ...base,
      text: "  ",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "stale" });
  expect((await service.read(alice, practice.id)).attempts).toEqual([next]);
});

test("识别、恢复、确认均检查所有权与练习状态；删除后迟到结果不会复活作答", async () => {
  const { service, practice, attempt } = await fixture();
  const confirmation = {
    rawTranscriptId: crypto.randomUUID(),
    expectedConfirmationId: null,
    text: "I read.",
  };
  for (const learner of [null, bob]) {
    const code = learner ? "not-found" : "unauthorized";
    await expect(
      service.recognize(learner, practice.id, attempt.id),
    ).rejects.toMatchObject({ code });
    await expect(
      service.recoverRecognition(learner, practice.id, attempt.id),
    ).rejects.toMatchObject({ code });
    await expect(
      service.confirmTranscript(learner, practice.id, attempt.id, confirmation),
    ).rejects.toMatchObject({ code });
  }
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, confirmation),
  ).rejects.toMatchObject({ code: "stale" });
  const { practiceRecord } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  // State fixtures: the real end/delete operations belong to later tickets.
  await connection.db
    .update(practiceRecord)
    .set({ endedAt: new Date() })
    .where(eq(practiceRecord.id, practice.id));
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "ended" });
  await expect(
    service.recoverRecognition(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "ended" });
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, confirmation),
  ).rejects.toMatchObject({ code: "ended" });
  const started = deferred<void>();
  const result = deferred<{ kind: "recognized"; text: string }>();
  const deleted = await fixture(async () => {
    started.resolve();
    return result.promise;
  });
  const pending = deleted.service
    .recognize(alice, deleted.practice.id, deleted.attempt.id)
    .catch((error) => error);
  await started.promise;
  await connection.db
    .delete(practiceRecord)
    .where(eq(practiceRecord.id, deleted.practice.id));
  result.resolve({ kind: "recognized", text: "Late text." });
  expect(await pending).toMatchObject({ code: "not-found" });
  await expect(
    deleted.service.read(alice, deleted.practice.id),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("实际识别进程被终止后，新实例通过持久化处理权恢复并重试原作答", async () => {
  const { spawn } = await import("node:child_process");
  const { service, practice, attempt, files } = await fixture();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "tests/fixtures/transcription-worker.ts",
      url!,
      directory,
      JSON.stringify(alice),
      practice.id,
      attempt.id,
      "2026-10-10T00:00:00Z",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("识别进程未就绪")), 5000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (data) => {
        if (data.toString().includes("recognition-started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect((await service.read(alice, practice.id)).attempts[0]!.status).toBe(
      "processing",
    );
    child.kill("SIGKILL");
    await exited;
    const resumed = createPractice(
      connection.db,
      content,
      files,
      {
        mode: "development",
        recognize: async () => ({
          kind: "recognized",
          text: "I survived interruption.",
        }),
      },
      { now: () => new Date("2026-10-10T00:01:01Z") },
    );
    expect(
      (await resumed.recoverRecognition(alice, practice.id, attempt.id)).status,
    ).toBe("unknown");
    const recognized = await resumed.recognize(alice, practice.id, attempt.id);
    expect(recognized.rawTranscript?.text).toBe("I survived interruption.");
    expect((await resumed.read(alice, practice.id)).attempts).toEqual([
      recognized,
    ]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
});

test("即使尚未点击恢复，过期请求也不能写回，刷新后仍可实际恢复", async () => {
  let time = new Date("2026-10-10T00:00:00Z");
  const started = deferred<void>();
  const result = deferred<{ kind: "recognized"; text: string }>();
  const { service, practice, attempt } = await fixture(
    async () => {
      started.resolve();
      return result.promise;
    },
    () => time,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  time = new Date(time.getTime() + 60_001);
  result.resolve({ kind: "recognized", text: "Expired text." });
  expect(await pending).toMatchObject({ code: "stale" });
  expect((await service.read(alice, practice.id)).attempts[0]).toMatchObject({
    status: "processing",
    rawTranscript: null,
  });
  expect(
    await service.recoverRecognition(alice, practice.id, attempt.id),
  ).toMatchObject({ status: "unknown", rawTranscript: null });
});

test("无效供应商响应被拒绝；未配置服务不会回退为固定转写", async () => {
  const { service, practice, attempt, files } = await fixture(async () => ({
    kind: "recognized",
    text: "x".repeat(20_001),
  }));
  const rejected = await service.recognize(alice, practice.id, attempt.id);
  expect(rejected).toMatchObject({ status: "failed", rawTranscript: null });
  expect(rejected.failure).toContain("无效结果");
  const unconfigured = createPractice(connection.db, content, files);
  await expect(
    unconfigured.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "transcription-unavailable" });
  expect((await unconfigured.read(alice, practice.id)).attempts).toEqual([
    rejected,
  ]);
});

test("真实识别未知保留预算；明确重试同一作答另占额度，重启与删除不释放预留", async () => {
  const { service, practice, attempt } = await fixture(
    async () => ({ kind: "unknown", dispatched: true }),
    () => new Date(),
    true,
  );
  expect((await service.recognize(alice, practice.id, attempt.id)).status).toBe(
    "unknown",
  );
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 120,
    remainingSeconds: 120,
  });
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "recognition-retry-consent" });
  expect(
    (
      await service.recognize(alice, practice.id, attempt.id, {
        acceptDuplicateCost: true,
      })
    ).id,
  ).toBe(attempt.id);
  await expect(
    service.recognize(alice, practice.id, attempt.id, {
      acceptDuplicateCost: true,
    }),
  ).rejects.toMatchObject({ code: "recognition-budget" });
  await service.delete(alice, practice.id);
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 240,
    remainingSeconds: 0,
  });
});
test("维护扫描恢复无人访问的过期识别，保留预留并阻止迟到写回", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<{ kind: "recognized"; text: string }>();
  const { service, practice, attempt } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
    true,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  time = new Date(time.getTime() + 90_001);
  expect(
    (await service.recoverExpiredRecognitions()).recovered,
  ).toBeGreaterThanOrEqual(1);
  expect((await service.read(alice, practice.id)).attempts[0]).toMatchObject({
    status: "unknown",
    rawTranscript: null,
  });
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 120,
  });
  remote.resolve({ kind: "recognized", text: "Too late." });
  expect(await pending).toMatchObject({ code: "stale" });
});
test("真实识别成功按供应商用量向上取整结算", async () => {
  const { service, practice, attempt } = await fixture(
    async () => ({
      kind: "recognized",
      text: "Actual speech.",
      dispatched: true,
      durationSeconds: 1.2,
    }),
    () => new Date(),
    true,
    120,
  );
  expect(
    (await service.recognize(alice, practice.id, attempt.id)).rawTranscript
      ?.text,
  ).toBe("Actual speech.");
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 2,
    remainingSeconds: 118,
  });
});

test("维护者依据账单对账未知预留，截止前不能释放预留", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const { service, practice, attempt } = await fixture(
    async () => ({ kind: "unknown", dispatched: true }),
    () => time,
    true,
  );
  await service.recognize(alice, practice.id, attempt.id);
  const [receipt] = await service.recognitionReceipts();
  await expect(
    service.reconcileRecognitionUsage(receipt!.id, {
      seconds: 0,
      evidence: "console-audit-1",
    }),
  ).rejects.toMatchObject({ code: "processing" });
  time = new Date(time.getTime() + 90_001);
  await service.reconcileRecognitionUsage(receipt!.id, {
    seconds: 2,
    evidence: "console-audit-1",
  });
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 2,
  });
  expect(await service.recognitionReceipts()).toMatchObject([
    {
      status: "settled",
      reservedSeconds: 2,
      reconciliationEvidence: "console-audit-1",
    },
  ]);
});

test("不同进程及作答共享预算锁，并发请求不能突破剩余免费预算", async () => {
  const budgetKey = crypto.randomUUID();
  const a = await fixture(
    async () => ({ kind: "unknown", dispatched: true }),
    () => new Date(),
    true,
    120,
    budgetKey,
  );
  const b = await fixture(
    async () => ({ kind: "unknown", dispatched: true }),
    () => new Date(),
    true,
    120,
    budgetKey,
  );
  const results = await Promise.allSettled([
    a.service.recognize(alice, a.practice.id, a.attempt.id),
    b.service.recognize(alice, b.practice.id, b.attempt.id),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "recognition-budget" },
  });
  const resumed = createPractice(
    connection.db,
    content,
    a.files,
    {
      mode: "bailian",
      recognize: async () => ({
        kind: "recognized",
        text: "should not dispatch",
      }),
    },
    undefined,
    undefined,
    undefined,
    { budgetKey, allowanceSeconds: 120, expiresAt: new Date("2099-01-01") },
  );
  expect(await resumed.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 120,
    remainingSeconds: 0,
  });
  await expect(
    resumed.recognize(alice, a.practice.id, a.attempt.id, {
      acceptDuplicateCost: true,
    }),
  ).rejects.toMatchObject({ code: "recognition-budget" });
});

test("到期免费预算拒绝请求；已开始的未知结果不因本地到期而释放", async () => {
  const { practice, attempt, files } = await fixture();
  const service = createPractice(
    connection.db,
    content,
    files,
    {
      mode: "bailian",
      recognize: async () => ({
        kind: "recognized",
        text: "should not dispatch",
      }),
    },
    undefined,
    undefined,
    undefined,
    {
      budgetKey: crypto.randomUUID(),
      allowanceSeconds: 240,
      expiresAt: new Date("2020-01-01"),
    },
  );
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "recognition-budget" });
  expect((await service.read(alice, practice.id)).attempts[0]?.status).toBe(
    "pending-identification",
  );
});
test("已执行供应商样例在 HTTP 边界回放，经真实 Adapter 进入同一次作答的核对确认", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createBailianTranscription } =
    await import("../../integrations/transcription/bailian");
  // Reconstructed from sanitized live receipt; this test does NOT make a live request.
  const evidence = JSON.parse(
    await readFile(
      "docs/implementation/issue-19/protocol-results.json",
      "utf8",
    ),
  );
  const response = evidence.cases.find(
    (item: { sample: string }) => item.sample === "browser-webm",
  ).response;
  const provider = createBailianTranscription({
    apiKey: "offline-only",
    host: "ws-fixture.cn-beijing.maas.aliyuncs.com",
    fetch: async () =>
      Response.json({
        output: { text: response.text, request_id: response.requestId },
        usage: response.usage,
      }),
  });
  const { service, practice, attempt } = await fixture(
    provider.recognize,
    () => new Date(),
    true,
  );
  const result = await service.recognize(alice, practice.id, attempt.id);
  expect(result.rawTranscript?.text).toBe("I will read a book this weekend.");
  await service.confirmTranscript(alice, practice.id, attempt.id, {
    rawTranscriptId: result.rawTranscript!.id,
    expectedConfirmationId: null,
    text: "I will read a book this weekend.",
  });
  const resumed = await service.read(alice, practice.id);
  expect(resumed.attempts).toHaveLength(1);
  expect(resumed.attempts[0]?.confirmations).toMatchObject([
    { text: "I will read a book this weekend." },
  ]);
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 2,
  });
});
test("删除运行中作答后维护仍能恢复独立用量回执，不遗失未知预算", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<{
    kind: "recognized";
    text: string;
    durationSeconds: number;
  }>();
  const { service, practice, attempt } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
    true,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  await service.delete(alice, practice.id);
  time = new Date(time.getTime() + 90_001);
  await service.recoverExpiredRecognitions();
  expect(await service.recognitionReceipts()).toMatchObject([
    { status: "unknown", reservedSeconds: 120 },
  ]);
  remote.resolve({
    kind: "recognized",
    text: "Deleted late output",
    durationSeconds: 1,
  });
  expect(await pending).toMatchObject({ code: "not-found" });
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 120,
  });
});
test("录音读取期间免费额度到期，不发出识别并释放已预留的预算", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const { practice, attempt, files } = await fixture();
  const service = createPractice(
    connection.db,
    content,
    {
      ...files,
      read: async (reference) => {
        const recording = await files.read(reference);
        time = new Date("2026-10-13T00:00:02Z");
        return recording;
      },
    },
    {
      mode: "bailian",
      recognize: async () => ({
        kind: "recognized",
        text: "Dispatched after free quota expired.",
      }),
    },
    { now: () => time },
    undefined,
    undefined,
    {
      budgetKey: crypto.randomUUID(),
      allowanceSeconds: 240,
      expiresAt: new Date("2026-10-13T00:00:01Z"),
    },
  );
  expect(await service.recognize(alice, practice.id, attempt.id)).toMatchObject(
    { status: "failed", rawTranscript: null },
  );
  expect(await service.recognitionBudgetStatus()).toMatchObject({
    committedSeconds: 0,
    expired: true,
  });
  expect(await service.recognitionReceipts()).toMatchObject([
    { status: "not-dispatched", reservedSeconds: 0 },
  ]);
});
test("供应商错误 request ID 留在未知用量回执，4xx/5xx 不释放最坏预留", async () => {
  const { createBailianTranscription } =
    await import("../../integrations/transcription/bailian");
  for (const status of [400, 403, 502]) {
    const provider = createBailianTranscription({
      apiKey: "offline-only",
      fetch: async () =>
        Response.json(
          {
            error: { request_id: `error-${status}`, message: "DO NOT EXPOSE" },
            usage: { duration: 0 },
          },
          { status },
        ),
    });
    const { service, practice, attempt } = await fixture(
      provider.recognize,
      () => new Date(),
      true,
    );
    const result = await service.recognize(alice, practice.id, attempt.id);
    expect(result.status).toBe(status === 502 ? "unknown" : "failed");
    expect(JSON.stringify(result)).not.toContain("DO NOT EXPOSE");
    expect(await service.recognitionReceipts()).toMatchObject([
      {
        providerRequestId: `error-${status}`,
        status: "unknown",
        reservedSeconds: 120,
      },
    ]);
    expect(await service.recognitionBudgetStatus()).toMatchObject({
      committedSeconds: 120,
    });
  }
});

test("读取原录音超过处理权后确认未发送，允许释放预留但不写回过期作答", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const { practice, attempt, files } = await fixture();
  const service = createPractice(
    connection.db,
    content,
    {
      ...files,
      read: async (reference) => {
        const recording = await files.read(reference);
        time = new Date("2026-10-13T00:02:00Z");
        return recording;
      },
    },
    {
      mode: "bailian",
      recognize: async () => ({
        kind: "recognized",
        text: "Should never dispatch.",
      }),
    },
    { now: () => time },
    undefined,
    undefined,
    {
      budgetKey: crypto.randomUUID(),
      allowanceSeconds: 240,
      expiresAt: new Date("2026-10-13T00:00:01Z"),
    },
  );
  await expect(
    service.recognize(alice, practice.id, attempt.id),
  ).rejects.toMatchObject({ code: "stale" });
  expect(await service.recognitionReceipts()).toMatchObject([
    { status: "not-dispatched", reservedSeconds: 0 },
  ]);
  expect(
    (await service.read(alice, practice.id)).attempts[0]?.rawTranscript,
  ).toBeNull();
});
test("过期响应只补充供应商对账标识，不释放未知预留或接纳迟到转写", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<{
    kind: "recognized";
    text: string;
    providerRequestId: string;
    durationSeconds: number;
  }>();
  const { service, practice, attempt } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
    true,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  time = new Date(time.getTime() + 90_001);
  await service.recoverRecognition(alice, practice.id, attempt.id);
  remote.resolve({
    kind: "recognized",
    text: "Late speech",
    providerRequestId: "late-receipt",
    durationSeconds: 1,
  });
  expect(await pending).toMatchObject({ code: "stale" });
  expect(await service.recognitionReceipts()).toMatchObject([
    {
      providerRequestId: "late-receipt",
      status: "unknown",
      reservedSeconds: 120,
    },
  ]);
  expect((await service.read(alice, practice.id)).attempts[0]).toMatchObject({
    status: "unknown",
    rawTranscript: null,
  });
});
test("对账完成后才到达的供应商标识不覆盖已核实用量", async () => {
  let time = new Date("2026-10-13T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<{
    kind: "recognized";
    text: string;
    providerRequestId: string;
    durationSeconds: number;
  }>();
  const { service, practice, attempt } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
    true,
  );
  const pending = service
    .recognize(alice, practice.id, attempt.id)
    .catch((error) => error);
  await started.promise;
  time = new Date(time.getTime() + 90_001);
  await service.recoverRecognition(alice, practice.id, attempt.id);
  const [receipt] = await service.recognitionReceipts();
  await service.reconcileRecognitionUsage(receipt!.id, {
    seconds: 2,
    evidence: "verified-console-receipt",
  });
  remote.resolve({
    kind: "recognized",
    text: "Late speech",
    providerRequestId: "late-after-reconcile",
    durationSeconds: 1,
  });
  expect(await pending).toMatchObject({ code: "stale" });
  expect(await service.recognitionReceipts()).toMatchObject([
    {
      providerRequestId: "late-after-reconcile",
      status: "settled",
      reservedSeconds: 2,
      reconciliationEvidence: "verified-console-receipt",
    },
  ]);
});
