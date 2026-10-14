import { createBailianFeedback } from "../integrations/expression-feedback/bailian";
import { readMailConfig } from "../integrations/mail/config";
import { createQQMail } from "../integrations/mail/qq-smtp";
import { createResendMail } from "../integrations/mail/resend";
import { limitMail } from "../integrations/mail/limited";
import { createBailianTranscription } from "../integrations/transcription/bailian";
import "server-only";
import { createMaterialAudioStore } from "../integrations/material-audio/blob";
import { connectDatabase } from "../db/client";
import { createIdentity } from "../modules/identity/server";
import { createMailAdapter } from "../integrations/mail/server";
import { readConfig } from "./config";
import { createLearningContent } from "../modules/learning-content/server";
import { createRecordingFiles } from "../integrations/files/server";
import { createExpressionFeedback } from "../integrations/expression-feedback/server";
import { createTranscription } from "../integrations/transcription/server";
import { createPractice } from "../modules/practice/server";
import { createPrivateRecordingFiles } from "../integrations/files/private";
import { createBlobObjectStore } from "../integrations/files/blob";
import { validateRecordingAudio } from "../integrations/files/media";
import { createBlobRecoveryJournal } from "../integrations/recovery/blob";

function compose() {
  const config = readConfig();
  const connection = connectDatabase(config.databaseURL);
  const journal = config.privateRecordings
    ? createBlobRecoveryJournal(config.blobToken!, "verlark-media-v1")
    : undefined;
  const content = createLearningContent(connection.db, {
    files: config.blobToken
      ? createMaterialAudioStore(config.blobToken)
      : undefined,
  });
  const files = config.privateRecordings
    ? createPrivateRecordingFiles(
        connection.db,
        createBlobObjectStore(config.blobToken!),
        validateRecordingAudio,
        undefined,
        {
          uploadsEnabled: config.recordingUploadsEnabled,
          requireMaintenance: true,
        },
        journal,
      )
    : createRecordingFiles({ development: config.developmentRecordings });
  const mailConfig = readMailConfig(
    process.env,
    config.baseURL,
    config.allowedEmails,
  );
  return {
    content,
    files,
    practice: createPractice(
      connection.db,
      content,
      files,
      config.bailianTranscription
        ? createBailianTranscription({
            apiKey: config.dashscopeApiKey!,
            host: config.dashscopeApiHost,
          })
        : createTranscription({ development: config.developmentTranscription }),
      undefined,
      config.realFeedback
        ? createBailianFeedback(connection.db, config.realFeedback)
        : createExpressionFeedback({ development: config.developmentFeedback }),
      journal,
      config.recognitionPolicy,
    ),
    identity: createIdentity(
      connection.db,
      config,
      mailConfig
        ? limitMail(
            connection.db,
            mailConfig.provider === "qq-smtp"
              ? createQQMail(mailConfig)
              : createResendMail(mailConfig),
            mailConfig.provider,
          )
        : createMailAdapter(config.developmentMail),
    ),
  };
}
const processServices = globalThis as typeof globalThis & {
  verlarkServices?: ReturnType<typeof compose>;
};
export function getServices() {
  return (processServices.verlarkServices ??= compose());
}
