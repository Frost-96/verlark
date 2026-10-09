import "./load-env";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { ContentError } from "../src/modules/learning-content/contracts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("发布材料需要配置 DATABASE_URL。");
const connection = connectDatabase(url);
try {
  const source: unknown = JSON.parse(
    await readFile(process.argv[2] ?? "content/weekend-plans-v1.json", "utf8"),
  );
  const { audioPath } = z
    .object({
      audioPath: z.string().regex(/^\/audio\/[a-z0-9-]+\.(wav|mp3|m4a)$/),
    })
    .parse(source);
  await access(resolve("public", `.${audioPath}`));
  const published = await createLearningContent(connection.db).publish(source);
  console.log(`材料已发布：${published.title}（版本 ${published.revision}）。`);
} catch (error) {
  console.error(
    error instanceof ContentError
      ? error.message
      : "材料发布失败，请检查数据库配置、材料格式和本地音频文件。",
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
