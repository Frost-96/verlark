import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("确认后生成反馈、刷新保留，文本更正后旧反馈仅为历史", async ({
  page,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-feedback-${info.project.name}@example.com`,
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
  await page.getByRole("button", { name: "识别本次录音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "获取表达反馈", exact: true }),
  ).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "核对后的英语文本" });
  await editor.fill("I will read a book this weekend.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(page.getByText("开发反馈替身", { exact: false })).toBeVisible();
  await expect(
    page.getByText("反馈仅依据确认文本，不评价发音、语调或停顿。", {
      exact: true,
    }),
  ).toBeVisible();
  for (const kind of ["network", "html", "proxy"] as const) {
    await page.route("**/feedback", async (route) => {
      if (kind === "network") await route.abort("failed");
      else
        await route.fulfill({
          status: 502,
          contentType: kind === "html" ? "text/html" : "application/json",
          body:
            kind === "html"
              ? "Bad Gateway"
              : JSON.stringify({ message: "Provider secret error" }),
        });
    });
    await page
      .getByRole("button", { name: "获取表达反馈", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "请查询反馈状态",
    );
    await page.unroute("**/feedback");
  }
  await page.getByRole("button", { name: "获取表达反馈", exact: true }).click();
  await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
  await expect(
    page.getByText("没有需要纠正的问题。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("可选替代表达（原话不是错误）", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
  await editor.fill("I will read tomorrow.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(page.getByText("当前有效反馈", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("当前确认文本尚无有效反馈。", { exact: true }),
  ).toBeVisible();
  await page.getByText("查看历史反馈", { exact: true }).click();
  await expect(
    page.getByText("历史反馈 · 依据确认文本版本 1", { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let snapshotReady!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const ready = new Promise<void>((done) => {
    snapshotReady = done;
  });
  await page.route(`**/api/practices/${id}`, async (route) => {
    const snapshot = await route.fetch();
    snapshotReady();
    await gate;
    await route.fulfill({ response: snapshot });
  });
  await page.getByRole("button", { name: "查询最新状态", exact: true }).click();
  await ready;
  await page.getByRole("button", { name: "获取表达反馈", exact: true }).click();
  await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
  release();
  await expect(editor).toBeEnabled();
  await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
  await page.unroute(`**/api/practices/${id}`);
  expect(
    (await (await page.request.get(`/api/practices/${id}`)).json()).attempts,
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/implementation/issue-10/feedback-${info.project.name}.png`,
    fullPage: true,
  });
});

test("反馈进程中断后重新进入，恢复结果未知并重试同一文本", async ({
  page,
}, info) => {
  const { user } = await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-feedback-recovery-${info.project.name}@example.com`,
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
  const recognized = await (
    await page.request.post(
      `/api/practices/${id}/attempts/${attempt.id}/transcription`,
      { headers, data: { action: "recognize" } },
    )
  ).json();
  const confirmed = await (
    await page.request.post(
      `/api/practices/${id}/attempts/${attempt.id}/transcription`,
      {
        headers,
        data: {
          action: "confirm",
          rawTranscriptId: recognized.rawTranscript.id,
          expectedConfirmationId: null,
          text: "I will read tomorrow.",
        },
      },
    )
  ).json();
  const confirmationId = confirmed.confirmations[0].id;
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "tests/fixtures/feedback-worker.ts",
      process.env.E2E_DATABASE_URL!,
      ".dev-recordings",
      JSON.stringify(user),
      id,
      attempt.id,
      confirmationId,
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
        () => reject(new Error(`反馈进程未就绪：${workerError}`)),
        5000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (data) => {
        if (data.toString().includes("feedback-started")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    child.kill("SIGKILL");
    await exited;
    await page.reload();
    await expect(
      page.getByText("反馈处理中。", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "恢复超时反馈", exact: true })
      .click();
    await expect(page.getByText("反馈结果未知", { exact: true })).toBeVisible();
    await expect(
      page.getByText("本地处理权已过期", { exact: false }),
    ).toContainText("不表示远端已取消");
    await page
      .getByRole("button", { name: "重试同一文本反馈", exact: true })
      .click();
    await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
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
