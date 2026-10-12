/** Run only while source writers AND the recovery target are isolated.
 * inspect: read-only journal summary; initialize: baseline from DATABASE_URL;
 * replay: metadata-only replay into a distinct RECOVERY_DATABASE_URL (*_recovery or *_test).
 * Never calls object deletion or automatically reopens the application.
 */
import "./load-env";
import { connectDatabase } from "../src/db/client";
import { createLearningContent } from "../src/modules/learning-content/server";
import { createPractice } from "../src/modules/practice/server";
import {
  createPrivateRecordingFiles,
  type PrivateObjectStore,
} from "../src/integrations/files/private";
import { createBlobRecoveryJournal } from "../src/integrations/recovery/blob";
import { replayMediaRecovery } from "../src/server/media-recovery";

const command = process.argv[2] ?? "inspect";
let close: (() => Promise<void>) | undefined;
try {
  if (!["inspect", "initialize", "replay"].includes(command))
    throw new Error("command");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("credentials");
  const journal = createBlobRecoveryJournal(token, "verlark-media-v1");
  if (command === "inspect") {
    const snapshot = await journal.readAll();
    console.log(
      JSON.stringify({
        initializedAt: snapshot.initializedAt,
        entries: snapshot.entries.length,
        writes: false,
      }),
    );
  } else {
    if (process.env.MEDIA_RECOVERY_OFFLINE !== "true")
      throw new Error("isolation");
    const source = process.env.DATABASE_URL;
    const target =
      command === "replay" ? process.env.RECOVERY_DATABASE_URL : source;
    if (!source || !target) throw new Error("database");
    if (command === "replay") {
      const a = new URL(source),
        b = new URL(target);
      if (
        a.hostname === b.hostname &&
        a.port === b.port &&
        a.pathname === b.pathname
      )
        throw new Error("same database");
      if (!/_(recovery|test)$/.test(b.pathname))
        throw new Error("recovery database name");
    }
    const connection = connectDatabase(target);
    close = connection.close;
    const content = createLearningContent(connection.db);
    const practice = createPractice(connection.db, content);
    const forbidden = async (): Promise<never> => {
      throw new Error("Recovery cannot access audio objects");
    };
    const store: PrivateObjectStore = {
      authorize: forbidden,
      read: forbidden,
      put: forbidden,
      remove: forbidden,
    };
    const files = createPrivateRecordingFiles(connection.db, store, forbidden);
    const inventory = await files.recoveryInventory();
    const markers = await practice.recoveryMarkers();
    if (command === "initialize") {
      await journal.initialize([...inventory, ...markers]);
      const verified = await journal.readAll();
      console.log(
        JSON.stringify({
          initialized: true,
          entries: verified.entries.length,
          audioWrites: false,
        }),
      );
    } else {
      const { entries } = await journal.readAll();
      const result = await replayMediaRecovery(entries, files, practice);
      console.log(
        JSON.stringify({
          replayed: true,
          ...result,
          audioWrites: false,
          keepOffline: true,
          physicalCleanupVerified: false,
        }),
      );
    }
  }
} catch {
  console.error(
    "恢复未完成；保持源站写入与恢复目标隔离。核对日志基线、凭据、独立目标库及清单完整性；不要开放访问。用法：tsx scripts/recover-media.ts inspect|initialize|replay。",
  );
  process.exitCode = 1;
} finally {
  await close?.();
}
