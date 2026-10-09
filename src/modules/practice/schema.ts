import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Schema-level references define database integrity, not cross-module business queries.
import { user } from "../identity/schema";
import { contentVersion } from "../learning-content/schema";

export const practiceRecord = pgTable(
  "practice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    index("practice_learner_created_idx").on(table.learnerId, table.createdAt),
  ],
);
