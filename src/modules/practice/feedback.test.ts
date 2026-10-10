import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase } from "../../db/client";
import { user } from "../identity/schema";
import { createLearningContent } from "../learning-content/server";
import type { ExpressionFeedback } from "../../integrations/expression-feedback/contracts";
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
  email: `feedback-${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `feedback-${crypto.randomUUID()}@example.com`,
  name: "乙",
};
let directory: string;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
  directory = await mkdtemp(join(tmpdir(), "verlark-feedback-"));
});
afterAll(async () => {
  await connection.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture(
  generate: ExpressionFeedback["generate"] = async () => ({
    kind: "generated",
    summary: "表达清楚，读者能理解你的计划。",
    issues: [],
    alternatives: [],
    provenance: { provider: "test", model: "fixture-v1" },
  }),
  now = () => new Date(),
) {
  const files = createRecordingFiles({ development: true, directory });
  const service = createPractice(
    connection.db,
    content,
    files,
    {
      mode: "development",
      recognize: async () => ({
        kind: "recognized",
        text: "I will read tomorrow.",
      }),
    },
    { now },
    { mode: "development", generate },
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
  const recognized = await service.recognize(alice, practice.id, attempt.id);
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
  return {
    service,
    practice,
    attempt: confirmed,
    files,
    confirmation: confirmed.confirmations[0]!,
  };
}

test("反馈固定确认文本，清楚表达零纠错且重复请求不覆盖成功结果", async () => {
  const { service, practice, attempt, confirmation } = await fixture();
  const updated = await service.requestFeedback(
    alice,
    practice.id,
    attempt.id,
    confirmation.id,
  );
  expect(updated.feedback).toMatchObject([
    {
      confirmationId: confirmation.id,
      status: "succeeded",
      rulesVersion: "expression-v1",
      result: { issues: [], summary: "表达清楚，读者能理解你的计划。" },
    },
  ]);
  expect(
    await service.requestFeedback(
      alice,
      practice.id,
      attempt.id,
      confirmation.id,
    ),
  ).toEqual(updated);
  expect((await service.read(alice, practice.id)).attempts).toEqual([updated]);
});

test.each([
  [{ kind: "unknown" }, "unknown"],
  [{ kind: "failed" }, "failed"],
  [{ kind: "no-content" }, "no-content"],
  [undefined, "failed"],
  [
    {
      kind: "generated",
      summary: "Looks good",
      issues: [],
      alternatives: [],
      provenance: { provider: "test", model: "fixture" },
    },
    "failed",
  ],
  [
    {
      kind: "generated",
      summary: "表达清楚。",
      issues: [
        {
          original: "invented quote",
          improved: "I will read.",
          explanation: "原话不清楚。",
        },
      ],
      alternatives: [],
      provenance: { provider: "test", model: "fixture" },
    },
    "failed",
  ],
])("无效或失败结果不是有效反馈：%j", async (result, status) => {
  const { service, practice, attempt, confirmation } = await fixture(
    async () => result,
  );
  const updated = await service.requestFeedback(
    alice,
    practice.id,
    attempt.id,
    confirmation.id,
  );
  expect(updated.feedback).toMatchObject([
    { status, result: null, generatedAt: null },
  ]);
  expect(updated.feedback[0]!.failure).toMatch(/重试/);
});

test("空白或无可识别内容不能生成反馈，网络异常保留结果未知", async () => {
  const { service, practice, attempt, confirmation } = await fixture(
    async () => {
      throw new Error("vendor secret");
    },
  );
  const failed = await service.requestFeedback(
    alice,
    practice.id,
    attempt.id,
    confirmation.id,
  );
  expect(failed.feedback[0]).toMatchObject({ status: "unknown", result: null });
  expect(failed.feedback[0]!.failure).not.toContain("vendor secret");
  await expect(
    service.confirmTranscript(alice, practice.id, attempt.id, {
      rawTranscriptId: attempt.rawTranscript!.id,
      expectedConfirmationId: confirmation.id,
      text: "   ",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  const punctuated = await service.confirmTranscript(
    alice,
    practice.id,
    attempt.id,
    {
      rawTranscriptId: attempt.rawTranscript!.id,
      expectedConfirmationId: confirmation.id,
      text: "… ???",
    },
  );
  const result = await service.requestFeedback(
    alice,
    practice.id,
    attempt.id,
    punctuated.confirmations.at(-1)!.id,
  );
  expect(
    result.feedback.find((item) => item.confirmationId !== confirmation.id),
  ).toMatchObject({ status: "no-content", result: null });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
test("过期处理权可恢复；并发重试和迟到结果不能覆盖成功反馈，文本更正保留历史依据", async () => {
  let time = new Date("2026-10-10T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<unknown>();
  let pending = true;
  const { service, practice, attempt, confirmation } = await fixture(
    async () => {
      if (pending) {
        started.resolve();
        return remote.promise;
      }
      return {
        kind: "generated",
        summary: "计划表达清楚。",
        issues: [],
        alternatives: [],
        provenance: { provider: "test", model: "retry" },
      };
    },
    () => time,
  );
  const old = service
    .requestFeedback(alice, practice.id, attempt.id, confirmation.id)
    .catch((error) => error);
  await started.promise;
  await expect(
    service.requestFeedback(alice, practice.id, attempt.id, confirmation.id),
  ).rejects.toMatchObject({ code: "processing" });
  await expect(
    service.recoverFeedback(alice, practice.id, attempt.id, confirmation.id),
  ).rejects.toMatchObject({ code: "processing" });
  const corrected = await service.confirmTranscript(
    alice,
    practice.id,
    attempt.id,
    {
      rawTranscriptId: attempt.rawTranscript!.id,
      expectedConfirmationId: confirmation.id,
      text: "I will read a book tomorrow.",
    },
  );
  time = new Date(time.getTime() + 60_001);
  const recovered = await service.recoverFeedback(
    alice,
    practice.id,
    attempt.id,
    confirmation.id,
  );
  expect(recovered.feedback[0]).toMatchObject({
    status: "unknown",
    result: null,
    leaseExpiresAt: null,
  });
  pending = false;
  const retries = await Promise.allSettled([
    service.requestFeedback(alice, practice.id, attempt.id, confirmation.id),
    service.requestFeedback(alice, practice.id, attempt.id, confirmation.id),
  ]);
  expect(retries.some((result) => result.status === "fulfilled")).toBe(true);
  const valid = (await service.read(alice, practice.id)).attempts[0]!;
  expect(valid.feedback).toMatchObject([
    {
      confirmationId: confirmation.id,
      status: "succeeded",
      provenance: { model: "retry" },
    },
  ]);
  expect(valid.confirmations.at(-1)!.id).toBe(
    corrected.confirmations.at(-1)!.id,
  );
  remote.resolve({
    kind: "generated",
    summary: "迟到结果。",
    issues: [],
    alternatives: [],
    provenance: { provider: "test", model: "late" },
  });
  expect(await old).toMatchObject({ code: "stale" });
  expect((await service.read(alice, practice.id)).attempts).toEqual([valid]);
});

test("未确认、跨作答版本和跨账号请求均被拒绝，外部调用前检查权限", async () => {
  const first = await fixture();
  const other = await fixture();
  await expect(
    first.service.requestFeedback(
      null,
      first.practice.id,
      first.attempt.id,
      first.confirmation.id,
    ),
  ).rejects.toMatchObject({ code: "unauthorized" });
  for (const operation of [
    first.service.requestFeedback,
    first.service.recoverFeedback,
  ]) {
    await expect(
      operation.call(
        first.service,
        bob,
        first.practice.id,
        first.attempt.id,
        first.confirmation.id,
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      operation.call(
        first.service,
        alice,
        first.practice.id,
        first.attempt.id,
        other.confirmation.id,
      ),
    ).rejects.toMatchObject({ code: "stale" });
  }
  await expect(
    first.service.requestFeedback(
      alice,
      first.practice.id,
      first.attempt.id,
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    (await first.service.read(alice, first.practice.id)).attempts[0]!.feedback,
  ).toEqual([]);
});

test.each([
  ["I will read tomorrow.", 0, 0],
  ["I will read a book this weekend.", 0, 1],
  ["I borrow you my book tomorrow.", 1, 0],
  ["I went tomorrow. I borrow you my book.", 2, 0],
] as const)(
  "固定质量样例通过 practice 校验：%s",
  async (text, issueCount, alternativeCount) => {
    const { createExpressionFeedback } =
      await import("../../integrations/expression-feedback/server");
    const adapter = createExpressionFeedback({ development: true });
    const { service, practice, attempt, confirmation } = await fixture(
      adapter.generate,
    );
    const confirmed = await service.confirmTranscript(
      alice,
      practice.id,
      attempt.id,
      {
        rawTranscriptId: attempt.rawTranscript!.id,
        expectedConfirmationId: confirmation.id,
        text,
      },
    );
    const result = await service.requestFeedback(
      alice,
      practice.id,
      attempt.id,
      confirmed.confirmations.at(-1)!.id,
    );
    const feedback = result.feedback[0]!;
    expect(feedback.status).toBe("succeeded");
    expect(feedback.result!.issues).toHaveLength(issueCount);
    expect(feedback.result!.alternatives).toHaveLength(alternativeCount);
    expect(feedback.result!.summary).toMatch(/[\u3400-\u9fff]/);
    expect(JSON.stringify(feedback.result)).not.toMatch(
      /发音|语调|停顿|得分|分数|掌握/,
    );
    if (text.includes("borrow"))
      expect(feedback.result!.issues.at(-1)!.improved).toContain("lend");
    if (alternativeCount)
      expect(feedback.result!.alternatives[0]!.explanation).toContain(
        "不是错误",
      );
  },
);

test.each([
  { summary: "你的发音得分是 90 分，已经掌握。" },
  { score: 90 },
  { pronunciation: "很好" },
  { mastered: true },
  {
    issues: [
      {
        original: "I will read tomorrow.",
        explanation: "表达可以这样说。",
        improved: "你好 A",
      },
    ],
  },
  {
    issues: Array.from({ length: 3 }, () => ({
      original: "I will read tomorrow.",
      explanation: "表达可以这样说。",
      improved: "I'll read tomorrow.",
    })),
  },
])("拒绝越界评价或非法结构：%j", async (override) => {
  const { service, practice, attempt, confirmation } = await fixture(
    async () => ({
      kind: "generated",
      summary: "表达清楚。",
      issues: [],
      alternatives: [],
      provenance: { provider: "test", model: "fixture" },
      ...override,
    }),
  );
  expect(
    (
      await service.requestFeedback(
        alice,
        practice.id,
        attempt.id,
        confirmation.id,
      )
    ).feedback[0],
  ).toMatchObject({ status: "failed", result: null });
});

test("实际反馈进程被终止后，新实例通过持久化处理权恢复并重试原确认文本", async () => {
  const { spawn } = await import("node:child_process");
  const { service, practice, attempt, confirmation, files } = await fixture();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "tests/fixtures/feedback-worker.ts",
      url!,
      directory,
      JSON.stringify(alice),
      practice.id,
      attempt.id,
      confirmation.id,
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
      const timer = setTimeout(() => reject(new Error("反馈进程未就绪")), 5000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (data) => {
        if (data.toString().includes("feedback-started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(
      (await service.read(alice, practice.id)).attempts[0]!.feedback[0]!.status,
    ).toBe("processing");
    child.kill("SIGKILL");
    await exited;
    const resumed = createPractice(
      connection.db,
      content,
      files,
      undefined,
      { now: () => new Date("2026-10-10T00:01:01Z") },
      {
        mode: "development",
        generate: async () => ({
          kind: "generated",
          summary: "中断恢复后的表达反馈。",
          issues: [],
          alternatives: [],
          provenance: { provider: "test", model: "resumed" },
        }),
      },
    );
    expect(
      (
        await resumed.recoverFeedback(
          alice,
          practice.id,
          attempt.id,
          confirmation.id,
        )
      ).feedback[0]!.status,
    ).toBe("unknown");
    const updated = await resumed.requestFeedback(
      alice,
      practice.id,
      attempt.id,
      confirmation.id,
    );
    expect(updated.feedback[0]).toMatchObject({
      confirmationId: confirmation.id,
      status: "succeeded",
      provenance: { model: "resumed" },
    });
    expect((await resumed.read(alice, practice.id)).attempts).toEqual([
      updated,
    ]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
});

test("过期但尚未恢复的结果不能写回；未配置服务不回退为替身", async () => {
  let time = new Date("2026-10-10T00:00:00Z");
  const started = deferred<void>();
  const remote = deferred<unknown>();
  const { service, practice, attempt, confirmation } = await fixture(
    async () => {
      started.resolve();
      return remote.promise;
    },
    () => time,
  );
  const running = service
    .requestFeedback(alice, practice.id, attempt.id, confirmation.id)
    .catch((error) => error);
  await started.promise;
  time = new Date(time.getTime() + 60_001);
  remote.resolve({
    kind: "generated",
    summary: "迟到的结果。",
    issues: [],
    alternatives: [],
    provenance: { provider: "test", model: "expired" },
  });
  expect(await running).toMatchObject({ code: "stale" });
  expect(
    (await service.read(alice, practice.id)).attempts[0]!.feedback[0],
  ).toMatchObject({ status: "processing", result: null });
  await service.recoverFeedback(
    alice,
    practice.id,
    attempt.id,
    confirmation.id,
  );
  const unconfigured = createPractice(connection.db, content);
  await expect(
    unconfigured.requestFeedback(
      alice,
      practice.id,
      attempt.id,
      confirmation.id,
    ),
  ).rejects.toMatchObject({ code: "feedback-unavailable" });
  expect(
    (await unconfigured.read(alice, practice.id)).attempts[0]!.feedback[0],
  ).toMatchObject({ status: "unknown", result: null });
});

test("已结束练习拒绝反馈变更；删除练习后迟到反馈不能复活记录", async () => {
  const { practiceRecord } = await import("./schema");
  const { eq } = await import("drizzle-orm");
  const ended = await fixture();
  // Fixture setup only: public end/delete operations are later tickets.
  await connection.db
    .update(practiceRecord)
    .set({ endedAt: new Date() })
    .where(eq(practiceRecord.id, ended.practice.id));
  for (const operation of [
    ended.service.requestFeedback,
    ended.service.recoverFeedback,
  ])
    await expect(
      operation.call(
        ended.service,
        alice,
        ended.practice.id,
        ended.attempt.id,
        ended.confirmation.id,
      ),
    ).rejects.toMatchObject({ code: "ended" });
  const started = deferred<void>();
  const remote = deferred<unknown>();
  const deleted = await fixture(async () => {
    started.resolve();
    return remote.promise;
  });
  const running = deleted.service
    .requestFeedback(
      alice,
      deleted.practice.id,
      deleted.attempt.id,
      deleted.confirmation.id,
    )
    .catch((error) => error);
  await started.promise;
  await connection.db
    .delete(practiceRecord)
    .where(eq(practiceRecord.id, deleted.practice.id));
  remote.resolve({
    kind: "generated",
    summary: "迟到的结果。",
    issues: [],
    alternatives: [],
    provenance: { provider: "test", model: "expired" },
  });
  expect(await running).toMatchObject({ code: "not-found" });
  await expect(
    deleted.service.read(alice, deleted.practice.id),
  ).rejects.toMatchObject({ code: "not-found" });
});
