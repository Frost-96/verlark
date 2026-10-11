import { createIdentity } from "../identity/server";
import { handleMaterialAudio } from "../../app/api/materials/audio-http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import { createLearningContent } from "./server";
import {
  inspectMaterialWav,
  reviewContentDigest,
} from "../../integrations/material-audio/preparation";
import type { MaterialAudioStore } from "../../integrations/material-audio/contracts";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("需要隔离测试数据库");
const connection = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(() => connection.close());
const objects = new Map<string, Uint8Array>();
const files: MaterialAudioStore = {
  async putImmutable(bytes) {
    const reference = `materials/${crypto.randomUUID()}.wav`;
    objects.set(reference, bytes);
    return reference;
  },
  async read(reference) {
    return objects.get(reference) ?? null;
  },
  async remove(reference) {
    objects.delete(reference);
  },
};
function fixture() {
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
  const source = {
    materialKey: `test-${crypto.randomUUID()}`,
    revision: 1,
    title: "周末计划",
    summary: "周末",
    materialText: "A: Hello.",
    translation: "你好",
    task: "问候朋友",
    keywords: ["hello"],
    sentenceStarters: ["Hello"],
    example: "Hello, friend.",
  };
  const metadata = inspectMaterialWav(bytes);
  const review = {
    reviewer: "integration-test fixture",
    reviewedAt: "2026-10-11T00:00:00.000Z",
    contentDigest: reviewContentDigest(source),
    audioDigest: metadata.digest,
    note: "Test fixture only; not human or real TTS quality evidence.",
  };
  return { bytes, source, metadata, review };
}
test("only reviewed immutable private bytes publish and remain available after deployment sources disappear", async () => {
  const content = createLearningContent(connection.db, { files });
  const f = fixture();
  const privateAudio = {
    ...f.metadata,
    reference: await files.putImmutable(f.bytes),
    model: "test-model",
    voice: "test-voice",
    parameters: { format: "wav" },
    review: f.review,
  };
  const published = await content.publish({ ...f.source, privateAudio });
  expect(published.audioPath).toBe(`/api/materials/${published.id}/audio`);
  expect(published).not.toHaveProperty("privateAudio");
  expect(await content.readAudio(published.id)).toEqual(f.bytes);
  await expect(
    content.publish({
      ...f.source,
      privateAudio: { ...privateAudio, voice: "changed" },
    }),
  ).rejects.toThrow("已发布版本不能改写");
  await expect(
    content.publish({ ...f.source, revision: 2, privateAudio }),
  ).rejects.toThrow("材料");
  const restarted = createLearningContent(connection.db, { files });
  expect(await restarted.readAudio(published.id)).toEqual(f.bytes);
});

test("withdrawal keeps referenced historical audio; cleanup waits 30 days after final release and cannot replace history", async () => {
  let now = new Date("2026-10-12T00:00:00Z");
  const content = createLearningContent(connection.db, {
    files,
    now: () => now,
  });
  const f = fixture();
  const published = await content.publish({
    ...f.source,
    privateAudio: {
      ...f.metadata,
      reference: await files.putImmutable(f.bytes),
      model: "fixture",
      voice: "fixture",
      parameters: {},
      review: f.review,
    },
  });
  const practiceId = crypto.randomUUID();
  await connection.db.transaction(async (tx) => {
    await content.retainPracticeReference(published.id, practiceId, tx);
    await content.retainPracticeReference(published.id, practiceId, tx);
  });
  await content.withdraw(published.id);
  now = new Date("2027-01-01T00:00:00Z");
  expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 0 });
  expect(await content.readAudio(published.id)).toEqual(f.bytes);
  await connection.db.transaction((tx) =>
    content.releasePracticeReference(published.id, practiceId, tx),
  );
  expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 0 });
  now = new Date("2027-01-30T23:59:59Z");
  expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 0 });
  now = new Date("2027-01-31T00:00:00Z");
  expect(await content.cleanupAudio()).toEqual({ cleaned: 1, failed: 0 });
  expect(await content.readVersion(published.id)).toMatchObject({
    materialText: "A: Hello.",
    available: false,
    audioStatus: "cleaned",
  });
  await expect(content.readAudio(published.id)).rejects.toThrow("材料暂不可用");
});

const allowedEmails = new Set<string>();
const messages: { to: string; url: string }[] = [];
const identity = createIdentity(
  connection.db,
  {
    databaseURL: url,
    baseURL: "http://localhost:3000",
    secret: "material-test-only-secret-32-characters",
    allowedEmails,
    developmentMail: true,
    production: false,
  },
  {
    async send(message) {
      messages.push(message);
    },
  },
);
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

test("material GET HEAD and Range recheck the authenticated session and never expose Blob credentials or URL", async () => {
  const owner = await register();
  const f = fixture();
  const content = createLearningContent(connection.db, { files });
  const published = await content.publish({
    ...f.source,
    privateAudio: {
      ...f.metadata,
      reference: await files.putImmutable(f.bytes),
      model: "fixture",
      voice: "fixture",
      parameters: {},
      review: f.review,
    },
  });
  function request(method: string, cookie?: string, range?: string) {
    return handleMaterialAudio(
      new Request(`http://localhost:3000/api/materials/${published.id}/audio`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(range ? { range } : {}) },
      }),
      { identity, content },
      published.id,
    );
  }
  for (const method of ["GET", "HEAD"])
    expect((await request(method)).status).toBe(401);
  const full = await request("GET", owner.cookie);
  expect(full.status).toBe(200);
  expect(Buffer.from(await full.arrayBuffer())).toEqual(f.bytes);
  expect(full.headers.get("Cache-Control")).toBe("private, no-store");
  expect(full.headers.has("location")).toBe(false);
  const head = await request("HEAD", owner.cookie);
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(head.headers.get("Content-Length")).toBe("46");
  const range = await request("GET", owner.cookie, "bytes=0-3");
  expect(range.status).toBe(206);
  expect(await range.text()).toBe("RIFF");
  expect(range.headers.get("Content-Range")).toBe("bytes 0-3/46");
  const suffix = await request("GET", owner.cookie, "bytes=-2");
  expect(suffix.status).toBe(206);
  expect((await suffix.arrayBuffer()).byteLength).toBe(2);
  for (const invalid of [
    "bytes=999-",
    "bytes=-0",
    "bytes=9-3",
    "bytes=0-1,3-4",
    "bytes=a-b",
  ])
    expect((await request("GET", owner.cookie, invalid)).status).toBe(416);
  allowedEmails.delete(owner.learner.email);
  for (const method of ["GET", "HEAD"])
    expect((await request(method, owner.cookie, "bytes=0-3")).status).toBe(401);
});

test("cleanup interruption is recoverable without reporting physical success or holding a database lock over storage", async () => {
  let now = new Date("2026-10-12T00:00:00Z");
  let fail = true;
  const faultFiles: MaterialAudioStore = {
    ...files,
    async remove(reference) {
      await files.remove(reference);
      if (fail) throw new Error("provider response lost");
    },
  };
  const content = createLearningContent(connection.db, {
    files: faultFiles,
    now: () => now,
  });
  const f = fixture();
  const published = await content.publish({
    ...f.source,
    privateAudio: {
      ...f.metadata,
      reference: await files.putImmutable(f.bytes),
      model: "fixture",
      voice: "fixture",
      parameters: {},
      review: f.review,
    },
  });
  const referenceId = crypto.randomUUID();
  await connection.db.transaction((tx) =>
    content.retainPracticeReference(published.id, referenceId, tx),
  );
  await content.withdraw(published.id);
  await connection.db.transaction((tx) =>
    content.releasePracticeReference(published.id, referenceId, tx),
  );
  now = new Date("2027-01-01T00:00:00Z");
  expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 1 });
  expect((await content.readVersion(published.id)).audioStatus).toBe(
    "unavailable",
  );
  await expect(
    connection.db.transaction((tx) =>
      content.retainPracticeReference(published.id, crypto.randomUUID(), tx),
    ),
  ).rejects.toThrow("撤下");
  now = new Date(now.getTime() + 90_000);
  fail = false;
  expect(await content.cleanupAudio()).toEqual({ cleaned: 1, failed: 0 });
  expect((await content.readVersion(published.id)).audioStatus).toBe("cleaned");
});

test("production hides development material from new practice and marks its historical audio unavailable", async () => {
  const f = fixture();
  const development = createLearningContent(connection.db);
  const published = await development.publish({
    ...f.source,
    audioPath: "/audio/development.wav",
  });
  const production = createLearningContent(connection.db, {
    files,
    requirePrivateAudio: true,
  });
  expect(
    (await production.listAvailable()).some((item) => item.id === published.id),
  ).toBe(false);
  await expect(
    production.latestAvailable(f.source.materialKey),
  ).rejects.toThrow("材料暂不可用");
  await expect(production.availableVersion(published.id)).rejects.toThrow(
    "撤下",
  );
  expect(await production.readVersion(published.id)).toMatchObject({
    audioPath: "",
    audioStatus: "unavailable",
    available: false,
  });
  await expect(
    production.publish({
      ...f.source,
      revision: 2,
      audioPath: "/audio/development.wav",
    }),
  ).rejects.toThrow("材料");
});

test("cleanup releases version locks before slow storage I/O and concurrent cleanup cannot steal its lease", async () => {
  let now = new Date("2026-10-12T00:00:00Z");
  let entered!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const slowFiles: MaterialAudioStore = {
    ...files,
    async remove(reference) {
      entered();
      await paused;
      await files.remove(reference);
    },
  };
  const content = createLearningContent(connection.db, {
    files: slowFiles,
    now: () => now,
  });
  const f = fixture();
  const published = await content.publish({
    ...f.source,
    privateAudio: {
      ...f.metadata,
      reference: await files.putImmutable(f.bytes),
      model: "fixture",
      voice: "fixture",
      parameters: {},
      review: f.review,
    },
  });
  const referenceId = crypto.randomUUID();
  await connection.db.transaction((tx) =>
    content.retainPracticeReference(published.id, referenceId, tx),
  );
  await content.withdraw(published.id);
  await connection.db.transaction((tx) =>
    content.releasePracticeReference(published.id, referenceId, tx),
  );
  now = new Date("2027-01-01T00:00:00Z");
  const cleaning = content.cleanupAudio();
  await started;
  try {
    // Updating the same row must complete even though the provider is still paused.
    await Promise.race([
      content.withdraw(published.id),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("database lock held during cloud I/O")),
          1000,
        ).unref();
      }),
    ]);
    expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 0 });
    expect((await content.readVersion(published.id)).audioStatus).toBe(
      "unavailable",
    );
  } finally {
    resume();
  }
  expect(await cleaning).toEqual({ cleaned: 1, failed: 0 });
});

test("concurrent versions cannot share a private object and the rejected publication returns a content error", async () => {
  const content = createLearningContent(connection.db, { files });
  const f = fixture();
  const reference = await files.putImmutable(f.bytes);
  const secondSource = { ...f.source, revision: 2 };
  const metadata = {
    ...f.metadata,
    reference,
    model: "fixture",
    voice: "fixture",
    parameters: {},
  };
  const results = await Promise.allSettled([
    content.publish({
      ...f.source,
      privateAudio: { ...metadata, review: f.review },
    }),
    content.publish({
      ...secondSource,
      privateAudio: {
        ...metadata,
        review: {
          ...f.review,
          contentDigest: reviewContentDigest(secondSource),
        },
      },
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.reason).toMatchObject({
    name: "ContentError",
    code: "invalid",
  });
  const accepted = results.find((result) => result.status === "fulfilled");
  if (!accepted) throw new Error("Expected one immutable publication");
  expect(await content.readAudio(accepted.value.id)).toEqual(f.bytes);
});

test("an expired cleanup owner cannot mark audio cleaned even before another worker acquires the lease", async () => {
  let now = new Date("2026-10-12T00:00:00Z");
  let expireLease = false;
  const slowFiles: MaterialAudioStore = {
    ...files,
    async remove(reference) {
      await files.remove(reference);
      if (expireLease) now = new Date(now.getTime() + 90_000);
    },
  };
  const content = createLearningContent(connection.db, {
    files: slowFiles,
    now: () => now,
  });
  const f = fixture();
  const published = await content.publish({
    ...f.source,
    privateAudio: {
      ...f.metadata,
      reference: await files.putImmutable(f.bytes),
      model: "fixture",
      voice: "fixture",
      parameters: {},
      review: f.review,
    },
  });
  const referenceId = crypto.randomUUID();
  await connection.db.transaction((tx) =>
    content.retainPracticeReference(published.id, referenceId, tx),
  );
  await content.withdraw(published.id);
  await connection.db.transaction((tx) =>
    content.releasePracticeReference(published.id, referenceId, tx),
  );
  now = new Date("2027-01-01T00:00:00Z");
  expireLease = true;
  expect(await content.cleanupAudio()).toEqual({ cleaned: 0, failed: 0 });
  expect((await content.readVersion(published.id)).audioStatus).toBe(
    "unavailable",
  );
  expireLease = false;
  expect(await content.cleanupAudio()).toEqual({ cleaned: 1, failed: 0 });
  expect((await content.readVersion(published.id)).audioStatus).toBe("cleaned");
});
