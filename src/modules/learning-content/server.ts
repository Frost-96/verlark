import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import {
  ContentError,
  type ContentVersion,
  type MaterialSummary,
} from "./contracts";
import { contentVersion } from "./schema";

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
    audioPath: z.string().regex(/^\/audio\/[a-z0-9-]+\.(wav|mp3|m4a)$/),
  })
  .strict();

export function createLearningContent(db: Database) {
  function version(row: typeof contentVersion.$inferSelect): ContentVersion {
    return { ...row.content, id: row.id };
  }
  return {
    // Maintenance-only entry point, never exposed through user HTTP requests.
    async publish(input: unknown): Promise<ContentVersion> {
      const parsed = sourceSchema.safeParse(input);
      if (!parsed.success) throw new ContentError("invalid");
      const source = parsed.data;
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
      if (!row) throw new ContentError("unavailable");
      if (!isDeepStrictEqual(row.content, source))
        throw new ContentError("immutable");
      return version(row);
    },
    async listAvailable(): Promise<MaterialSummary[]> {
      const rows = await db
        .selectDistinctOn([contentVersion.materialKey])
        .from(contentVersion)
        .where(eq(contentVersion.available, true))
        .orderBy(contentVersion.materialKey, desc(contentVersion.revision));
      return rows.map((row) => ({
        id: row.id,
        materialKey: row.materialKey,
        revision: row.revision,
        title: row.content.title,
        summary: row.content.summary,
      }));
    },
    async latestAvailable(materialKey: string): Promise<ContentVersion> {
      const [row] = await db
        .select()
        .from(contentVersion)
        .where(
          and(
            eq(contentVersion.materialKey, materialKey),
            eq(contentVersion.available, true),
          ),
        )
        .orderBy(desc(contentVersion.revision))
        .limit(1);
      if (!row) throw new ContentError("unavailable");
      return version(row);
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
