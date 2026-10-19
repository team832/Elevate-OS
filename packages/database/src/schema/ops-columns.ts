/**
 * OWNER: Business Ops OS team.
 *
 * Column helpers shared by the Ops schema files (ops.ts, ops-hr.ts,
 * ops-lifecycle.ts, ops-time.ts, ops-work.ts). Not a schema file: it is never
 * listed in SCHEMA_MODULES or drizzle.config.ts and exports no tables.
 */
import { sql } from 'drizzle-orm';
import { date, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { staffMembers, users } from './core';

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Calendar day `YYYY-MM-DD` (Asia/Kolkata unless a column says otherwise). */
export const isoDate = (name: string) => date(name, { mode: 'string' });
/** UTC instant. */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
export const staffRef = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'set null' })
    .$type<StaffMemberId>();
/** Staff reference that must never be detached (history rows). */
export const staffRefRestrict = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'restrict' })
    .$type<StaffMemberId>();
export const userRef = (name: string) =>
  uuid(name)
    .references(() => users.id, { onDelete: 'restrict' })
    .$type<UserId>();

/** `IN (...)` list for CHECK constraints built from a readonly tuple. */
export function inList(values: readonly string[]) {
  return sql.raw(`(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`);
}
