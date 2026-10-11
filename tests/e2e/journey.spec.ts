import { test, expect, type Page } from "@playwright/test";
import { verificationLink } from "./helpers";
import type { PracticeDetail } from "../../src/modules/practice/contracts";

async function recordAndSubmit(page: Page, start = true) {
  if (start)
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText("正在录音", { exact: false })).toBeVisible();
  // Real MediaRecorder, Chromium synthetic microphone; this is not device evidence.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  const preview = page.getByLabel("录音草稿试听");
  await preview.evaluate((audio: HTMLAudioElement) => audio.play());
  await expect
    .poll(() =>
      preview.evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await preview.evaluate((audio: HTMLAudioElement) => audio.pause());
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
}

test("一份材料贯穿注册验证、离开继续、更正、再次作答、结束历史、重练和删除", async ({
  page,
  context,
}, info) => {
  const email = `${process.env.E2E_PREFIX}-journey-${info.project.name}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("称呼").fill("完整流程学习者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("journey-password-123");
  await page.getByRole("button", { name: "注册并验证邮箱" }).click();
  await expect(page.getByRole("status")).toContainText("注册请求已完成");
  await page.goto(await verificationLink(email));
  await page.getByRole("button", { name: "确认验证邮箱" }).click();
  await expect(page.getByRole("status")).toContainText("邮箱验证成功");
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("journey-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/practices");
  await expect(
    page.getByText("还没有练习记录。选择一份材料开始吧。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "选择听力材料", exact: true }).click();
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const url = page.url();
  const id = url.split("/").at(-1)!;
  const read = async (): Promise<PracticeDetail> =>
    (await context.request.get(`/api/practices/${id}`)).json();
  await expect(
    page.getByText("A: What are you doing this weekend?", { exact: false }),
  ).toBeHidden();
  await page.getByRole("button", { name: "从头重听" }).click();
  const audio = page.getByLabel("听力材料播放器");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await page.getByText("查看材料原文", { exact: true }).click();
  await page.getByText("查看中文释义", { exact: true }).click();
  await expect(
    page.getByText("A：你这个周末打算做什么？", { exact: false }),
  ).toBeVisible();
  expect((await read()).attempts).toEqual([]);
  await recordAndSubmit(page);
  await expect(
    page.getByText("已接收 · 待识别", { exact: true }),
  ).toBeVisible();
  const received = await read();
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto("/practices");
  await resumed.getByRole("link", { name: "继续练习", exact: true }).click();
  await expect(resumed).toHaveURL(url);
  expect(await read()).toEqual(received);
  const first = resumed.getByRole("region", { name: "作答 1", exact: true });
  await first
    .getByRole("button", { name: "识别本次录音", exact: true })
    .click();
  const editor = first.getByRole("textbox", { name: "核对后的英语文本" });
  await editor.fill("I will read tomorrow.");
  await first.getByRole("button", { name: "确认文本", exact: true }).click();
  await first
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(
    first.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toBeVisible();
  await editor.fill("I will read a book this weekend.");
  await first.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(
    first.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toHaveCount(0);
  await resumed
    .getByRole("button", { name: "结束本次练习", exact: true })
    .click();
  await expect(
    resumed
      .getByRole("region", { name: "结束练习", exact: true })
      .getByRole("alert"),
  ).toContainText("历史反馈不能用于结束");
  await first.getByText("查看历史反馈", { exact: true }).click();
  await expect(
    first.getByRole("heading", {
      name: "历史反馈 · 依据确认文本版本 1",
      exact: true,
    }),
  ).toBeVisible();
  await first
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(
    first.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toBeVisible();
  const preserved = (await read()).attempts[0];
  await resumed.getByRole("button", { name: "再次作答", exact: true }).click();
  await recordAndSubmit(resumed, false);
  await expect(
    resumed.getByRole("region", { name: "作答 2", exact: true }),
  ).toBeVisible();
  expect((await read()).attempts[0]).toEqual(preserved);
  await resumed
    .getByRole("button", { name: "结束本次练习", exact: true })
    .click();
  await expect(
    resumed.getByText("练习已结束，记录只读。", { exact: false }),
  ).toBeVisible();
  const ended = await read();
  expect(ended.status).toBe("ended");
  expect(ended.attempts).toHaveLength(2);
  expect(ended.attempts[1]!.status).toBe("pending-identification");
  await resumed.screenshot({
    path: info.outputPath("journey-ended.png"),
    fullPage: true,
  });
  expect(
    await resumed.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await resumed.getByRole("link", { name: "练习记录", exact: true }).click();
  await resumed.getByRole("link", { name: "查看记录", exact: true }).click();
  await expect(resumed).toHaveURL(url);
  await resumed
    .getByRole("button", { name: "按原版本重练", exact: true })
    .click();
  await expect(resumed).not.toHaveURL(url);
  const repeatedId = resumed.url().split("/").at(-1)!;
  const repeated = await (
    await context.request.get(`/api/practices/${repeatedId}`)
  ).json();
  expect(repeated.content).toEqual(ended.content);
  expect(repeated.attempts).toEqual([]);
  expect(await read()).toEqual(ended);
  await resumed.goto(url);
  await resumed
    .getByRole("button", { name: "删除整次练习", exact: true })
    .click();
  await resumed
    .getByRole("button", { name: "确认删除整次练习", exact: true })
    .click();
  await expect(resumed).toHaveURL(/\/practices$/);
  expect((await context.request.get(`/api/practices/${id}`)).status()).toBe(
    404,
  );
  expect(await (await context.request.get("/api/practices")).json()).toEqual([
    expect.objectContaining({ id: repeatedId, status: "in-progress" }),
  ]);
  await expect(
    resumed.getByText("录音清理已完成。", { exact: true }),
  ).toBeVisible();
  await resumed.screenshot({
    path: info.outputPath("journey-deleted.png"),
    fullPage: true,
  });
  expect(
    await resumed.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await resumed.close();
});
