import "./load-env";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/client";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith("_test"))
  throw new Error(
    "请明确提供独立 TEST_DATABASE_URL，数据库名须以 _test 结尾。",
  );
if (connectionString === process.env.VERLARK_DATABASE_URL)
  throw new Error("测试与开发数据库不能相同。");
// Verification creates additional empty databases; it never drops or clears the supplied DB.
const admin = new Pool({ connectionString });
const databases: string[] = [];
try {
  for (let iteration = 0; iteration < 2; iteration++) {
    const name = `verlark_verify_${crypto.randomUUID().replaceAll("-", "")}_test`;
    await admin.query(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const target: URL = new URL(connectionString);
    target.pathname = `/${name}`;
    const connection = connectDatabase(target.toString());
    try {
      await migrate(connection.db, { migrationsFolder: "drizzle" });
      await migrate(connection.db, { migrationsFolder: "drizzle" });
      // This is infrastructure migration verification, not a domain seam test.
      const client: Pool = new Pool({ connectionString: target.toString() });
      try {
        await client.query(
          "INSERT INTO identity_user(id, name, email) VALUES($1,$2,$3)",
          ["migration-probe", "迁移验证", "migration@example.com"],
        );
        const result = await client.query<{ name: string }>(
          "SELECT name FROM identity_user WHERE id=$1",
          ["migration-probe"],
        );
        assert.equal(result.rows[0]?.name, "迁移验证");
        await migrate(connection.db, { migrationsFolder: "drizzle" });
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS total FROM identity_user",
            )
          ).rows[0]?.total,
          1,
        );
      } finally {
        await client.end();
      }
    } finally {
      await connection.close();
    }
  }
  console.log("两个独立空数据库迁移、重复执行、持久化读写与重建均通过。");
} catch {
  console.error(
    "数据库验证失败；需独立 PostgreSQL 及创建数据库权限，未输出连接凭据。",
  );
  process.exitCode = 1;
} finally {
  for (const name of databases) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
