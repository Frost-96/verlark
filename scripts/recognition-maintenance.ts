import "./load-env";
import { readConfig } from "../src/server/config";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { createPractice } from "../src/modules/practice/server";

// Deliberate operator entry point. Never calls recognition or resends audio.
const [action, id, seconds, evidence, consent] = process.argv.slice(2);
if (!["status", "recover", "reconcile"].includes(action ?? "")) {
  throw new Error(
    "用法：recognition-maintenance.ts status | recover | reconcile CALL_ID SECONDS EVIDENCE_REF --billing-verified",
  );
}
const config = readConfig();
const connection = connectDatabase(config.databaseURL);
try {
  const practice = createPractice(
    connection.db,
    createLearningContent(connection.db),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    config.recognitionPolicy,
  );
  if (action === "recover")
    console.log(JSON.stringify(await practice.recoverExpiredRecognitions(100)));
  if (action === "reconcile") {
    if (!id || !seconds || !evidence || consent !== "--billing-verified")
      throw new Error(
        "先核对供应商账单，再显式传入已验证的秒数及无个人信息的审计引用。",
      );
    await practice.reconcileRecognitionUsage(id, {
      seconds: Number(seconds),
      evidence,
    });
  }
  console.log(
    JSON.stringify(
      {
        budget: await practice.recognitionBudgetStatus(),
        calls: await practice.recognitionReceipts(),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "识别维护未完成。请核对配置、处理状态和对账依据；未释放未知预留，也未重发识别。",
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
