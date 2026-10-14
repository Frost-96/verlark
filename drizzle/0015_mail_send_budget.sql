-- Earlier PR Preview databases already contain this exact table; retain rows and budget.
CREATE TABLE IF NOT EXISTS "mail_send_budget" (
 "key" text PRIMARY KEY NOT NULL,
 "used" integer NOT NULL,
 CONSTRAINT "mail_send_budget_positive" CHECK ("used" > 0)
);
