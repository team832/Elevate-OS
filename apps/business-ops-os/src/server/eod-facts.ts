/**
 * Loads what A-TSK-8 (domain/eod.ts) needs for one staff member and IST period: the tasks they
 * owned or worked on, those tasks' events up to now, their work updates around the period, the
 * Academic teacher activity for the period (fetchInternal never throws: a failure becomes
 * "Academic OS unavailable") and, for a month, HR attendance and agreed development actions.
 * `factsHash` ignores values that change only with time, so the report page can say "Source
 * changed since submission" by comparing a fresh build with a submitted version.
 */
import { createHash } from 'node:crypto';
import { and, between, eq, gte, inArray, lte, ne, or } from 'drizzle-orm';
import {
  opsStaffTasks as tasks,
  opsTaskEvents as events,
  opsTaskUpdates as updates,
  opsTeacherDevelopmentActions as actions,
  opsTeacherFeedbackSummaries as summaries,
  type Database,
} from '@elevate/database';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, istInstant, istToday } from '../domain/dates';
import { buildEodFacts, type AttendanceFacts, type EodFacts } from '../domain/eod';
import type { Period } from '../domain/work-report';
import { fetchTeacherActivity } from './academic-summary';
import { attendanceSummary } from './attendance';
import { sharedWithTeacher } from './feedback-teacher';

/** Tasks a staff member owns or owned, with their events up to `now` (for replaying state). */
export async function taskHistory(
  db: Database,
  staffIds: readonly string[],
  now: Date,
  extraTaskIds: readonly string[] = [],
) {
  const ids = staffIds as StaffMemberId[];
  const touched = await db
    .selectDistinct({ id: events.taskId })
    .from(events)
    .where(or(inArray(events.toStaffId, ids), inArray(events.fromStaffId, ids)));
  const taskRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        // A task still in draft has not reached anyone (its history replays it as a draft too).
        ne(tasks.status, 'draft'),
        or(
          inArray(tasks.staffId, ids),
          inArray(tasks.id, [...touched.map((t) => t.id), ...extraTaskIds] as never[]),
        ),
      ),
    );
  const eventRows = taskRows.length
    ? await db
        .select()
        .from(events)
        .where(
          and(
            inArray(
              events.taskId,
              taskRows.map((t) => t.id),
            ),
            lte(events.occurredAt, now),
          ),
        )
    : [];
  return { tasks: taskRows, events: eventRows };
}

/** HR attendance for the period up to today (a failure reads "Source unavailable", never 0). */
async function periodAttendance(
  db: Database,
  staffId: string,
  p: Period,
  now: Date,
): Promise<AttendanceFacts> {
  const today = istToday(now);
  try {
    const s = await attendanceSummary(db, staffId, p.start, p.end < today ? p.end : today);
    return { status: 'available', ...s };
  } catch (error) {
    console.error('work report attendance failed', error);
    return { status: 'unavailable', reason: 'HR attendance could not be read' };
  }
}

/** Development actions agreed with the staff member that were open or changed in the period. */
const developmentActions = (db: Database, staffId: string, p: Period) =>
  db
    .select({ action: actions.action, dueOn: actions.dueOn, status: actions.status })
    .from(actions)
    .leftJoin(summaries, eq(summaries.id, actions.summaryId))
    .where(
      and(
        eq(actions.teacherStaffId, staffId as StaffMemberId),
        sharedWithTeacher,
        or(eq(actions.status, 'open'), gte(actions.updatedAt, istInstant(p.start))),
      ),
    )
    .orderBy(actions.dueOn);

export async function collectFacts(
  db: Database,
  staffId: string,
  p: Period,
  now = new Date(),
): Promise<EodFacts> {
  const near = await db
    .select()
    .from(updates)
    .where(
      and(
        eq(updates.authorStaffId, staffId as StaffMemberId),
        between(updates.occurredOn, addDays(p.start, -1), addDays(p.end, 1)),
      ),
    );
  const corrections = near.length
    ? await db
        .select()
        .from(updates)
        .where(
          inArray(
            updates.correctsUpdateId,
            near.map((u) => u.id),
          ),
        )
    : [];
  const history = await taskHistory(
    db,
    [staffId],
    now,
    near.map((u) => u.taskId),
  );
  return buildEodFacts({
    staffId,
    reportDate: p.start,
    periodKind: p.kind,
    periodEnd: p.end,
    now,
    tasks: history.tasks,
    events: history.events,
    updates: [...near, ...corrections.filter((c) => !near.some((u) => u.id === c.id))],
    academic: await fetchTeacherActivity(staffId, { from: p.start, to: p.end }),
    attendance: await periodAttendance(db, staffId, p, now),
    ...(p.kind === 'month' ? { development: await developmentActions(db, staffId, p) } : {}),
  });
}

/** Hash of the facts without values that change only with time (generation and fetch times,
 * the cut-off on "blocked now" rows, overdue flags, "closed later", whether a not-yet-submitted
 * task is still before its deadline), so an unchanged source never reads as "Source changed".
 * Keys are sorted: a snapshot read back from jsonb has its own order. */
export function factsHash(f: EodFacts) {
  const {
    generatedAt: _g,
    deadline: _d,
    asOf,
    academic,
    backlog,
    blocked,
    counts,
    timeliness,
    ...rest
  } = f;
  const { checkedAt: _c, ...acad } = academic;
  const { overdue: _o, ...stableCounts } = counts;
  const stableBacklog = backlog.map(({ overdue: _v, closedLater: _l, ...b }) => b);
  const stableBlocked = blocked.map(({ at, ...b }) => (at === asOf ? b : { at, ...b }));
  const sortKeys = (_k: string, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v;
  return createHash('sha256')
    .update(
      JSON.stringify(
        { ...rest, acad, stableCounts, stableBacklog, stableBlocked, due: timeliness?.rows.length },
        sortKeys,
      ),
    )
    .digest('hex');
}
