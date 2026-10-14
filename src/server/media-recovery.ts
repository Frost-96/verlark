import {
  uploadInventorySchema,
  recoveryEntrySchema,
  type RecoveryEntry,
} from "../integrations/recovery/contracts";
import type { createPrivateRecordingFiles } from "../integrations/files/private";
import type { createPractice } from "../modules/practice/server";

/** Offline orchestration only. A partial failure must leave the target isolated. */
export async function replayMediaRecovery(
  input: RecoveryEntry[],
  files: Pick<
    ReturnType<typeof createPrivateRecordingFiles>,
    "recoveryInventory" | "replayInventory"
  >,
  practice: Pick<
    ReturnType<typeof createPractice>,
    "recoveryMarkers" | "replayDeletion"
  >,
) {
  const entries = input.map((entry) => recoveryEntrySchema.parse(entry));
  const uploads = entries.filter((entry) => entry.kind === "upload");
  const deletions = entries.filter((entry) => entry.kind === "deletion");
  const inventory = await files.recoveryInventory();
  const markers = await practice.recoveryMarkers();
  for (const row of inventory) {
    const logged = uploads.find((entry) => entry.id === row.id);
    if (
      !logged ||
      JSON.stringify(uploadInventorySchema.parse(row)) !==
        JSON.stringify(logged)
    )
      throw new Error("恢复库包含未记入独立日志的文件清单。");
  }
  for (const row of markers)
    if (
      !deletions.some(
        (entry) =>
          entry.practiceId === row.practiceId &&
          entry.learnerId === row.learnerId &&
          entry.deletedAt <= row.deletedAt,
      )
    )
      throw new Error("恢复库包含未记入独立日志的删除标记。");
  await files.replayInventory(uploads, deletions);
  for (const marker of deletions) await practice.replayDeletion(marker);
  const restored = await practice.recoveryMarkers();
  if (
    deletions.some(
      (marker) =>
        !restored.some(
          (row) =>
            row.practiceId === marker.practiceId &&
            row.learnerId === marker.learnerId &&
            row.deletedAt <= marker.deletedAt,
        ),
    )
  )
    throw new Error("恢复后的删除标记对账失败。");
  return { uploads: uploads.length, deletions: deletions.length };
}
