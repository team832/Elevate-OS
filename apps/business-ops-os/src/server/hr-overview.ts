/**
 * HR Overview (brief 23 Oct 2026 §6): decision counts, each linking to the filtered source
 * list. Every area answers for its own counts (fixed interface, PLAN.md): tasks, attendance,
 * work reports and student feedback. An area that fails says "Source unavailable"; an area the
 * reader may not see is left out. Staff workload is open tasks per person, listed by name —
 * never a ranking (R13). Tasks always have one accountable assignee (ops.staff_tasks.staff_id is
 * required), so there is no "unassigned work" count to show.
 */
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { scopeFor } from '@elevate/authorization';
import { opsStaffProfiles, opsStaffTasks, staffMembers, type Database } from '@elevate/database';
import { AppError } from '@elevate/shared-contracts';
import { accessScope, type Actor } from './context';
import { hrReachWhere, hrScopeFor } from './organisation';

export type HrCount = { key: string; label: string; value: number | null; href: string };
type Provider = (db: Database, user: Actor) => Promise<HrCount[]>;

/** [area, provider loaded on use]: each area owns its file (PLAN.md fixed interfaces). */
const PROVIDERS: readonly [string, () => Promise<Provider>][] = [
  ['Tasks and submissions', async () => (await import('./staff-tasks-hr')).hrTaskCounts],
  ['Attendance', async () => (await import('./attendance-hr')).hrAttendanceCounts],
  ['Work reports', async () => (await import('./work-reports-hr')).hrReportCounts],
  ['Student feedback about teachers', async () => (await import('./feedback-hr')).hrFeedbackCounts],
];

export type HrArea = { area: string } & (
  { status: 'available'; counts: HrCount[] } | { status: 'unavailable' }
);

export async function hrDecisionCounts(db: Database, actor: Actor): Promise<HrArea[]> {
  await accessScope(db, actor, 'ops:hr:read');
  const areas = await Promise.all(
    PROVIDERS.map(async ([area, load]): Promise<HrArea | null> => {
      try {
        return { area, status: 'available', counts: await (await load())(db, actor) };
      } catch (error) {
        if (error instanceof AppError && error.status === 403) return null;
        console.error('hr overview area failed', area, error);
        return { area, status: 'unavailable' };
      }
    }),
  );
  return areas.filter((a): a is HrArea => a !== null);
}

const OPEN = ['pending', 'in_progress', 'in_review', 'changes_requested'] as const;
const WORKLOAD_PAGE = 25;

/**
 * Open tasks per active staff member in HR's scope, by name (25 a page). null when the reader
 * may not see everyone's tasks (their task access is limited to their team).
 */
export async function staffWorkload(db: Database, actor: Actor, page = 1) {
  await accessScope(db, actor, 'ops:hr:read');
  if (scopeFor(actor, 'ops:tasks:read') !== 'all') return null;
  const where = and(
    eq(staffMembers.status, 'active'),
    hrReachWhere(actor, await hrScopeFor(db, actor)),
  );
  const [people, [counted]] = await Promise.all([
    db
      .select({
        id: staffMembers.id,
        name: sql<string>`coalesce(${opsStaffProfiles.displayName}, ${staffMembers.fullName})`,
      })
      .from(staffMembers)
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
      .where(where)
      .orderBy(asc(staffMembers.fullName), asc(staffMembers.id))
      .limit(WORKLOAD_PAGE)
      .offset((page - 1) * WORKLOAD_PAGE),
    db.select({ n: count() }).from(staffMembers).where(where),
  ]);
  const ids = people.map((p) => p.id);
  const tasks = ids.length
    ? await db
        .select({
          staffId: opsStaffTasks.staffId,
          open: count(),
          submitted:
            sql<number>`count(*) filter (where ${opsStaffTasks.status} = 'in_review')`.mapWith(
              Number,
            ),
        })
        .from(opsStaffTasks)
        .where(and(inArray(opsStaffTasks.staffId, ids), inArray(opsStaffTasks.status, [...OPEN])))
        .groupBy(opsStaffTasks.staffId)
    : [];
  return {
    page,
    pageSize: WORKLOAD_PAGE,
    total: counted?.n ?? 0,
    rows: people.map((p) => {
      const t = tasks.find((x) => x.staffId === p.id);
      return { ...p, open: t?.open ?? 0, submitted: t?.submitted ?? 0 };
    }),
  };
}
