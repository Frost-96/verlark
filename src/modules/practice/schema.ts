import {
  integer,
  jsonb,
  foreignKey,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { FeedbackResult } from "./contracts";
// Schema-level references define database integrity, not cross-module business queries.
import { user } from "../identity/schema";
import { contentVersion } from "../learning-content/schema";

export const practiceRecord = pgTable(
  "practice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().defaultRandom(),
    // Request identity only: deleting the original must not delete an independent repeat.
    repeatOfId: uuid("repeat_of_id"),
    learnerId: text("learner_id")
      .notNull()
      .references(() => user.id),
    contentVersionId: uuid("content_version_id")
      .notNull()
      .references(() => contentVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    identificationStatus: text("identification_status", {
      enum: [
        "pending-identification",
        "processing",
        "recognized",
        "failed",
        "unknown",
        "no-content",
      ],
    })
      .notNull()
      .default("pending-identification"),
    identificationFailure: text("identification_failure"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    rawTranscriptId: uuid("raw_transcript_id").unique(),
    rawTranscriptText: text("raw_transcript_text"),
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

export const confirmedTranscript = pgTable(
  "confirmed_transcript",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attemptRecord.id, { onDelete: "cascade" }),
    rawTranscriptId: uuid("raw_transcript_id")
      .notNull()
      .references(() => attemptRecord.rawTranscriptId),
    revision: integer("revision").notNull(),
    text: text("text").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("confirmed_id_attempt_idx").on(table.id, table.attemptId),
    uniqueIndex("confirmed_attempt_revision_idx").on(
      table.attemptId,
      table.revision,
    ),
  ],
);

export const expressionFeedback = pgTable(
  "expression_feedback",
  {
    confirmationId: uuid("confirmation_id").primaryKey(),
    attemptId: uuid("attempt_id").notNull(),
    status: text("status", {
      enum: ["processing", "succeeded", "failed", "unknown", "no-content"],
    }).notNull(),
    rulesVersion: text("rules_version").notNull(),
    requestId: uuid("request_id").notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    failure: text("failure"),
    result: jsonb("result").$type<FeedbackResult>(),
    provenance: jsonb("provenance").$type<{
      provider: string;
      model: string;
    }>(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.confirmationId, table.attemptId],
      foreignColumns: [confirmedTranscript.id, confirmedTranscript.attemptId],
    }).onDelete("cascade"),
    check(
      "feedback_status_valid",
      sql`${table.status} in ('processing', 'succeeded', 'failed', 'unknown', 'no-content')`,
    ),
    check(
      "feedback_lease_consistent",
      sql`(${table.status} = 'processing') = (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
    check(
      "feedback_result_consistent",
      sql`(${table.status} = 'succeeded') = (${table.result} is not null and ${table.provenance} is not null and ${table.generatedAt} is not null)`,
    ),
  ],
);

// Kept separately from learning data so cleanup remains visible after deletion.
export const practiceDeletion = pgTable("practice_deletion", {
  practiceId: uuid("practice_id")
    .primaryKey()
    .references(() => practiceRecord.id),
  status: text("status", {
    enum: ["pending", "processing", "succeeded", "failed"],
  })
    .notNull()
    .default("pending"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  failure: text("failure"),
});

// No learner text/audio; independent lifetime keeps unknown costs after deletion.
export const recognitionCall = pgTable(
  "recognition_call",
  {
    id: uuid("id").primaryKey(),
    budgetKey: text("budget_key").notNull(),
    attemptId: uuid("attempt_id").references(() => attemptRecord.id, {
      onDelete: "set null",
    }),
    fingerprint: text("fingerprint").notNull(),
    model: text("model").notNull(),
    reservedSeconds: integer("reserved_seconds").notNull(),
    status: text("status", {
      enum: ["reserved", "settled", "unknown", "not-dispatched"],
    }).notNull(),
    providerRequestId: text("provider_request_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciliationEvidence: text("reconciliation_evidence"),
  },
  (table) => [
    index("recognition_budget_idx").on(table.budgetKey),
    check(
      "recognition_reservation_nonnegative",
      sql`${table.reservedSeconds} >= 0`,
    ),
  ],
);
