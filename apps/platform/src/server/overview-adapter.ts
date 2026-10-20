/**
 * Data adapter for the Workspace overview (platform home `/`).
 *
 * Every widget is loaded with the SIGNED-IN user, through the modules' own server
 * services, so each number respects that user's permissions and record scope:
 *   - Pending approvals, Admission decisions, Attendance corrections
 *       → Business Ops `listApprovalInbox` (live)
 *   - Students enrolled → Academic `listStudents` (live, scoped like the Students page)
 *   - Today's classes   → Academic `listSessions` for today in IST (live, scoped)
 *   - Content approvals → Marketing `listContentItems({ state: 'in_review' })` (live),
 *       shown only to holders of `marketing:content:approve`
 *   - Active enquiries, Staff present → NOT AVAILABLE: Business Ops exports no read
 *       service for them to the platform yet (shown as "Not available", never 0)
 *   - Admissions pipeline, Follow-ups, Team priorities → SAMPLE: fictional rows,
 *       flagged `source: 'sample'` and labelled "Sample data" on screen, because
 *       Business Ops exports no lead / follow-up / task list service yet.
 * To make a sample widget live, replace its `sample…` branch with a service call;
 * the widget contract (`Widget<T>`) and the page stay the same.
 *
 * Rules: missing is never zero (a failed or forbidden source is `unavailable` or
 * `error`, never an empty list or 0); sample data is never presented as live.
 */
import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { programmes, type Database } from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import type { DataSource } from '@elevate/shared-ui';
import { listApprovalInbox } from '@elevate/business-ops-os/server';
import { listSessions, listStudents } from '@elevate/academic-os/server';
import { listContentItems } from '@elevate/marketing-os/server';
import { inArray } from 'drizzle-orm';

export interface OverviewDeps {
  db: Database;
  user: AuthenticatedUser;
  now: Date;
}

/** One widget's data: live or sample rows, or an honest reason why there are none. */
export type Widget<T> =
  | { status: 'ok'; source: DataSource; data: T; note?: string }
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
    return { status: 'ok', source: 'live', data: await listApprovalInbox(deps.db, deps.user) };
  });
}

// --- metric strip ---------------------------------------------------------------------------------

export interface OverviewMetric {
  key: 'activeEnquiries' | 'studentsEnrolled' | 'staffPresent' | 'pendingApprovals';
  label: string;
  metric: Metric;
  source: DataSource;
  href?: string;
  note?: string;
}

/** The list service returns at most this many students; at the cap the total is unknown. */
const STUDENT_LIST_CAP = 500;

export async function loadMetrics(
  deps: OverviewDeps,
  inbox: Promise<Widget<Inbox>>,
): Promise<OverviewMetric[]> {
  const { user, now } = deps;
  const window = dayWindow(now);
  const missing = (reason: string, definition: string) =>
    metric.missing(reason, { definition, window, unit: 'count' });

  const activeEnquiries: OverviewMetric = {
    key: 'activeEnquiries',
    label: 'Active enquiries',
    source: 'live',
    metric: missing(
      can(user, 'ops:leads:read')
        ? 'Business Operations does not share an enquiry count with the overview yet.'
        : 'Your role does not include Business Operations leads.',
      'Leads whose admission is still open (not enrolled, not lost).',
    ),
  };

  const staffPresent: OverviewMetric = {
    key: 'staffPresent',
    label: 'Staff present',
    source: 'live',
    metric: missing(
      can(user, 'ops:attendance:read')
        ? 'Business Operations does not share today’s attendance with the overview yet.'
        : 'Your role does not include staff attendance.',
      'Staff with an attendance session today.',
    ),
  };

  const studentsDefinition = 'Students with an active batch enrolment that you can see.';
  let studentsEnrolled: OverviewMetric;
  if (!can(user, 'academic:students:read')) {
    studentsEnrolled = {
      key: 'studentsEnrolled',
      label: 'Students enrolled',
      source: 'live',
      metric: missing('Your role does not include Academic student records.', studentsDefinition),
    };
  } else {
    try {
      const students = await listStudents(deps.db, { user });
      studentsEnrolled = {
        key: 'studentsEnrolled',
        label: 'Students enrolled',
        source: 'live',
        href: '/academic/students',
        metric:
          students.length >= STUDENT_LIST_CAP
            ? missing(
                `More than ${STUDENT_LIST_CAP} students are visible; the list stops there, so the total is not counted here.`,
                studentsDefinition,
              )
            : metric.ok(students.filter((s) => s.batches.length > 0).length, {
                definition: studentsDefinition,
                window,
                unit: 'count',
              }),
        note: 'With an active batch',
      };
    } catch (error) {
      console.error('overview: students failed', error);
      studentsEnrolled = {
        key: 'studentsEnrolled',
        label: 'Students enrolled',
        source: 'live',
        metric: missing('Academic OS could not be reached just now.', studentsDefinition),
      };
    }
  }

  const approvalsDefinition =
    'Items in your Business Operations approvals inbox that you may decide.';
  const box = await inbox;
  const pendingApprovals: OverviewMetric = {
    key: 'pendingApprovals',
    label: 'Pending approvals',
    source: 'live',
    href: '/ops/operations/approvals',
    note: 'Waiting for your decision',
    metric:
      box.status === 'unavailable'
        ? missing(box.reason, approvalsDefinition)
        : box.status === 'error'
          ? missing('The approvals inbox could not be loaded just now.', approvalsDefinition)
          : box.data.sources.length === 0
            ? missing('Your roles do not decide any approvals.', approvalsDefinition)
            : box.data.total === null
              ? missing('No approval list could be loaded just now.', approvalsDefinition)
              : box.data.unavailable > 0
                ? metric.estimated(
                    box.data.total,
                    `${box.data.unavailable} approval list(s) could not be loaded and are not counted.`,
                    { definition: approvalsDefinition, window, unit: 'count' },
                  )
                : metric.ok(box.data.total, {
                    definition: approvalsDefinition,
                    window,
                    unit: 'count',
                  }),
  };

  return [activeEnquiries, studentsEnrolled, staffPresent, pendingApprovals];
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

/** Fictional status counts (sample only). */
const SAMPLE_STATUS_COUNTS: Record<string, number> = {
  new: 14,
  contacted: 9,
  counselling_scheduled: 4,
  counselled: 3,
  demo_scheduled: 2,
  demo_attended: 1,
  admission_pending: 3,
  admitted: 1,
  enrolment_requested: 1,
  enrolled: 6,
  lost: 5,
  on_hold: 2,
};

const SAMPLE_NOTE =
  'Fictional examples. Business Operations does not share this list with the overview yet.';

export function loadPipeline(deps: OverviewDeps): Promise<Widget<PipelineStage[]>> {
  return attempt('pipeline', async () => {
    if (!can(deps.user, 'ops:leads:read') && !can(deps.user, 'ops:admissions:read'))
      return noAccess('Business Operations admissions');
    return {
      status: 'ok',
      source: 'sample',
      note: SAMPLE_NOTE,
      data: mapPipeline(SAMPLE_STATUS_COUNTS),
    };
  });
}

// --- follow-ups -----------------------------------------------------------------------------------

export interface FollowUpRow {
  id: string;
  student: string;
  programme: string;
  owner: string;
  nextStep: string;
  /** IST calendar day. */
  due: string;
}

function sampleFollowUps(now: Date): FollowUpRow[] {
  const d = (offset: number) => istDate(now, offset);
  return [
    {
      id: 's1',
      student: 'Meera Iyer (fictional)',
      programme: 'COMMERCE_11_12',
      owner: 'Ravi Counsellor (fictional)',
      nextStep: 'Call after the demo class',
      due: d(-1),
    },
    {
      id: 's2',
      student: 'Aarav Mehta (fictional)',
      programme: 'CLAT',
      owner: 'Asha Counsellor (fictional)',
      nextStep: 'Call back about the weekend batch',
      due: d(0),
    },
    {
      id: 's3',
      student: 'Diya Sharma (fictional)',
      programme: 'IPMAT',
      owner: 'Ravi Counsellor (fictional)',
      nextStep: 'Send the fee structure',
      due: d(0),
    },
    {
      id: 's4',
      student: 'Kabir Jain (fictional)',
      programme: 'CUET',
      owner: 'Asha Counsellor (fictional)',
      nextStep: 'Confirm the counselling slot',
      due: d(1),
    },
    {
      id: 's5',
      student: 'Rohan Gupta (fictional)',
      programme: 'CLAT',
      owner: 'Asha Counsellor (fictional)',
      nextStep: 'Collect the previous marksheet',
      due: d(2),
    },
  ];
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
): Promise<Widget<{ rows: FollowUpRow[]; total: number }>> {
  return attempt('follow-ups', async () => {
    if (!can(deps.user, 'ops:leads:read')) return noAccess('Business Operations follow-ups');
    const all = sampleFollowUps(deps.now);
    return {
      status: 'ok',
      source: 'sample',
      note: SAMPLE_NOTE,
      data: { rows: filterFollowUps(all, q), total: all.length },
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

export function parsePriorityTab(value: unknown): PriorityTab {
  return PRIORITY_TABS.includes(value as PriorityTab) ? (value as PriorityTab) : 'today';
}

export interface PriorityRow {
  id: string;
  title: string;
  owner: string;
  /** IST calendar day. */
  due: string;
  status: 'Open' | 'In progress' | 'Blocked';
}

function sampleTasks(now: Date): PriorityRow[] {
  const d = (offset: number) => istDate(now, offset);
  return [
    {
      id: 't1',
      title: 'Close September attendance corrections',
      owner: 'HR Contributor (fictional)',
      due: d(-1),
      status: 'In progress',
    },
    {
      id: 't2',
      title: 'Publish the CLAT weekend timetable',
      owner: 'Academic Coordinator (fictional)',
      due: d(0),
      status: 'Open',
    },
    {
      id: 't3',
      title: 'Reconcile October fee receipts',
      owner: 'Finance Officer (fictional)',
      due: d(0),
      status: 'Blocked',
    },
    {
      id: 't4',
      title: 'Review counsellor call scripts',
      owner: 'Operations Manager (fictional)',
      due: d(2),
      status: 'Open',
    },
    {
      id: 't5',
      title: 'Plan the IPMAT mock test hall',
      owner: 'Academic Coordinator (fictional)',
      due: d(4),
      status: 'Open',
    },
    {
      id: 't6',
      title: 'Renew the classroom projector service contract',
      owner: 'Operations Manager (fictional)',
      due: d(12),
      status: 'Open',
    },
  ];
}

/** Today = due today or overdue; This week = due by Sunday (IST); All = every open task. */
export function filterPriorities(
  rows: readonly PriorityRow[],
  tab: PriorityTab,
  now: Date,
): PriorityRow[] {
  const today = istDate(now);
  const { to } = istWeek(now);
  const sorted = [...rows].sort((a, b) => a.due.localeCompare(b.due));
  if (tab === 'today') return sorted.filter((r) => r.due <= today);
  if (tab === 'week') return sorted.filter((r) => r.due <= to);
  return sorted;
}

export function loadPriorities(
  deps: OverviewDeps,
  tab: PriorityTab,
): Promise<Widget<{ rows: PriorityRow[]; counts: Record<PriorityTab, number> }>> {
  return attempt('priorities', async () => {
    if (!can(deps.user, 'ops:tasks:read')) return noAccess('Business Operations tasks');
    const all = sampleTasks(deps.now);
    const counts = Object.fromEntries(
      PRIORITY_TABS.map((t) => [t, filterPriorities(all, t, deps.now).length]),
    ) as Record<PriorityTab, number>;
    return {
      status: 'ok',
      source: 'sample',
      note: SAMPLE_NOTE,
      data: { rows: filterPriorities(all, tab, deps.now), counts },
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
      source: 'live',
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
