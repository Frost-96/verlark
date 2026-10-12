import { expect, test, afterAll, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../../db/client";
import { limitMail } from "./limited";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("需要隔离测试数据库");
const connection = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(() => connection.close());
test("two processes share a durable send cap and unknown sends keep their reservation", async () => {
  const scope = crypto.randomUUID();
  let sends = 0;
  const upstream = {
    async send() {
      sends++;
      throw new Error("unknown delivery");
    },
  };
  const a = limitMail(connection.db, upstream, scope);
  const b = limitMail(connection.db, upstream, scope);
  const msg = {
    to: `${scope}@example.com`,
    kind: "verification" as const,
    url: "https://app.example.com/verify-email?token=secret",
  };
  await Promise.allSettled([a.send(msg), b.send(msg)]);
  expect(sends).toBe(1);
  await expect(b.send(msg)).rejects.toThrow("发送过于频繁");
});
test("daily free budget stops before the 91st provider request across distinct recipients", async () => {
  const scope = crypto.randomUUID();
  let sent = 0;
  const mail = limitMail(
    connection.db,
    {
      async send() {
        sent++;
      },
    },
    scope,
  );
  for (let i = 0; i < 90; i++)
    await mail.send({
      to: `${i}@example.com`,
      kind: "verification",
      url: "https://app.example.com/verify-email?token=test",
    });
  await expect(
    mail.send({
      to: "last@example.com",
      kind: "verification",
      url: "https://app.example.com/verify-email?token=test",
    }),
  ).rejects.toThrow("发送过于频繁");
  expect(sent).toBe(90);
});
