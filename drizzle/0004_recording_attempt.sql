CREATE TABLE "attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"recording_reference" text NOT NULL,
	"recording_digest" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_practice_id_practice_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_practice_submission_idx" ON "attempt" USING btree ("practice_id","submission_id");