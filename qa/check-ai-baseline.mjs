// Uses only disposable fixtures produced by check-baseline.mjs --keep-fixtures.
// Makes small real calls to the configured AI, speech and storage providers.
import fs from "node:fs";
import {
  db,
  request,
  okAction,
  assert,
  reporter,
  readState,
  saveState,
  parseEvents,
} from "./baseline-lib.mjs";

const state = readState();
const report = reporter("ai-results.json");
let audio;
let audioText;
try {
  await db.connect();
  await report.test("writing real AI grading and persistence", async () => {
    const r = await request("/api/writing/submit", {
      jar: state.a,
      method: "POST",
      timeout: 150000,
      json: {
        exerciseId: state.gradeWriting.id,
        scenarioType: "daily",
        prompt: state.gradeWriting.prompt,
        isCustomPrompt: true,
        content: state.essay,
      },
    });
    assert(
      r.status === 200 && r.data?.success,
      `HTTP ${r.status}: ${r.data?.error || "No successful grading result"}`,
    );
    const row = (
      await db.query(
        "SELECT status,overall_score,feedback,content FROM writing_exercises WHERE id=$1",
        [state.gradeWriting.id],
      )
    ).rows[0];
    assert(
      row.status === "reviewed" && row.overall_score !== null && row.feedback,
      "Review not persisted",
    );
    assert(row.content === state.essay, "Essay not persisted");
    return { status: row.status, overallScore: row.overall_score };
  });
  await report.test("writing graded review page", async () => {
    const r = await request(`/writing/${state.gradeWriting.id}/review`, {
      jar: state.a,
    });
    assert(
      r.status === 200 && !r.text.includes("Application error:"),
      `HTTP ${r.status}`,
    );
  });
  await report.test("coach SSE reply and persistence", async () => {
    const r = await request("/api/coach/chat-stream", {
      jar: state.a,
      method: "POST",
      timeout: 120000,
      json: {
        message:
          "Please explain the difference between borrow and lend in two short sentences.",
      },
    });
    assert(r.status === 200, `HTTP ${r.status}: ${r.data?.error}`);
    const events = parseEvents(r.text);
    const err = events.find((e) => e.event === "error");
    assert(!err, err?.data.error);
    const done = events.find((e) => e.event === "done");
    assert(done?.data.fullText?.length > 0, "Empty or incomplete stream");
    const saved = events.find((e) => e.event === "message_saved");
    assert(saved, "Missing persistence event");
    const rows = await db.query(
      "SELECT c.id,count(m.id)::int AS messages FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.user_id=$1 AND c.type='coach' AND NOT c.is_deleted AND NOT m.is_deleted GROUP BY c.id",
      [state.accounts[0].id],
    );
    assert(
      rows.rows.some((x) => x.messages >= 2),
      "Coach messages not persisted",
    );
    state.coachId = rows.rows[0].id;
    saveState(state);
    return {
      events: [...new Set(events.map((e) => e.event))],
      replyCharacters: done.data.fullText.length,
      persistedMessages: rows.rows[0].messages,
    };
  });
  await report.test("coach non-stream reply", async () => {
    const r = await request("/api/coach/chat", {
      jar: state.a,
      method: "POST",
      timeout: 120000,
      json: {
        conversationId: state.coachId,
        message: "Give one short example sentence using lend.",
      },
    });
    assert(
      r.status === 200 && r.data?.success,
      `HTTP ${r.status}: ${r.data?.error}`,
    );
    assert(r.data.data.assistantMessage?.content?.length > 0, "Empty answer");
    return { replyCharacters: r.data.data.assistantMessage.content.length };
  });
  await report.test("coach blocks another account conversation", async () => {
    assert(state.coachId, "No coach fixture");
    const r = await request("/api/coach/chat-stream", {
      jar: state.b,
      method: "POST",
      json: { conversationId: state.coachId, message: "Hello" },
    });
    assert(r.status === 404, `HTTP ${r.status}`);
  });
  await report.test("speaking SSE reply and persistence", async () => {
    const body = new FormData();
    body.set("exerciseId", state.speaking.id);
    body.set("conversationId", state.speaking.conversationId);
    body.set("message", "Hello, I would like a small coffee, please.");
    const r = await request("/api/speaking/chat-stream", {
      jar: state.a,
      method: "POST",
      body,
      timeout: 150000,
    });
    assert(r.status === 200, `HTTP ${r.status}: ${r.data?.error}`);
    const events = parseEvents(r.text);
    const err = events.find((e) => e.event === "error");
    assert(!err, err?.data.error);
    const done = events.find((e) => e.event === "done");
    assert(done?.data.fullText?.length > 0, "Empty or incomplete stream");
    const chunks = events.filter((e) => e.event === "audio_chunk");
    if (chunks.length) {
      audio = Buffer.from(chunks[0].data.audioBase64, "base64");
      audioText =
        events.find(
          (e) =>
            e.event === "sentence" && e.data.index === chunks[0].data.index,
        )?.data.text || done.data.fullText;
      fs.writeFileSync("/tmp/verlark-baseline-audio.mp3", audio);
    }
    const rows = await db.query(
      "SELECT id,role,audio_url FROM messages WHERE conversation_id=$1 AND NOT is_deleted ORDER BY created_at",
      [state.speaking.conversationId],
    );
    assert(
      rows.rows.some((x) => x.role === "user") &&
        rows.rows.some((x) => x.role === "assistant"),
      "Messages not persisted",
    );
    state.speakingAssistant = rows.rows.find((x) => x.role === "assistant");
    saveState(state);
    return {
      events: [...new Set(events.map((e) => e.event))],
      audioChunks: chunks.length,
      persistedMessages: rows.rowCount,
    };
  });
  await report.test("speaking TTS yields audio bytes", async () => {
    assert(audio?.length > 100, "No audio_chunk payload from TTS");
    return { bytes: audio.length };
  });
  await report.test(
    "speaking audio stored and signed playback works",
    async () => {
      let row;
      for (let i = 0; i < 6; i++) {
        row = (
          await db.query(
            "SELECT audio_url FROM messages WHERE conversation_id=$1 AND role='assistant' AND NOT is_deleted ORDER BY created_at DESC LIMIT 1",
            [state.speaking.conversationId],
          )
        ).rows[0];
        if (row?.audio_url) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      assert(
        row?.audio_url,
        "Assistant audio path not persisted within 12 seconds",
      );
      state.storagePaths = [{ bucket: "ai-audio", path: row.audio_url }];
      saveState(state);
      const r = await request(
        `/api/speaking/getAudioURL?bucket=ai-audio&path=${encodeURIComponent(row.audio_url)}`,
        { jar: state.a },
      );
      assert(
        r.status === 200 && r.data?.data?.url,
        `HTTP ${r.status}: ${r.data?.error}`,
      );
      const playback = await fetch(r.data.data.url, {
        signal: AbortSignal.timeout(15000),
      });
      assert(playback.ok, `Signed playback HTTP ${playback.status}`);
      const bytes = (await playback.arrayBuffer()).byteLength;
      assert(bytes > 100, "Empty playback file");
      return { bytes };
    },
  );
  await report.test("STT recognizes synthetic English audio", async () => {
    assert(audio?.length, "TTS fixture unavailable");
    const body = new FormData();
    body.set(
      "audio",
      new Blob([audio], { type: "audio/mpeg" }),
      "baseline.mp3",
    );
    body.set("language", "en");
    const r = await request("/api/speaking/stt", {
      jar: state.a,
      method: "POST",
      body,
      timeout: 90000,
    });
    assert(
      r.status === 200 && r.data?.data?.text?.length > 0,
      `HTTP ${r.status}: ${r.data?.error}`,
    );
    return { recognizedText: r.data.data.text };
  });
  await report.test(
    "Azure pronunciation assessment of synthetic audio",
    async () => {
      assert(audio?.length, "TTS fixture unavailable");
      const body = new FormData();
      body.set(
        "audio",
        new Blob([audio], { type: "audio/mpeg" }),
        "baseline.mp3",
      );
      body.set("referenceText", audioText);
      body.set("language", "en-US");
      const r = await request("/api/speaking/pronunciation", {
        jar: state.a,
        method: "POST",
        body,
        timeout: 90000,
      });
      assert(
        r.status === 200 && r.data?.success,
        `HTTP ${r.status}: ${r.data?.error}`,
      );
      state.pronunciation = r.data.data;
      saveState(state);
      return { resultKeys: Object.keys(r.data.data) };
    },
  );
  await report.test("speaking end persists completed status", async () => {
    const r = await okAction(
      "endSpeakingAction",
      { exerciseId: state.speaking.id },
      state.a,
      "/speaking",
    );
    assert(r.exercise.status === "completed", "Unexpected status");
    return {
      status: r.exercise.status,
      totalTurns: r.exercise.totalTurns,
      durationSeconds: r.exercise.durationSeconds,
    };
  });
  await report.test("speaking AI review persists scores", async () => {
    const r = await request("/api/speaking/review", {
      jar: state.a,
      method: "POST",
      json: { exerciseId: state.speaking.id },
      timeout: 150000,
    });
    assert(
      r.status === 200 && r.data?.success,
      `HTTP ${r.status}: ${r.data?.error}`,
    );
    const row = (
      await db.query(
        "SELECT status,fluency_score,accuracy_score FROM speaking_exercises WHERE id=$1",
        [state.speaking.id],
      )
    ).rows[0];
    assert(
      row.status === "reviewed" && row.fluency_score !== null,
      "Review not persisted",
    );
    return row;
  });
  await report.test("speaking duplicate review rejected", async () => {
    const r = await request("/api/speaking/review", {
      jar: state.a,
      method: "POST",
      json: { exerciseId: state.speaking.id },
    });
    assert(r.status === 409, `HTTP ${r.status}`);
  });
  await report.test("speaking review page loads", async () => {
    const r = await request(`/speaking/${state.speaking.id}/review`, {
      jar: state.a,
    });
    assert(
      r.status === 200 && !r.text.includes("Application error:"),
      `HTTP ${r.status}`,
    );
  });
  await report.test(
    "speaking end excludes idle days from practice duration",
    async () => {
      const r = await okAction(
        "startSpeakingAction",
        {
          scenarioCategory: "daily",
          title: "Baseline idle timer test",
          aiRole: "A friendly tutor",
        },
        state.a,
        "/speaking",
      );
      await db.query(
        "UPDATE speaking_exercises SET created_at=now()-interval '1 day' WHERE id=$1 AND user_id=$2",
        [r.exercise.id, state.accounts[0].id],
      );
      const end = await okAction(
        "endSpeakingAction",
        { exerciseId: r.exercise.id },
        state.a,
        "/speaking",
      );
      assert(
        end.exercise.durationSeconds < 300,
        `Idle exercise counted as ${end.exercise.durationSeconds} seconds of practice`,
      );
    },
  );
} catch (error) {
  await report.test("AI test setup", async () => {
    throw error;
  });
} finally {
  await db.end();
  report.finish();
}
