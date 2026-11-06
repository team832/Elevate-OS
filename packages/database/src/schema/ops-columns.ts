/**
 * OWNER: Business Ops OS team.
 *
 * Column helpers shared by the Ops schema files (ops.ts, ops-*.ts), and the `ops` Postgres schema
 * object itself (re-exported by ops.ts), so files in an import cycle with ops.ts
 * (ops-applications.ts, ops-demos.ts) can define tables before ops.ts has run. Not a schema
 * file: it is never listed in SCHEMA_MODULES or drizzle.config.ts and exports no tables.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  numeric,
  pgSchema,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { StaffMemberId, StudentIdentityId, UserId } from '@elevate/shared-types';
import { staffMembers, students, users } from './core';

export const ops = pgSchema('ops');

/** UTC instant. */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => instant('created_at').notNull().defaultNow();
export const updatedAt = () =>
  instant('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Calendar day `YYYY-MM-DD` (Asia/Kolkata unless a column says otherwise). */
export const isoDate = (name: string) => date(name, { mode: 'string' });
export const userRef = (name: string) =>
  uuid(name)
    .references(() => users.id, { onDelete: 'restrict' })
    .$type<UserId>();
export const staffRef = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'set null' })
    .$type<StaffMemberId>();
/** Staff reference that must never be detached (history, classes, meetings). */
export const staffRefRestrict = (name: string) =>
  uuid(name)
    .references(() => staffMembers.id, { onDelete: 'restrict' })
    .$type<StaffMemberId>();
/** The canonical student (core.students). */
export const studentRef = (name = 'student_id') =>
  uuid(name)
    .references(() => students.id, { onDelete: 'restrict' })
    .$type<StudentIdentityId>();

/** Decision state of a policy value (PLT-007); re-exported by ops.ts. */
export const OPS_DECISION_STATES = [
  'proposed',
  'approved',
  'locked',
  'open',
  'pending_verification',
  'superseded',
] as const;

/** Integer paise (INR); amounts carry a `> 0` CHECK. */
export const paise = (name: string) => bigint(name, { mode: 'number' });
/** Day count in half-day steps (leave, loss of pay): exact numeric(5,1). */
export const dayCount = (name: string) => numeric(name, { precision: 5, scale: 1, mode: 'number' });
/** CHECK fragment: a whole or half number of days. */
export const halfDays = (column: AnyPgColumn) => sql`${column} * 2 = trunc(${column} * 2)`;
/** CHECK fragment: a lower snake-case key (template items, codes). */
export const keyFormat = (column: AnyPgColumn) => sql`${column} ~ '^[a-z][a-z0-9_]{1,59}$'`;

/** CHECK fragment: the text column holds something other than blanks. */
export const filled = (column: AnyPgColumn) => sql`length(trim(coalesce(${column}, ''))) > 0`;

/** `IN (...)` list for CHECK constraints built from a readonly tuple. */
export function inList(values: readonly string[]) {
  return sql.raw(`(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`);
}
