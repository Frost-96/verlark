import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase } from "../../db/client";
import { createIdentity } from "../identity/server";
import type { Learner } from "../identity/contracts";
import { createLearningContent } from "../learning-content/server";
import { createPractice } from "./server";
import { createRecordingFiles } from "../../integrations/files/server";
import { handlePracticeRequest } from "../../app/api/practices/http";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
const content = createLearningContent(connection.db);
const practice = createPractice(connection.db, content);
const allowedEmails = new Set<string>();
const messages: { to: string; url: string }[] = [];
const identity = createIdentity(
  connection.db,
  {
    databaseURL: url,
    baseURL: "http://localhost:3000",
    secret: "practice-test-only-secret-32-characters",
    allowedEmails,
    developmentMail: true,
    production: false,
  },
  {
    send: async (message) => {
      messages.push(message);
    },
  },
);
let alice: Learner;
let bob: Learner;
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  alice = (await register()).learner;
  bob = (await register()).learner;
});

test("HTTP 入口只采用实际会话，拒绝匿名、伪造身份和跨账号详情", async () => {
  const owner = await register();
  const visitor = await register();
  const material = await content.publish({
    materialKey: `http-${crypto.randomUUID()}`,
    revision: 1,
    title: "日常安排",
    summary: "安排一天",
    materialText: "I work from home.",
    translation: "我在家工作。",
    task: "说说你在哪里工作或学习。",
    keywords: ["from home：在家"],
    sentenceStarters: ["I …"],
    example: "I study at home.",
    audioPath: "/audio/day-v1.wav",
  });
  const services = { identity, practice };
  function post(
    body: object,
    cookie?: string,
    origin = "http://localhost:3000",
  ) {
    return handlePracticeRequest(
      new Request("http://localhost:3000/api/practices", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
      }),
      services,
    );
  }
  expect(
    (
      await post({
        materialKey: material.materialKey,
        userId: owner.learner.id,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await post(
        { materialKey: material.materialKey, userId: owner.learner.id },
        visitor.cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(
        { materialKey: material.materialKey },
        owner.cookie,
        "https://attacker.example",
      )
    ).status,
  ).toBe(403);
  const created = await post(
    { materialKey: material.materialKey },
    owner.cookie,
  );
  expect(created.status).toBe(201);
  const body = await created.json();
  const response = await handlePracticeRequest(
    new Request(`http://localhost:3000/api/practices/${body.id}`, {
      headers: { cookie: visitor.cookie },
    }),
    services,
    body.id,
  );
  expect(response.status).toBe(404);
  expect(await practice.list(visitor.learner)).toEqual([]);
  expect((await practice.list(owner.learner)).map((item) => item.id)).toEqual([
    body.id,
  ]);
});

test("同一开始请求并发或跨版本重发只创建一次，换材料返回冲突", async () => {
  const owner = await register();
  const source = {
    materialKey: `retry-${crypto.randomUUID()}`,
    revision: 1,
    title: "计划",
    summary: "周末计划",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说你的计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I'm going to …"],
    example: "I'm going to read.",
    audioPath: "/audio/weekend-v1.wav",
  };
  await content.publish(source);
  const requestId = crypto.randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      practice.start(owner.learner, source.materialKey, requestId),
    ),
  );
  expect(new Set(results.map((item) => item.id)).size).toBe(1);
  await content.publish({ ...source, revision: 2 });
  const retry = await practice.start(
    owner.learner,
    source.materialKey,
    requestId,
  );
  expect(retry.id).toBe(results[0]!.id);
  expect(retry.content.revision).toBe(1);
  expect((await practice.list(owner.learner)).length).toBe(1);
  await expect(
    practice.start(owner.learner, "different-material", requestId),
  ).rejects.toThrow("请求标识已用于其他材料");
  const deliberate = await practice.start(
    owner.learner,
    source.materialKey,
    crypto.randomUUID(),
  );
  expect(deliberate.id).not.toBe(retry.id);
  expect(deliberate.content.revision).toBe(2);
});
afterAll(() => connection.close());

async function register() {
  const email = `${crypto.randomUUID()}@example.com`;
  allowedEmails.add(email);
  const headers = {
    "content-type": "application/json",
    origin: "http://localhost:3000",
  };
  const password = "practice-password-123";
  await identity.handleAuthRequest(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, name: "学习者" }),
    }),
  );
  const token = new URL(
    messages.findLast((message) => message.to === email)!.url,
  ).searchParams.get("token")!;
  await identity.handleAuthRequest(
    new Request(
      `http://localhost:3000/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    ),
  );
  const response = await identity.handleAuthRequest(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password }),
    }),
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const learner = await identity.getCurrentLearner(new Headers({ cookie }));
  if (!learner) throw new Error("测试账号验证失败。");
  return { learner, cookie };
}

test("离开后继续同一练习；发布新版并移除源文件不改变旧内容", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verlark-content-"));
  const path = join(directory, "material.json");
  const source = {
    materialKey: `practice-${crypto.randomUUID()}`,
    revision: 1,
    title: "周末计划",
    summary: "谈谈周末",
    materialText: "A: Any plans?\nB: I'm going to visit a friend.",
    translation: "A：有什么计划？\nB：我打算去看朋友。",
    task: "说说你的周末计划。",
    keywords: ["visit a friend：看朋友"],
    sentenceStarters: ["I'm going to …"],
    example: "I'm going to visit a friend on Sunday.",
    audioPath: "/audio/weekend-v1.wav",
  };
  try {
    await writeFile(path, JSON.stringify(source));
    const first = await content.publish(
      JSON.parse(await readFile(path, "utf8")),
    );
    const started = await practice.start(
      alice,
      source.materialKey,
      crypto.randomUUID(),
    );
    await content.publish({
      ...source,
      revision: 2,
      title: "新版周末计划",
      task: "聊聊下个月。",
    });
    await rm(directory, { recursive: true });
    const resumed = await createPractice(
      connection.db,
      createLearningContent(connection.db),
    ).read(alice, started.id);
    expect(resumed).toMatchObject({
      id: started.id,
      status: "in-progress",
      content: { ...source, id: first.id },
    });
    expect((await practice.list(alice)).map((item) => item.id)).toEqual([
      started.id,
    ]);
    const latest = await practice.start(
      alice,
      source.materialKey,
      crypto.randomUUID(),
    );
    expect(latest.content.revision).toBe(2);
    expect(latest.id).not.toBe(started.id);
    expect((await practice.read(alice, started.id)).content.task).toBe(
      "说说你的周末计划。",
    );
    expect(await practice.list(bob)).toEqual([]);
    await expect(practice.read(bob, started.id)).rejects.toThrow(
      "找不到该练习",
    );
    await expect(practice.read(null, started.id)).rejects.toThrow(
      "请先验证邮箱并登录",
    );
    await expect(
      practice.start(null, source.materialKey, crypto.randomUUID()),
    ).rejects.toThrow("请先验证邮箱并登录");
    await expect(
      practice.start(alice, "missing-material", crypto.randomUUID()),
    ).rejects.toThrow("材料暂不可用");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("录音文件不是作答；主动提交后生成可恢复的待识别作答", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verlark-recordings-"));
  try {
    const service = createPractice(
      connection.db,
      content,
      createRecordingFiles({ development: true, directory }),
    );
    const material = await content.publish({
      materialKey: `recording-${crypto.randomUUID()}`,
      revision: 1,
      title: "周末",
      summary: "说说周末",
      materialText: "Any plans?",
      translation: "有什么计划？",
      task: "说说你的计划。",
      keywords: ["plan：计划"],
      sentenceStarters: ["I will …"],
      example: "I will read.",
      audioPath: "/audio/weekend-v1.wav",
    });
    const started = await service.start(
      alice,
      material.materialKey,
      crypto.randomUUID(),
    );
    const recording = await service.saveRecording(alice, started.id, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "audio/webm",
    });
    expect((await service.read(alice, started.id)).attempts).toEqual([]);
    const submissionId = crypto.randomUUID();
    const accepted = await service.submit(
      alice,
      started.id,
      submissionId,
      recording.reference,
    );
    expect(accepted).toMatchObject({
      submissionId,
      status: "pending-identification",
    });
    expect(
      await service.findSubmission(alice, started.id, submissionId),
    ).toEqual(accepted);
    expect((await service.read(alice, started.id)).attempts).toEqual([
      accepted,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("同一提交并发重发仅接收一次，不同录音冲突；外人和其他练习的录音不能提交", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verlark-recordings-"));
  try {
    const files = createRecordingFiles({ development: true, directory });
    const service = createPractice(connection.db, content, files);
    const material = await content.publish({
      materialKey: `concurrent-${crypto.randomUUID()}`,
      revision: 1,
      title: "周末",
      summary: "说说周末",
      materialText: "Any plans?",
      translation: "有什么计划？",
      task: "说说你的计划。",
      keywords: ["plan：计划"],
      sentenceStarters: ["I will …"],
      example: "I will read.",
      audioPath: "/audio/weekend-v1.wav",
    });
    const first = await service.start(
      alice,
      material.materialKey,
      crypto.randomUUID(),
    );
    const second = await service.start(
      alice,
      material.materialKey,
      crypto.randomUUID(),
    );
    const other = await service.start(
      bob,
      material.materialKey,
      crypto.randomUUID(),
    );
    const input = { bytes: new Uint8Array([1, 2, 3]), mediaType: "audio/webm" };
    const recording = await service.saveRecording(alice, first.id, input);
    expect(await service.saveRecording(alice, first.id, input)).toEqual(
      recording,
    );
    const submissionId = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit(alice, first.id, submissionId, recording.reference),
      ),
    );
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect((await service.read(alice, first.id)).attempts).toEqual([
      results[0],
    ]);
    const changed = await service.saveRecording(alice, first.id, {
      ...input,
      bytes: new Uint8Array([4, 5, 6]),
    });
    await expect(
      service.submit(alice, first.id, submissionId, changed.reference),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.submit(bob, first.id, submissionId, recording.reference),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      service.findSubmission(bob, first.id, submissionId),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      service.saveRecording(bob, first.id, input),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      service.submit(alice, second.id, submissionId, recording.reference),
    ).rejects.toMatchObject({ code: "recording-invalid" });
    await expect(
      service.submit(bob, other.id, submissionId, recording.reference),
    ).rejects.toMatchObject({ code: "recording-invalid" });
    await expect(
      service.submit(
        alice,
        first.id,
        crypto.randomUUID(),
        "https://example.com/audio",
      ),
    ).rejects.toMatchObject({ code: "recording-invalid" });
    expect(
      await service.findSubmission(alice, first.id, crypto.randomUUID()),
    ).toBeNull();
    expect((await service.read(alice, second.id)).attempts).toEqual([]);
    const secondRecording = await service.saveRecording(
      alice,
      second.id,
      input,
    );
    const secondAccepted = await service.submit(
      alice,
      second.id,
      submissionId,
      secondRecording.reference,
    );
    expect(secondAccepted.id).not.toBe(results[0]!.id);
    // Files can be unavailable later; durable acceptance is still recoverable.
    await rm(directory, { recursive: true });
    expect(await service.findSubmission(alice, first.id, submissionId)).toEqual(
      results[0],
    );
    expect(
      await service.submit(alice, first.id, submissionId, recording.reference),
    ).toEqual(results[0]);
    const unavailableFiles = createPractice(connection.db, content, {
      ...files,
      async inspect() {
        throw new Error("external storage unavailable");
      },
    });
    expect(
      await unavailableFiles.submit(
        alice,
        first.id,
        submissionId,
        recording.reference,
      ),
    ).toEqual(results[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("录音 HTTP 入口鉴权、防伪造、限制上传并按同一标识恢复接收结果", async () => {
  const owner = await register();
  const directory = await mkdtemp(join(tmpdir(), "verlark-http-recordings-"));
  try {
    const service = createPractice(
      connection.db,
      content,
      createRecordingFiles({ development: true, directory }),
    );
    const material = await content.publish({
      materialKey: `http-record-${crypto.randomUUID()}`,
      revision: 1,
      title: "周末",
      summary: "计划",
      materialText: "Any plans?",
      translation: "有什么计划？",
      task: "说说计划。",
      keywords: ["plan：计划"],
      sentenceStarters: ["I will …"],
      example: "I will read.",
      audioPath: "/audio/weekend-v1.wav",
    });
    const started = await service.start(
      owner.learner,
      material.materialKey,
      crypto.randomUUID(),
    );
    const services = { identity, practice: service };
    const { handleRecordingRequest } =
      await import("../../app/api/practices/recording-http");
    function request(
      kind: "recordings" | "submissions",
      body: BodyInit,
      cookie = owner.cookie,
      origin = "http://localhost:3000",
    ) {
      return handleRecordingRequest(
        new Request(
          `http://localhost:3000/api/practices/${started.id}/${kind}`,
          {
            method: "POST",
            headers: {
              cookie,
              origin,
              "content-type":
                kind === "recordings" ? "audio/webm" : "application/json",
            },
            body,
          },
        ),
        services,
        started.id,
        kind,
      );
    }
    expect(
      (await request("recordings", new Uint8Array([1, 2]), "")).status,
    ).toBe(401);
    expect(
      (
        await request(
          "recordings",
          new Uint8Array([1, 2]),
          owner.cookie,
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    expect((await request("recordings", new Uint8Array())).status).toBe(400);
    const uploaded = await request("recordings", new Uint8Array([1, 2]));
    expect(uploaded.status).toBe(201);
    const { reference } = await uploaded.json();
    const submissionId = crypto.randomUUID();
    const payload = { submissionId, reference };
    expect(
      (
        await request(
          "submissions",
          JSON.stringify({ ...payload, userId: "forged" }),
        )
      ).status,
    ).toBe(400);
    const accepted = await request("submissions", JSON.stringify(payload));
    expect(accepted.status).toBe(201);
    const result = await accepted.json();
    const replay = await request("submissions", JSON.stringify(payload));
    expect(await replay.json()).toEqual(result);
    const found = await handleRecordingRequest(
      new Request(
        `http://localhost:3000/api/practices/${started.id}/submissions?submissionId=${submissionId}`,
        { headers: { cookie: owner.cookie } },
      ),
      services,
      started.id,
      "submissions",
    );
    expect(await found.json()).toEqual({ attempt: result });
    expect(found.headers.get("Cache-Control")).toContain("no-store");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("已结束练习拒绝新上传和新作答；已接收标识仍能核对，冲突并发只保留胜出录音", async () => {
  const directory = await mkdtemp(join(tmpdir(), "verlark-ended-"));
  try {
    const service = createPractice(
      connection.db,
      content,
      createRecordingFiles({ development: true, directory }),
    );
    const material = await content.publish({
      materialKey: `ended-${crypto.randomUUID()}`,
      revision: 1,
      title: "周末",
      summary: "计划",
      materialText: "Any plans?",
      translation: "有什么计划？",
      task: "说说计划。",
      keywords: ["plan：计划"],
      sentenceStarters: ["I will …"],
      example: "I will read.",
      audioPath: "/audio/weekend-v1.wav",
    });
    const started = await service.start(
      alice,
      material.materialKey,
      crypto.randomUUID(),
    );
    const input = { bytes: new Uint8Array([1, 2, 3]), mediaType: "audio/mp4" };
    const first = await service.saveRecording(alice, started.id, input);
    const other = await service.saveRecording(alice, started.id, {
      ...input,
      bytes: new Uint8Array([4, 5]),
    });
    const submissionId = crypto.randomUUID();
    const results = await Promise.allSettled([
      service.submit(alice, started.id, submissionId, first.reference),
      service.submit(alice, started.id, submissionId, other.reference),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "conflict" },
    });
    const accepted = await service.findSubmission(
      alice,
      started.id,
      submissionId,
    );
    expect((await service.read(alice, started.id)).attempts).toEqual([
      accepted,
    ]);
    // Fixture only: ending needs feedback and belongs to a later ticket; no public arbitrary setter.
    const { practiceRecord } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    await connection.db
      .update(practiceRecord)
      .set({ endedAt: new Date() })
      .where(eq(practiceRecord.id, started.id));
    await expect(
      service.saveRecording(alice, started.id, input),
    ).rejects.toMatchObject({ code: "ended" });
    await expect(
      service.submit(alice, started.id, crypto.randomUUID(), first.reference),
    ).rejects.toMatchObject({ code: "ended" });
    const winner =
      results[0]!.status === "fulfilled" ? first.reference : other.reference;
    expect(
      await service.submit(alice, started.id, submissionId, winner),
    ).toEqual(accepted);
    expect((await service.read(alice, started.id)).attempts).toEqual([
      accepted,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
