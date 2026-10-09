import {
  db,
  reporter,
  readState,
  request,
  okAction,
  assert,
} from "./baseline-lib.mjs";
const state = readState();
const report = reporter("regression-results.json");
try {
  await db.connect();
  await report.test("unknown page returns 404", async () => {
    const r = await request("/baseline-nonexistent-page");
    assert(r.status === 404, `HTTP ${r.status}`);
  });
  await report.test(
    "debug pronunciation endpoint is unavailable anonymously",
    async () => {
      // Use the isolated mock app whose real speech credentials are blank.
      const r = await fetch(
        "http://127.0.0.1:3001/api/speaking/pronunciation-local",
        { method: "POST", signal: AbortSignal.timeout(15000) },
      );
      assert(
        [401, 404].includes(r.status),
        `Unauthenticated debug request reached the handler; HTTP ${r.status}`,
      );
    },
  );
  await report.test(
    "writing submission persists actual word count",
    async () => {
      const r = (
        await db.query(
          "SELECT content,word_count FROM writing_exercises WHERE id=$1",
          [state.mockWriting.id],
        )
      ).rows[0];
      const words = r.content.trim().split(/\s+/).length;
      assert(r.word_count === words, `Stored ${r.word_count}, actual ${words}`);
    },
  );
  await report.test(
    "speaking idle time is not counted as active practice",
    async () => {
      const exercise = (
        await okAction(
          "startSpeakingAction",
          {
            scenarioCategory: "daily",
            title: "Baseline idle duration regression",
            aiRole: "Tutor",
          },
          state.a,
          "/speaking",
        )
      ).exercise;
      await db.query(
        "UPDATE speaking_exercises SET created_at=now()-interval '1 day' WHERE id=$1 AND user_id=$2",
        [exercise.id, state.accounts[0].id],
      );
      const result = await okAction(
        "endSpeakingAction",
        { exerciseId: exercise.id },
        state.a,
        "/speaking",
      );
      assert(
        result.exercise.durationSeconds < 300,
        `A session with no conversation records ${result.exercise.durationSeconds} seconds`,
      );
    },
  );
} catch (error) {
  await report.test("regression setup", async () => {
    throw error;
  });
} finally {
  await db.end();
  report.finish();
}
