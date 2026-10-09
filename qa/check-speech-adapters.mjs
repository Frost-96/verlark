// Executes real route handlers and audio conversion, stubbing only request
// identity and the SDK's outbound recognition methods. No external speech calls.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { NextRequest } from "next/server.js";
import { db, reporter, readState, okAction, assert } from "./baseline-lib.mjs";
const require = createRequire(import.meta.url);
const { createJiti } = createRequire(require.resolve("next/package.json"))(
  "jiti",
);
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/auth": path.resolve("qa/fixtures/auth-context.mjs"),
    "@": path.resolve("src"),
  },
});
const state = readState();
const report = reporter("speech-adapter-results.json");
process.env.BASELINE_AUTH_USER = state.accounts[0].id;
process.env.AZURE_SPEECH_KEY = "baseline-sdk-mock";
process.env.AZURE_SPEECH_REGION = "eastus";
process.env.TENCENT_STT_ONE_SENTENCE_SECRET_ID = "baseline-sdk-mock";
process.env.TENCENT_STT_ONE_SENTENCE_SECRET_KEY = "baseline-sdk-mock";
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const tencent = require("tencentcloud-sdk-nodejs-asr");
let mode = "success";
let sttParams;
let azureCalls = 0;
const originalStt = tencent.asr.v20190614.Client.prototype.SentenceRecognition;
const originalAzure = sdk.SpeechRecognizer.prototype.recognizeOnceAsync;
tencent.asr.v20190614.Client.prototype.SentenceRecognition = async function (
  params,
) {
  sttParams = params;
  if (mode === "error") throw new Error("Simulated upstream failure");
  return {
    Result:
      mode === "empty"
        ? ""
        : "Hello, I would like a small cup of coffee, please.",
    RequestId: "mock",
  };
};
sdk.SpeechRecognizer.prototype.recognizeOnceAsync = function (
  success,
  failure,
) {
  azureCalls++;
  if (mode === "error") {
    failure("Simulated Azure error");
    return;
  }
  const properties = new sdk.PropertyCollection();
  properties.setProperty(
    sdk.PropertyId.SpeechServiceResponse_JsonResult,
    JSON.stringify({
      NBest: [
        {
          PronunciationAssessment: {
            PronScore: 91,
            AccuracyScore: 92,
            FluencyScore: 89,
            CompletenessScore: 100,
            ProsodyScore: 88,
          },
          Words: [
            {
              Word: "Hello",
              PronunciationAssessment: { AccuracyScore: 92, ErrorType: "None" },
              Phonemes: [
                {
                  Phoneme: "h",
                  PronunciationAssessment: { AccuracyScore: 93 },
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  success({
    reason:
      mode === "empty"
        ? sdk.ResultReason.NoMatch
        : sdk.ResultReason.RecognizedSpeech,
    properties,
  });
};
const audio = fs.readFileSync(
  new URL("./fixtures/synthetic-speech.mp3", import.meta.url),
);
const form = (messageId) => {
  const f = new FormData();
  f.set("audio", new Blob([audio], { type: "audio/mpeg" }), "synthetic.mp3");
  f.set("language", messageId ? "en-US" : "en");
  if (messageId) {
    f.set(
      "referenceText",
      "Hello, I would like a small cup of coffee, please.",
    );
    f.set("messageId", messageId);
  }
  return f;
};
try {
  await db.connect();
  const stt = await jiti.import("../src/app/api/speaking/stt/route.ts");
  const pronunciation = await jiti.import(
    "../src/app/api/speaking/pronunciation/route.ts",
  );
  await report.test(
    "STT SDK request maps audio bytes and transcript response",
    async () => {
      const r = await stt.POST(
        new NextRequest("http://localhost/api/speaking/stt", {
          method: "POST",
          body: form(),
        }),
      );
      const data = await r.json();
      assert(
        r.status === 200 && data.data.text.includes("coffee"),
        `HTTP ${r.status}`,
      );
      assert(
        sttParams.VoiceFormat === "mp3" &&
          sttParams.EngSerViceType === "16k_en" &&
          Buffer.from(sttParams.Data, "base64").equals(audio) &&
          sttParams.DataLen === audio.length,
        "Incorrect provider request mapping",
      );
    },
  );
  await report.test("STT empty audio rejected before SDK call", async () => {
    sttParams = null;
    const f = new FormData();
    f.set("audio", new Blob([], { type: "audio/mpeg" }), "empty.mp3");
    const r = await stt.POST(
      new NextRequest("http://localhost/api/speaking/stt", {
        method: "POST",
        body: f,
      }),
    );
    assert(
      r.status === 502 && sttParams === null,
      "Empty audio reached provider",
    );
  });
  for (const failure of ["error", "empty"])
    await report.test(`STT ${failure} produces controlled error`, async () => {
      mode = failure;
      const r = await stt.POST(
        new NextRequest("http://localhost/api/speaking/stt", {
          method: "POST",
          body: form(),
        }),
      );
      assert(r.status === 502, `HTTP ${r.status}`);
    });
  mode = "success";
  const mine = crypto.randomUUID();
  const theirs = crypto.randomUUID();
  const other = (
    await okAction(
      "startSpeakingAction",
      {
        scenarioCategory: "daily",
        title: "SDK isolation fixture",
        aiRole: "Tutor",
      },
      state.b,
      "/speaking",
    )
  ).exercise;
  for (const [id, conv] of [
    [mine, state.speaking.conversationId],
    [theirs, other.conversationId],
  ])
    await db.query(
      "INSERT INTO messages (id,conversation_id,role,content,updated_at) VALUES ($1,$2,$3,$4,now())",
      [id, conv, "user", "Hello"],
    );
  await report.test(
    "Azure SDK result maps scores, words, phonemes and persists",
    async () => {
      const r = await pronunciation.POST(
        new NextRequest("http://localhost/api/speaking/pronunciation", {
          method: "POST",
          body: form(mine),
        }),
      );
      const data = await r.json();
      assert(r.status === 200, `HTTP ${r.status}: ${data.error}`);
      assert(
        data.data.pronunciationScore === 91 &&
          data.data.words[0].phonemes[0].accuracyScore === 93,
        "Score mapping incorrect",
      );
      const row = (
        await db.query("SELECT pronunciation_score FROM messages WHERE id=$1", [
          mine,
        ])
      ).rows[0];
      assert(row.pronunciation_score === 91, "Score not persisted");
    },
  );
  await report.test(
    "pronunciation rejects cross-account message before SDK call",
    async () => {
      const before = azureCalls;
      const r = await pronunciation.POST(
        new NextRequest("http://localhost/api/speaking/pronunciation", {
          method: "POST",
          body: form(theirs),
        }),
      );
      const row = (
        await db.query("SELECT pronunciation_score FROM messages WHERE id=$1", [
          theirs,
        ])
      ).rows[0];
      assert(
        row.pronunciation_score === null,
        `Another account's message was changed to ${row.pronunciation_score}; HTTP ${r.status}`,
      );
      assert(
        [403, 404].includes(r.status) && azureCalls === before,
        "Ownership guard missing",
      );
    },
  );
  await report.test("Azure no speech produces controlled error", async () => {
    mode = "empty";
    const r = await pronunciation.POST(
      new NextRequest("http://localhost/api/speaking/pronunciation", {
        method: "POST",
        body: form(mine),
      }),
    );
    assert(r.status === 502, `HTTP ${r.status}`);
  });
  await report.test(
    "speech routes reject missing request identity",
    async () => {
      delete process.env.BASELINE_AUTH_USER;
      const r = await stt.POST(
        new NextRequest("http://localhost/api/speaking/stt", {
          method: "POST",
          body: form(),
        }),
      );
      assert(r.status === 401, `HTTP ${r.status}`);
    },
  );
} catch (error) {
  await report.test("speech harness setup", async () => {
    throw error;
  });
} finally {
  tencent.asr.v20190614.Client.prototype.SentenceRecognition = originalStt;
  sdk.SpeechRecognizer.prototype.recognizeOnceAsync = originalAzure;
  const { prisma } = await jiti.import("../src/lib/prisma.ts");
  await prisma.$disconnect();
  await db.end();
  report.finish();
}
