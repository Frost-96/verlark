import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";
import type {
  Attempt,
  PracticeDetail,
} from "../../src/modules/practice/contracts";

const headers = { origin: "http://localhost:3100" };
test("结束检查当前反馈、显示只读及真实状态，并能核对丢失响应、重练和删除", async ({
  page,
  playwright,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-finish-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const url = page.url();
  const id = url.split("/").at(-1)!;
  const base = `/api/practices/${id}`;
  const post = (path: string, data: unknown = {}) =>
    page.request.post(`${base}${path}`, { headers, data });
  const read = async (): Promise<PracticeDetail> =>
    (await page.request.get(base)).json();
  const rejected = await post("/finish");
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: "feedback-required" });
  await page.getByRole("button", { name: "结束本次练习", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "结束练习", exact: true })
      .getByRole("alert"),
  ).toContainText("至少需要一份针对当前确认文本的有效反馈");
  expect(
    (
      await page.request.post(`${base}/finish`, {
        headers: { origin: "https://elsewhere.invalid" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await post("/finish", { learnerId: "someone-else" })).status()).toBe(
    400,
  );
  const anonymous = await playwright.request.newContext({
    baseURL: "http://localhost:3100",
  });
  expect(
    (await anonymous.post(`${base}/finish`, { headers, data: {} })).status(),
  ).toBe(401);
  await anonymous.dispose();
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3100",
  });
  await signIn(
    other,
    `${process.env.E2E_PREFIX}-finish-other-${info.project.name}@example.com`,
  );
  expect(
    (await other.post(`${base}/finish`, { headers, data: {} })).status(),
  ).toBe(404);
  await other.dispose();

  async function submit(value: number): Promise<Attempt> {
    const upload = await page.request.post(`${base}/recordings`, {
      headers: { ...headers, "content-type": "audio/webm" },
      data: Buffer.from([value]),
    });
    expect(upload.ok()).toBe(true);
    const { reference } = await upload.json();
    const response = await post("/submissions", {
      submissionId: crypto.randomUUID(),
      reference,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  await submit(1);
  await page.reload();
  const first = page.getByRole("region", { name: "作答 1", exact: true });
  await first
    .getByRole("button", { name: "识别本次录音", exact: true })
    .click();
  await first
    .getByRole("textbox", { name: "核对后的英语文本" })
    .fill("I will read tomorrow.");
  await first.getByRole("button", { name: "确认文本", exact: true }).click();
  await first
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(first.getByText("当前有效反馈", { exact: true })).toBeVisible();
  await first
    .getByRole("textbox", { name: "核对后的英语文本" })
    .fill("I will read a book this weekend.");
  await first.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(
    first.getByText("当前确认文本尚无有效反馈。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "结束本次练习", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "结束练习", exact: true })
      .getByRole("alert"),
  ).toContainText("历史反馈不能用于结束");
  await first
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(first.getByText("当前有效反馈", { exact: true })).toBeVisible();
  const second = await submit(2);
  const recognized = await (
    await post(`/attempts/${second.id}/transcription`, { action: "recognize" })
  ).json();
  const confirmed = await (
    await post(`/attempts/${second.id}/transcription`, {
      action: "confirm",
      rawTranscriptId: recognized.rawTranscript.id,
      expectedConfirmationId: null,
      text: "Unsupported sample.",
    })
  ).json();
  await post(`/attempts/${second.id}/feedback`, {
    action: "generate",
    confirmationId: confirmed.confirmations[0].id,
  });
  const third = await submit(3);
  await post(`/attempts/${third.id}/transcription`, { action: "recognize" });
  await submit(4);
  // Ending must clear a local recording draft without a navigation/leave-page prompt.
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(
    page.getByText("正在录音 · 说完后点击停止录音。", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByLabel("录音草稿试听")).toBeVisible();
  let navigationPrompts = 0;
  page.on("dialog", async (dialog) => {
    navigationPrompts++;
    await dialog.dismiss();
  });
  // No reload after the feedback change: ending must use current server state.
  await page.route("**/finish", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "结束本次练习", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "结束练习", exact: true })
      .getByRole("alert"),
  ).toContainText("结束结果尚未确认");
  expect((await read()).status).toBe("ended");
  await page.unroute("**/finish");
  await page.getByRole("button", { name: "查询结束状态", exact: true }).click();
  await expect(
    page.getByText("练习已结束，记录只读。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /开始录音|再次作答|确认文本|重试同一文本反馈|识别本次录音/,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "作答 2", exact: true })
      .getByText("当前确认文本尚无有效反馈。", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "作答 3", exact: true })
      .getByText("识别完成 · 未核对", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "作答 4", exact: true })
      .getByText("已接收 · 待识别", { exact: true }),
  ).toBeVisible();
  expect(navigationPrompts).toBe(0);
  await expect(page.getByLabel("录音草稿试听")).toHaveCount(0);
  const ended = await read();
  expect((await post("/finish")).status()).toBe(200);
  expect(
    (
      await post(`/attempts/${third.id}/transcription`, { action: "recognize" })
    ).status(),
  ).toBe(409);
  expect(await read()).toEqual(ended);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/implementation/issue-13/ended-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "按原版本重练", exact: true }).click();
  await expect(page).not.toHaveURL(url);
  await page.goto(url);
  await page.getByRole("button", { name: "删除整次练习", exact: true }).click();
  await page
    .getByRole("button", { name: "确认删除整次练习", exact: true })
    .click();
  await expect(page).toHaveURL(/\/practices$/);
  expect((await page.request.get(base)).status()).toBe(404);
});
