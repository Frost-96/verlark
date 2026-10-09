import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import {
  db,
  reporter,
  readState,
  saveState,
  request,
  okAction,
  assert,
} from "./baseline-lib.mjs";
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const { createJiti } = nextRequire("jiti");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve("src") },
});
const audioOnly = process.argv.includes("--audio-only");
const report = reporter(
  audioOnly ? "audio-results.json" : "dependency-results.json",
);
const state = readState();
const sample = "Hello, I would like a small cup of coffee, please.";
let audio;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
try {
  await db.connect();
  if (!audioOnly) {
    await report.test(
      "database columns match Prisma scalar fields",
      async () => {
        const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
        const rows = (
          await db.query(
            "SELECT table_name,column_name,is_nullable,udt_name,character_maximum_length FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
          )
        ).rows;
        const diffs = [];
        let fields = 0;
        let tables = 0;
        for (const model of schema.matchAll(
          /^model\s+\w+\s*\{([\s\S]*?)^\}/gm,
        )) {
          const body = model[1];
          const table = body.match(/@@map\("([^"]+)"\)/)?.[1];
          if (!table) continue;
          tables++;
          for (const field of body.matchAll(
            /^\s*(\w+)\s+(String|Int|Float|Boolean|DateTime|Json)(\?)?\s*([^\r\n]*)/gm,
          )) {
            fields++;
            const name = field[4].match(/@map\("([^"]+)"\)/)?.[1] || field[1];
            const col = rows.find(
              (r) => r.table_name === table && r.column_name === name,
            );
            if (!col) {
              diffs.push(`${table}.${name}: missing`);
              continue;
            }
            if ((col.is_nullable === "YES") !== Boolean(field[3]))
              diffs.push(`${table}.${name}: nullability differs`);
            const length = field[4].match(/@db.VarChar\((\d+)\)/)?.[1];
            if (length && Number(length) !== col.character_maximum_length)
              diffs.push(`${table}.${name}: varchar length differs`);
          }
        }
        assert(!diffs.length, diffs.join("; "));
        return {
          tables,
          fields,
          scope:
            "presence, nullability, varchar length; not complete index/default drift detection",
        };
      },
    );
    await report.test(
      "database migration ledger matches local migrations",
      async () => {
        const rows = (
          await db.query(
            "SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at",
          )
        ).rows;
        const local = fs
          .readdirSync("prisma/migrations")
          .filter((name) =>
            fs.existsSync(`prisma/migrations/${name}/migration.sql`),
          );
        const missing = local.filter(
          (name) =>
            !rows.some(
              (r) =>
                r.migration_name === name && r.finished_at && !r.rolled_back_at,
            ),
        );
        const drift = rows
          .filter((r) => {
            const file = `prisma/migrations/${r.migration_name}/migration.sql`;
            if (!fs.existsSync(file)) return true;
            const source = fs.readFileSync(file, "utf8");
            const lf = source.replace(/\r\n/g, "\n");
            return ![source, lf, lf.replace(/\n/g, "\r\n")].some(
              (s) =>
                crypto.createHash("sha256").update(s).digest("hex") ===
                r.checksum,
            );
          })
          .map((r) => r.migration_name);
        assert(
          !missing.length && !drift.length,
          JSON.stringify({ unapplied: missing, missingOrChanged: drift }),
        );
        return { applied: rows.length };
      },
    );
    await report.test("current speaking LLM credentials", async () => {
      const { getSpeakingLlmClient, getSpeakingLlmModel } = await jiti.import(
        "../src/lib/speaking/speakingLlmClient.ts",
      );
      const client = getSpeakingLlmClient();
      assert(client, "Client is not configured");
      const result = await client
        .withOptions({ timeout: 20000, maxRetries: 0 })
        .chat.completions.create({
          model: getSpeakingLlmModel(),
          messages: [{ role: "user", content: "Reply with Hello." }],
          max_tokens: 16,
        });
      assert(result.choices[0]?.message?.content, "Empty reply");
    });
    await report.test(
      "independent TTS generates synthetic speech",
      async () => {
        const { textToSpeech } = await jiti.import(
          "../src/lib/speaking/tts.ts",
        );
        const r = await textToSpeech(sample, "Mia", 1, "mp3");
        assert(r.ok, r.error);
        audio = r.audioBuffer;
        assert(audio.length > 100, "Empty audio");
        fs.writeFileSync("/tmp/verlark-baseline-audio.mp3", audio);
        return { bytes: audio.length };
      },
    );
  } else {
    audio = fs.readFileSync("/tmp/verlark-baseline-synthetic.mp3");
  }
  for (const bucket of ["user-audio", "ai-audio"])
    await report.test(
      `${bucket} storage upload, signed read, cleanup`,
      async () => {
        assert(audio, "No synthetic audio fixture");
        const objectPath = `${state.accounts[0].id}/baseline-${state.runId}/${crypto.randomUUID()}.mp3`;
        state.storagePaths ??= [];
        state.storagePaths.push({ bucket, path: objectPath });
        saveState(state);
        const upload = await supabase.storage
          .from(bucket)
          .upload(objectPath, audio, {
            contentType: "audio/mpeg",
            upsert: false,
          });
        assert(!upload.error, upload.error?.message);
        const signed = await request(
          `/api/speaking/getAudioURL?bucket=${bucket}&path=${encodeURIComponent(objectPath)}`,
          { jar: state.a },
        );
        assert(
          signed.status === 200 && signed.data?.data?.url,
          `Signing HTTP ${signed.status}`,
        );
        const r = await fetch(signed.data.data.url, {
          signal: AbortSignal.timeout(15000),
        });
        assert(r.ok, `Playback HTTP ${r.status}`);
        assert(
          (await r.arrayBuffer()).byteLength === audio.length,
          "Storage bytes differ",
        );
        const removed = await supabase.storage
          .from(bucket)
          .remove([objectPath]);
        assert(!removed.error, removed.error?.message);
        return { bytes: audio.length };
      },
    );
  await report.test(
    "independent STT transcribes synthetic speech",
    async () => {
      assert(audio, "No synthetic audio fixture");
      const body = new FormData();
      body.set(
        "audio",
        new Blob([audio], { type: "audio/mpeg" }),
        "synthetic.mp3",
      );
      body.set("language", "en");
      const r = await request("/api/speaking/stt", {
        jar: state.a,
        method: "POST",
        body,
        timeout: 90000,
      });
      assert(
        r.status === 200 && r.data?.data?.text,
        `HTTP ${r.status}: ${r.data?.error}`,
      );
      return { recognizedText: r.data.data.text };
    },
  );
  let otherMessage;
  await report.test("Azure assessment accepts synthetic speech", async () => {
    assert(audio, "No synthetic audio fixture");
    const speaking = await okAction(
      "startSpeakingAction",
      {
        scenarioCategory: "daily",
        title: "Baseline isolation fixture",
        aiRole: "A tutor",
      },
      state.b,
      "/speaking",
    );
    otherMessage = crypto.randomUUID();
    await db.query(
      "INSERT INTO messages (id,conversation_id,role,content,updated_at) VALUES ($1,$2,$3,$4,now())",
      [otherMessage, speaking.exercise.conversationId, "user", sample],
    );
    const body = new FormData();
    body.set(
      "audio",
      new Blob([audio], { type: "audio/mpeg" }),
      "synthetic.mp3",
    );
    body.set("referenceText", sample);
    body.set("language", "en-US");
    body.set("messageId", otherMessage);
    // A submits against B's disposable message, to verify the ownership boundary.
    const r = await request("/api/speaking/pronunciation", {
      jar: state.a,
      method: "POST",
      body,
      timeout: 90000,
    });
    state.azureStatus = r.status;
    saveState(state);
    assert(
      r.status === 200 && r.data?.success,
      `HTTP ${r.status}: ${r.data?.error}`,
    );
    return { keys: Object.keys(r.data.data) };
  });
  await report.test(
    "pronunciation cannot update another account message",
    async () => {
      assert(otherMessage, "No isolation fixture");
      const row = (
        await db.query("SELECT pronunciation_score FROM messages WHERE id=$1", [
          otherMessage,
        ])
      ).rows[0];
      assert(
        row.pronunciation_score === null,
        `Cross-account score updated to ${row.pronunciation_score}`,
      );
      assert(
        state.azureStatus === 403 || state.azureStatus === 404,
        `Ownership not rejected before processing (HTTP ${state.azureStatus})`,
      );
    },
  );
  if (!audioOnly)
    await report.test("writing submission updates word count", async () => {
      const row = (
        await db.query(
          "SELECT content,word_count FROM writing_exercises WHERE id=$1",
          [state.gradeWriting.id],
        )
      ).rows[0];
      const count = row.content.trim().split(/\s+/).length;
      assert(
        row.word_count === count,
        `Stored ${row.word_count}, actual ${count}`,
      );
    });
} catch (error) {
  await report.test("dependency setup", async () => {
    throw error;
  });
} finally {
  await db.end();
  report.finish();
}
