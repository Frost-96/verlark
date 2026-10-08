import "./load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/client";

const url = process.env.VERLARK_DATABASE_URL;
if (!url) {
  console.error(
    "请显式配置 VERLARK_DATABASE_URL。迁移不会使用旧 DATABASE_URL。",
  );
  process.exit(1);
}
const connection = connectDatabase(url);
try {
  await migrate(connection.db, { migrationsFolder: "drizzle" });
  console.log("数据库迁移完成（只执行尚未应用的版本，不清空现有数据）。");
} catch {
  console.error("数据库迁移失败，请检查连接配置与数据库权限；未输出连接凭据。");
  process.exitCode = 1;
} finally {
  await connection.close();
}
