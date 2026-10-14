import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../db/client";
import { withMediaRecoveryBaselineLock } from "./media-recovery-baseline";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  url === process.env.DATABASE_URL
)
  throw new Error("请提供独立 TEST_DATABASE_URL。");
const connection = connectDatabase(url);
const writer = connectDatabase(url);
beforeAll(() => migrate(connection.db, { migrationsFolder: "drizzle" }));
afterAll(async () => {
  await connection.close();
  await writer.close();
});

test("baseline holds both tables against concurrent writes and initialization through read-back", async () => {
  await withMediaRecoveryBaselineLock(connection.db, async () => {
    for (const table of ["practice", "recording_asset"]) {
      await expect(
        writer.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`);
          await tx.execute(
            sql.raw(`LOCK TABLE ${table} IN ROW EXCLUSIVE MODE`),
          );
        }),
      ).rejects.toThrow();
    }
    await expect(
      withMediaRecoveryBaselineLock(writer.db, async () => {
        throw new Error("must not reach external storage");
      }),
    ).rejects.not.toThrow("must not reach external storage");
    // Reads needed by the metadata adapters remain available on other connections.
    await writer.db.execute(sql`SELECT id FROM practice LIMIT 1`);
    await writer.db.execute(sql`SELECT id FROM recording_asset LIMIT 1`);
  });
  await writer.db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE practice, recording_asset IN ROW EXCLUSIVE MODE NOWAIT`,
    );
  });
});

test("active writers reject initialization before external writes; failures release locks", async () => {
  let called = false;
  await writer.db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE recording_asset IN ROW EXCLUSIVE MODE`);
    await expect(
      withMediaRecoveryBaselineLock(connection.db, async () => {
        called = true;
      }),
    ).rejects.toThrow();
  });
  expect(called).toBe(false);
  await expect(
    withMediaRecoveryBaselineLock(connection.db, async () => {
      throw new Error("Blob unavailable");
    }),
  ).rejects.toThrow("Blob unavailable");
  await expect(
    withMediaRecoveryBaselineLock(writer.db, async () => "retry allowed"),
  ).resolves.toBe("retry allowed");
});
