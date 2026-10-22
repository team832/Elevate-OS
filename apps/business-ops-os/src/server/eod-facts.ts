/**
 * Loads what A-TSK-8 (domain/eod.ts) needs for one staff member and IST day: the tasks they
 * owned or worked on, those tasks' events up to now, their work updates around the day, and the
 * Academic teacher activity for the day (fetchInternal never throws: a failure becomes
 * "Academic OS unavailable"). `factsHash` ignores generation and fetch times, so the report page
 * can say "Source changed since submission" by comparing a fresh build with a submitted version.
 */
import { appOrigin } from '@elevate/configuration/workspaces';
import { createHash } from 'node:crypto';
import { and, between, eq, inArray, lte, or } from 'drizzle-orm';
import {
  opsStaffTasks as tasks,
  opsTaskEvents as events,
  opsTaskUpdates as updates,
  type Database,
} from '@elevate/database';
import { fetchInternal } from '@elevate/server-kit';
import { academicTeacherActivityV1Schema } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { addDays, type IsoDate } from '../domain/dates';
import { buildEodFacts, type EodFacts } from '../domain/eod';

export function fetchTeacherActivity(staffId: string, from: string, to: string) {
  return fetchInternal(
    `${appOrigin('academic')}/academic/api/internal/v1/teachers/${encodeURIComponent(staffId)}/activity?${new URLSearchParams({ from, to })}`,
    academicTeacherActivityV1Schema,
    { caller: 'ops', timeoutMs: 3000 },
  );
}

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
      or(
        inArray(tasks.staffId, ids),
        inArray(tasks.id, [...touched.map((t) => t.id), ...extraTaskIds] as never[]),
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

export async function collectFacts(
  db: Database,
  staffId: string,
  day: string,
  now = new Date(),
): Promise<EodFacts> {
  const near = await db
    .select()
    .from(updates)
    .where(
      and(
        eq(updates.authorStaffId, staffId as StaffMemberId),
        between(updates.occurredOn, addDays(day as IsoDate, -1), addDays(day as IsoDate, 1)),
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
    reportDate: day,
    now,
    tasks: history.tasks,
    events: history.events,
    updates: [...near, ...corrections.filter((c) => !near.some((u) => u.id === c.id))],
    academic: await fetchTeacherActivity(staffId, day, day),
  });
}

/** Hash of the facts without values that change only with time (generation and fetch times,
 * the cut-off on "blocked now" rows, overdue flags, "closed later"), so an unchanged source never
 * reads as "Source changed". Keys are sorted: a snapshot read back from jsonb has its own order. */
export function factsHash(f: EodFacts) {
  const { generatedAt: _g, asOf, academic, backlog, blocked, counts, ...rest } = f;
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
    .update(JSON.stringify({ ...rest, acad, stableCounts, stableBacklog, stableBlocked }, sortKeys))
    .digest('hex');
}
