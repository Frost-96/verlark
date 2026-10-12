import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
async function emailLink(email: string, kind: string) {
  const files = await readdir(".dev-mail");
  const messages = await Promise.all(
    files.map(async (file) =>
      JSON.parse(await readFile(`.dev-mail/${file}`, "utf8")),
    ),
  );
  return messages.findLast((item) => item.to === email && item.kind === kind)
    ?.url as string | undefined;
}

test("中文注册、验证、登录、恢复密码、撤销会话和旧入口关闭", async ({
  page,
  request,
}, info) => {
  const email = `${process.env.E2E_PREFIX}-${info.project.name}@example.com`;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /先听懂，\s*再说出自己的想法。/ }),
  ).toBeVisible();
  expect((await request.get("/api/speaking/chat")).status()).toBe(404);
  expect((await request.post("/api/coach/chat", { data: {} })).status()).toBe(
    404,
  );
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "注册", exact: true }).click();
  await page.getByLabel("称呼").fill("浏览器学习者");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("browser-password-123");
  await page.getByRole("button", { name: "注册并验证邮箱" }).click();
  await expect(page.getByRole("status")).toContainText("注册请求已完成");
  await expect(
    page.getByText("开发邮件替身已启用", { exact: false }),
  ).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("browser-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "请先验证邮箱",
  );
  const verification = await emailLink(email, "verification");
  expect(verification).toBeTruthy();
  await page.goto(verification!);
  await page.getByRole("button", { name: "确认验证邮箱" }).click();
  await expect(page.getByRole("status")).toContainText("邮箱验证成功");
  await page.getByRole("button", { name: "确认验证邮箱" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "链接无效、已过期或已使用",
  );
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("browser-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`已验证邮箱：${email}`)).toBeVisible();
  const oldCookies = await page.context().cookies();
  await page.getByRole("button", { name: "退出当前登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.context().addCookies(oldCookies);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/forgot-password");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送重置链接" }).click();
  await expect(page.getByRole("status")).toContainText("若该邮箱已注册");
  const reset = await emailLink(email, "password-reset");
  expect(reset).toBeTruthy();
  await page.goto(reset!);
  await page.getByLabel("新密码").fill("browser-new-password-456");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("密码已重置");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "链接无效、已过期或已使用",
  );
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill("browser-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "邮箱或密码不正确",
  );
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-new-password-456");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  const revokedCookies = await page.context().cookies();
  await page.screenshot({
    path: `test-results/account-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "退出所有设备" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.context().addCookies(revokedCookies);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/reset-password?token=invalid");
  await page.getByLabel("新密码").fill("browser-new-password-456");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "链接无效、已过期或已使用",
  );
});

test("验证链接缺少令牌时提供恢复入口，不显示无法操作的验证按钮", async ({
  page,
}) => {
  await page.goto("/verify-email");
  await expect(
    page.getByRole("alert").filter({ hasText: "验证链接" }),
  ).toContainText("验证链接不完整");
  await expect(
    page.getByRole("button", { name: "确认验证邮箱", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "重新申请验证邮件", exact: true }),
  ).toHaveAttribute("href", "/login");
  await page.goto("/verify-email?token=invalid-probe");
  await expect(
    page.getByRole("button", { name: "确认验证邮箱", exact: true }),
  ).toBeEnabled();
});
