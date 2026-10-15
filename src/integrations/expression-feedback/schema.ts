import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
// Minimal technical accounting survives deletion; contains no learner text or key.
export const feedbackProviderRequest = pgTable(
  "feedback_provider_request",
  {
    requestId: uuid("request_id").primaryKey(),
    confirmationId: uuid("confirmation_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    model: text("model").notNull(),
    rulesVersion: text("rules_version").notNull(),
    reservedTokens: integer("reserved_tokens").notNull(),
    observedTokens: integer("observed_tokens"),
    providerId: text("provider_id"),
    state: text("state").notNull().default("unknown"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "feedback_provider_request_reserved_tokens_check",
      sql`${t.reservedTokens} > 0`,
    ),
    check(
      "feedback_provider_request_observed_tokens_check",
      sql`${t.observedTokens} >= 0`,
    ),
    check(
      "feedback_provider_request_state_check",
      sql`${t.state} in ('unknown','responded')`,
    ),
  ],
);

// No text, audio or account identifier. Retained when a practice is deleted.
export const feedbackTrialRequest = pgTable(
  "feedback_trial_request",
  {
    requestId: uuid("request_id")
      .primaryKey()
      .references(() => feedbackProviderRequest.requestId),
    trialId: text("trial_id").notNull(),
    contentVersionId: uuid("content_version_id").notNull(),
    accepted: boolean("accepted").notNull().default(false),
  },
  (t) => [
    uniqueIndex("feedback_trial_content_idx").on(t.trialId, t.contentVersionId),
  ],
);
