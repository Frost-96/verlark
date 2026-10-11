import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("更正保留旧反馈依据，多页面冲突恢复后需为新版本重新取得反馈", async ({
  page,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-revisions-${info.project.name}@example.com`,
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
  const editor = page.getByRole("textbox", { name: "核对后的英语文本" });
  await editor.fill("I will read a book this weekend.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await page.getByRole("button", { name: "获取表达反馈", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("再次确认会保存为新版本，旧反馈只对应旧文本。", {
      exact: true,
    }),
  ).toBeVisible();
  const other = await page.context().newPage();
  await other.goto(page.url());
  const otherEditor = other.getByRole("textbox", { name: "核对后的英语文本" });
  await otherEditor.fill("I will read tomorrow.");
  await editor.fill("I will write tomorrow.");
  await page.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(
    page.getByText("确认文本 · 版本 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("文本已更正，请为当前版本重新获取表达反馈。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("查看历史反馈", { exact: true }).click();
  const historical = page.locator(".feedback-result").filter({
    has: page.getByRole("heading", {
      name: "历史反馈 · 依据确认文本版本 1",
      exact: true,
    }),
  });
  await expect(historical).toContainText("I will read a book this weekend.");
  await expect(historical).toContainText("仅供对照，不适用于当前确认文本。");
  await page.screenshot({
    path: `docs/implementation/issue-11/revisions-awaiting-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "获取表达反馈", exact: true }).click();
  await expect(
    page.getByText("反馈服务失败或返回无效结果", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toHaveCount(0);
  await other.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(other.getByRole("main").getByRole("alert")).toContainText(
    "已改变",
  );
  await expect(otherEditor).toHaveValue("I will read tomorrow.");
  await other
    .getByRole("button", { name: "查询最新状态", exact: true })
    .click();
  await expect(
    other.getByText("确认文本 · 版本 2", { exact: true }),
  ).toBeVisible();
  await expect(otherEditor).toHaveValue("I will read tomorrow.");
  await other
    .getByRole("button", { name: "载入最新确认文本", exact: true })
    .click();
  await expect(otherEditor).toHaveValue("I will write tomorrow.");
  await otherEditor.fill("I will read tomorrow.");
  await other.getByRole("button", { name: "确认文本", exact: true }).click();
  await expect(
    other.getByText("确认文本 · 版本 3", { exact: true }),
  ).toBeVisible();
  await other
    .getByRole("button", { name: "获取表达反馈", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("确认文本 · 版本 3", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "当前有效反馈", exact: true }),
  ).toBeVisible();
  await page.getByText("查看此前确认文本", { exact: true }).click();
  await page.getByText("查看历史反馈", { exact: true }).click();
  await expect(historical).toContainText("I will read a book this weekend.");
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: /^I will reed a book this weekend\.$/ }),
  ).toBeVisible();
  const detail = await (await page.request.get(`/api/practices/${id}`)).json();
  expect(detail.attempts).toHaveLength(1);
  expect(detail.attempts[0].confirmations).toHaveLength(3);
  expect(detail.attempts[0].currentValidFeedback.confirmationId).toBe(
    detail.attempts[0].confirmations[2].id,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/implementation/issue-11/revisions-${info.project.name}.png`,
    fullPage: true,
  });
  await other.close();
});
