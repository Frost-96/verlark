// Local-only HTTP mocks for OpenAI-compatible LLM/TTS and Supabase Storage.
// The real application runs unchanged on :3001, using disposable DB fixtures.
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
  false,
  { info() {}, error() {} },
);
const audio = fs.readFileSync(
  new URL("./fixtures/synthetic-speech.mp3", import.meta.url),
);
const mode = { llm: "success", tts: "success", storage: "success" };
const objects = new Map();
const stats = { llm: 0, tts: 0, storage: 0 };
const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};
const writing = {
  overallScore: 7,
  grammarScore: 7,
  vocabularyScore: 7,
  coherenceScore: 7,
  taskScore: 7,
  overallComment: "SIMULATED: clear writing with room for more detail.",
  sentenceFeedback: [],
  strengths: ["Clear structure"],
  improvements: ["Add descriptive detail"],
  sampleExpressions: [],
};
const speaking = {
  fluencyScore: 7,
  accuracyScore: 8,
  overallComment: "SIMULATED: clear and polite conversation.",
  grammarErrors: [],
  vocabularyAnalysis: {
    totalUniqueWords: 10,
    advancedWordsUsed: [],
    suggestedVocabulary: [],
  },
  expressionSuggestions: [],
  strengths: ["Polite request"],
  improvements: ["Add more detail"],
};
const provider = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4318");
    const parts = [];
    for await (const p of req) parts.push(p);
    const raw = Buffer.concat(parts);
    if (url.pathname === "/__control") {
      if (req.method === "POST")
        Object.assign(mode, JSON.parse(raw.toString()));
      return json(res, 200, { mode, stats, objects: objects.size });
    }
    if (url.pathname === "/v1/chat/completions") {
      const body = JSON.parse(raw.toString());
      const isTts = Boolean(body.audio);
      stats[isTts ? "tts" : "llm"]++;
      const selected = isTts ? mode.tts : mode.llm;
      if (selected === "401")
        return json(res, 401, {
          error: {
            message: "Simulated invalid API key",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        });
      let content =
        body.model === "baseline-writing"
          ? JSON.stringify(writing)
          : body.response_format
            ? JSON.stringify(speaking)
            : body.model === "baseline-coach"
              ? "SIMULATED: Borrow means receive temporarily; lend means give temporarily."
              : "Certainly, here is your small coffee. Would you like some milk?";
      if (selected === "empty") content = "";
      if (selected === "invalid-json") content = "{invalid";
      if (body.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        for (const delta of content.match(/.{1,15}/g) || []) {
          if (res.destroyed) break;
          res.write(
            `data: ${JSON.stringify({ id: "mock-completion", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`,
          );
          await new Promise((r) => setTimeout(r, 20));
        }
        res.end("data: [DONE]\n\n");
        return;
      }
      return json(res, 200, {
        id: "mock-completion",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
              ...(isTts
                ? {
                    audio: {
                      data: audio.toString("base64"),
                      id: "mock-audio",
                      expires_at: 0,
                      transcript: "Synthetic QA audio",
                    },
                  }
                : {}),
            },
            finish_reason: "stop",
          },
        ],
      });
    }
    if (url.pathname.startsWith("/storage/v1/")) {
      stats.storage++;
      if (mode.storage === "fail")
        return json(res, 503, {
          statusCode: "503",
          error: "Unavailable",
          message: "Simulated storage failure",
        });
      const prefix = "/storage/v1/object/";
      if (url.pathname.startsWith(prefix + "sign/") && req.method === "POST") {
        const key = decodeURIComponent(
          url.pathname.slice((prefix + "sign/").length),
        );
        if (!objects.has(key))
          return json(res, 404, { message: "Object not found" });
        return json(res, 200, { signedURL: `/object/sign/${key}?token=mock` });
      }
      if (url.pathname.startsWith(prefix + "sign/") && req.method === "GET") {
        const value = objects.get(
          decodeURIComponent(url.pathname.slice((prefix + "sign/").length)),
        );
        if (!value) return json(res, 404, { message: "Object not found" });
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(value);
        return;
      }
      if (url.pathname.startsWith(prefix) && req.method === "POST") {
        const key = decodeURIComponent(url.pathname.slice(prefix.length));
        objects.set(key, raw);
        return json(res, 200, { Key: key, Id: "mock-object" });
      }
      if (url.pathname.startsWith(prefix) && req.method === "DELETE") {
        const bucket = url.pathname.slice(prefix.length);
        for (const p of JSON.parse(raw.toString()).prefixes || [])
          objects.delete(`${bucket}/${p}`);
        return json(res, 200, []);
      }
      if (url.pathname === "/storage/v1/bucket")
        return json(res, 200, [
          { id: "user-audio", name: "user-audio" },
          { id: "ai-audio", name: "ai-audio" },
        ]);
    }
    json(res, 404, { error: "No mock defined for this request" });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});
await new Promise((resolve) => provider.listen(4318, "127.0.0.1", resolve));
const env = { ...process.env };
for (const prefix of ["WRITING_LLM", "SPEAKING_LLM", "COACH_LLM", "TTS"]) {
  env[`${prefix}_API_KEY`] = "baseline-mock-key";
  env[`${prefix}_BASE_URL`] = "http://127.0.0.1:4318/v1";
}
env.WRITING_LLM_MODEL = "baseline-writing";
env.SPEAKING_LLM_MODEL = "baseline-speaking";
env.COACH_LLM_MODEL = "baseline-coach";
env.TTS_MODEL = "baseline-tts";
env.SUPABASE_URL = "http://127.0.0.1:4318";
env.SUPABASE_SERVICE_ROLE_KEY = "baseline-mock-storage-key";
// Prevent accidental real speech-provider calls in this isolated instance.
env.AZURE_SPEECH_KEY = "";
env.TENCENT_STT_ONE_SENTENCE_SECRET_ID = "";
env.TENCENT_STT_ONE_SENTENCE_SECRET_KEY = "";
env.TENCENT_STT_FLASH_SECRET_ID = "";
env.TENCENT_STT_FLASH_SECRET_KEY = "";
const log = fs.openSync("/tmp/verlark-mock-app.log", "w");
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  { env, stdio: ["ignore", log, log] },
);
const close = () => {
  child.kill("SIGTERM");
  provider.close();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
child.on("exit", () => provider.close());
console.log(
  "Mock provider: http://127.0.0.1:4318 ; unchanged app: http://127.0.0.1:3001",
);
