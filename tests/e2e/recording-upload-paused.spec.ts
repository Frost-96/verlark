import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

for (const [code, explanation] of [
  ["recording-maintenance-paused", "录音上传因维护暂时暂停"],
  ["recording-quota-paused", "等待维护者核实服务额度"],
] as const) {
  test(`上传暂停保留同一草稿并允许恢复重试：${code}`, async ({ page }) => {
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
          name: "RecordingPauseTest",
        },
      },
    });
    const output = Array.isArray(bundle) ? bundle[0]! : bundle;
    if (!("output" in output)) throw new Error("Expected browser bundle");
    const chunk = output.output.find((item) => item.type === "chunk");
    if (!chunk || chunk.type !== "chunk")
      throw new Error("Missing browser bundle");
    const id = crypto.randomUUID();
    await page.route("**/__upload-pause?*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><div id="root"></div><script src="/__upload-pause.js"></script>',
      }),
    );
    await page.route("**/__upload-pause.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: chunk.code }),
    );
    await page.route(`**/api/practices/${id}`, (route) =>
      route.fulfill({
        json: {
          id,
          title: "录音测试",
          status: "in-progress",
          createdAt: new Date().toISOString(),
          attempts: [],
          recordingMode: "private",
        },
      }),
    );
    let paused = true;
    let submissionCount = 0;
    const references: string[] = [];
    await page.route(`**/api/practices/${id}/uploads`, (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "issue")
        return route.fulfill({
          status: 503,
          json: { code, message: "secret-raw-provider-body" },
        });
      references.push(body.reference);
      return route.fulfill(
        paused
          ? { status: 503, json: { code: "unavailable" } }
          : { json: { reference: body.reference } },
      );
    });
    await page.route(`**/api/practices/${id}/submissions`, (route) => {
      submissionCount++;
      return route.fulfill({
        json: {
          id: crypto.randomUUID(),
          submissionId: route.request().postDataJSON().submissionId,
          acceptedAt: new Date().toISOString(),
          status: "pending-identification",
          failure: null,
          leaseExpiresAt: null,
          rawTranscript: null,
          confirmations: [],
          feedback: [],
          currentValidFeedback: null,
        },
      });
    });
    await page.goto(`/__upload-pause?practice=${id}`);
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "停止录音", exact: true }).click();
    const draft = page.getByLabel("录音草稿试听");
    await expect(draft).toBeVisible();
    const source = await draft.getAttribute("src");
    await page.getByRole("button", { name: "提交本次录音" }).click();
    await expect(page.getByRole("alert")).toContainText(explanation);
    await expect(page.getByRole("alert")).toContainText("草稿仍可试听");
    await expect(page.getByRole("alert")).not.toContainText(
      "secret-raw-provider-body",
    );
    await expect(draft).toHaveAttribute("src", source!);
    await expect(
      page.getByRole("button", { name: "提交本次录音" }),
    ).toBeEnabled();
    expect(submissionCount).toBe(0);
    paused = false;
    await page.getByRole("button", { name: "提交本次录音" }).click();
    await expect(draft).toHaveCount(0);
    expect(submissionCount).toBe(1);
    expect(references).toHaveLength(2);
    expect(references[0]).toBe(references[1]);
  });
}
