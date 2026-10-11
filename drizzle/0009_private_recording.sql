CREATE TABLE "recording_asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"practice_id" uuid NOT NULL,
	"temporary_path" text NOT NULL,
	"final_path" text NOT NULL,
	"requested_media_type" text NOT NULL,
	"media_type" text,
	"digest" text,
	"size" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone NOT NULL,
	"permit_expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"cleanup_after" timestamp with time zone NOT NULL,
	"cleanup_failure" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	CONSTRAINT "recording_asset_temporary_path_unique" UNIQUE("temporary_path"),
	CONSTRAINT "recording_asset_final_path_unique" UNIQUE("final_path"),
	CONSTRAINT "recording_asset_size_valid" CHECK ("recording_asset"."size" is null or ("recording_asset"."size" > 0 and "recording_asset"."size" <= 8388608)),
	CONSTRAINT "recording_asset_ready_consistent" CHECK (("recording_asset"."digest" is null and "recording_asset"."size" is null and "recording_asset"."media_type" is null and "recording_asset"."duration_ms" is null) or ("recording_asset"."digest" is not null and "recording_asset"."size" is not null and "recording_asset"."media_type" is not null and "recording_asset"."duration_ms" > 0 and "recording_asset"."duration_ms" <= 120000))
);
--> statement-breakpoint
CREATE TABLE "recording_maintenance" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_completed_scan_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "recording_asset_scope_idx" ON "recording_asset" USING btree ("practice_id","learner_id");--> statement-breakpoint
CREATE INDEX "recording_asset_cleanup_idx" ON "recording_asset" USING btree ("cleanup_after","id");