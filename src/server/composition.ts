import "server-only";
import { connectDatabase } from "../db/client";
import { createIdentity } from "../modules/identity/server";
import { createMailAdapter } from "../integrations/mail/server";
import { readConfig } from "./config";
import { createLearningContent } from "../modules/learning-content/server";
import { createRecordingFiles } from "../integrations/files/server";
import { createTranscription } from "../integrations/transcription/server";
import { createPractice } from "../modules/practice/server";

function compose() {
  const config = readConfig();
  const connection = connectDatabase(config.databaseURL);
  const content = createLearningContent(connection.db);
  return {
    content,
    practice: createPractice(
      connection.db,
      content,
      createRecordingFiles({ development: config.developmentRecordings }),
      createTranscription({ development: config.developmentTranscription }),
    ),
    identity: createIdentity(
      connection.db,
      config,
      createMailAdapter(config.developmentMail),
    ),
  };
}
const processServices = globalThis as typeof globalThis & {
  verlarkServices?: ReturnType<typeof compose>;
};
export function getServices() {
  return (processServices.verlarkServices ??= compose());
}
