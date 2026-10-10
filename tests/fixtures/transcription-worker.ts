// Crash-test worker: calls only the practice public API and an external fault adapter.
import { connectDatabase } from "../../src/db/client";
import { createPractice } from "../../src/modules/practice/server";
import { createLearningContent } from "../../src/modules/learning-content/server";
import { createRecordingFiles } from "../../src/integrations/files/server";
const [url, directory, learnerJSON, practiceId, attemptId, time] =
  process.argv.slice(2);
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("独立测试库必需。");
const connection = connectDatabase(url);
const service = createPractice(
  connection.db,
  createLearningContent(connection.db),
  createRecordingFiles({ development: true, directory }),
  {
    mode: "development",
    recognize: async () => {
      process.stdout.write("recognition-started\n");
      return new Promise(() => {});
    },
  },
  { now: () => new Date(time!) },
);
await service.recognize(JSON.parse(learnerJSON!), practiceId!, attemptId!);
