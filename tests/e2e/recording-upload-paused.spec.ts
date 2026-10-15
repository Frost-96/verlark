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
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
        "process.env.VERCEL_BLOB_API_URL": JSON.stringify(
          "http://localhost:3100/__blob-test",
        ),
      },
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
    let uploadCount = 0;
    let storedBytes: Buffer | undefined;
    let permittedPath: string | undefined;
    const token = "vercel_blob_client_teststore_fake";
    const references: string[] = [];
    const uploadIds: string[] = [];
    const steps: string[] = [];
    await page.route(`**/api/practices/${id}/uploads`, (route) => {
      const body = route.request().postDataJSON();
      steps.push(body.action);
      if (body.action === "issue") {
        uploadIds.push(body.uploadId);
        if (paused)
          return route.fulfill({
            status: 503,
            json: { code, message: "secret-raw-provider-body" },
          });
        permittedPath = `test/${id}/${body.uploadId}.webm`;
        return route.fulfill({
          json: {
            reference: `recording:${body.uploadId}`,
            pathname: permittedPath,
            clientToken: token,
          },
        });
      }
      references.push(body.reference);
      return route.fulfill(
        storedBytes
          ? { json: { reference: body.reference } }
          : { status: 503, json: { code: "unavailable" } },
      );
    });
    // Exercise the real Blob client; only its HTTP storage boundary is replaced.
    await page.route("**/__blob-test/**", (route) => {
      const request = route.request();
      expect(request.method()).toBe("PUT");
      expect(new URL(request.url()).searchParams.get("pathname")).toBe(
        permittedPath,
      );
      expect(request.headers().authorization).toBe(`Bearer ${token}`);
      expect(request.headers()["x-vercel-blob-access"]).toBe("private");
      expect(paused).toBe(false);
      expect(uploadIds).toHaveLength(2);
      storedBytes = request.postDataBuffer() ?? undefined;
      expect(storedBytes?.length).toBeGreaterThan(0);
      uploadCount++;
      steps.push("put");
      return route.fulfill({
        json: {
          url: `http://localhost:3100/${permittedPath}`,
          pathname: permittedPath,
          contentType: "audio/webm",
          contentDisposition: "attachment",
          etag: "test-etag",
        },
      });
    });
    await page.route(`**/api/practices/${id}/submissions`, (route) => {
      const input = route.request().postDataJSON();
      expect(storedBytes?.length).toBeGreaterThan(0);
      expect(input.reference).toBe(`recording:${uploadIds[0]}`);
      expect(input.submissionId).toBe(uploadIds[0]);
      submissionCount++;
      steps.push("submit");
      return route.fulfill({
        json: {
          id: crypto.randomUUID(),
          submissionId: input.submissionId,
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
    const draftBytes = await draft.evaluate(async (element: HTMLAudioElement) =>
      Array.from(
        new Uint8Array(await (await fetch(element.src)).arrayBuffer()),
      ),
    );

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
    expect(uploadCount).toBe(0);
    paused = false;
    await page.getByRole("button", { name: "提交本次录音" }).click();
    await expect(draft).toHaveCount(0);
    expect(submissionCount).toBe(1);
    expect(uploadIds).toHaveLength(2);
    expect(uploadIds[1]).toBe(uploadIds[0]);
    expect(uploadCount).toBe(1);
    expect(Array.from(storedBytes!)).toEqual(draftBytes);
    expect(references).toEqual(Array(3).fill(`recording:${uploadIds[0]}`));
    expect(steps).toEqual([
      "complete",
      "issue",
      "complete",
      "issue",
      "put",
      "complete",
      "submit",
    ]);
  });
}
