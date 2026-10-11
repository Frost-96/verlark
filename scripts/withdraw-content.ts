import "./load-env";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { isContentError } from "../src/modules/learning-content/contracts";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("撤下材料需要配置 DATABASE_URL。");
const connection = connectDatabase(url);
try {
  await createLearningContent(connection.db).withdraw(process.argv[2] ?? "");
  console.log("内容版本已撤下；历史文字保留，不能再用此版本开始或重练。");
} catch (error) {
  console.error(
    isContentError(error)
      ? error.message
      : "撤下失败，请检查数据库配置和内容版本标识。",
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
