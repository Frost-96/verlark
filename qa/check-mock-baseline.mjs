import fs from "node:fs";
import {
  db,
  reporter,
  readState,
  saveState,
  request,
  okAction,
  assert,
  parseEvents,
  baseURL,
} from "./baseline-lib.mjs";
assert(
  baseURL === "http://127.0.0.1:3001",
  "Run with BASELINE_URL=http://127.0.0.1:3001 against qa/mock-environment.mjs",
);
const state = readState();
const report = reporter("mock-results.json");
const audio = fs.readFileSync(
  new URL("./fixtures/synthetic-speech.mp3", import.meta.url),
);
const control = async (mode) => {
  const r = await fetch("http://127.0.0.1:4318/__control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mode),
  });
  return r.json();
};
const messages = async (id) =>
  (
    await db.query(
      "SELECT id,role,audio_url,content FROM messages WHERE conversation_id=$1 AND NOT is_deleted ORDER BY created_at",
      [id],
    )
  ).rows;
const parseStream = (r) => {
  assert(r.status === 200, `HTTP ${r.status}: ${r.data?.error}`);
  const ev = parseEvents(r.text);
  const error = ev.find((e) => e.event === "error");
  assert(!error, error?.data.error);
  const done = ev.find((e) => e.event === "done");
  assert(done?.data.fullText, "Missing complete response");
  assert(
    ev
      .filter((e) => e.event === "text_delta")
      .map((e) => e.data.delta)
      .join("") === done.data.fullText,
    "Stream final text differs from deltas",
  );
  return ev;
};
const speak = async (exercise, withAudio = false) => {
  const body = new FormData();
  body.set("exerciseId", exercise.id);
  body.set("conversationId", exercise.conversationId);
  body.set("message", "Hello, I would like a small coffee, please.");
  if (withAudio)
    body.set(
      "audio",
      new Blob([audio], { type: "audio/mpeg" }),
      "synthetic.mp3",
    );
  return request("/api/speaking/chat-stream", {
    jar: state.a,
    method: "POST",
    body,
    timeout: 45000,
  });
};
let conversationId;
let exercise;
try {
  await db.connect();
  await control({ llm: "success", tts: "success", storage: "success" });
  await report.test(
    "mock coach SSE completes and persists exact text",
    async () => {
      const r = await request("/api/coach/chat-stream", {
        jar: state.a,
        method: "POST",
        json: { message: "Explain borrow and lend briefly." },
      });
      const ev = parseStream(r);
      const saved = ev.find((e) => e.event === "message_saved");
      assert(saved, "Missing message_saved");
      const rows = (
        await db.query(
          "SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.type='coach' AND NOT c.is_deleted ORDER BY created_at DESC",
          [state.accounts[0].id],
        )
      ).rows;
      conversationId = rows[0]?.id;
      const rowsM = await messages(conversationId);
      assert(rowsM.length === 2, "Incorrect persisted message count");
      assert(
        rowsM[1].content === ev.find((e) => e.event === "done").data.fullText,
        "Persisted text differs",
      );
      state.mockCoachId = conversationId;
      saveState(state);
      return { events: [...new Set(ev.map((e) => e.event))] };
    },
  );
  await report.test(
    "mock coach non-stream continues existing history",
    async () => {
      const r = await request("/api/coach/chat", {
        jar: state.a,
        method: "POST",
        json: { conversationId, message: "Give another example." },
      });
      assert(r.status === 200 && r.data?.success, `HTTP ${r.status}`);
      assert(
        (await messages(conversationId)).length === 4,
        "Reply not persisted",
      );
    },
  );
  await report.test("mock coach cross-account access rejected", async () => {
    const r = await request("/api/coach/chat-stream", {
      jar: state.b,
      method: "POST",
      json: { conversationId, message: "Hello" },
    });
    assert(r.status === 404, `HTTP ${r.status}`);
  });
  for (const failure of ["401", "empty"])
    await report.test(
      `mock coach ${failure} rolls back user message`,
      async () => {
        const before = (await messages(conversationId)).length;
        await control({ llm: failure });
        const r = await request("/api/coach/chat-stream", {
          jar: state.a,
          method: "POST",
          json: { conversationId, message: "Please help me." },
        });
        const ev = parseEvents(r.text);
        assert(
          ev.some((e) => e.event === "error"),
          "Failure not surfaced",
        );
        assert(
          (await messages(conversationId)).length === before,
          "Failed request left a visible message",
        );
      },
    );
  await control({ llm: "success" });
  await report.test(
    "mock speaking SSE includes text, audio and persistence",
    async () => {
      exercise = (
        await okAction(
          "startSpeakingAction",
          {
            scenarioCategory: "daily",
            title: "SIMULATED provider cafe test",
            aiRole: "Cafe barista",
          },
          state.a,
          "/speaking",
        )
      ).exercise;
      state.mockSpeaking = exercise;
      saveState(state);
      const ev = parseStream(await speak(exercise, true));
      assert(
        ev.some(
          (e) =>
            e.event === "audio_chunk" &&
            Buffer.from(e.data.audioBase64, "base64").length > 100,
        ),
        "No audio chunks",
      );
      const rows = await messages(exercise.conversationId);
      assert(rows.length === 2, "Message pair not persisted");
      assert(rows[0].audio_url, "Uploaded user audio not linked");
      return {
        events: [...new Set(ev.map((e) => e.event))],
        messages: rows.length,
      };
    },
  );
  await report.test(
    "mock stored assistant audio signed and playable",
    async () => {
      let row;
      for (let i = 0; i < 6; i++) {
        row = (await messages(exercise.conversationId)).find(
          (m) => m.role === "assistant",
        );
        if (row?.audio_url) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      assert(row?.audio_url, "Assistant audio path missing");
      const r = await request(
        `/api/speaking/getAudioURL?bucket=ai-audio&path=${encodeURIComponent(row.audio_url)}`,
        { jar: state.a },
      );
      assert(r.status === 200, `HTTP ${r.status}`);
      const play = await fetch(r.data.data.url);
      assert(
        play.ok && (await play.arrayBuffer()).byteLength === audio.length,
        "Signed audio not playable",
      );
    },
  );
  await report.test(
    "mock speaking upstream error rolls back message and turn count",
    async () => {
      const before = await messages(exercise.conversationId);
      const turnsBefore = (
        await db.query(
          "SELECT total_turns FROM speaking_exercises WHERE id=$1",
          [exercise.id],
        )
      ).rows[0].total_turns;
      await control({ llm: "401" });
      const r = await speak(exercise);
      assert(
        parseEvents(r.text).some((e) => e.event === "error"),
        "Missing error event",
      );
      assert(
        (await messages(exercise.conversationId)).length === before.length,
        "User message not rolled back",
      );
      const after = (
        await db.query(
          "SELECT total_turns FROM speaking_exercises WHERE id=$1",
          [exercise.id],
        )
      ).rows[0].total_turns;
      assert(after === turnsBefore, "Turn count not rolled back");
    },
  );
  await report.test(
    "mock TTS failure retains valid speaking text",
    async () => {
      await control({ llm: "success", tts: "401" });
      const ev = parseStream(await speak(exercise));
      assert(
        !ev.some((e) => e.event === "audio_chunk"),
        "Unexpected audio from failed TTS",
      );
      assert(
        (await messages(exercise.conversationId)).length === 4,
        "Text reply was not retained",
      );
    },
  );
  await control({ llm: "success", tts: "success" });
  await report.test(
    "mock speaking finish and structured AI review persist",
    async () => {
      await okAction(
        "endSpeakingAction",
        { exerciseId: exercise.id },
        state.a,
        "/speaking",
      );
      const r = await request("/api/speaking/review", {
        jar: state.a,
        method: "POST",
        json: { exerciseId: exercise.id },
      });
      assert(
        r.status === 200 && r.data?.success,
        `HTTP ${r.status}: ${r.data?.error}`,
      );
      const row = (
        await db.query(
          "SELECT status,fluency_score,accuracy_score FROM speaking_exercises WHERE id=$1",
          [exercise.id],
        )
      ).rows[0];
      assert(
        row.status === "reviewed" &&
          row.fluency_score === 7 &&
          row.accuracy_score === 8,
        "Review values not persisted",
      );
      return row;
    },
  );
  await report.test(
    "mock duplicate speaking review returns conflict",
    async () => {
      const r = await request("/api/speaking/review", {
        jar: state.a,
        method: "POST",
        json: { exerciseId: exercise.id },
      });
      assert(r.status === 409, `HTTP ${r.status}`);
    },
  );
  const w = (
    await okAction(
      "createWritingExerciseAction",
      {
        scenarioType: "daily",
        prompt: "Describe a relaxing weekend.",
        isCustomPrompt: true,
      },
      state.a,
      "/writing",
    )
  ).exercise;
  state.mockWriting = w;
  saveState(state);
  const input = {
    exerciseId: w.id,
    scenarioType: "daily",
    prompt: w.prompt,
    isCustomPrompt: true,
    content: state.essay,
  };
  await report.test(
    "mock malformed writing JSON fails without saving a review",
    async () => {
      await control({ llm: "invalid-json" });
      const r = await request("/api/writing/submit", {
        jar: state.a,
        method: "POST",
        json: input,
      });
      assert(r.status === 502, `HTTP ${r.status}`);
      const row = (
        await db.query(
          "SELECT status,overall_score FROM writing_exercises WHERE id=$1",
          [w.id],
        )
      ).rows[0];
      assert(
        row.status === "draft" && row.overall_score === null,
        "Invalid review persisted",
      );
    },
  );
  await report.test(
    "mock writing retries successfully after provider failure",
    async () => {
      await control({ llm: "success" });
      const r = await request("/api/writing/submit", {
        jar: state.a,
        method: "POST",
        json: input,
      });
      assert(r.status === 200 && r.data?.success, `HTTP ${r.status}`);
      const row = (
        await db.query(
          "SELECT status,overall_score FROM writing_exercises WHERE id=$1",
          [w.id],
        )
      ).rows[0];
      assert(
        row.status === "reviewed" && row.overall_score === 7,
        "Review not persisted",
      );
    },
  );
  await report.test(
    "duplicate writing submit rejects before calling provider",
    async () => {
      const before = (await control({})).stats.llm;
      const r = await request("/api/writing/submit", {
        jar: state.a,
        method: "POST",
        json: input,
      });
      const after = (await control({})).stats.llm;
      assert(
        after === before,
        `Rejected duplicate still made ${after - before} provider call(s); HTTP ${r.status}`,
      );
      assert(r.status === 409, `HTTP ${r.status}`);
    },
  );
} catch (error) {
  await report.test("mock setup", async () => {
    throw error;
  });
} finally {
  await control({ llm: "success", tts: "success", storage: "success" });
  await db.end();
  report.finish();
}
