CREATE TABLE "feedback_trial_request" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"trial_id" text NOT NULL,
	"content_version_id" uuid NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_trial_request" ADD CONSTRAINT "feedback_trial_request_request_id_feedback_provider_request_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feedback_provider_request"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_trial_content_idx" ON "feedback_trial_request" USING btree ("trial_id","content_version_id");