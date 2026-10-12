import { pgTable, text, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export const mailSendBudget = pgTable(
  "mail_send_budget",
  { key: text("key").primaryKey(), used: integer("used").notNull() },
  (table) => [check("mail_send_budget_positive", sql`${table.used} > 0`)],
);
