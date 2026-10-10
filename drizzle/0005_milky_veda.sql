CREATE TABLE "confirmed_transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"raw_transcript_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"text" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "identification_status" text DEFAULT 'pending-identification' NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "identification_failure" text;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "raw_transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "raw_transcript_text" text;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_raw_transcript_id_unique" UNIQUE("raw_transcript_id");
--> statement-breakpoint
ALTER TABLE "confirmed_transcript" ADD CONSTRAINT "confirmed_transcript_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_transcript" ADD CONSTRAINT "confirmed_transcript_raw_transcript_id_attempt_raw_transcript_id_fk" FOREIGN KEY ("raw_transcript_id") REFERENCES "public"."attempt"("raw_transcript_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "confirmed_attempt_revision_idx" ON "confirmed_transcript" USING btree ("attempt_id","revision");--> statement-breakpoint
