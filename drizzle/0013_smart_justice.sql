CREATE TABLE "recognition_call" (
	"id" uuid PRIMARY KEY NOT NULL,
	"budget_key" text NOT NULL,
	"attempt_id" uuid,
	"fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"reserved_seconds" integer NOT NULL,
	"status" text NOT NULL,
	"provider_request_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"reconciled_at" timestamp with time zone,
	"reconciliation_evidence" text,
	CONSTRAINT "recognition_reservation_nonnegative" CHECK ("recognition_call"."reserved_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recognition_call" ADD CONSTRAINT "recognition_call_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recognition_budget_idx" ON "recognition_call" USING btree ("budget_key");