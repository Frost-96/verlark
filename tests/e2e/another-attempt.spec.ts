import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import type { PracticeDetail } from "../../src/modules/practice/contracts";

async function finishRecording(page: Page) {
  await expect(
    page.getByText("正在录音 · 说完后点击停止录音。", { exact: true }),
  ).toBeVisible();
  // A real MediaRecorder needs a chunk from Chromium's explicit fake microphone.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  const audio = page.getByLabel("录音草稿试听");
  await expect(audio).toBeVisible();
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
}

test("反馈后再次录音形成独立作答，新反馈失败仍保留先前文本与反馈供对照", async ({
  page,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-another-attempt-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const url = page.url();
  const id = url.split("/").at(-1)!;
  const read = async (): Promise<PracticeDetail> =>
    (await page.request.get(`/api/practices/${id}`)).json();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await finishRecording(page);
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
  await page.getByRole("button", { name: "识别本次录音", exact: true }).click();
  await page
    .getByRole("textbox", { name: "核对后的英语文本" })
    .fill("I will read tomorrow.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await page.getByRole("button", { name: "获取表达反馈", exact: true }).click();
  await expect(page.getByText("当前有效反馈", { exact: true })).toBeVisible();
  const first = (await read()).attempts[0]!;
  await page.getByRole("button", { name: "再次作答", exact: true }).click();
  await finishRecording(page);
  expect((await read()).attempts).toEqual([first]);
  await page.getByRole("button", { name: "提交本次录音", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "作答 2", exact: true }),
  ).toBeVisible();
  const second = page.getByRole("region", { name: "作答 2", exact: true });
  await second
    .getByRole("button", { name: "识别本次录音", exact: true })
    .click();
  await second
    .getByRole("textbox", { name: "核对后的英语文本" })
    .fill("This is an unsupported development feedback sample.");
  await second.getByRole("button", { name: "确认文本", exact: true }).click();
  await second
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(
    second.getByRole("button", { name: "重试同一文本反馈", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "重试同一文本反馈", exact: true })
    .click();
  await expect(
    second.getByText("当前确认文本尚无有效反馈。", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await read()).attempts[1]?.feedback[0]?.status)
    .toBe("failed");
  const detail = await read();
  expect(detail.id).toBe(id);
  expect(detail.status).toBe("in-progress");
  expect(detail.attempts).toHaveLength(2);
  expect(detail.attempts[0]).toEqual(first);
  expect(detail.attempts[1]!.id).not.toBe(first.id);
  expect(detail.attempts[1]!.submissionId).not.toBe(first.submissionId);
  expect(detail.attempts[1]!.feedback[0]!.status).toBe("failed");
  await page.reload();
  await expect(page).toHaveURL(url);
  const prior = page.getByRole("region", { name: "作答 1", exact: true });
  await expect(prior.getByText("当前有效反馈", { exact: true })).toBeVisible();
  await expect(
    prior.getByText("I will read tomorrow.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    second.getByText("当前确认文本尚无有效反馈。", { exact: true }),
  ).toBeVisible();
  expect((await read()).attempts[0]).toEqual(first);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/implementation/issue-12/another-attempt-${info.project.name}.png`,
    fullPage: true,
  });
});
