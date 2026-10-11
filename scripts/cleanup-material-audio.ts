import "./load-env";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { createMaterialAudioStore } from "../src/integrations/material-audio/blob";
const databaseURL = process.env.DATABASE_URL;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!databaseURL || !token)
  throw new Error("材料音频维护需要 DATABASE_URL 和 BLOB_READ_WRITE_TOKEN。");
const connection = connectDatabase(databaseURL);
try {
  const result = await createLearningContent(connection.db, {
    files: createMaterialAudioStore(token),
  }).cleanupAudio();
  console.log(
    `材料音频维护：已确认清理 ${result.cleaned}，失败待重试 ${result.failed}。`,
  );
  if (result.failed) process.exitCode = 1;
} catch {
  console.error(
    "材料音频维护未完成，请检查服务端配置并重试；未确认对象不存在前不会标记清理成功。",
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
