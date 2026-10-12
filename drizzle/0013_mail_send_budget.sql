CREATE TABLE "mail_send_budget" (
 "key" text PRIMARY KEY NOT NULL,
 "used" integer NOT NULL,
 CONSTRAINT "mail_send_budget_positive" CHECK ("used" > 0)
);
