CREATE TABLE "learning_content_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_key" text NOT NULL,
	"revision" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_material_revision_idx" ON "learning_content_version" USING btree ("material_key","revision");