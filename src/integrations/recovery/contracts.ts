import { z } from "zod";

const scope = { learnerId: z.string().min(1).max(256), practiceId: z.uuid() };
export const deletionMarkerSchema = z
  .object({
    kind: z.literal("deletion"),
    ...scope,
    deletedAt: z.iso.datetime(),
  })
  .strict();
export const uploadInventorySchema = z
  .object({
    kind: z.literal("upload"),
    ...scope,
    id: z.uuid(),
    temporaryPath: z
      .string()
      .regex(/^temporary\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
    finalPath: z.string().regex(/^recordings\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
    requestedMediaType: z.string().min(1).max(128),
    createdAt: z.iso.datetime(),
    permitExpiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((entry, context) => {
    for (const path of [entry.temporaryPath, entry.finalPath]) {
      const [, namespace, id] = path.split("/");
      if (!z.uuid().safeParse(namespace).success || id !== entry.id)
        context.addIssue({ code: "custom", message: "上传路径与标识不一致。" });
    }
    if (new Date(entry.permitExpiresAt) < new Date(entry.createdAt))
      context.addIssue({ code: "custom", message: "上传许可时间无效。" });
  });
export const recoveryEntrySchema = z.discriminatedUnion("kind", [
  deletionMarkerSchema,
  uploadInventorySchema,
]);
export type DeletionMarker = z.infer<typeof deletionMarkerSchema>;
export type UploadInventory = z.infer<typeof uploadInventorySchema>;
export type RecoveryEntry = z.infer<typeof recoveryEntrySchema>;

/** Minimal private metadata independent of application database backups. */
export interface RecoveryJournal {
  recordUpload(entry: UploadInventory): Promise<void>;
  recordDeletion(entry: DeletionMarker): Promise<DeletionMarker>;
}
