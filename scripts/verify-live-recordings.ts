/** Opt-in integration acceptance. Requires a disposable LOCAL *_test DB and Blob token.
 * LIVE_RECORDING_PROBE=1 TEST_DATABASE_URL=... BLOB_READ_WRITE_TOKEN=...
 * node_modules/.bin/tsx scripts/verify-live-recordings.ts /tmp/receipt.json
 * Uses synthetic WAV only; no production DB, mail, AI, or deployment is touched.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { put as clientPut } from "@vercel/blob/client";
import { connectDatabase } from "../src/db/client";
import { createIdentity } from "../src/modules/identity/server";
import { createLearningContent } from "../src/modules/learning-content/server";
import { createPractice } from "../src/modules/practice/server";
import { createBlobObjectStore } from "../src/integrations/files/blob";
import {
  createPrivateRecordingFiles,
  type PrivateObjectStore,
} from "../src/integrations/files/private";
import { validateRecordingAudio } from "../src/integrations/files/media";
import {
  handleAudioRequest,
  handleUploadRequest,
} from "../src/app/api/practices/audio-http";
import { handleRecordingRequest } from "../src/app/api/practices/recording-http";
import type { MailMessage } from "../src/integrations/mail/contracts";

const url = process.env.TEST_DATABASE_URL;
const token = process.env.BLOB_READ_WRITE_TOKEN;
const receiptPath = process.argv[2];
if (process.env.LIVE_RECORDING_PROBE !== "1" || !url || !token || !receiptPath)
  throw new Error(
    "Explicit LIVE_RECORDING_PROBE=1, TEST_DATABASE_URL, BLOB_READ_WRITE_TOKEN and receipt path required.",
  );
const database = new URL(url);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
  !database.pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("Probe requires a separate local database ending in _test.");
if (
  !resolve(receiptPath).startsWith("/tmp/") &&
  !resolve(receiptPath).startsWith("/private/tmp/")
)
  throw new Error(
    "Write the sanitized receipt outside the repository under /tmp.",
  );
const receipt: {
  startedAt: string;
  finishedAt?: string;
  stage: string;
  passed: string[];
  outcome: string;
  paths: string[];
  cleanup: Record<string, string>;
  limitations: string[];
} = {
  startedAt: new Date().toISOString(),
  stage: "setup",
  passed: [],
  outcome: "running",
  paths: [],
  cleanup: {},
  limitations: [
    "Runs HTTP handlers directly, not a deployed browser/server.",
    "Email delivery is local capture; authentication/session checks are real Better Auth.",
    "30-day expiry uses an injected clock, not 30 days of wall time.",
    "Known-object absence is not evidence that in-flight/multipart uploads have terminated.",
  ],
};
const save = () =>
  writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
const pass = async (name: string) => {
  receipt.passed.push(name);
  await save();
};
const stage = async (name: string) => {
  receipt.stage = name;
  await save();
};
const connection = connectDatabase(url);
const origin = "http://localhost:3000";
const allowedEmails = new Set<string>();
const mail: MailMessage[] = [];
const identity = createIdentity(
  connection.db,
  {
    databaseURL: url,
    baseURL: origin,
    secret: crypto.randomUUID() + crypto.randomUUID(),
    allowedEmails,
    developmentMail: true,
    production: false,
  },
  {
    send: async (message) => {
      mail.push(message);
    },
  },
);
const objectStore = createBlobObjectStore(token);
const uploadIds = new Set<string>();
const paths = new Set<string>();
async function remember(path: string) {
  assert.match(path, /^(temporary|recordings)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  assert.ok(uploadIds.has(path.split("/")[2]!), "Object outside this probe");
  paths.add(path);
  receipt.paths = [...paths];
  await save();
}
const trackedStore: PrivateObjectStore = {
  authorize: async (path, type, until) => {
    await remember(path);
    return objectStore.authorize(path, type, until);
  },
  put: async (path, bytes, type) => {
    await remember(path);
    await objectStore.put(path, bytes, type);
  },
  read: async (path) => {
    await remember(path);
    return objectStore.read(path);
  },
  remove: async (path) => {
    await remember(path);
    await objectStore.remove(path);
  },
};
let now = new Date();
const clock = { now: () => now };
const files = createPrivateRecordingFiles(
  connection.db,
  trackedStore,
  validateRecordingAudio,
  clock,
);
const content = createLearningContent(connection.db);
const practice = createPractice(
  connection.db,
  content,
  files,
  undefined,
  clock,
);
const services = { identity, practice };
const audio = Buffer.alloc(32044);
audio.write("RIFF");
audio.writeUInt32LE(32036, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24);
audio.writeUInt32LE(32000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(32000, 40);
for (let i = 0; i < 16000; i++)
  audio.writeInt16LE(
    Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 1000),
    44 + i * 2,
  );
function request(
  path: string,
  cookie: string,
  body?: object,
  method = body ? "POST" : "GET",
  range?: string,
) {
  return new Request(origin + path, {
    method,
    headers: {
      origin,
      cookie,
      "content-type": "application/json",
      ...(range ? { range } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function account() {
  const email = `blob-probe-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  allowedEmails.add(email);
  assert.equal(
    (
      await identity.handleAuthRequest(
        request("/api/auth/sign-up/email", "", {
          email,
          password,
          name: "Synthetic probe",
        }),
      )
    ).status,
    200,
  );
  const verification = mail.findLast((message) => message.to === email);
  assert.ok(verification);
  const verifyToken = new URL(verification.url).searchParams.get("token");
  assert.equal(
    (
      await identity.handleAuthRequest(
        request(`/api/auth/verify-email?token=${verifyToken}`, ""),
      )
    ).status,
    200,
  );
  const signed = await identity.handleAuthRequest(
    request("/api/auth/sign-in/email", "", { email, password }),
  );
  assert.equal(signed.status, 200);
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const learner = await identity.getCurrentLearner(new Headers({ cookie }));
  assert.ok(learner);
  return { cookie, learner };
}
try {
  await save();
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  const alice = await account();
  const bob = await account();
  await pass(
    "Two real verified Better Auth sessions established in isolated local DB",
  );
  const source = await content.publish({
    materialKey: `blob-probe-${crypto.randomUUID()}`,
    revision: 1,
    title: "Synthetic probe",
    summary: "Synthetic",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I will …"],
    example: "I will read.",
    audioPath: "/audio/weekend-v1.wav",
  });
  const current = await practice.start(
    alice.learner,
    source.materialKey,
    crypto.randomUUID(),
  );
  const uploadRoute = `/api/practices/${current.id}/uploads`;
  async function issue() {
    const uploadId = crypto.randomUUID();
    uploadIds.add(uploadId);
    const response = await handleUploadRequest(
      request(uploadRoute, alice.cookie, {
        action: "issue",
        uploadId,
        mediaType: "audio/wav",
      }),
      services,
      current.id,
    );
    assert.equal(response.status, 200);
    return (await response.json()) as {
      reference: string;
      pathname: string;
      clientToken: string;
    };
  }
  await stage("signed-upload");
  const permit = await issue();
  for (const [cookie, expected] of [
    [bob.cookie, 404],
    ["", 401],
  ] as const) {
    const denied = await handleUploadRequest(
      request(uploadRoute, cookie, {
        action: "issue",
        uploadId: crypto.randomUUID(),
        mediaType: "audio/wav",
      }),
      services,
      current.id,
    );
    assert.equal(denied.status, expected);
  }
  const uploaded = await clientPut(permit.pathname, audio, {
    access: "private",
    contentType: "audio/wav",
    token: permit.clientToken,
    abortSignal: AbortSignal.timeout(15000),
  });
  assert.equal(
    (await fetch(uploaded.url, { signal: AbortSignal.timeout(10000) })).status,
    403,
  );
  await pass(
    "Owner-scoped signed client upload succeeds; cross-account 404 / unauthenticated 401; direct anonymous Blob URL 403",
  );
  await stage("validation-submit-history");
  const completed = await handleUploadRequest(
    request(uploadRoute, alice.cookie, {
      action: "complete",
      reference: permit.reference,
    }),
    services,
    current.id,
  );
  assert.equal(completed.status, 200);
  assert.equal(
    (await practice.read(alice.learner, current.id)).attempts.length,
    0,
  );
  const submissionId = crypto.randomUUID();
  const submitted = await handleRecordingRequest(
    request(`/api/practices/${current.id}/submissions`, alice.cookie, {
      submissionId,
      reference: permit.reference,
    }),
    services,
    current.id,
    "submissions",
  );
  assert.equal(submitted.status, 201);
  const attempt = (await submitted.json()) as {
    id: string;
    acceptedAt: string;
  };
  const replayed = await practice.submit(
    alice.learner,
    current.id,
    submissionId,
    permit.reference,
  );
  assert.equal(replayed.id, attempt.id);
  assert.equal(
    (await practice.read(alice.learner, current.id)).attempts.length,
    1,
  );
  await pass(
    "Actual FFmpeg validation, immutable final private Blob, explicit submission and idempotent history acceptance",
  );
  const audioRoute = `/api/practices/${current.id}/attempts/${attempt.id}/audio`;
  const playback = (cookie: string, method = "GET", range?: string) =>
    handleAudioRequest(
      request(audioRoute, cookie, undefined, method, range),
      services,
      current.id,
      attempt.id,
    );
  await stage("playback");
  const get = await playback(alice.cookie);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), audio);
  const head = await playback(alice.cookie, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(audio.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const range = await playback(alice.cookie, "GET", "bytes=10-19");
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 10-19/32044");
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    audio.subarray(10, 20),
  );
  for (const method of ["GET", "HEAD"]) {
    assert.equal((await playback(bob.cookie, method)).status, 404);
    assert.equal((await playback("", method)).status, 401);
  }
  await pass(
    "History playback GET / HEAD / Range use real private origin bytes; cross-account and unauthenticated playback denied",
  );
  // Issue a second permit before deleting. Its upload deliberately arrives after deletion.
  const late = await issue();
  await stage("unaccepted-expiry");
  now = new Date(now.getTime() + 86400000);
  await assert.rejects(
    practice.completeRecordingUpload(alice.learner, current.id, late.reference),
    { message: "上传不属于本次练习或已到期。" },
  );
  await pass("24-hour logical expiry prevents completing an unaccepted upload");
  await stage("retention-expiry");
  now = new Date(new Date(attempt.acceptedAt).getTime() + 30 * 86400000);
  assert.equal((await playback(alice.cookie)).status, 410);
  assert.equal((await playback(alice.cookie, "HEAD")).status, 410);
  await assert.rejects(
    practice.recognize(alice.learner, current.id, attempt.id),
    { code: "recording-expired" },
  );
  assert.equal(
    (await practice.read(alice.learner, current.id)).attempts[0]
      ?.recordingStatus,
    "expired",
  );
  await pass(
    "30-day logical expiry denies new playback and recognition while retaining attempt history",
  );
  await stage("delete-late-upload");
  const deletion = await practice.delete(alice.learner, current.id);
  assert.equal(deletion.status, "failed");
  assert.equal((await playback(alice.cookie)).status, 404);
  await assert.rejects(practice.read(alice.learner, current.id), {
    code: "not-found",
  });
  await clientPut(late.pathname, audio, {
    access: "private",
    contentType: "audio/wav",
    token: late.clientToken,
    abortSignal: AbortSignal.timeout(15000),
  });
  assert.ok(await objectStore.read(late.pathname));
  const deniedComplete = await handleUploadRequest(
    request(uploadRoute, alice.cookie, {
      action: "complete",
      reference: late.reference,
    }),
    services,
    current.id,
  );
  assert.equal(deniedComplete.status, 404);
  await assert.rejects(
    practice.submit(
      alice.learner,
      current.id,
      crypto.randomUUID(),
      late.reference,
    ),
    { code: "not-found" },
  );
  const retry = await practice.retryDeletion(alice.learner, current.id);
  assert.equal(retry.status, "failed");
  assert.equal(await objectStore.read(late.pathname), null);
  await assert.rejects(practice.readDeletion(bob.learner, current.id), {
    code: "not-found",
  });
  assert.notEqual(
    (await practice.readDeletion(alice.learner, current.id)).status,
    "succeeded",
  );
  await pass(
    "Deletion immediately denies access; actual late client upload cannot revive practice; retry removes it and receipt truthfully remains incomplete",
  );
  receipt.outcome = "passed";
} catch {
  // SDK/DB errors may embed secrets. Report only the named stage, never raw errors.
  receipt.outcome = "failed";
  process.exitCode = 1;
} finally {
  for (const path of paths) {
    try {
      await objectStore.remove(path);
      receipt.cleanup[path] =
        (await objectStore.read(path)) === null
          ? "known-object-absence-confirmed"
          : "object-still-present";
    } catch {
      receipt.cleanup[path] = "unknown-retry-required";
    }
    await save();
  }
  if (
    Object.values(receipt.cleanup).some(
      (value) => value !== "known-object-absence-confirmed",
    )
  ) {
    receipt.outcome = "cleanup-incomplete";
    process.exitCode = 1;
  }
  receipt.finishedAt = new Date().toISOString();
  await save();
  await connection.close();
  console.log(
    JSON.stringify({
      outcome: receipt.outcome,
      stage: receipt.stage,
      passed: receipt.passed.length,
      cleanup: Object.values(receipt.cleanup),
      receipt: receiptPath,
    }),
  );
}
