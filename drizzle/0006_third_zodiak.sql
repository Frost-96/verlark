CREATE UNIQUE INDEX "confirmed_id_attempt_idx" ON "confirmed_transcript" USING btree ("id","attempt_id");--> statement-breakpoint
CREATE TABLE "expression_feedback" (
	"confirmation_id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"status" text NOT NULL,
	"rules_version" text NOT NULL,
	"request_id" uuid NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"failure" text,
	"result" jsonb,
	"provenance" jsonb,
	"generated_at" timestamp with time zone,
	CONSTRAINT "feedback_status_valid" CHECK ("expression_feedback"."status" in ('processing', 'succeeded', 'failed', 'unknown', 'no-content')),
	CONSTRAINT "feedback_lease_consistent" CHECK (("expression_feedback"."status" = 'processing') = ("expression_feedback"."lease_token" is not null and "expression_feedback"."lease_expires_at" is not null)),
	CONSTRAINT "feedback_result_consistent" CHECK (("expression_feedback"."status" = 'succeeded') = ("expression_feedback"."result" is not null and "expression_feedback"."provenance" is not null and "expression_feedback"."generated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "expression_feedback" ADD CONSTRAINT "expression_feedback_confirmation_id_attempt_id_confirmed_transcript_id_attempt_id_fk" FOREIGN KEY ("confirmation_id","attempt_id") REFERENCES "public"."confirmed_transcript"("id","attempt_id") ON DELETE cascade ON UPDATE no action;
