/**
 * Data adapter for the Workspace overview (platform home `/`).
 *
 * Every widget is loaded with the SIGNED-IN user, through the modules' own server
 * services, so each number respects that user's permissions and record scope:
 *   - Pending approvals, Admission decisions → Business Ops `listApprovalInbox`
 *   - Active enquiries   → Business Ops `countOpenLeads` (`ops:leads:read`)
 *   - Admissions pipeline → Business Ops `countAdmissionsByStatus` (`ops:admissions:read`)
 *   - Follow-ups         → Business Ops `openFollowUpsForOverview` (`ops:leads:read`)
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
  countAdmissionsByStatus,
  countOpenLeads,
  APPROVAL_SOURCES,
  listApprovalInbox,
  openFollowUpsForOverview,
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

const dayWindow = (now: Date) => {
  const d = istDate(now);
  return { from: d, to: d, label: 'Today' };
};

// --- approvals inbox (shared by the metric strip and the attention panel) -------------------------

type Inbox = Awaited<ReturnType<typeof listApprovalInbox>>;

export function loadInbox(deps: OverviewDeps): Promise<Widget<Inbox>> {
  return attempt('approvals inbox', async () => {
    // Module access alone (e.g. a teacher) is not enough: an empty inbox would read as a real 0.
    const decides = APPROVAL_SOURCES.some((s) =>
      [s.permission].flat().some((p) => can(deps.user, p)),
    );
    if (!can(deps.user, 'ops:module:access') || !decides)
      return noAccess('Business Operations approvals');
    return { status: 'ok', data: await listApprovalInbox(deps.db, deps.user) };
  });
}

// --- metric strip ---------------------------------------------------------------------------------

export interface OverviewMetric {
  key: 'activeEnquiries' | 'studentsEnrolled' | 'pendingApprovals';
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

  return [await activeEnquiries, await studentsEnrolled, pendingApprovals];
}

// --- attention panel ------------------------------------------------------------------------------

export interface AttentionItem {
  key: 'admissionDecisions' | 'contentApprovals';
  label: string;
  /** What exactly is counted (shown under the label). */
  detail: string;
  href: string;
  /** null = not available (see `reason`); never 0 in place of unknown. */
  count: number | null;
  reason?: string;
}

/** The fee-arrangement list of the approvals inbox (null count = not available, with a reason). */
function admissionDecisions(box: Widget<Inbox>): AttentionItem {
  const base = {
    key: 'admissionDecisions' as const,
    label: 'Admission decisions',
    href: '/ops/operations/approvals#ops.fee_arrangements',
    detail: '',
    count: null,
  };
  if (box.status === 'error') return { ...base, reason: 'Approvals could not be loaded just now.' };
  if (box.status === 'unavailable') return { ...base, reason: box.reason };
  const source = box.data.sources.find((s) => s.key === 'ops.fee_arrangements');
  if (!source) return { ...base, reason: 'Not part of your role (admission approvals).' };
  if (source.status === 'unavailable' || source.count === null)
    return { ...base, detail: source.label, reason: 'This list could not be loaded just now.' };
  return { ...base, detail: source.label, count: source.count };
}

export async function loadAttention(
  deps: OverviewDeps,
  inbox: Promise<Widget<Inbox>>,
): Promise<AttentionItem[]> {
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
  return [admissionDecisions(await inbox), content];
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
