/**
 * Sample work of the marketing team (brief 23 Oct 2026 §6–§8, §25; D-036): Ops tasks for the two
 * fictional marketing employees in every state the brief names (assigned, acknowledged, in
 * progress, blocked, submitted, changes requested, approved, overdue) plus one parent task with a
 * child per employee, and requests sent through HR (submitted, forwarded, resolved, one for Schar
 * waiting in HR's queue). Everything goes through the task and HR-request services, so the
 * lifecycle rules hold: HR (the assignment centre, brief §6) records the tasks with the Sample
 * Marketing Manager as assigning manager and reviewer (never the owner), so seeding does not depend
 * on who the employees report to (db:seed-demo-accounts moves them to the demo marketing manager). Rows are then marked `is_sample` (no route may set the flag).
 * In-app notifications only. Skipped once sample HR requests exist.
 */
import { eq, inArray } from 'drizzle-orm';
import { opsHrRequests, opsStaffTasks, type Database } from '@elevate/database';
import {
  defineSeed,
  POOJA_EMAIL,
  ROHIT_EMAIL,
  SAMPLE_MARKETING_MANAGER_EMAIL,
  sampleText,
} from '@elevate/database/seed';
import type { TaskAction } from '../src/domain/task-lifecycle';
import { addDays, istToday } from '../src/domain';
import { createHrRequest, hrRequestAction } from '../src/server/hr-requests';
import type { HrRequestAction } from '../src/domain/hr-requests';
import { taskAction } from '../src/server/task-actions';
import { createTask } from '../src/server/task-create';
import { seedActor } from './samples';

const [POOJA, ROHIT] = [POOJA_EMAIL, ROHIT_EMAIL];
const why = sampleText;

/** [title, owner, due day, review needed, the owner's steps, then the reviewer's decision]. */
export const SAMPLE_TEAM_TASKS: readonly {
  title: string;
  owner: string;
  due: number;
  review?: true;
  steps: TaskAction[];
  decision?: 'approve' | 'request_changes';
  shows: string;
}[] = [
  {
    title: 'Draft the IPMAT webinar reminder message',
    owner: POOJA,
    due: 2,
    steps: [],
    shows: 'assigned, not acknowledged',
  },
  {
    title: 'Collect CLAT quiz questions from the sample teacher',
    owner: ROHIT,
    due: 1,
    steps: ['acknowledge'],
    shows: 'acknowledged',
  },
  {
    title: 'Tidy the sample lead follow-up list',
    owner: POOJA,
    due: 3,
    steps: ['acknowledge', 'start'],
    shows: 'in progress',
  },
  {
    title: 'Book the seminar hall for the CLAT session',
    owner: ROHIT,
    due: 4,
    steps: ['acknowledge', 'start', 'block'],
    shows: 'blocked with a reason',
  },
  {
    title: 'Write the CA Foundation open-house post',
    owner: POOJA,
    due: 1,
    review: true,
    steps: ['acknowledge', 'start', 'submit'],
    shows: 'submitted for review',
  },
  {
    title: 'Prepare the CLAT current-affairs carousel',
    owner: ROHIT,
    due: 2,
    review: true,
    steps: ['acknowledge', 'start', 'submit'],
    decision: 'request_changes',
    shows: 'changes requested',
  },
  {
    title: 'Proofread the IPMAT webinar landing page',
    owner: POOJA,
    due: -1,
    review: true,
    steps: ['acknowledge', 'start', 'submit'],
    decision: 'approve',
    shows: 'approved',
  },
  {
    title: 'Send the weekly enquiry summary',
    owner: ROHIT,
    due: -3,
    steps: ['acknowledge', 'start'],
    shows: 'overdue, still in progress',
  },
];

/** HR requests: sender, recipient (`hr`, `manager` or a recipient key), HR's steps. */
export const SAMPLE_HR_REQUESTS: readonly {
  subject: string;
  from: string;
  to: 'hr' | 'manager' | 'key:schar';
  category: string;
  hr: HrRequestAction[];
}[] = [
  { subject: 'Leave on Friday afternoon', from: POOJA, to: 'hr', category: 'other', hr: [] },
  {
    subject: 'Need the CLAT batch timetable for posts',
    from: ROHIT,
    to: 'manager',
    category: 'classes',
    hr: ['review', 'forward'],
  },
  {
    subject: 'Deadline of the open-house post',
    from: POOJA,
    to: 'hr',
    category: 'tasks',
    hr: ['review', 'resolve'],
  },
  {
    subject: 'Question for Schar about the campus visit',
    from: ROHIT,
    to: 'key:schar',
    category: 'other',
    hr: [],
  },
];

type Seeded = NonNullable<Awaited<ReturnType<typeof seedActor>>>;

const version = async (db: Database, id: string) =>
  (
    await db
      .select({ v: opsStaffTasks.version })
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.id, id as never))
  )[0]!.v;

async function act(db: Database, who: Seeded, id: string, action: TaskAction) {
  await taskAction(db, who.actor, id, action, {
    expectedVersion: await version(db, id),
    reason:
      action === 'block'
        ? why('Waiting for the hall booking reply')
        : action === 'request_changes'
          ? why('Add the source of each news item')
          : null,
    completionNote: action === 'submit' ? why('Draft finished') : null,
    evidence: action === 'submit' ? why('Draft kept in the team folder') : null,
    note: action === 'approve' ? why('Looks good') : null,
  });
}

export async function seedSampleTeamWork(db: Database, log: (m: string) => void = () => {}) {
  if (await db.$count(opsHrRequests, eq(opsHrRequests.isSample, true)))
    return log('ops.sample-team-work skipped: sample HR requests exist');
  const manager = await seedActor(db, SAMPLE_MARKETING_MANAGER_EMAIL);
  const hr = await seedActor(db, 'hr-manager@example.test');
  const people = new Map<string, Seeded>();
  for (const email of [POOJA, ROHIT]) {
    const a = await seedActor(db, email);
    if (a?.staffId) people.set(email, a);
  }
  if (!manager?.staffId || !hr || people.size < 2)
    return log('ops.sample-team-work skipped: run ops.sample-leads first (marketing employees)');
  const today = istToday(new Date());
  const taskIds: string[] = [];
  for (const t of SAMPLE_TEAM_TASKS) {
    const owner = people.get(t.owner)!;
    const row = await createTask(db, hr.actor, {
      title: `${t.title} (sample)`,
      details: `Sample task: ${t.shows}.`,
      staffId: owner.staffId,
      assignedByStaffId: manager.staffId,
      reviewerStaffId: t.review ? manager.staffId : null,
      reviewRequired: Boolean(t.review),
      expectedDeliverable: t.review ? why('Draft text or design file') : null,
      dueOn: addDays(today, t.due),
      priority: 'medium',
      status: 'pending',
      progressPercent: 0,
      recurrence: 'none',
      visibility: 'assignee_chain',
      publish: true,
    } as never);
    taskIds.push(row.id);
    for (const step of t.steps) await act(db, owner, row.id, step);
    if (t.decision) await act(db, manager, row.id, t.decision);
  }
  const parent = (await createTask(db, hr.actor, {
    title: 'Share the CA Foundation open-house post on your channels (sample)',
    details: 'Sample parent task: one child per employee, each tracked on its own.',
    assignees: [...people.values()].map((p) => p.staffId!),
    assignedByStaffId: manager.staffId,
    reviewRequired: false,
    dueOn: addDays(today, 5),
    priority: 'low',
    status: 'pending',
    progressPercent: 0,
    recurrence: 'none',
    visibility: 'assignee_chain',
    publish: true,
  } as never)) as { id: string; childIds?: string[] };
  taskIds.push(parent.id, ...(parent.childIds ?? []));
  await db
    .update(opsStaffTasks)
    .set({ isSample: true })
    .where(inArray(opsStaffTasks.id, taskIds as never[]));

  const requestIds: string[] = [];
  for (const r of SAMPLE_HR_REQUESTS) {
    const sender = people.get(r.from)!;
    const row = await createHrRequest(db, sender.actor, {
      category: r.category,
      subject: `${r.subject} (sample)`,
      message: why('Sample message written for local testing'),
      recipient: r.to === 'manager' ? `staff:${manager.staffId}` : r.to,
      relatedKind: 'none',
      urgency: 'normal',
      draft: false,
    } as never);
    requestIds.push(row.id);
    for (const action of r.hr)
      await hrRequestAction(db, hr.actor, row.id, action, {
        body:
          action === 'forward'
            ? why('Please share the timetable with Rohit')
            : action === 'resolve'
              ? why('Agreed with your manager; the deadline moves to Monday')
              : null,
        hrNote: why('HR note, not shown to the sender'),
      });
  }
  await db
    .update(opsHrRequests)
    .set({ isSample: true })
    .where(inArray(opsHrRequests.id, requestIds as never[]));
  log(`ops.sample-team-work: ${taskIds.length} sample tasks, ${requestIds.length} HR requests`);
}

export const sampleTeamWorkSeeds = [
  defineSeed({
    name: 'ops.sample-team-work',
    module: 'ops',
    dependsOn: ['ops.sample-leads'],
    description: `${SAMPLE_TEAM_TASKS.length} sample marketing tasks + a parent task, ${SAMPLE_HR_REQUESTS.length} requests through HR (one for Schar in HR's queue)`,
    run: ({ db, log }) => seedSampleTeamWork(db, log),
  }),
];
