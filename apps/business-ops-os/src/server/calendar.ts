/**
 * Calendar (F4-08), read only: the viewer's items for a range of IST days, each read with the
 * permission and scope of the page that owns it. Meetings and events (Counselling and events),
 * demo classes (Demos: own admissions or demos for counsellors), open tasks due (Tasks), approved
 * leave (own; HR's reach for all-scope readers), staff holidays (My attendance / HR attendance),
 * and tests through Academic's internal assessment contract (Tests). Academic classes have no
 * internal read contract, so they stay on Academic's calendar.
 */
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsHolidays,
  opsLeads,
  opsLeaveRecords,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { fetchInternal } from '@elevate/server-kit';
import {
  academicAssessmentListV1Schema,
  sourceReasonWords,
  type AcademicAssessmentListV1,
} from '@elevate/shared-contracts';
import { calendarCut, type CalendarCut, type CalendarItem } from '@elevate/shared-ui';
import { APPOINTMENT_TYPE_LABELS } from '../domain/appointments';
import { addDays, istInstant, type IsoDate } from '../domain/dates';
import { academicUrl } from './academic-summary';
import { listAppointments } from './appointments';
import { accessScope, type Actor } from './context';
import { ownDemoFilter } from './demos-read';
import { hrReachWhere, hrScopeFor } from './hr-scope';
import { listTasks } from './staff-tasks';
import { taskListQuery } from './staff-tasks-schemas';

type Range = { from: IsoDate; to: IsoDate };
// shortcut: up to 500 rows per Ops source and month; a full source says "first 500" on the page.
const MAX = 500;
/** A source read with `.limit(MAX)` that came back full may hold more. */
const atLimit = (what: string, shown: number) =>
  calendarCut(what, shown, shown < MAX ? shown : null);

const TEST_PAGE = 100;
// shortcut: up to 10 pages (1,000 tests) per view and month; past that the calendar says "first N of M".
const TEST_PAGES = 10;
const TEST_VIEWS = ['upcoming', 'in_progress', 'previous'] as const;

/** Every page of one view of Academic's assessment list for the range (bounded), or why it could not be read. */
async function testView(view: (typeof TEST_VIEWS)[number], { from, to }: Range) {
  const items: AcademicAssessmentListV1['items'] = [];
  let total = 0;
  for (let page = 1; page <= TEST_PAGES && (page === 1 || items.length < total); page++) {
    const r = await fetchInternal(
      academicUrl(
        `/academic/api/internal/v1/assessments?view=${view}&from=${from}&to=${to}&page=${page}&pageSize=${TEST_PAGE}`,
      ),
      academicAssessmentListV1Schema,
      { caller: 'ops', timeoutMs: 8000 },
    );
    if (r.status === 'unavailable') return { unavailable: r.reason, items, total };
    items.push(...r.data.items);
    total = r.data.total;
    if (r.data.items.length === 0) break;
  }
  return { unavailable: null, items, total };
}

/** Tests from Academic: every dated, not-cancelled test in the range (three views cover all states). */
async function tests(actor: Actor, range: Range) {
  if (!can(actor, 'ops:assessments:read')) return { items: [], cut: [], unavailable: null };
  const reads = await Promise.all(TEST_VIEWS.map((view) => testView(view, range)));
  const failed = reads.find((r) => r.unavailable);
  if (failed) return { items: [], cut: [], unavailable: sourceReasonWords(failed.unavailable!) };
  // A test that moved between views while the pages were read is listed once.
  const read = [...new Map(reads.flatMap((r) => r.items).map((t) => [t.id, t])).values()];
  return {
    unavailable: null,
    cut: calendarCut(
      'tests',
      read.length,
      reads.reduce((n, r) => n + r.total, 0),
    ),
    items: read
      .filter((t) => t.scheduledDate && t.status !== 'cancelled')
      .map((t): CalendarItem => ({
        id: t.id,
        kind: 'test',
        title: `${t.title} · ${t.batches.map((b) => b.code).join(', ')}`,
        start: t.startTime ? istInstant(t.scheduledDate!, t.startTime) : t.scheduledDate!,
        href: `/ops/tests/${t.id}`,
        sample: t.isSample,
      })),
  };
}

async function demos(db: Database, actor: Actor, start: Date, end: Date): Promise<CalendarItem[]> {
  if (!can(actor, 'ops:leads:read')) return [];
  const rows = await db
    .select({
      id: opsDemos.id,
      startsAt: opsDemoSessions.startsAt,
      subject: opsDemoSessions.subject,
      studentName: opsLeads.studentName,
      isSample: opsLeads.isSample,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .where(
      and(
        ownDemoFilter(await accessScope(db, actor, 'ops:leads:read')),
        gte(opsDemoSessions.startsAt, start),
        lt(opsDemoSessions.startsAt, end),
      ),
    )
    .limit(MAX);
  return rows.map((d) => ({
    id: `${d.id}-${+d.startsAt}`,
    kind: 'demo',
    title: `${d.studentName}${d.subject ? ` · ${d.subject}` : ''}`,
    start: d.startsAt,
    href: `/ops/admissions/demos/${d.id}`,
    sample: d.isSample,
  }));
}

/** Approved leave and staff holidays: own (with your branch's holidays) or, at all scope, HR's reach. */
async function leaveAndHolidays(
  db: Database,
  actor: Actor,
  { from, to }: Range,
): Promise<{ items: CalendarItem[]; cut: CalendarCut[] }> {
  if (!can(actor, 'ops:attendance:read')) return { items: [], cut: [] };
  const access = await accessScope(db, actor, 'ops:attendance:read');
  const all = access.scope === 'all';
  if (!all && !access.staffId) return { items: [], cut: [] };
  const [branch] = all
    ? []
    : await db
        .select({ id: opsStaffProfiles.branchId })
        .from(opsStaffProfiles)
        .where(eq(opsStaffProfiles.staffId, access.staffId!));
  const [leave, holidays] = await Promise.all([
    db
      .select({
        id: opsLeaveRecords.id,
        staffId: opsLeaveRecords.staffId,
        name: staffMembers.fullName,
        kind: opsLeaveRecords.kind,
        fromDate: opsLeaveRecords.fromDate,
        toDate: opsLeaveRecords.toDate,
        isSample: opsLeaveRecords.isSample,
      })
      .from(opsLeaveRecords)
      .innerJoin(staffMembers, eq(staffMembers.id, opsLeaveRecords.staffId))
      .where(
        and(
          eq(opsLeaveRecords.status, 'approved'),
          lte(opsLeaveRecords.fromDate, to),
          gte(opsLeaveRecords.toDate, from),
          all
            ? hrReachWhere(actor, await hrScopeFor(db, actor))
            : eq(opsLeaveRecords.staffId, access.staffId!),
        ),
      )
      .limit(MAX),
    db
      .select({
        id: opsHolidays.id,
        on: opsHolidays.holidayOn,
        name: opsHolidays.name,
        state: opsHolidays.decisionState,
      })
      .from(opsHolidays)
      .where(
        and(
          gte(opsHolidays.holidayOn, from),
          lte(opsHolidays.holidayOn, to),
          inArray(opsHolidays.decisionState, ['approved', 'locked', 'proposed']),
          all
            ? undefined
            : or(
                isNull(opsHolidays.branchId),
                branch?.id ? eq(opsHolidays.branchId, branch.id) : sql`false`,
              ),
        ),
      ),
  ]);
  return {
    cut: atLimit('leave records', leave.length),
    items: [
      ...leave.map((l): CalendarItem => ({
        id: l.id,
        kind: 'leave',
        title: `${l.name}: ${l.kind}`,
        start: l.fromDate,
        until: l.toDate,
        href: all ? `/ops/hr/attendance/${l.staffId}` : '/ops/my-attendance?view=leave',
        sample: l.isSample,
      })),
      ...holidays.map((h): CalendarItem => ({
        id: h.id,
        kind: 'holiday',
        title: h.state === 'proposed' ? `${h.name} (proposed)` : h.name,
        start: h.on,
        href: all ? '/ops/hr/attendance?tab=calendar' : '/ops/my-attendance',
      })),
    ],
  };
}

export async function opsCalendar(db: Database, actor: Actor, { from, to }: Range) {
  const range = { from, to };
  const start = istInstant(from);
  const end = istInstant(addDays(to, 1));
  const none = { rows: [], total: 0 };
  const [meetingList, taskList, demoItems, leave, test] = await Promise.all([
    can(actor, 'ops:appointments:read') ? listAppointments(db, actor, range, MAX) : none,
    can(actor, 'ops:tasks:read')
      ? listTasks(db, actor, taskListQuery.parse({ ...range, open: '1', groups: 'exclude' }), MAX)
      : none,
    demos(db, actor, start, end),
    leaveAndHolidays(db, actor, range),
    tests(actor, range),
  ]);
  const [meetings, tasks] = [meetingList.rows, taskList.rows];
  const items: CalendarItem[] = [
    ...meetings.map((m): CalendarItem => ({
      id: m.id,
      kind: 'meeting',
      title: `${APPOINTMENT_TYPE_LABELS[m.type]}: ${m.personName}${m.status === 'cancelled' ? ' (cancelled)' : ''}`,
      start: m.startsAt,
      href: `/ops/meetings?open=${m.id}`,
      sample: m.studentSample ?? false,
    })),
    ...tasks.map((t): CalendarItem => ({
      id: t.id,
      kind: 'task',
      title: `${t.title} · ${t.staffName}`,
      start: t.dueTime ? istInstant(t.dueOn, t.dueTime) : t.dueOn,
      href: `/ops/tasks/${t.id}`,
      sample: t.isSample,
    })),
    ...demoItems,
    ...leave.items,
    ...test.items,
  ];
  const cut = [
    ...calendarCut('meetings and events', meetings.length, meetingList.total),
    ...calendarCut('tasks', tasks.length, taskList.total),
    ...atLimit('demo classes', demoItems.length),
    ...leave.cut,
    ...test.cut,
  ];
  return { items, cut, testsUnavailable: test.unavailable };
}
