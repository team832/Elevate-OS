/**
 * OWNER: Business Ops OS team.
 *
 * Column helpers shared by the Ops schema files (ops.ts, ops-*.ts), and the `ops` Postgres schema
 * object itself (re-exported by ops.ts), so files in an import cycle with ops.ts
 * (ops-applications.ts, ops-demos.ts) can define tables before ops.ts has run. Not a schema
 * file: it is never listed in SCHEMA_MODULES or drizzle.config.ts and exports no tables.
 */
import { sql } from 'drizzle-orm';
import { date, pgSchema, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
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

/** CHECK fragment: the text column holds something other than blanks. */
export const filled = (column: AnyPgColumn) => sql`length(trim(coalesce(${column}, ''))) > 0`;

/** `IN (...)` list for CHECK constraints built from a readonly tuple. */
export function inList(values: readonly string[]) {
  return sql.raw(`(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})`);
}
