/**
 * Calendar (F4-08), read only: the viewer's Academic items for a range of IST days, each read
 * with the permission and scope of the page that owns it. Classes (Timetable: a teacher's own),
 * dated tests (Tests: own assignments), dated closures (centre-wide and batches in scope),
 * unavailability and approved HR leave (Teachers: a teacher's own records only), and, from the
 * shared Ops entry (D-073), the viewer's own open tasks due and meetings.
 */
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { academicAssessments as A, academicBatches, type Database } from '@elevate/database';
import { listMyMeetings, listTasks, taskListQuery } from '@elevate/business-ops-os/work';
import { calendarCut, type CalendarItem } from '@elevate/shared-ui';
import type { IsoDate } from '@elevate/shared-types';
import { assessmentInScope, resolveScope, type Actor } from '../context';
import { MODULE_PATHS } from '../paths';
import { batchCodes } from './assessments';
import { listExclusions } from './batches';
import { listSessions } from './timetable';
import { listUnavailability } from './unavailability';

type Range = { from: IsoDate; to: IsoDate };
// shortcut: up to 500 tasks and meetings per month; a full list says "first 500 of N" on the page.
const MAX = 500;
/** timetable.ts sessionRows stops at this many classes. */
const CLASS_LIMIT = 1000;
const ist = (day: string, time: string) => new Date(`${day}T${time.slice(0, 5)}:00+05:30`);
const inRange = (day: string | null, r: Range): day is string =>
  !!day && day >= r.from && day <= r.to;

/** Not-cancelled tests dated in the range, in the reader's assessment scope (as on Tests and mock tests). */
async function testsIn(db: Database, actor: Actor, { from, to }: Range) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  return db
    .select({
      id: A.id,
      title: A.title,
      scheduledDate: A.scheduledDate,
      startTime: A.startTime,
      isSample: A.isSample,
      batchCode: batchCodes,
    })
    .from(A)
    .innerJoin(academicBatches, eq(academicBatches.id, A.batchId))
    .where(
      and(
        assessmentInScope(scope),
        ne(A.status, 'cancelled'),
        gte(A.scheduledDate, from),
        lte(A.scheduledDate, to),
      ),
    )
    .orderBy(asc(A.scheduledDate));
}
const SESSION_NOTE: Record<string, string> = { cancelled: ' (cancelled)', rescheduled: ' (moved)' };

export async function academicCalendar(db: Database, user: AuthenticatedUser, { from, to }: Range) {
  const r = { from, to };
  const actor = { user };
  const may = (p: Parameters<typeof can>[1]) => can(user, p);
  const none = { rows: [], total: 0 };
  const [sessions, tests, closures, scope, away, taskList, meetingList] = await Promise.all([
    may('academic:timetable:read') ? listSessions(db, actor, r) : [],
    may('academic:assessments:read') ? testsIn(db, actor, r) : [],
    may('academic:timetable:read') ? listExclusions(db) : [],
    may('academic:timetable:read') ? resolveScope(db, actor, 'academic:timetable:read') : null,
    may('academic:assignments:read') ? listUnavailability(db, actor) : [],
    may('ops:tasks:read')
      ? listTasks(db, user, taskListQuery.parse({ ...r, open: '1', groups: 'exclude' }), MAX)
      : none,
    may('ops:appointments:read') ? listMyMeetings(db, user, r, MAX).then((m) => m ?? none) : none,
  ]);
  const [tasks, meetings] = [taskList.rows, meetingList.rows];
  const cut = [
    ...calendarCut(
      'classes',
      sessions.length,
      sessions.length < CLASS_LIMIT ? sessions.length : null,
    ),
    ...calendarCut('tasks', tasks.length, taskList.total),
    ...calendarCut('meetings', meetings.length, meetingList.total),
  ];
  const batchInScope = (id: string | null) =>
    !id || scope?.kind === 'all' || !!scope?.batchIds.includes(id as never);
  const items: CalendarItem[] = [
    ...sessions.map((s): CalendarItem => ({
      id: s.id,
      kind: 'class',
      title: `${s.batchCode} · ${s.subjectName ?? s.sessionType.replace('_', ' ')}${SESSION_NOTE[s.status] ?? ''}`,
      start: ist(s.date, s.startTime),
      href: MODULE_PATHS.attendance(s.id),
      sample: s.isSample,
    })),
    ...tests.map((t): CalendarItem => ({
      id: t.id,
      kind: 'test',
      title: `${t.title} · ${t.batchCode}`,
      start: t.startTime ? ist(t.scheduledDate!, t.startTime) : t.scheduledDate!,
      href: MODULE_PATHS.assessment(t.id),
      sample: t.isSample,
    })),
    ...closures
      .filter((x) => inRange(x.date, r) && batchInScope(x.batchId))
      .map((x): CalendarItem => ({
        id: x.id,
        kind: x.kind === 'holiday' ? 'holiday' : 'closure',
        title: x.batchId ? x.label : `${x.label} · centre-wide`,
        start: x.date!,
        // A centre-wide closure has no page of its own.
        href: x.batchId ? MODULE_PATHS.batch(x.batchId) : undefined,
      })),
    ...away
      .filter((u) => !u.cancelledAt && u.fromDate <= to && u.toDate >= from)
      .map((u): CalendarItem => ({
        id: u.id,
        kind: 'leave',
        title: `${u.staffName}: ${u.source === 'hr_leave' ? 'leave' : 'not available'}`,
        start: u.fromDate,
        until: u.toDate,
        href: MODULE_PATHS.teacher(u.staffId),
      })),
    ...tasks.map((t): CalendarItem => ({
      id: t.id,
      kind: 'task',
      title: t.title,
      start: t.dueTime ? ist(t.dueOn, t.dueTime) : t.dueOn,
      href: `${MODULE_PATHS.tasks}/${t.id}`,
      sample: t.isSample,
    })),
    ...meetings.map((m): CalendarItem => ({
      id: m.id,
      kind: 'meeting',
      title: m.personName,
      start: m.startsAt,
      href: `${MODULE_PATHS.meetings}?open=${m.id}`,
      sample: m.studentSample ?? false,
    })),
  ];
  return { items, cut };
}
