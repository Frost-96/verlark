import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ContentSource } from "./contracts";

export const contentVersion = pgTable(
  "learning_content_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    materialKey: text("material_key").notNull(),
    revision: integer("revision").notNull(),
    available: boolean("available").notNull().default(true),
    content: jsonb("content").$type<ContentSource>().notNull(),
  },
  (table) => [
    uniqueIndex("content_material_revision_idx").on(
      table.materialKey,
      table.revision,
    ),
  ],
);
