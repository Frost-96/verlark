import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("核对转写、并发更正冲突与刷新恢复保留一次作答", async ({ page }, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-transcription-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const id = page.url().split("/").at(-1)!;
  const headers = { origin: "http://localhost:3100" };
  const recording = await page.request.post(`/api/practices/${id}/recordings`, {
    headers: { ...headers, "content-type": "audio/webm" },
    data: Buffer.from([1, 2, 3]),
  });
  const { reference } = await recording.json();
  await page.request.post(`/api/practices/${id}/submissions`, {
    headers,
    data: { submissionId: crypto.randomUUID(), reference },
  });
  await page.reload();
  await page
    .getByRole("button", { name: "识别本次录音", exact: true })
    .click({ timeout: 2000 });
  await expect(page.getByText("开发识别替身", { exact: false })).toBeVisible();
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: /^I will reed a book this weekend\.$/ }),
  ).toBeVisible();
  await expect(
    page.getByText("只纠正识别错误", { exact: false }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", { name: "核对后的英语文本" });
  await editor.fill("I will read a book this weekend.");
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/transcription", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(editor).toBeDisabled();
  release();
  await expect(
    page.getByText("确认文本 · 版本 1", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/transcription");
  const detail = await (await page.request.get(`/api/practices/${id}`)).json();
  const attempt = detail.attempts[0];
  await page.request.post(
    `/api/practices/${id}/attempts/${attempt.id}/transcription`,
    {
      headers,
      data: {
        action: "confirm",
        rawTranscriptId: attempt.rawTranscript.id,
        expectedConfirmationId: attempt.confirmations[0].id,
        text: "I will read tomorrow.",
      },
    },
  );
  await editor.fill("My unsaved correction.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "已改变",
  );
  await expect(editor).toHaveValue("My unsaved correction.");
  await page.getByRole("button", { name: "查询最新状态", exact: true }).click();
  await expect(
    page.getByText("确认文本 · 版本 2", { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue("My unsaved correction.");
  await page
    .getByRole("button", { name: "载入最新确认文本", exact: true })
    .click();
  await expect(editor).toHaveValue("I will read tomorrow.");
  await page.reload();
  await expect(editor).toHaveValue("I will read tomorrow.");
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: /^I will reed a book this weekend\.$/ }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/implementation/issue-9/transcription-${info.project.name}.png`,
    fullPage: true,
  });
});

test("识别进程中断后重新进入，手动恢复结果未知并重试同一录音", async ({
  page,
}, info) => {
  const { user } = await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-transcription-recovery-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const id = page.url().split("/").at(-1)!;
  const headers = { origin: "http://localhost:3100" };
  const recording = await page.request.post(`/api/practices/${id}/recordings`, {
    headers: { ...headers, "content-type": "audio/webm" },
    data: Buffer.from([1, 2, 3]),
  });
  const { reference } = await recording.json();
  const submitted = await page.request.post(
    `/api/practices/${id}/submissions`,
    { headers, data: { submissionId: crypto.randomUUID(), reference } },
  );
  const attempt = await submitted.json();
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "tests/fixtures/transcription-worker.ts",
      process.env.E2E_DATABASE_URL!,
      ".dev-recordings",
      JSON.stringify(user),
      id,
      attempt.id,
      "2026-10-01T00:00:00Z",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  let workerError = "";
  child.stderr.on("data", (data) => {
    workerError += data.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`识别进程未就绪：${workerError}`)),
        5000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (data) => {
        if (data.toString().includes("recognition-started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    child.kill("SIGKILL");
    await exited;
    await page.reload();
    await expect(page.getByText("识别处理中", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "恢复超时处理", exact: true })
      .click();
    await expect(page.getByText("识别结果未知", { exact: true })).toBeVisible();
    await expect(
      page.getByText("本地处理权已过期", { exact: false }),
    ).toContainText("不表示远端已取消");
    await page
      .getByRole("button", { name: "重试原录音识别", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "核对后的英语文本" }),
    ).toHaveValue("I will reed a book this weekend.");
    expect(
      (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
    ).toHaveLength(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
});
