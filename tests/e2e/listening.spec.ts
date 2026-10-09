import { test, expect, type APIRequestContext } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";

async function signIn(request: APIRequestContext, email: string) {
  const password = "listening-password-123";
  const headers = { origin: "http://localhost:3100" };
  const signup = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { email, password, name: "聆听学习者" },
  });
  expect(signup.ok()).toBe(true);
  const messages = await Promise.all(
    (await readdir(".dev-mail")).map(async (file) =>
      JSON.parse(await readFile(`.dev-mail/${file}`, "utf8")),
    ),
  );
  const message = messages.findLast(
    (value) => value.to === email && value.kind === "verification",
  );
  const token = new URL(message.url).searchParams.get("token");
  const verified = await request.get(
    `/api/auth/verify-email?token=${encodeURIComponent(token!)}`,
  );
  expect(verified.ok()).toBe(true);
  const login = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(login.ok()).toBe(true);
}

test("选材、播放、分级帮助及关闭后继续，跨账号和匿名无法访问", async ({
  page,
  browser,
}, info) => {
  const suffix = info.project.name;
  await page.goto("/materials");
  await expect(page).toHaveURL(/\/login$/);
  await signIn(
    page.request,
    `${process.env.E2E_PREFIX}-learning-${suffix}@example.com`,
  );
  await page.goto("/practices");
  await expect(
    page.getByText("还没有练习记录。选择一份材料开始吧。"),
  ).toBeVisible();
  await page.getByRole("link", { name: "选择听力材料", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "周末计划", exact: true }),
  ).toBeVisible();
  // The server accepts the first request, but the browser never receives its response.
  await page.route("**/api/practices", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "未能确认练习是否已保存",
  );
  await page.unroute("**/api/practices");
  await page.getByRole("button", { name: "开始聆听练习" }).click();
  await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
  const practiceURL = page.url();
  const id = practiceURL.split("/").at(-1)!;
  await expect(
    page.getByText("A: What are you doing this weekend?", { exact: false }),
  ).toBeHidden();
  const audio = page.getByLabel("听力材料播放器");
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "从头重听" }).click();
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await page.getByText("查看材料原文", { exact: true }).click();
  await expect(
    page.getByText("A: What are you doing this weekend?", { exact: false }),
  ).toBeVisible();
  await page.getByText("查看中文释义", { exact: true }).click();
  await expect(
    page.getByText("A：你这个周末打算做什么？", { exact: false }),
  ).toBeVisible();
  await page.getByText("查看关键词与句式", { exact: true }).click();
  await expect(
    page.getByText("visit a friend：看望朋友", { exact: true }),
  ).toBeVisible();
  const example = page.getByText(
    "I'm going to go for a walk on Sunday because I want to relax.",
    { exact: true },
  );
  await expect(example).toBeHidden();
  await page.getByText("还需要帮助，查看完整示例", { exact: true }).click();
  await expect(example).toBeVisible();
  await expect(
    page.getByText("本次练习还没有作答", { exact: false }),
  ).toBeVisible();
  const before = await (await page.request.get("/api/practices")).json();
  expect(before.map((item: { id: string }) => item.id)).toEqual([id]);
  await page.reload();
  await expect(page).toHaveURL(practiceURL);
  await expect(
    page.getByRole("heading", { name: "周末计划", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A: What are you doing this weekend?", { exact: false }),
  ).toBeHidden();
  await page.screenshot({
    path: `test-results/listening-${suffix}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/practices");
  await reopened.getByRole("link", { name: "继续练习" }).click();
  await expect(reopened).toHaveURL(practiceURL);
  await expect(
    reopened.getByRole("heading", { name: "周末计划", exact: true }),
  ).toBeVisible();
  const after = await (await reopened.request.get("/api/practices")).json();
  expect(after).toEqual(before);
  const outsider = await browser.newContext({
    baseURL: "http://localhost:3100",
  });
  try {
    expect((await outsider.request.get(`/api/practices/${id}`)).status()).toBe(
      401,
    );
    await signIn(
      outsider.request,
      `${process.env.E2E_PREFIX}-other-${suffix}@example.com`,
    );
    expect((await outsider.request.get(`/api/practices/${id}`)).status()).toBe(
      404,
    );
    const forged = await outsider.request.post("/api/practices", {
      headers: { origin: "http://localhost:3100" },
      data: {
        materialKey: "weekend-plans",
        requestId: crypto.randomUUID(),
        userId: "forged-user",
      },
    });
    expect(forged.status()).toBe(400);
    expect(await (await outsider.request.get("/api/practices")).json()).toEqual(
      [],
    );
    const otherPage = await outsider.newPage();
    await otherPage.goto(practiceURL);
    await expect(
      otherPage.getByRole("heading", { name: "找不到该练习" }),
    ).toBeVisible();
  } finally {
    await outsider.close();
  }
  await reopened.close();
});
