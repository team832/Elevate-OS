/**
 * Review round 1 of the HR task work (E1–E8 and minors), kept as permanent tests: status changes
 * only through the actions, the brief of assigned work belongs to the assigner, reopening
 * cancelled work, related batch/subject checked with Academic OS, parents close after their
 * children, the review queue, collaborators, the brief's wording and the deadline minute.
 * Fictional people only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  departments,
  notifications,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskReviews,
  staffMembers,
} from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { taskDaySummary } from '../../src/server/staff-tasks';
import { taskDetail } from '../../src/server/task-detail';
import { taskFacts, tasksReach } from '../../src/server/teacher-ops';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { POST as actionRoute } from '../../src/app/api/v1/staff-tasks/[id]/[action]/route';
import { POST as updateRoute } from '../../src/app/api/v1/staff-tasks/[id]/updates/route';
import { POST as reassignRoute } from '../../src/app/api/v1/staff-tasks/[id]/reassign/route';
import { POST as dependencyRoute } from '../../src/app/api/v1/staff-tasks/[id]/dependencies/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
const due = addDays(today, 3);
let hr: StaffUser;
let teacher: StaffUser;
let teacher2: StaffUser;
let collaborator: StaffUser;

const url = (u: TestUser, path: string) =>
  `/${u.roles[0] === 'teacher' ? 'academic' : 'ops'}/api/v1/staff-tasks${path}`;
type Task = Record<string, unknown> & { id: string; status: string; version: number };
const create = (u: TestUser, json: Record<string, unknown>) =>
  callRoute<Task & { childIds?: string[] }>(
    createRoute,
    authedRequest(u, url(u, ''), { method: 'POST', json }),
  );
const version = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.id, id as never))
  )[0]!.version;
const act = async (u: TestUser, id: string, action: string, json: Record<string, unknown> = {}) =>
  callRoute<Task>(
    actionRoute,
    authedRequest(u, url(u, `/${id}/${action}`), {
      method: 'POST',
      json: { expectedVersion: await version(id), ...json },
    }),
    { id, action },
  );
const patch = async (u: TestUser, id: string, json: Record<string, unknown>) =>
  callRoute<Task>(
    patchRoute,
    authedRequest(u, url(u, `/${id}`), {
      method: 'PATCH',
      json: { expectedVersion: await version(id), ...json },
    }),
    { id },
  );
const brief = (staffId: string, more: Record<string, unknown> = {}) => ({
  title: 'Sample answer key',
  staffId,
  expectedDeliverable: 'Answer key (PDF)',
  reviewRequired: true,
  reviewerStaffId: hr.staffId,
  dueOn: due,
  ...more,
});
/** Assigned, acknowledged and started by the teacher. */
async function started(more: Record<string, unknown> = {}) {
  const t = (await create(hr, brief(teacher.staffId, more))).data!;
  await act(teacher, t.id, 'acknowledge');
  await act(teacher, t.id, 'start');
  return t.id;
}

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Asha' });
  teacher2 = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Bina' });
  collaborator = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Chitra' });
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, 'ACADEMICS'));
  for (const s of [teacher, teacher2, collaborator])
    await ctx.db
      .update(staffMembers)
      .set({ departmentId: d!.id })
      .where(eq(staffMembers.id, s.staffId));
});
afterEach(() => vi.unstubAllGlobals());

describe('C1/C2: no status change through PATCH', () => {
  it('E1: the assignee cannot PATCH a reviewed task to done', async () => {
    const id = await started();
    const res = await patch(teacher, id, { status: 'done' });
    expect(res.status).toBe(400);
    expect(res.error!.details).toEqual([expect.objectContaining({ path: ['status'] })]);
    expect((await taskDetail(ctx.db, hr, id)).status).toBe('in_progress');
  });

  it('E2: a reviewer cannot skip the review row by PATCHing in_review → done', async () => {
    const id = await started();
    await act(teacher, id, 'submit-for-review', { completionNote: 'Done', evidence: 'Drive' });
    expect((await patch(hr, id, { status: 'done' })).status).toBe(400);
    expect(await ctx.db.$count(opsTaskReviews, eq(opsTaskReviews.taskId, id as never))).toBe(0);
    const ok = await act(hr, id, 'approve');
    expect(ok.data).toMatchObject({ status: 'done', approvedAt: expect.any(String) });
  });
});

describe('I1/I2: the brief of assigned work is the assigner’s', () => {
  it('E3: the assignee cannot change the title, deliverable, criteria or deadline', async () => {
    const id = await started();
    for (const json of [
      { title: 'Easier task' },
      { expectedDeliverable: null },
      { acceptanceCriteria: 'Anything' },
      { dueOn: addDays(today, 30), changeReason: 'Busy' },
    ])
      expect((await patch(teacher, id, json)).status).toBe(403);
    expect((await patch(teacher, id, { progressPercent: 50 })).status).toBe(200);
    expect((await patch(hr, id, { title: 'Sample answer key v2' })).status).toBe(200);
  });

  it('E4: submit still needs evidence when a deliverable is expected', async () => {
    const id = await started();
    expect((await act(teacher, id, 'submit-for-review', { completionNote: 'Done' })).status).toBe(
      400,
    );
  });

  it('self-logged work keeps the owner’s edits', async () => {
    const own = (await create(teacher, { title: 'Sample own note' })).data!;
    expect((await patch(teacher, own.id, { title: 'Sample own note, edited' })).status).toBe(200);
  });
});

describe('I4: reopening cancelled work', () => {
  it('E5: the assignee cannot reopen assigned work HR cancelled; HR can', async () => {
    const t = (await create(hr, brief(teacher.staffId))).data!;
    await act(hr, t.id, 'cancel', { reason: 'Not needed' });
    expect((await act(teacher, t.id, 'reopen', { reason: 'I want it' })).status).toBe(403);
    expect((await act(hr, t.id, 'reopen', { reason: 'Needed after all' })).data).toMatchObject({
      status: 'in_progress',
    });
  });
});

describe('I5: a related batch or subject is one the assignee teaches', () => {
  const batchId = crypto.randomUUID();
  const subjectId = crypto.randomUUID();
  const academic = (ok = true) =>
    vi.stubGlobal('fetch', async () =>
      ok
        ? Response.json({
            data: {
              contract: 'academic.teaching_assignments',
              version: 1,
              generatedAt: new Date().toISOString(),
              total: 1,
              page: 1,
              pageSize: 25,
              items: [
                {
                  assignmentId: crypto.randomUUID(),
                  staffId: teacher.staffId,
                  teacherName: 'Sample Teacher Asha',
                  courseName: 'Sample Class 12',
                  subjectName: 'Mathematics',
                  classLevel: 'Class 12',
                  batchCode: 'SAMPLE-C12',
                  batchId,
                  subjectId,
                  academicYear: '2026-27',
                  branchName: null,
                  startDate: null,
                  endDate: null,
                  role: 'primary',
                  status: 'active',
                },
              ],
            },
          })
        : new Response('down', { status: 503 }),
    );

  it('E6: stores the batch with Academic’s label; refuses a guessed id or an unchecked one', async () => {
    academic();
    const ok = await create(hr, brief(teacher.staffId, { relatedRef: `batch:${batchId}` }));
    expect(ok.data).toMatchObject({
      relatedKind: 'batch',
      relatedId: batchId,
      relatedLabel: 'SAMPLE-C12 · Mathematics',
    });
    const guessed = await create(
      hr,
      brief(teacher.staffId, { relatedRef: `batch:${crypto.randomUUID()}` }),
    );
    expect(guessed.status).toBe(400);
    expect(
      (await create(hr, brief(teacher2.staffId, { relatedRef: `subject:${subjectId}` }))).status,
    ).toBe(400);
    expect(
      (
        await create(
          hr,
          brief(teacher.staffId, { relatedKind: 'campaign', relatedId: crypto.randomUUID() }),
        )
      ).status,
    ).toBe(400);
    academic(false);
    const down = await create(hr, brief(teacher.staffId, { relatedRef: `batch:${batchId}` }));
    expect(down.status).toBe(400);
    expect(down.error!.details).toEqual([
      expect.objectContaining({ message: expect.stringContaining('Source unavailable') }),
    ]);
  });
});

describe('M3, M4: parents and the review queue', () => {
  it('E7: a parent cannot be closed while a person’s task is open', async () => {
    const t = await create(hr, {
      ...brief(teacher.staffId, { title: 'Sample group' }),
      staffId: undefined,
      assignees: { [teacher.staffId]: true, [teacher2.staffId]: true },
    });
    const res = await act(hr, t.data!.id, 'complete');
    expect(res.status).toBe(409);
    expect(res.error!.message).toContain('still open');
  });

  it('E8: the review queue lists only work the viewer may decide, with the submitting user', async () => {
    const id = await started({ title: 'Sample queue' });
    await act(teacher, id, 'submit-for-review', { completionNote: 'Done', evidence: 'Drive' });
    const own = (
      await create(hr, brief(hr.staffId, { title: 'Sample HR own', reviewerStaffId: null }))
    ).data!;
    await act(hr, own.id, 'start');
    await act(hr, own.id, 'submit-for-review', { completionNote: 'x', evidence: 'y' });
    const queue = await callRoute<{ rows: Task[] }>(
      listRoute,
      authedRequest(hr, '/ops/api/v1/staff-tasks?status=in_review&reviewable=1&sort=submitted'),
    );
    const ids = queue.data!.rows.map((r) => r.id);
    expect(ids).toContain(id);
    expect(ids).not.toContain(own.id);
    expect(queue.data!.rows.find((r) => r.id === id)).toMatchObject({
      submittedBy: 'Sample Teacher Asha',
    });
  });
});

describe('M1, M2: collaborators and the brief’s wording', () => {
  it('a collaborator may read and comment, not log work or submit', async () => {
    const t = (
      await create(hr, {
        ...brief(teacher.staffId, { title: 'Sample shared' }),
        visibility: 'collaborators',
        collaborators: { [collaborator.staffId]: true },
      })
    ).data!;
    expect(
      (await act(collaborator, t.id, 'comment', { reason: 'Use last year’s key' })).status,
    ).toBe(200);
    const logged = await callRoute(
      updateRoute,
      authedRequest(collaborator, url(collaborator, `/${t.id}/updates`), {
        method: 'POST',
        json: { workPerformed: 'Helped' },
      }),
      { id: t.id },
    );
    expect(logged.status).toBe(403);
    expect((await act(collaborator, t.id, 'start')).status).toBe(403);
  });

  it('"Submitted by Asha… at 4:42 PM." and "Changes requested by HR: …"', async () => {
    const id = await started({ title: 'Sample wording' });
    await act(teacher, id, 'submit-for-review', { completionNote: 'Done', evidence: 'Drive' });
    await act(hr, id, 'request-changes', { reason: 'please attach the answer key.' });
    const notes = await ctx.db.select().from(notifications);
    const body = (kind: string) => notes.filter((n) => n.kind === kind).at(-1)!.body!;
    expect(body('task.submitted')).toMatch(
      /^Submitted by Sample Teacher Asha at \d{1,2}:\d{2} (AM|PM)\.$/,
    );
    expect(body('task.changes_requested')).toBe(
      'Changes requested by HR: please attach the answer key.',
    );
    const d = await taskDetail(ctx.db, teacher, id);
    expect(d.reviews.at(-1)).toMatchObject({
      reviewer: 'HR',
      note: 'please attach the answer key.',
    });
  });
});

const reassign = async (u: TestUser, id: string, toStaffId: string) =>
  callRoute<Task>(
    reassignRoute,
    authedRequest(u, url(u, `/${id}/reassign`), {
      method: 'POST',
      json: { expectedVersion: await version(id), toStaffId },
    }),
    { id },
  );
const queueOf = async (u: TestUser) =>
  (
    await callRoute<{ rows: Task[] }>(
      listRoute,
      authedRequest(u, '/ops/api/v1/staff-tasks?status=in_review&reviewable=1&sort=submitted'),
    )
  ).data!.rows.map((r) => r.id);
const academics = async (s: StaffUser) => {
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, 'ACADEMICS'));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: d!.id })
    .where(eq(staffMembers.id, s.staffId));
};

describe('review round 2 (X1): nobody holds admin or manager powers over a task they own', () => {
  const ROLES = ['hr_manager', 'operations_manager', 'director'] as const;
  type Role = (typeof ROLES)[number];
  const owners = {} as Record<Role, StaffUser>;
  const others = {} as Record<Role, StaffUser>;
  let assigner: StaffUser;
  let reviewer: StaffUser;
  type Step = (u: StaffUser, id: string) => Promise<{ status: number }>;
  const GATED: [string, Step[]][] = [
    [
      'deadline change',
      [(u, id) => patch(u, id, { dueOn: addDays(today, 9), changeReason: 'Busy' })],
    ],
    ['review toggle', [(u, id) => patch(u, id, { reviewRequired: false })]],
    ['brief edit', [(u, id) => patch(u, id, { title: 'Sample easier brief' })]],
    [
      'complete without review',
      [(u, id) => patch(u, id, { reviewRequired: false }), (u, id) => act(u, id, 'complete')],
    ],
    ['cancel', [(u, id) => act(u, id, 'cancel', { reason: 'Not needed' })]],
    ['reopen', [(u, id) => act(u, id, 'reopen', { reason: 'Needed' })]],
    ['reviewer change', [(u, id) => patch(u, id, { reviewerStaffId: collaborator.staffId })]],
    ['reassign', [(u, id) => reassign(u, id, teacher2.staffId)]],
  ];

  beforeAll(async () => {
    assigner = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Assigner' });
    reviewer = await staffUser(ctx.db, ['teacher'], { name: 'Sample Reviewer Deepa' });
    const otherOps = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Two' });
    Object.assign(others, {
      hr_manager: await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Two' }),
      operations_manager: otherOps,
      director: otherOps,
    });
    for (const role of ROLES) {
      owners[role] = await staffUser(ctx.db, [role], { name: `Sample Owner ${role}` });
      await academics(owners[role]);
    }
  });

  it.each(GATED.flatMap(([name, steps]) => ROLES.map((role) => [name, role, steps] as const)))(
    '%s: refused to the owner holding %s, allowed to another HR/ops person',
    async (name, role, steps) => {
      const t = (
        await create(assigner, brief(owners[role].staffId, { reviewerStaffId: reviewer.staffId }))
      ).data!;
      if (name === 'reopen') await act(assigner, t.id, 'cancel', { reason: 'Paused' });
      for (const step of steps)
        expect([403, 409]).toContain((await step(owners[role], t.id)).status);
      for (const step of steps) expect((await step(others[role], t.id)).status).toBe(200);
    },
  );
});

describe('review round 2: hand-over, multi-person drafts and minors', () => {
  it('X2: no reassignment while submitted; an approval never credits a new owner', async () => {
    const id = await started({ title: 'Sample handover' });
    await act(teacher, id, 'submit-for-review', { completionNote: 'Done', evidence: 'Drive' });
    const refused = await reassign(hr, id, teacher2.staffId);
    expect(refused.status).toBe(409);
    expect(refused.error!.message).toBe('Ask for changes or approve first.');
    await act(hr, id, 'request-changes', { reason: 'Redo the key' });
    expect((await reassign(hr, id, teacher2.staffId)).status).toBe(200);
    // Not reachable through the API any more; the approval still checks who handed it in.
    await ctx.db
      .update(opsStaffTasks)
      .set({ status: 'in_review' })
      .where(eq(opsStaffTasks.id, id as never));
    expect((await act(hr, id, 'approve')).status).toBe(409);
    expect((await taskDetail(ctx.db, hr, id)).status).toBe('in_review');
  });

  it('X4: assigning a multi-person draft assigns and delivers every person’s task', async () => {
    const t = (
      await create(hr, {
        ...brief(teacher.staffId, { title: 'Sample group draft', publish: false }),
        staffId: undefined,
        assignees: { [teacher.staffId]: true, [teacher2.staffId]: true },
      })
    ).data!;
    const assigned = () => ctx.db.$count(notifications, eq(notifications.kind, 'task.assigned'));
    const before = await assigned();
    expect((await act(hr, t.id, 'publish')).status).toBe(200);
    const kids = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.parentTaskId, t.id as never));
    expect(kids.map((k) => [k.status, !!k.deliveredAt])).toEqual([
      ['pending', true],
      ['pending', true],
    ]);
    expect(await assigned()).toBe(before + 2);
    for (const k of kids) {
      const kinds = await ctx.db
        .select({ kind: opsTaskEvents.kind })
        .from(opsTaskEvents)
        .where(eq(opsTaskEvents.taskId, k.id));
      expect(kinds.map((e) => e.kind)).toEqual(
        expect.arrayContaining(['status_changed', 'delivered']),
      );
    }
  });

  it('a collaborator cannot change what a task waits on', async () => {
    const t = (
      await create(hr, {
        ...brief(teacher.staffId, { title: 'Sample shared deps' }),
        visibility: 'collaborators',
        collaborators: { [collaborator.staffId]: true },
      })
    ).data!;
    const other = (await create(collaborator, { title: 'Sample own prep' })).data!;
    const res = await callRoute(
      dependencyRoute,
      authedRequest(collaborator, url(collaborator, `/${t.id}/dependencies`), {
        method: 'POST',
        json: { expectedVersion: await version(t.id), dependsOnTaskId: other.id },
      }),
      { id: t.id },
    );
    expect(res.status).toBe(403);
  });

  it('the review queue leaves out work the reader handed in for someone else', async () => {
    const hr2 = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Three' });
    const id = await started({ title: 'Sample on behalf' });
    await act(hr, id, 'submit-for-review', { completionNote: 'Sent for Asha', evidence: 'Drive' });
    expect(await queueOf(hr)).not.toContain(id);
    expect(await queueOf(hr2)).toContain(id);
  });

  it('home figures: "open" leaves out submitted work, as the teacher directory does', async () => {
    const t = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Esha' });
    await academics(t);
    const task = (await create(hr, brief(t.staffId, { title: 'Sample summary' }))).data!;
    await act(t, task.id, 'acknowledge');
    await act(t, task.id, 'start');
    await act(t, task.id, 'submit-for-review', { completionNote: 'Done', evidence: 'Drive' });
    expect(await taskDaySummary(ctx.db, t)).toMatchObject({ open: 0, submitted: 1 });
    const facts = await taskFacts(ctx.db, await tasksReach(ctx.db, hr), [t.staffId]);
    expect(facts.get(t.staffId)).toMatchObject({ open: 0 });
  });

  it('teacher task facts follow HR’s department scope, never hiding HR’s own record', async () => {
    const outsider = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Outsider' });
    const facts = await taskFacts(ctx.db, await tasksReach(ctx.db, hr), [
      outsider.staffId,
      teacher.staffId,
      hr.staffId,
    ]);
    expect([...facts.keys()].sort()).toEqual([teacher.staffId, hr.staffId].sort());
  });
});

describe('review round 3: the reviewer is independent of the owner side', () => {
  /** Assigned to the teacher; reviewer HR, backup teacher2 unless overridden. */
  const backed = async (more: Record<string, unknown> = {}) =>
    (
      await create(
        hr,
        brief(teacher.staffId, {
          title: 'Sample backed',
          backupStaffId: teacher2.staffId,
          ...more,
        }),
      )
    ).data!.id;
  const N2: [string, () => Promise<{ status: number }>][] = [
    [
      'create with the backup as reviewer',
      () =>
        create(
          hr,
          brief(teacher.staffId, {
            reviewerStaffId: teacher2.staffId,
            backupStaffId: teacher2.staffId,
          }),
        ),
    ],
    [
      'reviewer changed to the backup',
      async () => patch(hr, await backed(), { reviewerStaffId: teacher2.staffId }),
    ],
    [
      'backup changed to the reviewer',
      async () => patch(hr, await backed({ backupStaffId: null }), { backupStaffId: hr.staffId }),
    ],
    ['reassigned to the reviewer', async () => reassign(hr, await backed(), hr.staffId)],
  ];
  it.each(N2)('N2: %s → 400', async (_name, run) => {
    expect((await run()).status).toBe(400);
  });

  it('nobody turns review off on a task they own, even as its creator', async () => {
    const id = await backed({ reviewerStaffId: collaborator.staffId, backupStaffId: null });
    expect((await reassign(hr, id, hr.staffId)).status).toBe(200);
    expect((await patch(hr, id, { reviewRequired: false })).status).toBe(403);
    expect((await act(hr, id, 'complete')).status).toBe(409);
    const own = (
      await create(teacher, {
        title: 'Sample own reviewed',
        reviewRequired: true,
        reviewerStaffId: hr.staffId,
      })
    ).data!;
    expect((await patch(teacher, own.id, { reviewRequired: false })).status).toBe(403);
  });
});
