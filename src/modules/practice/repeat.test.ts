import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import { user } from "../identity/schema";
import { createLearningContent } from "../learning-content/server";
import { createPractice } from "./server";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
const content = createLearningContent(connection.db);
const service = createPractice(connection.db, content);
const alice = {
  id: crypto.randomUUID(),
  email: `repeat-${crypto.randomUUID()}@example.com`,
  name: "甲",
};
const bob = {
  id: crypto.randomUUID(),
  email: `repeat-${crypto.randomUUID()}@example.com`,
  name: "乙",
};
beforeAll(async () => {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  await connection.db
    .insert(user)
    .values([alice, bob].map((item) => ({ ...item, emailVerified: true })));
});
afterAll(() => connection.close());
function source() {
  return {
    materialKey: `repeat-${crypto.randomUUID()}`,
    revision: 1,
    title: "原版计划",
    summary: "谈谈周末",
    materialText: "Any plans?",
    translation: "有什么计划？",
    task: "说说周末计划。",
    keywords: ["plan：计划"],
    sentenceStarters: ["I will …"],
    example: "I will read.",
    audioPath: "/audio/weekend-v1.wav",
  };
}

test("发布新版后目录开始使用新版，历史重练保留完整原版并创建独立记录", async () => {
  const original = source();
  await content.publish(original);
  const first = await service.start(
    alice,
    original.materialKey,
    crypto.randomUUID(),
  );
  await content.publish({
    ...original,
    revision: 2,
    title: "新版计划",
    materialText: "What about tomorrow?",
    translation: "明天怎么样？",
    task: "说说明天。",
    keywords: ["tomorrow：明天"],
    sentenceStarters: ["Tomorrow …"],
    example: "Tomorrow I will swim.",
  });
  const repeated = await service.repeat(alice, first.id, crypto.randomUUID());
  expect(repeated.id).not.toBe(first.id);
  expect(repeated.content).toMatchObject(original);
  expect(repeated.attempts).toEqual([]);
  expect(await service.read(alice, first.id)).toEqual(first);
  expect(
    (await service.start(alice, original.materialKey, crypto.randomUUID()))
      .content.revision,
  ).toBe(2);
});

test("撤下原版保留历史文字与新版本，禁止重练且不会自动换版或重新发布原版", async () => {
  const original = source();
  const published = await content.publish(original);
  const first = await service.start(
    alice,
    original.materialKey,
    crypto.randomUUID(),
  );
  const newer = await content.publish({
    ...original,
    revision: 2,
    title: "新版计划",
  });
  await content.withdraw(published.id);
  await content.publish(original);
  const reloaded = createPractice(
    connection.db,
    createLearningContent(connection.db),
  );
  expect((await reloaded.read(alice, first.id)).content).toMatchObject({
    ...original,
    available: false,
  });
  await expect(
    reloaded.repeat(alice, first.id, crypto.randomUUID()),
  ).rejects.toThrow("原内容版本已撤下");
  expect(
    (await reloaded.list(alice)).filter((item) => item.id === first.id),
  ).toHaveLength(1);
  expect((await content.latestAvailable(original.materialKey)).id).toBe(
    newer.id,
  );
  await content.withdraw(newer.id);
  await expect(
    reloaded.start(alice, original.materialKey, crypto.randomUUID()),
  ).rejects.toThrow("材料暂不可用");
});

test("重练并发与结果未知重发只创建一次，重用标识改原练习或混用目录入口被拒绝", async () => {
  const original = source();
  await content.publish(original);
  const first = await service.start(
    alice,
    original.materialKey,
    crypto.randomUUID(),
  );
  const second = await service.start(
    alice,
    original.materialKey,
    crypto.randomUUID(),
  );
  const requestId = crypto.randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => service.repeat(alice, first.id, requestId)),
  );
  expect(new Set(results.map((item) => item.id)).size).toBe(1);
  await content.withdraw(first.content.id);
  expect((await service.repeat(alice, first.id, requestId)).id).toBe(
    results[0]!.id,
  );
  await expect(service.repeat(alice, second.id, requestId)).rejects.toThrow(
    "请求标识",
  );
  await expect(
    service.start(alice, original.materialKey, requestId),
  ).rejects.toThrow("请求标识");
  await expect(
    service.repeat(bob, first.id, crypto.randomUUID()),
  ).rejects.toThrow("找不到该练习");
  await expect(
    service.repeat(null, first.id, crypto.randomUUID()),
  ).rejects.toThrow("请先验证邮箱");
  expect((await service.read(alice, first.id)).attempts).toEqual([]);
});

test.each(["start", "repeat"] as const)(
  "%s 读取可用版本后，撤下必须等待新练习提交；之后的新请求被拒绝",
  async (operation) => {
    const original = source();
    const published = await content.publish(original);
    const first = await service.start(
      alice,
      original.materialKey,
      crypto.randomUUID(),
    );
    let selected!: () => void;
    let release!: () => void;
    const selection = new Promise<void>((resolve) => {
      selected = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Pause only after the real content public interface has resolved the version.
    // Both database implementations remain real; the barrier controls interleaving.
    const coordinated = createPractice(connection.db, {
      ...content,
      latestAvailable: async (...args) => {
        const version = await content.latestAvailable(...args);
        selected();
        await barrier;
        return version;
      },
      availableVersion: async (...args) => {
        const version = await content.availableVersion(...args);
        selected();
        await barrier;
        return version;
      },
    });
    const creating =
      operation === "start"
        ? coordinated.start(alice, original.materialKey, crypto.randomUUID())
        : coordinated.repeat(alice, first.id, crypto.randomUUID());
    await selection;
    let withdrawn = false;
    const withdrawing = content.withdraw(published.id).then(() => {
      withdrawn = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(withdrawn).toBe(false);
    } finally {
      release();
      await Promise.allSettled([creating, withdrawing]);
    }
    const created = await creating;
    await withdrawing;
    expect((await service.read(alice, created.id)).content).toMatchObject({
      ...original,
      available: false,
    });
    await expect(
      service.repeat(alice, first.id, crypto.randomUUID()),
    ).rejects.toThrow("原内容版本已撤下");
    await expect(
      service.start(alice, original.materialKey, crypto.randomUUID()),
    ).rejects.toThrow("材料暂不可用");
  },
);
