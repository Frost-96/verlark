import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { signIn } from "./helpers";

test("过期的恢复响应不会丢弃随后录制的草稿", async ({ page }, info) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  const { build } = await import("vite");
  const bundle = await build({
    configFile: false,
    oxc: { jsx: { runtime: "automatic" } },
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve("tests/fixtures/recording-recovery.tsx"),
        formats: ["iife"],
        name: "RecordingRecoveryTest",
      },
    },
  });
  const output = Array.isArray(bundle) ? bundle[0]! : bundle;
  if (!("output" in output)) throw new Error("Expected a browser bundle");
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing browser bundle");
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-recovery-${info.project.name}@example.com`,
  );
  const started = await page.request.post("/api/practices", {
    headers: { origin: "http://localhost:3100" },
    data: { materialKey: "weekend-plans", requestId: crypto.randomUUID() },
  });
  expect(started.ok()).toBe(true);
  const { id } = await started.json();
  await page.route("**/__recording-recovery?*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<meta charset="utf-8"><div id="root"></div><script src="/__recording-recovery.js"></script>',
    }),
  );
  await page.route("**/__recording-recovery.js", (route) =>
    route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: chunk.code,
    }),
  );
  await page.goto(`/__recording-recovery?practice=${id}`);
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  async function record() {
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "停止录音", exact: true }).click();
    await expect(page.getByLabel("录音草稿试听")).toBeVisible();
  }
  await record();
  await page.route("**/submissions", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "提交本次录音" }).click();
  await expect(page.getByRole("alert")).toContainText("接收结果尚未确认");
  await page.unroute("**/submissions");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed: Promise<void>[] = [];
  let first = true;
  await page.route("**/submissions?*", async (route) => {
    const response = await route.fetch();
    if (first) {
      first = false;
      await route.fulfill({ response });
      return;
    }
    const delivery = held.then(async () => {
      await route.fulfill({ response }).catch(() => undefined);
    });
    delayed.push(delivery);
    await delivery;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  await record();
  const draft = page.getByLabel("录音草稿试听");
  const source = await draft.getAttribute("src");
  release();
  await Promise.all(delayed);
  await page.waitForTimeout(200);
  await expect(draft).toBeVisible();
  await expect(draft).toHaveAttribute("src", source!);
});
