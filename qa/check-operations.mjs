import {
  db,
  reporter,
  readState,
  request,
  action,
  okAction,
  assert,
} from "./baseline-lib.mjs";
const state = readState();
const report = reporter("operation-results.json");
try {
  await db.connect();
  const writing = (
    await okAction(
      "createWritingExerciseAction",
      {
        scenarioType: "daily",
        prompt: "Disposable deletion fixture",
        isCustomPrompt: true,
      },
      state.a,
      "/writing",
    )
  ).exercise;
  await report.test("cross-account writing delete rejected", async () => {
    const r = await action(
      "deleteWritingExerciseAction",
      { exerciseId: writing.id },
      state.b,
      "/writing",
    );
    assert(!r.success, "Another account deleted the exercise");
  });
  await report.test(
    "own writing delete removes it from active records",
    async () => {
      await okAction(
        "deleteWritingExerciseAction",
        { exerciseId: writing.id },
        state.a,
        "/writing",
      );
      const row = (
        await db.query("SELECT is_deleted FROM writing_exercises WHERE id=$1", [
          writing.id,
        ])
      ).rows[0];
      assert(row.is_deleted, "Record not soft-deleted");
    },
  );
  await report.test("coach rename keeps message content", async () => {
    const before = (
      await db.query(
        "SELECT content FROM messages WHERE conversation_id=$1 ORDER BY created_at",
        [state.mockCoachId],
      )
    ).rows;
    await okAction(
      "updateConversationTitleAction",
      { id: state.mockCoachId, title: "Renamed baseline coach" },
      state.a,
      "/coach",
    );
    const after = (
      await db.query(
        "SELECT content FROM messages WHERE conversation_id=$1 ORDER BY created_at",
        [state.mockCoachId],
      )
    ).rows;
    assert(
      JSON.stringify(before) === JSON.stringify(after),
      "Rename changed messages",
    );
  });
  const speaking = (
    await okAction(
      "startSpeakingAction",
      {
        scenarioCategory: "daily",
        title: "Disposable speaking deletion fixture",
        aiRole: "Tutor",
      },
      state.a,
      "/speaking",
    )
  ).exercise;
  await report.test(
    "own speaking delete hides exercise and conversation",
    async () => {
      await okAction(
        "deleteSpeakingExerciseAction",
        { id: speaking.id },
        state.a,
        "/speaking",
      );
      const row = (
        await db.query(
          "SELECT s.is_deleted AS exercise,c.is_deleted AS conversation FROM speaking_exercises s JOIN conversations c ON c.id=s.conversation_id WHERE s.id=$1",
          [speaking.id],
        )
      ).rows[0];
      assert(row.exercise && row.conversation, "Deletion left active records");
    },
  );
  const oldSession = { cookie: state.b.cookie };
  await report.test("account deletion clears caller session", async () => {
    await okAction("deleteCurrentUserAction", undefined, state.b, "/settings");
    const row = (
      await db.query("SELECT is_deleted FROM users WHERE id=$1", [
        state.accounts[1].id,
      ])
    ).rows[0];
    assert(row.is_deleted, "Account not deleted");
    const r = await request("/dashboard", { jar: state.b });
    assert(r.status === 307, "Caller session not cleared");
  });
  await report.test(
    "deleted account cannot mutate using a previously issued session",
    async () => {
      const r = await action(
        "createWritingExerciseAction",
        {
          scenarioType: "daily",
          prompt: "This must be rejected after account deletion",
          isCustomPrompt: true,
        },
        oldSession,
        "/writing",
      );
      assert(
        !r.success,
        "Deleted account can still create writing exercises with its old JWT",
      );
    },
  );
} catch (error) {
  await report.test("operation test setup", async () => {
    throw error;
  });
} finally {
  await db.end();
  report.finish();
}
