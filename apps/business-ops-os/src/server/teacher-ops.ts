/**
 * Teacher operations facts (owner brief 2 §7, §8, §17): each fact comes from its own source and
 * is never substituted for another. Staff attendance is HR's (HR → Attendance), never inferred
 * from this. Class delivery and teaching logs come from Academic OS (A2's
 * activity contract; "Academic OS unavailable" when it cannot be read). Tasks and EOD reports are
 * Ops' own rows, shown only to readers whose ops:tasks:read covers the teacher: all, or own =
 * yourself and the staff who report to you (R3; EOD history of a report = those submitted to you).
 * Nothing here rates a teacher.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { opsEodReports, opsStaffTasks, type Database } from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { istToday } from '../domain';
import { WORK_STATUSES, type TaskStatus } from '../domain/staff-tasks';
import { fetchTeacherActivity } from './academic-summary';
import { accessScope, managedStaffIds, staffIdForUser, type Actor } from './context';
import { isHrScoped } from './organisation';
import { hrScopeStaff } from './task-access';
import { overdueSql } from './task-list';

/** Staff whose tasks and EOD reports this reader may see: 'all', a set, or null (no access). */
export async function tasksReach(db: Database, actor: Actor) {
  if (!can(actor, 'ops:tasks:read')) return null;
  const access = await accessScope(db, actor, 'ops:tasks:read');
  if (access.scope === 'all') {
    // HR's department scope (task-access), never hiding the reader's own record.
    const scope = isHrScoped(actor) ? await hrScopeStaff(db) : null;
    const self = scope && (await staffIdForUser(db, actor.id));
    if (self) scope!.add(self);
    return { all: true as const, self: null, scope };
  }
  if (!access.staffId) return { all: false as const, self: null, ids: new Set<string>() };
  return {
    all: false as const,
    self: access.staffId,
    ids: new Set<string>([access.staffId, ...(await managedStaffIds(db, access.staffId))]),
  };
}
export type TasksReach = Awaited<ReturnType<typeof tasksReach>>;
const reaches = (reach: TasksReach, staffId: string) =>
  Boolean(reach && (reach.all ? !reach.scope || reach.scope.has(staffId) : reach.ids.has(staffId)));

/** Open work (assigned, in progress, changes requested) and overdue tasks (R5), and today's EOD status, per reachable staff id. */
export async function taskFacts(
  db: Database,
  reach: TasksReach,
  staffIds: readonly string[],
  now = new Date(),
) {
  const ids = staffIds.filter((id) => reaches(reach, id)) as StaffMemberId[];
  const today = istToday(now);
  const [tasks, eods] = ids.length
    ? await Promise.all([
        db
          .select({
            staffId: opsStaffTasks.staffId,
            open: sql<number>`count(*)`.mapWith(Number),
            // The shared rules (R5): open = still with the teacher; overdue past the deadline in force.
            overdue: sql<number>`count(*) filter (where ${overdueSql(now)})`.mapWith(Number),
          })
          .from(opsStaffTasks)
          .where(
            and(
              inArray(opsStaffTasks.staffId, ids),
              inArray(opsStaffTasks.status, WORK_STATUSES as TaskStatus[]),
            ),
          )
          .groupBy(opsStaffTasks.staffId),
        db
          .select({ staffId: opsEodReports.staffId, status: opsEodReports.status })
          .from(opsEodReports)
          .where(and(inArray(opsEodReports.staffId, ids), eq(opsEodReports.reportDate, today))),
      ])
    : [[], []];
  return new Map(
    ids.map((id) => {
      const t = tasks.find((x) => x.staffId === id);
      return [
        id as string,
        {
          open: t?.open ?? 0,
          overdue: t?.overdue ?? 0,
          eodToday: eods.find((e) => e.staffId === id)?.status ?? ('not_started' as const),
        },
      ];
    }),
  );
}

/** Recent EOD reports of one teacher the reader may see (R3: a manager sees those sent to them). */
export async function eodHistory(db: Database, reach: TasksReach, staffId: string) {
  if (!reaches(reach, staffId)) return null;
  const sentToMe = reach && !reach.all && reach.self !== staffId ? reach.self : null;
  return db
    .select({
      id: opsEodReports.id,
      reportDate: opsEodReports.reportDate,
      status: opsEodReports.status,
      submittedAt: opsEodReports.submittedAt,
      reviewedAt: opsEodReports.reviewedAt,
    })
    .from(opsEodReports)
    .where(
      and(
        eq(opsEodReports.staffId, staffId as StaffMemberId),
        sentToMe ? eq(opsEodReports.submittedToStaffId, sentToMe) : undefined,
      ),
    )
    .orderBy(desc(opsEodReports.reportDate))
    .limit(10);
}

/**
 * Academic activity per teacher for an IST window (one call each; failures stay per teacher).
 * shortcut: one Academic request per teacher on the directory (fine for ~12–50 teachers); add a
 * batched activity route in Academic if the directory grows.
 */
export async function academicActivity(
  staffIds: readonly string[],
  window: { from: string; to: string },
) {
  const results = await Promise.all(staffIds.map((id) => fetchTeacherActivity(id, window)));
  return new Map(staffIds.map((id, i) => [id, results[i]!]));
}
