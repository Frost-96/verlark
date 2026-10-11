import type { MaterialAudioStore } from "../../integrations/material-audio/contracts";
import {
  inspectMaterialWav,
  reviewContentDigest,
} from "../../integrations/material-audio/preparation";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import {
  ContentError,
  type ContentVersion,
  type MaterialSummary,
} from "./contracts";
import { contentVersion, contentPracticeReference } from "./schema";

const text = z.string().trim().min(1).max(10000);
const sourceSchema = z
  .object({
    materialKey: z.string().regex(/^[a-z0-9-]{1,100}$/),
    revision: z.number().int().positive().max(2147483647),
    title: text.max(120),
    summary: text.max(500),
    materialText: text,
    translation: text,
    task: text,
    keywords: z.array(text).min(1).max(20),
    sentenceStarters: z.array(text).min(1).max(20),
    example: text,
    audioPath: z
      .string()
      .regex(/^\/audio\/[a-z0-9-]+\.(wav|mp3|m4a)$/)
      .optional(),
    privateAudio: z
      .object({
        reference: z.string().regex(/^materials\/[a-z0-9-]+\.wav$/),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        byteLength: z
          .number()
          .int()
          .positive()
          .max(8 * 1024 * 1024),
        mediaType: z.literal("audio/wav"),
        durationSeconds: z.number().positive().max(120),
        model: text.max(200),
        voice: text.max(200),
        parameters: z.record(
          z.string().max(100),
          z.union([z.string().max(1000), z.number().finite(), z.boolean()]),
        ),
        review: z
          .object({
            reviewer: text.max(200),
            reviewedAt: z.iso.datetime(),
            contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
            audioDigest: z.string().regex(/^[a-f0-9]{64}$/),
            note: text,
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (source) => Boolean(source.audioPath) !== Boolean(source.privateAudio),
  );

export function createLearningContent(
  db: Database,
  options: {
    files?: MaterialAudioStore;
    now?: () => Date;
    requirePrivateAudio?: boolean;
  } = {},
) {
  const requirePrivateAudio =
    options.requirePrivateAudio ?? process.env.NODE_ENV === "production";
  const publishable = () =>
    and(
      eq(contentVersion.available, true),
      requirePrivateAudio
        ? sql`${contentVersion.content}->'privateAudio' IS NOT NULL`
        : undefined,
    );
  function version(row: typeof contentVersion.$inferSelect): ContentVersion {
    const { privateAudio, audioPath, ...editorial } = row.content;
    const developmentUnavailable = requirePrivateAudio && !privateAudio;
    return {
      ...editorial,
      audioPath: privateAudio
        ? `/api/materials/${row.id}/audio`
        : developmentUnavailable
          ? ""
          : (audioPath ?? ""),
      audioProvenance: privateAudio ? "reviewed" : "development",
      audioStatus: developmentUnavailable
        ? "unavailable"
        : row.audioCleanedAt
          ? "cleaned"
          : row.audioCleanupToken
            ? "unavailable"
            : "available",
      id: row.id,
      available: row.available && !developmentUnavailable,
    };
  }
  return {
    // Maintenance-only entry point, never exposed through user HTTP requests.
    async publish(input: unknown): Promise<ContentVersion> {
      const parsed = sourceSchema.safeParse(input);
      if (!parsed.success) throw new ContentError("invalid");
      const source = parsed.data;
      if (requirePrivateAudio && !source.privateAudio)
        throw new ContentError("invalid");
      if (source.privateAudio) {
        const audio = source.privateAudio;
        if (
          audio.review.contentDigest !== reviewContentDigest(source) ||
          audio.review.audioDigest !== audio.digest ||
          new Date(audio.review.reviewedAt).getTime() >
            (options.now?.() ?? new Date()).getTime()
        )
          throw new ContentError("invalid");
        const bytes = await options.files?.read(audio.reference);
        if (!bytes) throw new ContentError("unavailable");
        let inspected;
        try {
          inspected = inspectMaterialWav(bytes);
        } catch {
          throw new ContentError("invalid");
        }
        if (
          inspected.digest !== audio.digest ||
          inspected.byteLength !== audio.byteLength ||
          inspected.durationSeconds !== audio.durationSeconds
        )
          throw new ContentError("invalid");
      }
      await db
        .insert(contentVersion)
        .values({
          materialKey: source.materialKey,
          revision: source.revision,
          content: source,
        })
        .onConflictDoNothing();
      const [row] = await db
        .select()
        .from(contentVersion)
        .where(
          and(
            eq(contentVersion.materialKey, source.materialKey),
            eq(contentVersion.revision, source.revision),
          ),
        );
      if (!row)
        throw new ContentError(source.privateAudio ? "invalid" : "unavailable");
      if (!isDeepStrictEqual(row.content, source))
        throw new ContentError("immutable");
      return version(row);
    },
    async readAudio(id: string): Promise<Uint8Array> {
      if (!z.uuid().safeParse(id).success)
        throw new ContentError("unavailable");
      const [row] = await db
        .select()
        .from(contentVersion)
        .where(eq(contentVersion.id, id));
      if (
        !row?.content.privateAudio ||
        row.audioCleanedAt ||
        row.audioCleanupToken
      )
        throw new ContentError("unavailable");
      const bytes = await options.files?.read(
        row.content.privateAudio.reference,
      );
      if (
        !bytes ||
        inspectMaterialWav(bytes).digest !== row.content.privateAudio.digest
      )
        throw new ContentError("unavailable");
      return bytes;
    },
    // These hooks MUST run in the same transaction as creation/deletion of the practice.
    async retainPracticeReference(
      id: string,
      practiceId: string,
      tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    ): Promise<void> {
      const [row] = await tx
        .select()
        .from(contentVersion)
        .where(eq(contentVersion.id, id))
        .for("update");
      if (!row || !row.available || row.audioCleanedAt || row.audioCleanupToken)
        throw new ContentError("withdrawn");
      await tx
        .insert(contentPracticeReference)
        .values({ practiceId, contentVersionId: id })
        .onConflictDoNothing();
      const [existing] = await tx
        .select()
        .from(contentPracticeReference)
        .where(eq(contentPracticeReference.practiceId, practiceId));
      if (existing?.contentVersionId !== id) throw new ContentError("invalid");
      await tx
        .update(contentVersion)
        .set({ unreferencedSince: null })
        .where(eq(contentVersion.id, id));
    },
    async releasePracticeReference(
      id: string,
      practiceId: string,
      tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    ): Promise<void> {
      await tx
        .select()
        .from(contentVersion)
        .where(eq(contentVersion.id, id))
        .for("update");
      const released = await tx
        .delete(contentPracticeReference)
        .where(
          and(
            eq(contentPracticeReference.practiceId, practiceId),
            eq(contentPracticeReference.contentVersionId, id),
          ),
        )
        .returning();
      if (!released.length) return;
      const remaining = await tx
        .select()
        .from(contentPracticeReference)
        .where(eq(contentPracticeReference.contentVersionId, id))
        .limit(1);
      if (!remaining.length)
        await tx
          .update(contentVersion)
          .set({ unreferencedSince: options.now?.() ?? new Date() })
          .where(eq(contentVersion.id, id));
    },
    // Claim under the version lock, then perform bounded cloud I/O outside the transaction.
    // Withdrawal is permanent; a cleanup claim also prevents any future reference acquisition.
    async cleanupAudio(
      limit = 20,
    ): Promise<{ cleaned: number; failed: number }> {
      if (!options.files) throw new ContentError("unavailable");
      const files = options.files;
      const now = options.now?.() ?? new Date();
      const cutoff = new Date(now.getTime() - 30 * 86400_000);
      const candidates = await db
        .select({ id: contentVersion.id })
        .from(contentVersion)
        .where(
          and(
            eq(contentVersion.available, false),
            isNull(contentVersion.audioCleanedAt),
            lte(contentVersion.unreferencedSince, cutoff),
            or(
              isNull(contentVersion.audioCleanupLeaseUntil),
              lte(contentVersion.audioCleanupLeaseUntil, now),
            ),
            sql`${contentVersion.content}->'privateAudio' IS NOT NULL`,
          ),
        )
        .orderBy(
          sql`coalesce(${contentVersion.audioCleanupAttemptedAt}, ${contentVersion.unreferencedSince})`,
          contentVersion.id,
        )
        .limit(Math.min(100, Math.max(1, limit)));
      let cleaned = 0;
      let failed = 0;
      const deadline = Date.now() + 20000;
      for (const candidate of candidates) {
        if (Date.now() >= deadline) break;
        const claim = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(contentVersion)
            .where(eq(contentVersion.id, candidate.id))
            .for("update", { skipLocked: true });
          if (
            !row ||
            row.available ||
            row.audioCleanedAt ||
            !row.unreferencedSince ||
            row.unreferencedSince > cutoff ||
            !row.content.privateAudio ||
            (row.audioCleanupLeaseUntil && row.audioCleanupLeaseUntil > now)
          )
            return null;
          const refs = await tx
            .select()
            .from(contentPracticeReference)
            .where(eq(contentPracticeReference.contentVersionId, row.id))
            .limit(1);
          if (refs.length) return null;
          const token = crypto.randomUUID();
          await tx
            .update(contentVersion)
            .set({
              audioCleanupToken: token,
              audioCleanupAttemptedAt: now,
              audioCleanupLeaseUntil: new Date(now.getTime() + 90_000),
            })
            .where(eq(contentVersion.id, row.id));
          return { token, reference: row.content.privateAudio.reference };
        });
        if (!claim) continue;
        try {
          await files.remove(claim.reference);
          if ((await files.read(claim.reference)) !== null)
            throw new ContentError("unavailable");
          const completedAt = options.now?.() ?? new Date();
          const completed = await db
            .update(contentVersion)
            .set({
              audioCleanedAt: completedAt,
              audioCleanupToken: null,
              audioCleanupLeaseUntil: null,
            })
            .where(
              and(
                eq(contentVersion.id, candidate.id),
                eq(contentVersion.audioCleanupToken, claim.token),
                gt(contentVersion.audioCleanupLeaseUntil, completedAt),
              ),
            )
            .returning({ id: contentVersion.id });
          cleaned += completed.length;
        } catch {
          failed++;
        }
      }
      return { cleaned, failed };
    },
    async listAvailable(): Promise<MaterialSummary[]> {
      const rows = await db
        .selectDistinctOn([contentVersion.materialKey])
        .from(contentVersion)
        .where(publishable())
        .orderBy(contentVersion.materialKey, desc(contentVersion.revision));
      return rows.map((row) => ({
        id: row.id,
        materialKey: row.materialKey,
        revision: row.revision,
        title: row.content.title,
        summary: row.content.summary,
      }));
    },
    // A practice creation transaction holds this exclusive lock until its insert commits.
    // Withdrawal updates the same row and therefore cannot pass a creation in flight.
    async latestAvailable(
      materialKey: string,
      reader: Pick<Database, "select"> = db,
    ): Promise<ContentVersion> {
      const [row] = await reader
        .select()
        .from(contentVersion)
        .where(and(eq(contentVersion.materialKey, materialKey), publishable()))
        .orderBy(desc(contentVersion.revision))
        .limit(1)
        .for("update");
      if (!row) throw new ContentError("unavailable");
      return version(row);
    },
    async availableVersion(
      id: string,
      reader: Pick<Database, "select"> = db,
    ): Promise<ContentVersion> {
      if (!z.uuid().safeParse(id).success)
        throw new ContentError("unavailable");
      const [row] = await reader
        .select()
        .from(contentVersion)
        .where(and(eq(contentVersion.id, id), publishable()))
        .for("update");
      if (!row) throw new ContentError("withdrawn");
      return version(row);
    },
    // Maintenance-only; withdrawn revisions remain immutable and cannot be republished.
    async withdraw(id: string): Promise<void> {
      if (!z.uuid().safeParse(id).success) throw new ContentError("invalid");
      const rows = await db
        .update(contentVersion)
        .set({ available: false })
        .where(eq(contentVersion.id, id))
        .returning({ id: contentVersion.id });
      if (!rows.length) throw new ContentError("unavailable");
    },
    async readVersion(id: string): Promise<ContentVersion> {
      if (!z.uuid().safeParse(id).success)
        throw new ContentError("unavailable");
      const [row] = await db
        .select()
        .from(contentVersion)
        .where(eq(contentVersion.id, id));
      if (!row) throw new ContentError("unavailable");
      return version(row);
    },
  };
}
export type LearningContent = ReturnType<typeof createLearningContent>;
