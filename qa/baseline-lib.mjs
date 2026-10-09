import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
nextRequire("@next/env").loadEnvConfig(process.cwd(), false, {
  info() {},
  error() {},
});

export const baseURL = process.env.BASELINE_URL || "http://127.0.0.1:3000";
export const stateFile = "/tmp/verlark-baseline-fixtures.json";
export const outputDir = process.env.BASELINE_OUTPUT || "qa/runs/latest";
fs.mkdirSync(outputDir, { recursive: true });
export const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  query_timeout: 10000,
  application_name: "verlark_baseline",
});

export function sanitize(value) {
  let text = String(value);
  for (const [key, secret] of Object.entries(process.env)) {
    if (
      /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) &&
      secret?.length > 5
    )
      text = text.split(secret).join("<REDACTED>");
  }
  return text.replace(/postgres\.[a-z0-9]+/gi, "postgres.<REDACTED>");
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertPageOK(response) {
  assert(response.status === 200, `HTTP ${response.status}`);
  assert(
    !/Application error:|We hit an unexpected error|SOMETHING WENT WRONG/.test(
      response.text,
    ),
    "Application error boundary rendered",
  );
}

export function reporter(filename) {
  const results = [];
  const save = () =>
    fs.writeFileSync(
      path.join(outputDir, filename),
      JSON.stringify(
        { testedAt: new Date().toISOString(), baseURL, results },
        null,
        2,
      ) + "\n",
    );
  return {
    results,
    async test(name, fn) {
      const start = Date.now();
      try {
        const detail = await fn();
        results.push({
          name,
          status: "pass",
          elapsedMs: Date.now() - start,
          detail,
        });
        console.log(`PASS ${name}`);
        save();
        return detail;
      } catch (error) {
        results.push({
          name,
          status: "fail",
          elapsedMs: Date.now() - start,
          error: sanitize(error.message),
        });
        console.log(`FAIL ${name}: ${sanitize(error.message)}`);
        save();
        return undefined;
      }
    },
    finish() {
      save();
      const failed = results.filter((r) => r.status === "fail").length;
      console.log(
        JSON.stringify({
          total: results.length,
          passed: results.length - failed,
          failed,
        }),
      );
      if (failed) process.exitCode = 1;
    },
  };
}

export async function request(
  route,
  { jar, json, body, method = "GET", headers = {}, timeout = 30000 } = {},
) {
  const h = { ...headers };
  if (jar?.cookie) h.cookie = jar.cookie;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const response = await fetch(new URL(route, baseURL), {
    method,
    headers: h,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });
  if (jar) {
    const cookies = new Map(
      (jar.cookie || "")
        .split("; ")
        .filter(Boolean)
        .map((c) => {
          const i = c.indexOf("=");
          return [c.slice(0, i), c.slice(i + 1)];
        }),
    );
    for (const c of response.headers.getSetCookie()) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    jar.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: response.status, headers: response.headers, text, data };
}

export async function action(name, input, jar, route) {
  const manifest = JSON.parse(
    fs.readFileSync(".next/server/server-reference-manifest.json", "utf8"),
  );
  const entry = Object.entries(manifest.node).find(
    ([, m]) => m.exportedName === name,
  );
  assert(entry, `Server action unavailable in build: ${name}`);
  if (!route)
    route = Object.keys(entry[1].workers)[0]
      .replace(/^app/, "")
      .replace(/\/\([^/]+\)/g, "")
      .replace(/\/page$/, "");
  const response = await request(route, {
    method: "POST",
    jar,
    headers: {
      "next-action": entry[0],
      "content-type": "text/plain;charset=UTF-8",
      accept: "text/x-component",
      origin: baseURL,
    },
    body: JSON.stringify(input === undefined ? [] : [input]),
    timeout: 45000,
  });
  assert(response.status === 200, `${name}: HTTP ${response.status}`);
  for (const line of response.text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    try {
      const data = JSON.parse(line.slice(colon + 1));
      if (typeof data?.success === "boolean") return data;
    } catch {}
  }
  if (name === "logOut") return { success: true };
  throw new Error(`${name}: no action result in response`);
}

export async function okAction(name, input, jar, route) {
  const result = await action(name, input, jar, route);
  assert(result.success, `${name}: ${result.error}`);
  return result.data;
}

export function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}
export function readState() {
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

export async function cleanup(state) {
  if (state.storagePaths?.length) {
    const { createClient } = await import("@supabase/supabase-js");
    const storage = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ).storage;
    for (const object of state.storagePaths) {
      assert(
        ["user-audio", "ai-audio"].includes(object.bucket),
        "Unexpected fixture bucket",
      );
      assert(
        state.accounts.some((account) =>
          object.path.startsWith(`${account.id}/`),
        ),
        "Refusing cleanup outside fixture account",
      );
      const { error } = await storage.from(object.bucket).remove([object.path]);
      assert(!error, error?.message);
    }
  }
  // Only delete the exact disposable accounts that this run created.
  for (const account of state.accounts || []) {
    assert(
      account.email.startsWith(`baseline-${state.runId}-`),
      "Refusing cleanup outside this run",
    );
    await db.query(
      "DELETE FROM users WHERE ($1::text IS NULL OR id = $1) AND email = $2",
      [account.id ?? null, account.email],
    );
  }
}

export function parseEvents(text) {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const data = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!event || !data) return [];
    try {
      return [{ event, data: JSON.parse(data) }];
    } catch {
      return [];
    }
  });
}
