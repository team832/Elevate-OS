import { sql } from 'drizzle-orm';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import type { Database } from '../client';

/**
 * After a seed writes core.staff_members.department_id / manager_id, make the open rows of
 * ops.staff_departments (primary) and ops.staff_manager_history match them: an open row that
 * no longer matches is closed today (IST) and the current value opens from that day (start not
 * recorded on a first row). No current value = no open row. Idempotent.
 */
export async function syncStaffHistory(db: Database, staffIds: StaffMemberId[], by: UserId) {
  if (!staffIds.length) return;
  const ids = sql.join(
    staffIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const from = (table: string) =>
    sql.raw(`(SELECT max(to_date) FROM ${table} p WHERE p.staff_id = m.id)`);
  const histories = [
    {
      table: 'ops.staff_departments',
      kept: 'department_id',
      current: 'department_id',
      open: 'h.is_primary AND h.to_date IS NULL',
      insert: sql`(staff_id, department_id, is_primary, from_date, created_by)
        SELECT m.id, m.department_id, true, ${from('ops.staff_departments')}, ${by}`,
    },
    {
      table: 'ops.staff_manager_history',
      kept: 'manager_staff_id',
      current: 'manager_id',
      open: 'h.to_date IS NULL',
      insert: sql`(staff_id, manager_staff_id, from_date, changed_by, reason)
        SELECT m.id, m.manager_id, ${from('ops.staff_manager_history')}, ${by}, 'Seed data'`,
    },
  ];
  for (const { table, kept, current, open, insert } of histories) {
    const [t, o] = [sql.raw(table), sql.raw(open)];
    await db.execute(sql`UPDATE ${t} h SET to_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      FROM core.staff_members m WHERE m.id = h.staff_id AND m.id IN (${ids}) AND ${o}
        AND h.${sql.raw(kept)} IS DISTINCT FROM m.${sql.raw(current)}`);
    await db.execute(sql`INSERT INTO ${t} ${insert} FROM core.staff_members m
      WHERE m.id IN (${ids}) AND m.${sql.raw(current)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${t} h WHERE h.staff_id = m.id AND ${o})`);
  }
}
