/**
 * OWNER: Marketing OS team.
 *
 * The `marketing` Postgres schema object and the column helpers shared by marketing.ts and
 * marketing-planning.ts, so those files can import each other's tables lazily (FK callbacks)
 * without a load-order cycle. Not a schema file: it exports no tables and is never listed in
 * SCHEMA_MODULES or drizzle.config.ts.
 */
import { sql } from 'drizzle-orm';
import { pgSchema, timestamp } from 'drizzle-orm/pg-core';

export const marketing = pgSchema('marketing');

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** `col IN ('a', 'b')` for a literal list (values are compile-time constants, never user input). */
export const inList = (values: readonly string[]) =>
  sql.raw(`(${values.map((v) => `'${v}'`).join(', ')})`);
