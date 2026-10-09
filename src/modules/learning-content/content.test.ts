import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import { createLearningContent } from "./server";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(() => connection.close());

test("发布后更换内容实例仍能读取完整材料；同版本不可改写", async () => {
  const content = createLearningContent(connection.db);
  const source = {
    materialKey: `test-${crypto.randomUUID()}`,
    revision: 1,
    title: "周末计划",
    summary: "聊聊周末想做的事。",
    materialText:
      "A: What are you doing this weekend?\nB: I'm going for a walk.",
    translation: "A：这周末你打算做什么？\nB：我打算去散步。",
    task: "说说你这个周末想做的事。",
    keywords: ["go for a walk：去散步"],
    sentenceStarters: ["I'm going to …"],
    example: "I'm going to visit a friend this weekend.",
    audioPath: "/audio/weekend-v1.wav",
  };
  const published = await content.publish(source);
  const reader = createLearningContent(connection.db);
  expect(await reader.readVersion(published.id)).toMatchObject(source);
  expect(
    (await reader.listAvailable()).find(
      (item) => item.materialKey === source.materialKey,
    )?.id,
  ).toBe(published.id);
  expect((await content.publish(source)).id).toBe(published.id);
  await expect(
    content.publish({ ...source, title: "被改写的标题" }),
  ).rejects.toThrow("已发布版本不能改写");
  expect((await reader.readVersion(published.id)).title).toBe("周末计划");
});
