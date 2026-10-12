import { expect, test } from "vitest";
import { createBailianFeedback } from "./bailian";
import { connectDatabase } from "../../db/client";
import { migrate } from "drizzle-orm/node-postgres/migrator";

test("真实反馈发送前拒绝空输入、未启用或已过期额度", async () => {
  const url = process.env.TEST_DATABASE_URL!;
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error("需要隔离数据库");
  const db = connectDatabase(url);
  await migrate(db.db, { migrationsFolder: "drizzle" });
  let calls = 0;
  const adapter = createBailianFeedback(
    db.db,
    {
      enabled: false,
      apiKey: "test",
      host: "ws-test.cn-beijing.maas.aliyuncs.com",
      freeTokenBudget: 100000,
      freeUntil: new Date("2099-01-01"),
    },
    async () => {
      calls++;
      throw new Error();
    },
  );
  expect(
    await adapter.generate({
      text: "Hello.",
      confirmationId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      rulesVersion: "expression-v1",
    }),
  ).toEqual({ kind: "failed" });
  expect(calls).toBe(0);
  await db.close();
});

test("并发相同请求只发送一次，未知不自动重发，预算不足停止", async () => {
  const db = connectDatabase(process.env.TEST_DATABASE_URL!);
  const input = {
    text: "I will read tomorrow.",
    confirmationId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    rulesVersion: "expression-v1",
  };
  let calls = 0;
  const configuration = {
    enabled: true,
    apiKey: "test",
    host: "ws-test.cn-beijing.maas.aliyuncs.com",
    freeTokenBudget: 1000000,
    freeUntil: new Date("2099-01-01"),
  };
  const adapter = createBailianFeedback(db.db, configuration, async () => {
    calls++;
    throw new Error("lost response");
  });
  const results = await Promise.all([
    adapter.generate(input),
    adapter.generate(input),
  ]);
  expect(calls).toBe(1);
  expect(results).toContainEqual({ kind: "unknown" });
  expect(await adapter.generate(input)).toEqual({ kind: "failed" });
  expect(calls).toBe(1);
  const stopped = createBailianFeedback(
    db.db,
    { ...configuration, freeTokenBudget: 1 },
    async () => {
      calls++;
      throw new Error();
    },
  );
  expect(
    await stopped.generate({ ...input, requestId: crypto.randomUUID() }),
  ).toEqual({ kind: "failed" });
  expect(calls).toBe(1);
  await db.close();
});

test("真实协议携带文本依据与规则，合法响应无强制纠错，截断与超限响应不能当成功", async () => {
  const db = connectDatabase(process.env.TEST_DATABASE_URL!);
  const config = {
    enabled: true,
    apiKey: "test",
    host: "ws-test.cn-beijing.maas.aliyuncs.com",
    freeTokenBudget: 1000000,
    freeUntil: new Date("2099-01-01"),
  };
  const input = {
    text: "I will read tomorrow.",
    confirmationId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    rulesVersion: "expression-v1",
  };
  const output = {
    kind: "generated",
    summary: "计划表达清楚。",
    issues: [],
    alternatives: [],
  };
  const adapter = createBailianFeedback(db.db, config, async (url, init) => {
    expect(String(url)).toContain("/compatible-mode/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.messages[1].content).toBe(input.text);
    expect(body.enable_thinking).toBe(false);
    expect(body.max_tokens).toBe(1024);
    return Response.json({
      id: "synthetic-provider-id",
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(output) } },
      ],
      usage: { total_tokens: 100 },
    });
  });
  expect(await adapter.generate(input)).toMatchObject(output);
  for (const response of [
    new Response("x".repeat(65537)),
    Response.json({
      id: "truncated",
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
      usage: { total_tokens: 100 },
    }),
  ]) {
    expect(
      await createBailianFeedback(db.db, config, async () => response).generate(
        { ...input, requestId: crypto.randomUUID() },
      ),
    ).toEqual({ kind: "unknown" });
  }
  await db.close();
});

test("过期额度和空输入不触发远端，供应商拒绝不伪造反馈", async () => {
  const db = connectDatabase(process.env.TEST_DATABASE_URL!);
  let calls = 0;
  const config = {
    enabled: true,
    apiKey: "test",
    host: "ws-test.cn-beijing.maas.aliyuncs.com",
    freeTokenBudget: 1000000,
    freeUntil: new Date("2099-01-01"),
  };
  const transport: typeof fetch = async () => {
    calls++;
    return new Response("rejected", { status: 429 });
  };
  const input = {
    text: "Hello.",
    confirmationId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    rulesVersion: "expression-v1",
  };
  expect(
    await createBailianFeedback(
      db.db,
      { ...config, freeUntil: new Date(0) },
      transport,
    ).generate(input),
  ).toEqual({ kind: "failed" });
  expect(
    await createBailianFeedback(db.db, config, transport).generate({
      ...input,
      text: "",
    }),
  ).toEqual({ kind: "no-content" });
  expect(calls).toBe(0);
  expect(
    await createBailianFeedback(db.db, config, transport).generate(input),
  ).toEqual({ kind: "unknown" });
  expect(calls).toBe(1);
  await db.close();
});
