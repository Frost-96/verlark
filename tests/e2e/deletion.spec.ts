import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("删除整次练习后刷新仍显示清理结果，可再次核对且原记录不可访问", async ({
  page,
}, info) => {
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-deletion-${info.project.name}@example.com`,
  );
  await page.goto("/materials");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const url = page.url();
  const id = url.split("/").at(-1)!;
  await page.getByRole("button", { name: "删除整次练习", exact: true }).click();
  await expect(
    page.getByText("删除后无法恢复本次练习、全部作答与反馈。", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect((await page.request.get(`/api/practices/${id}`)).ok()).toBe(true);
  await page.getByRole("button", { name: "删除整次练习", exact: true }).click();
  for (const failure of ["network", "json", "html"] as const) {
    await page.route("**/deletion", async (route) => {
      if (failure === "network") await route.abort("failed");
      else
        await route.fulfill({
          status: 502,
          contentType: failure === "html" ? "text/html" : "application/json",
          body:
            failure === "html"
              ? "<html>Bad Gateway</html>"
              : JSON.stringify({ message: "Upstream provider failed" }),
        });
    });
    await page
      .getByRole("button", { name: "确认删除整次练习", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "暂时无法核对删除结果",
    );
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "请刷新练习记录",
    );
    expect((await page.request.get(`/api/practices/${id}`)).ok()).toBe(true);
    await page.unroute("**/deletion");
  }
  // The server deletes successfully, but its response never reaches the browser.
  await page.route("**/deletion", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "确认删除整次练习", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "暂时无法核对删除结果",
  );
  await page.screenshot({
    path: `test-results/deletion-response-loss-${info.project.name}.png`,
    fullPage: true,
  });
  await page.unroute("**/deletion");
  await page.getByRole("link", { name: "返回练习记录", exact: true }).click();
  await expect(page).toHaveURL(/\/practices$/);
  await expect(
    page.getByText("录音清理已完成。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("开发录音清理 · 仅供本地流程验证，不代表真实存储验收。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "练习记录已删除", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "再次检查录音清理" }).click();
  await expect(
    page.getByRole("button", { name: "再次检查录音清理" }),
  ).toBeEnabled();
  expect((await page.request.get(`/api/practices/${id}`)).status()).toBe(404);
  expect(await (await page.request.get("/api/practices")).json()).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/deletion-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "找不到该练习" }),
  ).toBeVisible();
});
