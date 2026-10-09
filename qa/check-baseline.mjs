// Live integration checks. Creates two disposable accounts in the configured DB.
// No AI calls. Fixtures are removed unless --keep-fixtures is set.
import fs from "node:fs";
import crypto from "node:crypto";
import {
  db,
  request,
  action,
  okAction,
  assert,
  assertPageOK,
  reporter,
  saveState,
  readState,
  cleanup,
  stateFile,
} from "./baseline-lib.mjs";

const report = reporter(
  process.argv.includes("--cleanup")
    ? "cleanup-results.json"
    : "core-results.json",
);
const state = { runId: crypto.randomUUID(), accounts: [] };
const a = {},
  b = {};
const password = "BaselineQa123!"; // Disposable fixture only; never an existing user password.
const essay =
  "Last weekend I visited a small park near my home. The weather was pleasant, so I walked along the river and watched the birds. Later I met a friend at a cafe. We discussed our plans for learning English and agreed to practise together every week. This simple day helped me relax and reminded me that regular conversations can improve both confidence and vocabulary.";
if (!process.argv.includes("--cleanup") && fs.existsSync(stateFile)) {
  throw new Error(
    "Fixtures from a previous run exist. Run node qa/check-baseline.mjs --cleanup first.",
  );
}
try {
  await db.connect();
  if (process.argv.includes("--cleanup")) {
    await cleanup(readState());
    fs.unlinkSync(stateFile);
    console.log("Disposable accounts cleaned up.");
  } else {
    await report.test(
      "database SELECT 1 and all application tables readable",
      async () => {
        await db.query("BEGIN READ ONLY");
        try {
          const tables = [
            "users",
            "conversations",
            "messages",
            "writing_exercises",
            "speaking_exercises",
            "scenarios",
            "subscriptions",
            "email_verifications",
          ];
          for (const table of tables)
            await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
          const migrations = await db.query(
            "SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at",
          );
          return { tables: tables.length, migrations: migrations.rows };
        } finally {
          await db.query("ROLLBACK");
        }
      },
    );
    for (const route of [
      "/",
      "/login",
      "/signup",
      "/forgot-password",
      "/pricing",
    ])
      await report.test(`public GET ${route}`, async () => {
        const r = await request(route);
        assert(r.status === 200, `HTTP ${r.status}`);
        assertPageOK(r);
      });
    for (const route of [
      "/dashboard",
      "/writing",
      "/speaking",
      "/coach",
      "/profile",
      "/settings",
    ])
      await report.test(`anonymous redirect ${route}`, async () => {
        const r = await request(route);
        assert(
          r.status === 307 && r.headers.get("location")?.startsWith("/login"),
          `HTTP ${r.status}`,
        );
      });
    const endpoints = [
      "/api/writing/submit",
      "/api/coach/chat",
      "/api/coach/chat-stream",
      "/api/speaking/chat",
      "/api/speaking/chat-stream",
      "/api/speaking/stt",
      "/api/speaking/pronunciation",
      "/api/speaking/review",
      "/api/speaking/getAudioURL",
    ];
    for (const route of endpoints)
      await report.test(`anonymous denial ${route}`, async () => {
        const r = await request(route, {
          method: route.endsWith("getAudioURL") ? "GET" : "POST",
        });
        assert(r.status === 401, `HTTP ${r.status}`);
      });
    await report.test("invalid session rejected", async () => {
      const r = await request("/dashboard", {
        jar: { cookie: "auth_token=invalid" },
      });
      assert(r.status === 307, "Invalid JWT accepted");
    });
    await report.test("signup rejects mismatched passwords", async () => {
      const r = await action(
        "signUp",
        {
          email: `baseline-${state.runId}-invalid@example.invalid`,
          password,
          confirmPassword: "Different123!",
        },
        a,
        "/signup",
      );
      assert(!r.success, "Invalid signup accepted");
    });
    for (const [label, jar] of [
      ["a", a],
      ["b", b],
    ]) {
      await report.test(`signup ${label} and onboarding redirect`, async () => {
        const email = `baseline-${state.runId}-${label}@example.invalid`;
        // Record the email before signup so interrupted runs can be cleaned up.
        const record = { email };
        state.accounts.push(record);
        saveState(state);
        const result = await okAction(
          "signUp",
          {
            email,
            password,
            confirmPassword: password,
            name: `Baseline QA ${label}`,
          },
          jar,
          "/signup",
        );
        assert(
          result.redirect === "/onboarding",
          "New account bypassed onboarding",
        );
        const row = await db.query("SELECT id FROM users WHERE email=$1", [
          email,
        ]);
        assert(row.rowCount === 1, "Account not persisted");
        record.id = row.rows[0].id;
        record.jar = jar;
        saveState(state);
      });
      await report.test(`onboarding ${label} persists`, async () => {
        const r = await okAction(
          "completeOnboarding",
          { englishLevel: "intermediate", learningGoal: "daily" },
          jar,
          "/onboarding",
        );
        assert(r.redirect === "/dashboard", "Unexpected onboarding redirect");
        const row = await db.query(
          "SELECT english_level, learning_goal FROM users WHERE id=$1",
          [state.accounts.find((x) => x.jar === jar)?.id],
        );
        assert(
          row.rows[0]?.english_level === "intermediate",
          "Onboarding not persisted",
        );
      });
    }
    assert(
      state.accounts.every((x) => x.id),
      "Fixture setup failed",
    );
    state.a = a;
    state.b = b;
    saveState(state);
    await report.test("duplicate registration rejected", async () => {
      const r = await action(
        "signUp",
        { email: state.accounts[0].email, password, confirmPassword: password },
        {},
        "/signup",
      );
      assert(!r.success && /exists/i.test(r.error), "Duplicate email accepted");
    });
    await report.test("wrong password rejected", async () => {
      const r = await action(
        "login",
        { email: state.accounts[0].email, password: "WrongPassword123!" },
        {},
        "/login",
      );
      assert(!r.success, "Wrong password accepted");
    });
    await report.test("login and external redirect sanitization", async () => {
      const fresh = {};
      const r = await okAction(
        "login",
        {
          email: state.accounts[0].email,
          password,
          redirectTo: "https://example.com",
        },
        fresh,
        "/login",
      );
      assert(r.redirect === "/dashboard", "External redirect accepted");
      a.cookie = fresh.cookie;
    });
    for (const route of [
      "/dashboard",
      "/writing",
      "/speaking",
      "/coach",
      "/profile",
      "/settings",
    ])
      await report.test(`authenticated GET ${route}`, async () => {
        const r = await request(route, { jar: a });
        assert(r.status === 200, `HTTP ${r.status}`);
        assertPageOK(r);
      });
    for (const route of endpoints)
      await report.test(`input validation ${route}`, async () => {
        const r = await request(route, {
          jar: a,
          method: route.endsWith("getAudioURL") ? "GET" : "POST",
          json: route.endsWith("getAudioURL") ? undefined : {},
        });
        assert(r.status === 400, `HTTP ${r.status}`);
      });
    for (const route of [
      "/api/writing/submit",
      "/api/coach/chat",
      "/api/coach/chat-stream",
      "/api/speaking/review",
    ])
      await report.test(`malformed JSON ${route}`, async () => {
        const r = await request(route, {
          jar: a,
          method: "POST",
          body: "{",
          headers: { "content-type": "application/json" },
        });
        assert(r.status === 400, `HTTP ${r.status}`);
      });
    await report.test("audio URL blocks another user path", async () => {
      const r = await request(
        `/api/speaking/getAudioURL?bucket=user-audio&path=${state.accounts[1].id}/test.wav`,
        { jar: a },
      );
      assert(r.status === 403, `HTTP ${r.status}`);
    });
    await report.test(
      "partial profile update preserves onboarding fields",
      async () => {
        await okAction(
          "saveSettingsProfile",
          { name: "Baseline QA Updated" },
          a,
          "/settings",
        );
        const r = await db.query(
          "SELECT name,english_level,learning_goal FROM users WHERE id=$1",
          [state.accounts[0].id],
        );
        assert(r.rows[0].name === "Baseline QA Updated", "Name not persisted");
        assert(
          r.rows[0].english_level === "intermediate" &&
            r.rows[0].learning_goal === "daily",
          "Omitted fields were cleared to NULL",
        );
      },
    );
    // Restore only this disposable fixture so one failing contract cannot block later cases.
    await okAction(
      "completeOnboarding",
      { englishLevel: "intermediate", learningGoal: "daily" },
      a,
      "/onboarding",
    );
    await report.test("full profile save persists", async () => {
      await okAction(
        "saveSettingsProfile",
        {
          name: "Baseline QA Updated",
          englishLevel: "intermediate",
          learningGoal: "daily",
          avatar: null,
        },
        a,
        "/settings",
      );
      const r = await db.query("SELECT name FROM users WHERE id=$1", [
        state.accounts[0].id,
      ]);
      assert(r.rows[0].name === "Baseline QA Updated", "Name not persisted");
    });
    await report.test("locale save persists", async () => {
      await okAction("saveLocalePreference", "zh", a, "/settings");
      const r = await db.query(
        "SELECT preferred_locale FROM users WHERE id=$1",
        [state.accounts[0].id],
      );
      assert(r.rows[0].preferred_locale === "zh", "Locale not persisted");
      await okAction("saveLocalePreference", "en", a, "/settings");
    });
    await report.test("writing create", async () => {
      const r = await okAction(
        "createWritingExerciseAction",
        {
          scenarioType: "daily",
          prompt: "Describe a relaxing weekend.",
          isCustomPrompt: true,
        },
        a,
        "/writing",
      );
      state.writing = r.exercise;
      saveState(state);
      assert(r.exercise.status === "draft", "Unexpected initial status");
    });
    await report.test("writing save and reload draft", async () => {
      assert(state.writing, "Missing fixture");
      await okAction(
        "saveDraftAction",
        {
          exerciseId: state.writing.id,
          content: essay,
          wordCount: essay.split(/\s+/).length,
        },
        a,
        "/writing",
      );
      const r = await request(`/writing/${state.writing.id}`, { jar: a });
      assert(
        r.status === 200 && r.text.includes("Last weekend I visited"),
        "Draft not present after reload",
      );
    });
    await report.test(
      "writing draft rejects inconsistent word count",
      async () => {
        const r = await action(
          "saveDraftAction",
          { exerciseId: state.writing.id, content: essay, wordCount: 1 },
          a,
          "/writing",
        );
        assert(!r.success, "Bad count accepted");
      },
    );
    await report.test("writing rejects another account save", async () => {
      const r = await action(
        "saveDraftAction",
        {
          exerciseId: state.writing.id,
          content: "Foreign update",
          wordCount: 2,
        },
        b,
        "/writing",
      );
      assert(!r.success, "Cross-account mutation accepted");
    });
    await report.test(
      "writing title rename preserves original prompt",
      async () => {
        await okAction(
          "renameWritingExerciseAction",
          { exerciseId: state.writing.id, title: "QA weekend draft" },
          a,
          "/writing",
        );
        const r = await db.query(
          "SELECT prompt FROM writing_exercises WHERE id=$1",
          [state.writing.id],
        );
        assert(
          r.rows[0].prompt === state.writing.prompt,
          "Renaming replaces the writing prompt",
        );
      },
    );
    // A separate exercise is used for grading so the rename check cannot change its prompt.
    const w = await okAction(
      "createWritingExerciseAction",
      {
        scenarioType: "daily",
        prompt: "Describe a relaxing weekend.",
        isCustomPrompt: true,
      },
      a,
      "/writing",
    );
    state.gradeWriting = w.exercise;
    state.essay = essay;
    await report.test("speaking create", async () => {
      const r = await okAction(
        "startSpeakingAction",
        {
          scenarioCategory: "daily",
          title: "Baseline cafe conversation",
          aiRole:
            "A friendly cafe barista. Reply in one short English sentence.",
        },
        a,
        "/speaking",
      );
      state.speaking = r.exercise;
      saveState(state);
      assert(r.exercise.status === "in_progress", "Unexpected initial status");
    });
    await report.test("speaking rejects another account access", async () => {
      const body = new FormData();
      body.set("exerciseId", state.speaking.id);
      body.set("conversationId", state.speaking.conversationId);
      body.set("message", "Hello");
      const r = await request("/api/speaking/chat-stream", {
        jar: b,
        method: "POST",
        body,
      });
      assert(r.status === 404, `HTTP ${r.status}`);
    });
    await report.test("writing rejects another account grading", async () => {
      const r = await request("/api/writing/submit", {
        jar: b,
        method: "POST",
        json: {
          exerciseId: state.gradeWriting.id,
          scenarioType: "daily",
          prompt: state.gradeWriting.prompt,
          isCustomPrompt: true,
          content: essay,
        },
      });
      assert(r.status === 404, `HTTP ${r.status}`);
    });
    await report.test("logout removes access", async () => {
      const jar = { cookie: a.cookie };
      await okAction("logOut", undefined, jar, "/dashboard");
      const r = await request("/dashboard", { jar });
      assert(r.status === 307, "Logged out session still authenticated");
    });
    saveState(state);
    console.log(
      JSON.stringify({
        fixtureEmail: state.accounts[0].email,
        writingId: state.writing?.id,
        speakingId: state.speaking?.id,
      }),
    );
  }
} catch (error) {
  await report.test("test setup or execution", async () => {
    throw error;
  });
} finally {
  if (
    !process.argv.includes("--keep-fixtures") &&
    !process.argv.includes("--cleanup")
  )
    await cleanup(state).catch((error) =>
      report.test("cleanup", async () => {
        throw error;
      }),
    );
  await db.end();
  report.finish();
}
