import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  check,
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
