CREATE TABLE "practice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" text NOT NULL,
	"content_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_learner_id_identity_user_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."identity_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice" ADD CONSTRAINT "practice_content_version_id_learning_content_version_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."learning_content_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_learner_created_idx" ON "practice" USING btree ("learner_id","created_at");