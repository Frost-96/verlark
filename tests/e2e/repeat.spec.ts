import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";
import { connectDatabase } from "../../src/db/client";
import { createLearningContent } from "../../src/modules/learning-content/server";

test("历史按原版重练、未知结果重发、目录新版及撤下提示", async ({
  page,
  browser,
}, info) => {
  const connection = connectDatabase(process.env.E2E_DATABASE_URL!);
  const content = createLearningContent(connection.db, {
    requirePrivateAudio: false,
  });
  const source = {
    materialKey: `repeat-${crypto.randomUUID()}`,
    revision: 1,
    title: `重练原版 ${crypto.randomUUID().slice(0, 8)}`,
    summary: "旧版说明",
    materialText: "I will read.",
    translation: "我会读书。",
    task: "说说你要读什么。",
    keywords: ["read：读书"],
    sentenceStarters: ["I will …"],
    example: "I will read a story.",
    audioPath: "/audio/weekend-v1.wav",
  };
  const versions: string[] = [];
  const headers = { origin: "http://localhost:3100" };
  try {
    const original = await content.publish(source);
    versions.push(original.id);
    await signIn(
      page.request,
      `${process.env.E2E_PREFIX}-repeat-${info.project.name}@example.com`,
    );
    const started = await page.request.post("/api/practices", {
      headers,
      data: { materialKey: source.materialKey, requestId: crypto.randomUUID() },
    });
    expect(started.status()).toBe(201);
    const first = await started.json();
    const audio = await page.request.post(
      `/api/practices/${first.id}/recordings`,
      {
        headers: { ...headers, "content-type": "audio/webm" },
        data: Buffer.from([1, 2, 3]),
      },
    );
    const { reference } = await audio.json();
    expect(
      (
        await page.request.post(`/api/practices/${first.id}/submissions`, {
          headers,
          data: { submissionId: crypto.randomUUID(), reference },
        })
      ).ok(),
    ).toBe(true);
    const before = await (
      await page.request.get(`/api/practices/${first.id}`)
    ).json();
    versions.push(
      (
        await content.publish({
          ...source,
          revision: 2,
          title: `${source.title}新版`,
          task: "说说明天读什么。",
        })
      ).id,
    );
    await page.goto("/practices");
    await page.getByRole("link", { name: "继续练习" }).click();
    await page.route("**/repeat", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "按原版本重练", exact: true })
      .click({ timeout: 2000 });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "暂时无法确认重练是否已保存",
    );
    await page.unroute("**/repeat");
    await page
      .getByRole("button", { name: "按原版本重练", exact: true })
      .click();
    await expect(page).toHaveURL(/\/practice\/[a-f0-9-]+$/);
    await expect(page).not.toHaveURL(new RegExp(`${first.id}$`));
    const repeatedId = page.url().split("/").at(-1)!;
    const repeated = await (
      await page.request.get(`/api/practices/${repeatedId}`)
    ).json();
    expect(repeated.content).toEqual(before.content);
    expect(repeated.attempts).toEqual([]);
    expect(
      await (await page.request.get(`/api/practices/${first.id}`)).json(),
    ).toEqual(before);
    expect(
      await (await page.request.get("/api/practices")).json(),
    ).toHaveLength(2);
    await page.goto("/materials");
    await page
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", {
          name: `${source.title}新版`,
          exact: true,
        }),
      })
      .getByRole("button", { name: "开始聆听练习" })
      .click();
    await expect(
      page.getByRole("heading", { name: `${source.title}新版`, exact: true }),
    ).toBeVisible();
    const outsider = await browser.newContext({
      baseURL: "http://localhost:3100",
    });
    try {
      expect(
        (
          await outsider.request.post(`/api/practices/${first.id}/repeat`, {
            headers,
            data: { requestId: crypto.randomUUID() },
          })
        ).status(),
      ).toBe(401);
      await signIn(
        outsider.request,
        `${process.env.E2E_PREFIX}-repeat-other-${info.project.name}@example.com`,
      );
      expect(
        (
          await outsider.request.post(`/api/practices/${first.id}/repeat`, {
            headers,
            data: { requestId: crypto.randomUUID() },
          })
        ).status(),
      ).toBe(404);
      expect(
        await (await outsider.request.get("/api/practices")).json(),
      ).toEqual([]);
    } finally {
      await outsider.close();
    }
    expect(
      (
        await page.request.post(`/api/practices/${first.id}/repeat`, {
          headers: { origin: "https://attacker.example" },
          data: { requestId: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`/api/practices/${first.id}/repeat`, {
          headers,
          data: { requestId: crypto.randomUUID(), userId: "forged" },
        })
      ).status(),
    ).toBe(400);
    await page.goto(`/practice/${first.id}`);
    await content.withdraw(original.id);
    await page
      .getByRole("button", { name: "按原版本重练", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "原内容版本已撤下",
    );
    await expect(page).toHaveURL(new RegExp(`${first.id}$`));
    await page.reload();
    await expect(
      page.getByRole("button", { name: "按原版本重练", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("原内容版本已撤下", { exact: false }),
    ).toBeVisible();
    await page.getByText("查看材料原文", { exact: true }).click();
    await expect(page.getByText("I will read.", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "另选可用材料开始新练习", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/repeat-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    for (const id of versions) await content.withdraw(id);
    await connection.close();
  }
});
