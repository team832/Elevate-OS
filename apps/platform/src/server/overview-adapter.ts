/**
 * Data adapter for the Workspace overview (platform home `/`).
 *
 * Every widget is loaded with the SIGNED-IN user, through the modules' own server
 * services, so each number respects that user's permissions and record scope:
 *   - Pending approvals, Admission decisions, Attendance corrections
 *       → Business Ops `listApprovalInbox`
 *   - Active enquiries   → Business Ops `countOpenLeads` (`ops:leads:read`)
 *   - Staff present      → Business Ops `staffPresentToday` (`ops:attendance:read`, HR scope)
 *   - Admissions pipeline → Business Ops `countAdmissionsByStatus` (`ops:admissions:read`)
 *   - Follow-ups         → Business Ops `openFollowUpsForOverview` (`ops:leads:read`)
 *   - Team priorities    → Business Ops `listTasks` view `open` (`ops:tasks:read`)
 *   - Students enrolled  → Academic `listStudents` (scoped like the Students page)
 *   - Today's classes    → Academic `listSessions` for today in IST (scoped)
 *   - Content approvals  → Marketing `listContentItems({ state: 'in_review' })`,
 *       shown only to holders of `marketing:content:approve`
 *
 * Rule: missing is never zero. A failed or forbidden source is `unavailable` or
 * `error` (a metric is `missing`), never an empty list or 0.
 */
import { can, scopeFor, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { programmes, type Database } from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import {
  TASK_STATUS_LABELS,
  countAdmissionsByStatus,
  countOpenLeads,
  listApprovalInbox,
  listTasks,
  openFollowUpsForOverview,
  staffPresentToday,
} from '@elevate/business-ops-os/server';
import { listSessions, listStudents } from '@elevate/academic-os/server';
import { listContentItems } from '@elevate/marketing-os/server';
import { inArray } from 'drizzle-orm';

export interface OverviewDeps {
  db: Database;
  user: AuthenticatedUser;
  now: Date;
}

/** One widget's data, or an honest reason why there is none. */
export type Widget<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string };

const LOAD_ERROR = 'This could not be loaded just now. Reload the page to try again.';

async function attempt<T>(label: string, fn: () => Promise<Widget<T>>): Promise<Widget<T>> {
  try {
    return await fn();
  } catch (error) {
    console.error(`overview: ${label} failed`, error);
    return { status: 'error', message: LOAD_ERROR };
  }
}

const noAccess = (what: string): { status: 'unavailable'; reason: string } => ({
  status: 'unavailable',
  reason: `Your role does not include ${what}.`,
});

// --- dates (Asia/Kolkata calendar days) ---------------------------------------------------------

export function istDate(now: Date, offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() + offsetDays * 86_400_000));
}

/** Monday–Sunday (IST) week containing `now`. */
export function istWeek(now: Date): { from: string; to: string } {
  const today = istDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7;
  return { from: istDate(now, -back), to: istDate(now, 6 - back) };
}

const dayWindow = (now: Date) => {
  const d = istDate(now);
  return { from: d, to: d, label: 'Today' };
};

// --- approvals inbox (shared by the metric strip and the attention panel) -------------------------

type Inbox = Awaited<ReturnType<typeof listApprovalInbox>>;

export function loadInbox(deps: OverviewDeps): Promise<Widget<Inbox>> {
  return attempt('approvals inbox', async () => {
    if (!can(deps.user, 'ops:module:access')) return noAccess('Business Operations approvals');
    return { status: 'ok', data: await listApprovalInbox(deps.db, deps.user) };
  });
}

// --- metric strip ---------------------------------------------------------------------------------

export interface OverviewMetric {
  key: 'activeEnquiries' | 'studentsEnrolled' | 'staffPresent' | 'pendingApprovals';
  label: string;
  metric: Metric;
  href?: string;
  note?: string;
}

/** The list service returns at most this many students; at the cap the total is unknown. */
const STUDENT_LIST_CAP = 500;

export const METRIC_DEFINITIONS = {
  activeEnquiries:
    'Leads you can see (merged duplicates excluded) whose admission case is still open: any status except enrolled or lost (on hold counts as open).',
  staffPresent:
    'Staff in your HR scope with an attendance session (not superseded) on today’s IST date, including those who have clocked out.',
  studentsEnrolled: 'Students with an active batch enrolment that you can see.',
  pendingApprovals: 'Items in your Business Operations approvals inbox that you may decide.',
} as const;

export async function loadMetrics(
  deps: OverviewDeps,
  inbox: Promise<Widget<Inbox>>,
): Promise<OverviewMetric[]> {
  const { db, user, now } = deps;
  const window = dayWindow(now);
  const meta = (key: OverviewMetric['key']) => ({
    definition: METRIC_DEFINITIONS[key],
    window,
    unit: 'count' as const,
  });
  const missing = (key: OverviewMetric['key'], reason: string) => metric.missing(reason, meta(key));

  /** One figure from a module service: role check first, a failure is "Not available". */
  async function figure(
    key: OverviewMetric['key'],
    label: string,
    gate: { permission: Permission; area: string; unreachable: string },
    load: () => Promise<Omit<OverviewMetric, 'key' | 'label'>>,
  ): Promise<OverviewMetric> {
    if (!can(user, gate.permission))
      return { key, label, metric: missing(key, `Your role does not include ${gate.area}.`) };
    try {
      return { key, label, ...(await load()) };
    } catch (error) {
      console.error(`overview: ${key} failed`, error);
      return { key, label, metric: missing(key, gate.unreachable) };
    }
  }

  const opsDown = 'Business Operations could not be reached just now.';

  const activeEnquiries = figure(
    'activeEnquiries',
    'Active enquiries',
    { permission: 'ops:leads:read', area: 'Business Operations leads', unreachable: opsDown },
    async () => ({
      metric: metric.ok(await countOpenLeads(db, user), meta('activeEnquiries')),
      href: '/ops/leads',
      note: scopeFor(user, 'ops:leads:read') === 'own' ? 'Open, assigned to you' : 'Open leads',
    }),
  );

  const staffPresent = figure(
    'staffPresent',
    'Staff present',
    { permission: 'ops:attendance:read', area: 'staff attendance', unreachable: opsDown },
    async () => {
      const today = await staffPresentToday(db, user, now);
      if (!today)
        return {
          metric: missing('staffPresent', 'Your account is not linked to staff records in scope.'),
        };
      const noShifts = today.withShift === 0;
      if (!today.recordedToday)
        return {
          metric: missing(
            'staffPresent',
            noShifts
              ? 'No attendance recorded today, and no shifts are assigned for today.'
              : 'No attendance recorded today.',
          ),
        };
      return {
        href: '/ops/hr/attendance',
        metric: metric.ok(today.present, meta('staffPresent')),
        note: noShifts
          ? 'No shifts are assigned for today'
          : `${today.withShift} with a shift assigned today`,
      };
    },
  );

  const studentsEnrolled = figure(
    'studentsEnrolled',
    'Students enrolled',
    {
      permission: 'academic:students:read',
      area: 'Academic student records',
      unreachable: 'Academic OS could not be reached just now.',
    },
    async () => {
      const students = await listStudents(db, { user });
      return {
        href: '/academic/students',
        note: 'With an active batch',
        metric:
          students.length >= STUDENT_LIST_CAP
            ? missing(
                'studentsEnrolled',
                `More than ${STUDENT_LIST_CAP} students are visible; the list stops there, so the total is not counted here.`,
              )
            : metric.ok(
                students.filter((s) => s.batches.length > 0).length,
                meta('studentsEnrolled'),
              ),
      };
    },
  );

  const box = await inbox;
  const pendingApprovals: OverviewMetric = {
    key: 'pendingApprovals',
    label: 'Pending approvals',
    href: '/ops/operations/approvals',
    note: 'Waiting for your decision',
    metric:
      box.status === 'unavailable'
        ? missing('pendingApprovals', box.reason)
        : box.status === 'error'
          ? missing('pendingApprovals', 'The approvals inbox could not be loaded just now.')
          : box.data.sources.length === 0
            ? missing('pendingApprovals', 'Your roles do not decide any approvals.')
            : box.data.total === null
              ? missing('pendingApprovals', 'No approval list could be loaded just now.')
              : box.data.unavailable > 0
                ? metric.estimated(
                    box.data.total,
                    `${box.data.unavailable} approval list(s) could not be loaded and are not counted.`,
                    meta('pendingApprovals'),
                  )
                : metric.ok(box.data.total, meta('pendingApprovals')),
  };

  return [await activeEnquiries, await studentsEnrolled, await staffPresent, pendingApprovals];
}

// --- attention panel ------------------------------------------------------------------------------

export interface AttentionItem {
  key: 'admissionDecisions' | 'attendanceCorrections' | 'contentApprovals';
  label: string;
  /** What exactly is counted (shown under the label). */
  detail: string;
  href: string;
  /** null = not available (see `reason`); never 0 in place of unknown. */
  count: number | null;
  reason?: string;
}

const INBOX_ROWS: {
  key: AttentionItem['key'];
  label: string;
  sourceKey: string;
  permission: Permission;
  href: string;
  area: string;
}[] = [
  {
    key: 'admissionDecisions',
    label: 'Admission decisions',
    sourceKey: 'ops.fee_arrangements',
    permission: 'ops:admissions:approve',
    href: '/ops/operations/approvals#ops.fee_arrangements',
    area: 'admission approvals',
  },
  {
    key: 'attendanceCorrections',
    label: 'Attendance corrections',
    sourceKey: 'ops.attendance_corrections',
    permission: 'ops:attendance:approve',
    href: '/ops/operations/approvals#ops.attendance_corrections',
    area: 'attendance correction decisions',
  },
];

export async function loadAttention(
  deps: OverviewDeps,
  inbox: Promise<Widget<Inbox>>,
): Promise<AttentionItem[]> {
  const box = await inbox;
  const rows: AttentionItem[] = INBOX_ROWS.map((r) => {
    const base = { key: r.key, label: r.label, href: r.href };
    if (box.status === 'error')
      return {
        ...base,
        detail: '',
        count: null,
        reason: 'Approvals could not be loaded just now.',
      };
    if (box.status === 'unavailable')
      return { ...base, detail: '', count: null, reason: box.reason };
    const source = box.data.sources.find((s) => s.key === r.sourceKey);
    if (!source)
      return { ...base, detail: '', count: null, reason: `Not part of your role (${r.area}).` };
    if (source.status === 'unavailable' || source.count === null)
      return {
        ...base,
        detail: source.label,
        count: null,
        reason: 'This list could not be loaded just now.',
      };
    return { ...base, detail: source.label, count: source.count };
  });

  const content: AttentionItem = {
    key: 'contentApprovals',
    label: 'Content approvals',
    detail: 'Content items in review',
    href: '/marketing',
    count: null,
  };
  if (!can(deps.user, 'marketing:content:approve')) {
    content.reason = 'Not part of your role (content approval).';
  } else {
    try {
      const items = await listContentItems(deps.db, { state: 'in_review' });
      if (items.length >= 500) content.reason = 'More than 500 items are in review.';
      else content.count = items.length;
    } catch (error) {
      console.error('overview: content approvals failed', error);
      content.reason = 'Marketing OS could not be reached just now.';
    }
  }
  return [...rows, content];
}

// --- admissions pipeline ------------------------------------------------------------------------

/**
 * Overview stages → Business Ops admission statuses (apps/business-ops-os/src/domain/pipeline.ts).
 * `lost` and `on_hold` are not forward stages and are not shown.
 */
export const PIPELINE_STAGES = [
  { key: 'new', label: 'New', statuses: ['new'] },
  { key: 'contacted', label: 'Contacted', statuses: ['contacted'] },
  {
    key: 'counselling',
    label: 'Counselling',
    statuses: ['counselling_scheduled', 'counselled', 'demo_scheduled', 'demo_attended'],
  },
  {
    key: 'application',
    label: 'Application',
    statuses: ['admission_pending', 'admitted', 'enrolment_requested'],
  },
  { key: 'enrolled', label: 'Enrolled', statuses: ['enrolled'] },
] as const;

export interface PipelineStage {
  key: (typeof PIPELINE_STAGES)[number]['key'];
  label: string;
  count: number;
  statuses: readonly string[];
}

export function mapPipeline(countsByStatus: Readonly<Record<string, number>>): PipelineStage[] {
  return PIPELINE_STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    statuses: s.statuses,
    count: s.statuses.reduce((n, status) => n + (countsByStatus[status] ?? 0), 0),
  }));
}

export function loadPipeline(deps: OverviewDeps): Promise<Widget<PipelineStage[]>> {
  return attempt('pipeline', async () => {
    if (!can(deps.user, 'ops:admissions:read')) return noAccess('Business Operations admissions');
    return { status: 'ok', data: mapPipeline(await countAdmissionsByStatus(deps.db, deps.user)) };
  });
}

// --- follow-ups -----------------------------------------------------------------------------------

/** Rows shown in the widget; the full list is in Business Operations. */
export const FOLLOW_UP_ROWS = 10;
/** `openFollowUpsForOverview` reads at most this many (earliest due first). */
const FOLLOW_UP_CAP = 500;

export interface FollowUpRow {
  id: string;
  leadId: string;
  student: string;
  programme: string;
  owner: string;
  nextStep: string;
  /** IST calendar day. */
  due: string;
}

/** Case-insensitive match on student, programme, owner or next step. */
export function filterFollowUps(
  rows: readonly FollowUpRow[],
  q: string | undefined,
): FollowUpRow[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) =>
    [r.student, r.programme, r.owner, r.nextStep].some((v) => v.toLowerCase().includes(needle)),
  );
}

export function loadFollowUps(
  deps: OverviewDeps,
  q: string | undefined,
): Promise<Widget<{ rows: FollowUpRow[]; matched: number; total: number; capped: boolean }>> {
  return attempt('follow-ups', async () => {
    if (!can(deps.user, 'ops:leads:read')) return noAccess('Business Operations follow-ups');
    const all: FollowUpRow[] = (await openFollowUpsForOverview(deps.db, deps.user, deps.now)).map(
      (r) => ({ ...r, programme: r.programme ?? '—' }),
    );
    const matched = filterFollowUps(all, q);
    return {
      status: 'ok',
      data: {
        rows: matched.slice(0, FOLLOW_UP_ROWS),
        matched: matched.length,
        total: all.length,
        capped: all.length >= FOLLOW_UP_CAP,
      },
    };
  });
}

// --- team priorities --------------------------------------------------------------------------------

export const PRIORITY_TABS = ['today', 'week', 'all'] as const;
export type PriorityTab = (typeof PRIORITY_TABS)[number];
export const PRIORITY_TAB_LABELS: Record<PriorityTab, string> = {
  today: 'Today',
  week: 'This week',
  all: 'All tasks',
};

/** Rows shown per tab; "View all tasks" opens the full list. */
export const PRIORITY_ROWS = 10;
/** `listTasks` returns at most this many tasks. */
const TASK_LIST_CAP = 1000;

export function parsePriorityTab(value: unknown): PriorityTab {
  return PRIORITY_TABS.includes(value as PriorityTab) ? (value as PriorityTab) : 'today';
}

export interface PriorityRow {
  id: string;
  title: string;
  owner: string;
  /** IST calendar day; null = no due date set. */
  due: string | null;
  /** Business Ops status label, e.g. "Blocked". */
  status: string;
}

/**
 * Today = due today or overdue; This week = due by Sunday (IST); All = every open task.
 * Rows arrive in due-date order (no due date last) from `listTasks`.
 */
export function filterPriorities(
  rows: readonly PriorityRow[],
  tab: PriorityTab,
  now: Date,
): PriorityRow[] {
  if (tab === 'all') return [...rows];
  const until = tab === 'today' ? istDate(now) : istWeek(now).to;
  return rows.filter((r) => r.due !== null && r.due <= until);
}

export function loadPriorities(
  deps: OverviewDeps,
  tab: PriorityTab,
): Promise<Widget<{ rows: PriorityRow[]; counts: Record<PriorityTab, number>; capped: boolean }>> {
  return attempt('priorities', async () => {
    if (!can(deps.user, 'ops:tasks:read')) return noAccess('Business Operations tasks');
    const tasks = await listTasks(deps.db, deps.user, 'open', deps.now);
    const all: PriorityRow[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      owner: t.ownerName ?? 'No owner',
      due: t.dueDate,
      status: TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status,
    }));
    const counts = Object.fromEntries(
      PRIORITY_TABS.map((t) => [t, filterPriorities(all, t, deps.now).length]),
    ) as Record<PriorityTab, number>;
    return {
      status: 'ok',
      data: {
        rows: filterPriorities(all, tab, deps.now).slice(0, PRIORITY_ROWS),
        counts,
        capped: all.length >= TASK_LIST_CAP,
      },
    };
  });
}

// --- today's classes --------------------------------------------------------------------------------

export interface ClassRow {
  id: string;
  time: string;
  batch: string;
  subject: string;
  room: string;
}

export function loadTodayClasses(deps: OverviewDeps): Promise<Widget<ClassRow[]>> {
  return attempt('today’s classes', async () => {
    if (!can(deps.user, 'academic:timetable:read')) return noAccess('the Academic timetable');
    const today = istDate(deps.now);
    const sessions = await listSessions(deps.db, { user: deps.user }, { from: today, to: today });
    return {
      status: 'ok',
      data: sessions
        .filter((s) => s.status !== 'cancelled' && s.status !== 'rescheduled')
        .map((s) => ({
          id: s.id,
          time: String(s.startTime).slice(0, 5),
          batch: s.batchCode,
          subject: s.subjectCode ?? '—',
          room: s.roomCode ?? '—',
        })),
    };
  });
}

// --- new enquiry form options -------------------------------------------------------------------------

/** Programmes for the "Programme of interest" select (core reference data, active only). */
export async function enquiryProgrammes(db: Database): Promise<{ value: string; label: string }[]> {
  try {
    const rows = await db
      .select({ code: programmes.code, name: programmes.name })
      .from(programmes)
      .where(inArray(programmes.status, ['active']))
      .orderBy(programmes.code);
    return rows.map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }));
  } catch (error) {
    console.error('overview: programmes failed', error);
    return [];
  }
}
