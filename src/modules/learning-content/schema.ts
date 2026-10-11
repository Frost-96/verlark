import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  timestamp,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ContentSource } from "./contracts";

export const contentVersion = pgTable(
  "learning_content_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialKey: text("material_key").notNull(),
    revision: integer("revision").notNull(),
    available: boolean("available").notNull().default(true),
    unreferencedSince: timestamp("unreferenced_since", {
      withTimezone: true,
    }).defaultNow(),
    audioCleanupToken: uuid("audio_cleanup_token"),
    audioCleanupLeaseUntil: timestamp("audio_cleanup_lease_until", {
      withTimezone: true,
    }),
    audioCleanedAt: timestamp("audio_cleaned_at", { withTimezone: true }),
    content: jsonb("content").$type<ContentSource>().notNull(),
  },
  (table) => [
    uniqueIndex("content_private_audio_reference_idx").on(
      sql`(${table.content}->'privateAudio'->>'reference')`,
    ),
    uniqueIndex("content_material_revision_idx").on(
      table.materialKey,
      table.revision,
    ),
  ],
);

// References are maintained through the public content seam in practice transactions.
export const contentPracticeReference = pgTable(
  "learning_content_practice_reference",
  {
    practiceId: uuid("practice_id").primaryKey(),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => contentVersion.id),
  },
  (table) => [
    index("content_reference_version_idx").on(table.contentVersionId),
  ],
);
