import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Technical upload inventory survives deletion of the learning records.
export const recordingAsset = pgTable(
  "recording_asset",
  {
    id: uuid("id").primaryKey(),
    learnerId: text("learner_id").notNull(),
    practiceId: uuid("practice_id").notNull(),
    temporaryPath: text("temporary_path").notNull().unique(),
    finalPath: text("final_path").notNull().unique(),
    requestedMediaType: text("requested_media_type").notNull(),
    mediaType: text("media_type"),
    digest: text("digest"),
    size: integer("size"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    permitExpiresAt: timestamp("permit_expires_at", {
      withTimezone: true,
    }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sealed: boolean("sealed").notNull().default(false),
    cleanupAfter: timestamp("cleanup_after", { withTimezone: true }).notNull(),
    cleanupFailure: text("cleanup_failure"),
    knownObjectsAbsentAt: timestamp("known_objects_absent_at", {
      withTimezone: true,
    }),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  },
  (table) => [
    index("recording_asset_scope_idx").on(table.practiceId, table.learnerId),
    index("recording_asset_cleanup_idx").on(table.cleanupAfter, table.id),
    check(
      "recording_asset_size_valid",
      sql`${table.size} is null or (${table.size} > 0 and ${table.size} <= 8388608)`,
    ),
    check(
      "recording_asset_ready_consistent",
      sql`(${table.digest} is null and ${table.size} is null and ${table.mediaType} is null and ${table.durationMs} is null) or (${table.digest} is not null and ${table.size} is not null and ${table.mediaType} is not null and ${table.durationMs} > 0 and ${table.durationMs} <= 120000)`,
    ),
  ],
);

export const recordingMaintenance = pgTable("recording_maintenance", {
  id: integer("id").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
  lastCompletedScanAt: timestamp("last_completed_scan_at", {
    withTimezone: true,
  }),
});
