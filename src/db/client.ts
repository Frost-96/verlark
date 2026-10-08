import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function connectDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  // Driver errors can contain credentials or hosts; never print the raw error.
  pool.on("error", () => console.error("数据库连接中断，请检查服务端配置。"));
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
