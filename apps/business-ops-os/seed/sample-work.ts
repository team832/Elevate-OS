/**
 * Sample task-tracker work of the twelve sample teachers (brief 2 §14, D-036): one task per
 * lifecycle case, its dated history (task_events), work updates across days (one spanning
 * midnight, one late entry) and end-of-day reports in each review state. Dates are offsets from
 * `sampleAnchorDate()`. Every task, update and report has `is_sample`; nothing notifies anyone or
 * is sent (no delivery provider exists, so there is no "delivery failure/retry" fixture).
 * Idempotent: skipped once sample tasks exist (`npm run db:clear-samples` removes them).
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  opsEodReports,
  opsEodReportVersions,
  opsEodReviewEvents,
  opsStaffProfiles,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskReviews,
  opsTaskSubmissions,
  opsTaskUpdates,
  staffMembers,
  type Database,
} from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, istInstant, type IsoDate } from '../src/domain/dates';
import { buildEodFacts } from '../src/domain/eod';
import type { TaskPriority, TaskStatus } from '../src/domain/staff-tasks';
import {
  sampleAnchorDate,
  SAMPLE_MANAGER,
  SAMPLE_TEACHER_STAFF,
  type SampleTeacherCode,
} from './sample-staff';

/** [day offset from the anchor, IST HH:MM]. */
type At = [number, string];
type Step =
  | { kind: 'acknowledged' | 'submitted_for_review'; at: At }
  | { kind: 'status_changed'; at: At; to: TaskStatus; reason?: string }
  | { kind: 'reopened' | 'cancelled' | 'blocked_set'; at: At; reason: string }
  | { kind: 'changes_requested'; at: At; reason: string }
  | { kind: 'review_approved'; at: At }
  | { kind: 'reassigned'; at: At; to: SampleTeacherCode; reason: string };
interface Update {
  on: number;
  work: string;
  at?: At;
  minutes?: number;
  /** Start/stop instead of a duration. */
  span?: [At, At];
  /** A late entry: written later, keeps its work day. */
  recorded?: At;
  blocker?: string;
}
interface SampleTask {
  owner: SampleTeacherCode;
  /** Owner before a reassignment. */
  firstOwner?: SampleTeacherCode;
  title: string;
  shows: string;
  source: 'manager' | 'self' | 'verbal';
  received: At;
  due: number;
  dueTime?: string;
  priority: TaskPriority;
  progress?: number;
  review?: true;
  /** Brief 23 Oct 2026 §8: what the assignee hands in. */
  deliverable?: string;
  steps: Step[];
  updates?: Update[];
}

const ack = (day: number, time: string): Step => ({ kind: 'acknowledged', at: [day, time] });
const to = (status: TaskStatus, day: number, time: string, reason?: string): Step => ({
  kind: 'status_changed',
  at: [day, time],
  to: status,
  reason,
});

export const SAMPLE_TASKS: readonly SampleTask[] = [
  {
    owner: 'DEMO-T01',
    title: 'Prepare the CA Foundation chapter 3 revision sheet',
    shows: 'assigned, not acknowledged',
    source: 'manager',
    received: [0, '09:30'],
    due: 2,
    dueTime: '18:00',
    priority: 'high',
    steps: [],
  },
  {
    owner: 'DEMO-T02',
    title: 'Collect the Business Laws test answer sheets',
    shows: 'verbal request, acknowledged, not started',
    source: 'verbal',
    received: [-1, '10:00'],
    due: 1,
    priority: 'medium',
    steps: [ack(-1, '10:05')],
  },
  {
    owner: 'DEMO-T03',
    title: 'Set the Quant practice paper for Friday',
    shows: 'in progress; updates on two days, one across midnight',
    source: 'manager',
    received: [-2, '09:00'],
    due: 1,
    dueTime: '17:00',
    priority: 'high',
    progress: 40,
    steps: [ack(-2, '09:15'), to('in_progress', -1, '18:30')],
    updates: [
      {
        on: -1,
        work: 'Drafted 20 of the 50 questions',
        span: [
          [-1, '23:15'],
          [0, '00:40'],
        ],
      },
      {
        on: 0,
        work: 'Checked the answer key of the first 20 questions',
        at: [0, '11:00'],
        minutes: 60,
      },
    ],
  },
  {
    owner: 'DEMO-T04',
    title: 'Plan the Legal Reasoning doubt session',
    shows: 'blocked with a reason',
    source: 'manager',
    received: [-3, '11:00'],
    due: 0,
    priority: 'medium',
    progress: 20,
    steps: [
      ack(-3, '11:30'),
      to('in_progress', -2, '10:00'),
      {
        kind: 'blocked_set',
        at: [-1, '15:00'],
        reason: 'Waiting for a free room from the coordinator (sample).',
      },
    ],
    updates: [
      {
        on: -2,
        work: 'Listed the doubts students raised this week',
        at: [-2, '12:00'],
        minutes: 45,
        blocker: 'No room booked yet',
      },
    ],
  },
  {
    owner: 'DEMO-T05',
    title: 'Check the Verbal Ability homework',
    shows: 'submitted for review (review required)',
    source: 'manager',
    review: true,
    received: [-2, '09:00'],
    due: 0,
    priority: 'medium',
    progress: 100,
    steps: [
      ack(-2, '09:10'),
      to('in_progress', -2, '14:00'),
      { kind: 'submitted_for_review', at: [-1, '16:00'] },
    ],
    updates: [{ on: -1, work: 'Checked 32 homework notebooks', at: [-1, '15:30'], minutes: 90 }],
  },
  {
    owner: 'DEMO-T03',
    title: 'Prepare the integration practice sheet with an answer key',
    shows: 'submitted, changes requested, resubmitted as version 2 (review required)',
    source: 'manager',
    review: true,
    deliverable: 'Practice sheet (PDF) and its answer key',
    received: [-3, '09:00'],
    due: 0,
    dueTime: '17:00',
    priority: 'high',
    progress: 100,
    steps: [
      ack(-3, '09:20'),
      to('in_progress', -3, '10:00'),
      { kind: 'submitted_for_review', at: [-2, '16:42'] },
      {
        kind: 'changes_requested',
        at: [-1, '10:00'],
        reason: 'Please attach the answer key (sample).',
      },
      { kind: 'submitted_for_review', at: [-1, '15:30'] },
    ],
  },
  {
    owner: 'DEMO-T06',
    title: 'Upload the Logical Reasoning mock answer key',
    shows: 'done',
    source: 'manager',
    received: [-2, '10:00'],
    due: -1,
    priority: 'high',
    progress: 100,
    steps: [ack(-2, '10:30'), to('in_progress', -2, '11:00'), to('done', -1, '17:00')],
    updates: [
      {
        on: -1,
        work: 'Uploaded the key and checked two disputed answers',
        at: [-1, '16:45'],
        minutes: 30,
      },
    ],
  },
  {
    owner: 'DEMO-T07',
    title: 'Compile the weekly current-affairs notes',
    shows: 'overdue: due two days ago, still in progress',
    source: 'manager',
    received: [-5, '09:00'],
    due: -2,
    priority: 'medium',
    progress: 60,
    steps: [ack(-5, '09:20'), to('in_progress', -4, '10:00')],
    updates: [{ on: -4, work: 'Collected the week’s news items', at: [-4, '13:00'], minutes: 120 }],
  },
  {
    owner: 'DEMO-T08',
    title: 'Re-mark the Quant unit test after the key correction',
    shows: 'done, then reopened',
    source: 'manager',
    received: [-4, '09:00'],
    due: 1,
    priority: 'high',
    progress: 50,
    steps: [
      ack(-4, '09:05'),
      to('in_progress', -4, '10:00'),
      to('done', -3, '16:00'),
      {
        kind: 'reopened',
        at: [-1, '09:30'],
        reason: 'Two answers in the key were wrong; re-mark needed (sample).',
      },
    ],
  },
  {
    owner: 'DEMO-T09',
    title: 'Arrange the Economics guest lecture',
    shows: 'cancelled with a reason',
    source: 'manager',
    received: [-6, '12:00'],
    due: 5,
    priority: 'low',
    steps: [
      ack(-6, '12:30'),
      { kind: 'cancelled', at: [-2, '11:00'], reason: 'The lecture moved to next term (sample).' },
    ],
  },
  {
    owner: 'DEMO-T10',
    firstOwner: 'DEMO-T09',
    title: 'Build the Business Studies case-study pack',
    shows: 'reassigned from Mehul Desai to Tara Kapoor',
    source: 'manager',
    received: [-3, '10:00'],
    due: 3,
    priority: 'medium',
    progress: 20,
    steps: [
      ack(-3, '10:15'),
      {
        kind: 'reassigned',
        at: [-2, '09:00'],
        to: 'DEMO-T10',
        reason: 'Mehul is on exam duty this week (sample).',
      },
      ack(-2, '09:30'),
      to('in_progress', -2, '11:00'),
    ],
    updates: [{ on: -2, work: 'Picked four case studies', at: [-2, '12:00'], minutes: 40 }],
  },
  {
    owner: 'DEMO-T11',
    title: 'Prepare the Class 12 Accountancy worksheet',
    shows: 'self-logged; a late entry keeps its work day',
    source: 'self',
    received: [-3, '08:30'],
    due: 1,
    priority: 'medium',
    progress: 70,
    steps: [ack(-3, '08:30'), to('in_progress', -3, '09:00')],
    updates: [
      {
        on: -2,
        work: 'Wrote 15 journal-entry questions',
        at: [-2, '10:00'],
        minutes: 75,
        recorded: [0, '10:00'],
      },
    ],
  },
  {
    owner: 'DEMO-T12',
    title: 'Draft a CUET General Test practice set',
    shows: 'self-logged by the teacher with no manager',
    source: 'self',
    received: [-1, '09:00'],
    due: 3,
    priority: 'medium',
    progress: 10,
    steps: [ack(-1, '09:00'), to('in_progress', -1, '09:30')],
    updates: [{ on: 0, work: 'Outlined the reasoning section', at: [0, '10:00'], minutes: 30 }],
  },
];

/** One EOD per state; `submit` = submission time, `review` = the manager's answer. */
export const SAMPLE_EODS: readonly {
  owner: SampleTeacherCode;
  day: number;
  submit?: At;
  review?: { kind: 'revision_requested' | 'acknowledged'; at: At; text?: string };
}[] = [
  { owner: 'DEMO-T03', day: 0 },
  { owner: 'DEMO-T06', day: -1, submit: [-1, '18:30'] },
  {
    owner: 'DEMO-T05',
    day: -1,
    submit: [-1, '18:40'],
    review: {
      kind: 'revision_requested',
      at: [-1, '20:00'],
      text: 'Say which homework sets are still unchecked (sample).',
    },
  },
  {
    owner: 'DEMO-T08',
    day: -1,
    submit: [-1, '18:50'],
    review: { kind: 'acknowledged', at: [0, '09:00'] },
  },
];

interface Person {
  staffId: StaffMemberId;
  userId: UserId;
}

async function samplePeople(db: Database) {
  const rows = await db
    .select({
      code: opsStaffProfiles.staffCode,
      staffId: staffMembers.id,
      userId: staffMembers.userId,
      name: staffMembers.fullName,
    })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(
      and(
        eq(opsStaffProfiles.isSample, true),
        inArray(staffMembers.fullName, [
          SAMPLE_MANAGER.name,
          ...SAMPLE_TEACHER_STAFF.map(([, n]) => `Sample ${n}`),
        ]),
      ),
    );
  const by = new Map(
    rows.filter((r) => r.userId).map((r) => [r.code ?? 'manager', r as Person & { name: string }]),
  );
  return by.size === SAMPLE_TEACHER_STAFF.length + 1 ? by : null;
}

export async function seedSampleWork(db: Database, log: (m: string) => void = () => {}) {
  if (await db.$count(opsStaffTasks, eq(opsStaffTasks.isSample, true)))
    return log('ops.sample-work skipped: sample tasks exist');
  const people = await samplePeople(db);
  if (!people) return log('ops.sample-work skipped: sample staff missing');
  const anchor = sampleAnchorDate() as IsoDate;
  const at = ([d, t]: At) => istInstant(addDays(anchor, d), t);
  const day = (d: number) => addDays(anchor, d);
  const manager = people.get('manager')!;
  const who = (code: SampleTeacherCode) => people.get(code)!;

  for (const t of SAMPLE_TASKS) {
    let owner = who(t.firstOwner ?? t.owner);
    let status: TaskStatus = 'pending';
    let reason: string | null = null;
    let completedAt: Date | null = null;
    let acknowledged: { at: Date; by: UserId } | null = null;
    let blocked: { at: Date; reason: string } | null = null;
    let approvedAt: Date | null = null;
    const submitted: Date[] = [];
    const reviews: { at: Date; note: string | null; decision: 'approved' | 'changes_requested' }[] =
      [];
    const events: Omit<typeof opsTaskEvents.$inferInsert, 'taskId'>[] = [];
    const creator = t.source === 'manager' ? manager : owner;
    const event = (e: (typeof events)[number]) => events.push(e);
    // Same shapes as the task services (O1): `created` names the first owner and status.
    event({
      kind: 'created',
      toStatus: 'pending',
      toStaffId: owner.staffId,
      actorUserId: creator.userId,
      occurredAt: at(t.received),
    });
    for (const s of t.steps) {
      const occurredAt = at(s.at);
      if (s.kind === 'acknowledged') {
        acknowledged = { at: occurredAt, by: owner.userId };
        event({ kind: s.kind, actorUserId: owner.userId, occurredAt });
      } else if (s.kind === 'reassigned') {
        const next = who(s.to);
        event({
          kind: s.kind,
          fromStaffId: owner.staffId,
          toStaffId: next.staffId,
          actorUserId: manager.userId,
          occurredAt,
          reason: s.reason,
        });
        owner = next;
        acknowledged = null;
      } else if (s.kind === 'blocked_set') {
        // R4: blocked is a flag; the status stays.
        blocked = { at: occurredAt, reason: s.reason };
        event({
          kind: s.kind,
          actorUserId: owner.userId,
          occurredAt,
          reason: s.reason,
          data: { kind: 'blocked' },
        });
      } else {
        if (s.kind === 'submitted_for_review') submitted.push(occurredAt);
        if (s.kind === 'changes_requested' || s.kind === 'review_approved')
          reviews.push({
            at: occurredAt,
            note: s.kind === 'changes_requested' ? s.reason : null,
            decision: s.kind === 'changes_requested' ? 'changes_requested' : 'approved',
          });
        if (s.kind === 'review_approved') approvedAt = occurredAt;
        const toStatus: TaskStatus =
          s.kind === 'status_changed'
            ? s.to
            : s.kind === 'submitted_for_review'
              ? 'in_review'
              : s.kind === 'reopened'
                ? 'in_progress'
                : s.kind === 'changes_requested'
                  ? 'changes_requested'
                  : s.kind === 'review_approved'
                    ? 'done'
                    : 'cancelled';
        const actor = ['cancelled', 'changes_requested', 'review_approved'].includes(s.kind)
          ? manager
          : owner;
        event({
          kind: s.kind,
          fromStatus: status,
          toStatus,
          actorUserId: actor.userId,
          occurredAt,
          reason: 'reason' in s ? (s.reason ?? null) : null,
        });
        status = toStatus;
        reason = 'reason' in s ? (s.reason ?? null) : null;
        completedAt = status === 'done' ? occurredAt : null;
      }
    }
    const [task] = await db
      .insert(opsStaffTasks)
      .values({
        staffId: owner.staffId,
        title: `${t.title} (sample)`,
        details: `Sample task: ${t.shows}.`,
        assignedByStaffId: t.source === 'manager' ? manager.staffId : null,
        source: t.source,
        requesterStaffId: t.source === 'verbal' ? manager.staffId : null,
        requesterNote: t.source === 'verbal' ? 'Asked in person in the staff room (sample).' : null,
        reviewerStaffId: t.review ? manager.staffId : null,
        reviewRequired: Boolean(t.review),
        receivedAt: at(t.received),
        dueOn: day(t.due),
        dueTime: t.dueTime ?? null,
        originalDueOn: day(t.due),
        originalDueTime: t.dueTime ?? null,
        expectedDeliverable: t.deliverable ?? null,
        blockedAt: blocked?.at ?? null,
        blockedKind: blocked ? 'blocked' : null,
        blockedReason: blocked?.reason ?? null,
        firstSubmittedAt: submitted[0] ?? null,
        lastSubmittedAt: submitted.at(-1) ?? null,
        approvedAt,
        priority: t.priority,
        status,
        progressPercent: status === 'done' ? 100 : (t.progress ?? 0),
        reason,
        completedAt,
        acknowledgedAt: acknowledged?.at ?? null,
        acknowledgedByUserId: acknowledged?.by ?? null,
        isSample: true,
        createdBy: creator.userId,
      })
      .returning({ id: opsStaffTasks.id });
    await db.insert(opsTaskEvents).values(events.map((e) => ({ ...e, taskId: task!.id })));
    const versions = [];
    for (const [i, submittedAt] of submitted.entries())
      versions.push(
        (
          await db
            .insert(opsTaskSubmissions)
            .values({
              taskId: task!.id,
              version: i + 1,
              completionNote: `Version ${i + 1} handed in (sample).`,
              // A task with an expected deliverable is submitted with it (as the service requires).
              evidence: t.deliverable ? `Sample shared folder: version ${i + 1} (sample).` : null,
              submittedByUserId: owner.userId,
              submittedAt,
            })
            .returning()
        )[0]!,
      );
    for (const r of reviews)
      await db.insert(opsTaskReviews).values({
        taskId: task!.id,
        // The decision is on the latest version handed in before it.
        submissionId: versions.filter((v) => v.submittedAt <= r.at).at(-1)!.id,
        decision: r.decision,
        note: r.note,
        reviewerUserId: manager.userId,
        createdAt: r.at,
      });
    for (const u of t.updates ?? [])
      await db.insert(opsTaskUpdates).values({
        taskId: task!.id,
        authorUserId: owner.userId,
        authorStaffId: owner.staffId,
        occurredOn: day(u.on),
        occurredAt: u.at ? at(u.at) : null,
        recordedAt: at(u.recorded ?? u.span?.[1] ?? u.at!),
        workPerformed: `${u.work} (sample).`,
        blocker: u.blocker ?? null,
        durationMinutes: u.minutes ?? null,
        startedAt: u.span ? at(u.span[0]) : null,
        endedAt: u.span ? at(u.span[1]) : null,
        isSample: true,
      });
  }

  const allTasks = await db.select().from(opsStaffTasks).where(eq(opsStaffTasks.isSample, true));
  const allEvents = await db
    .select()
    .from(opsTaskEvents)
    .where(
      inArray(
        opsTaskEvents.taskId,
        allTasks.map((t) => t.id),
      ),
    );
  const allUpdates = await db
    .select()
    .from(opsTaskUpdates)
    .where(eq(opsTaskUpdates.isSample, true));
  for (const e of SAMPLE_EODS) {
    const owner = who(e.owner);
    const cutoff = e.submit ? at(e.submit) : at([e.day, '18:00']);
    // O2's facts format, from the history above as it stood at the cut-off.
    const snapshot = buildEodFacts({
      staffId: owner.staffId,
      reportDate: day(e.day),
      now: cutoff,
      tasks: allTasks,
      events: allEvents.filter((x) => x.occurredAt <= cutoff),
      updates: allUpdates.filter(
        (u) => u.authorStaffId === owner.staffId && u.recordedAt <= cutoff,
      ),
      academic: {
        status: 'unavailable',
        reason: 'Sample data: the seed does not ask Academic OS',
        fetchedAt: cutoff.toISOString(),
      },
    });
    const narrative = {
      summary: 'Sample end-of-day summary written by the teacher.',
      nextDayPlan: 'Continue the open tasks (sample).',
      notes: null,
    };
    const status = e.review?.kind ?? (e.submit ? 'submitted' : 'draft');
    const reviewed =
      e.review?.kind === 'acknowledged'
        ? { reviewedBy: manager.userId, reviewedAt: at(e.review.at) }
        : {};
    const [report] = await db
      .insert(opsEodReports)
      .values({
        staffId: owner.staffId,
        reportDate: day(e.day),
        periodKind: 'day',
        periodStart: day(e.day),
        periodEnd: day(e.day),
        status,
        snapshot,
        summary: narrative.summary,
        nextDayPlan: narrative.nextDayPlan,
        currentVersion: e.submit ? 1 : 0,
        submittedAt: e.submit ? cutoff : null,
        submittedToStaffId: e.submit ? manager.staffId : null,
        ...reviewed,
        isSample: true,
        createdBy: owner.userId,
      })
      .returning({ id: opsEodReports.id });
    if (!e.submit) continue;
    const [version] = await db
      .insert(opsEodReportVersions)
      .values({
        reportId: report!.id,
        version: 1,
        snapshot,
        narrative,
        sourceCutoffAt: cutoff,
        submittedAt: cutoff,
        submittedByUserId: owner.userId,
        submittedToStaffId: manager.staffId,
      })
      .returning({ id: opsEodReportVersions.id });
    if (e.review)
      await db.insert(opsEodReviewEvents).values({
        reportId: report!.id,
        versionId: version!.id,
        kind: e.review.kind,
        actorUserId: manager.userId,
        text: e.review.text ?? null,
        createdAt: at(e.review.at),
      });
  }
  log(
    `ops.sample-work: ${SAMPLE_TASKS.length} sample tasks and ${SAMPLE_EODS.length} end-of-day reports around ${anchor}`,
  );
}

export const sampleWorkSeeds = [
  defineSeed({
    name: 'ops.sample-work',
    module: 'ops',
    dependsOn: ['ops.sample-staff'],
    description: `${SAMPLE_TASKS.length} sample tasks (every lifecycle case) with history, updates and ${SAMPLE_EODS.length} EOD reports`,
    run: ({ db, log }) => seedSampleWork(db, log),
  }),
];
