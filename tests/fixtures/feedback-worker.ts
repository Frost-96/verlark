// Crash-test worker: no database state mutation outside the practice public API.
import { connectDatabase } from "../../src/db/client";
import { createPractice } from "../../src/modules/practice/server";
import { createLearningContent } from "../../src/modules/learning-content/server";
const [url, , learnerJSON, practiceId, attemptId, confirmationId, time] =
  process.argv.slice(2);
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("独立测试库必需。");
const connection = connectDatabase(url);
const service = createPractice(
  connection.db,
  createLearningContent(connection.db),
  undefined,
  undefined,
  { now: () => new Date(time!) },
  {
    mode: "development",
    generate: async () => {
      process.stdout.write("feedback-started\n");
      return new Promise(() => {});
    },
  },
);
await service.requestFeedback(
  JSON.parse(learnerJSON!),
  practiceId!,
  attemptId!,
  confirmationId!,
);
