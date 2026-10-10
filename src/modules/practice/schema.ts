import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Schema-level references define database integrity, not cross-module business queries.
import { user } from "../identity/schema";
import { contentVersion } from "../learning-content/schema";

export const practiceRecord = pgTable(
  "practice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().defaultRandom(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => user.id),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => contentVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("practice_learner_request_idx").on(
      table.learnerId,
      table.requestId,
    ),
    index("practice_learner_created_idx").on(table.learnerId, table.createdAt),
  ],
);

export const attemptRecord = pgTable(
  "attempt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practiceRecord.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").notNull(),
    recordingReference: text("recording_reference").notNull(),
    recordingDigest: text("recording_digest").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("attempt_practice_submission_idx").on(
      table.practiceId,
      table.submissionId,
    ),
  ],
);
