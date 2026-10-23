/**
 * HR task assignment, delivery, submission and review (owner brief 23 Oct 2026 §8–§10, §20
 * scenarios 3–9). Fictional people only. Teachers call through Academic OS's API path and the
 * marketer through Marketing OS's (D-072: a workspace's API refuses non-members).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  departments,
  notifications,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskReviews,
  opsTaskSubmissions,
  staffMembers,
} from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { hrTaskCounts } from '../../src/server/staff-tasks-hr';
import { taskDetail } from '../../src/server/task-detail';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { GET as getRoute, PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { POST as actionRoute } from '../../src/app/api/v1/staff-tasks/[id]/[action]/route';
import { POST as checklistRoute } from '../../src/app/api/v1/staff-tasks/[id]/checklist/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
let hr: StaffUser;
let teacher: StaffUser;
let teacher2: StaffUser;
let marketer: StaffUser;
let financeClerk: StaffUser;

const ZONE: Record<string, string> = { teacher: 'academic', marketing_contributor: 'marketing' };
const zone = (u: TestUser) => ZONE[u.roles[0] as string] ?? 'ops';
const url = (u: TestUser, path: string) => `/${zone(u)}/api/v1/staff-tasks${path}`;

type Task = Record<string, unknown> & { id: string; status: string; version: number };
const create = (u: TestUser, json: Record<string, unknown>) =>
  callRoute<Task & { childIds?: string[] }>(
    createRoute,
    authedRequest(u, url(u, ''), { method: 'POST', json }),
  );
const act = (u: TestUser, id: string, action: string, json: Record<string, unknown>) =>
  callRoute<Task>(
    actionRoute,
    authedRequest(u, url(u, `/${id}/${action}`), { method: 'POST', json }),
    {
      id,
      action,
    },
  );
const get = (u: TestUser, id: string) =>
  callRoute<Task>(getRoute, authedRequest(u, url(u, `/${id}`)), { id });
const list = (u: TestUser, query = '') =>
  callRoute<{ rows: Task[]; total: number }>(listRoute, authedRequest(u, url(u, query)));
const version = async (u: TestUser, id: string) => (await get(u, id)).data!.version;

async function inDept(s: StaffUser, code: string) {
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, code));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: d!.id })
    .where(eq(staffMembers.id, s.staffId));
}
const notesFor = (u: TestUser) =>
  ctx.db.select().from(notifications).where(eq(notifications.userId, u.id));

const due = addDays(today, 3);
const brief = (staffId: string, more: Record<string, unknown> = {}) => ({
  title: 'Sample Class 12 integration practice sheet',
  staffId,
  category: 'Worksheet',
  expectedDeliverable: 'Practice sheet with an answer key',
  acceptanceCriteria: '20 questions, answer key included',
  reviewRequired: true,
  reviewerStaffId: hr.staffId,
  dueOn: due,
  dueTime: '17:00',
  checklist: 'Write 20 questions\nWrite the answer key',
  ...more,
});

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher One' });
  teacher2 = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Two' });
  marketer = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' });
  financeClerk = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance' });
  for (const s of [hr, teacher, teacher2]) await inDept(s, 'ACADEMICS');
  await inDept(marketer, 'MARKETING_GROWTH');
  await inDept(financeClerk, 'FINANCE');
});

describe('HR assigns, the teacher submits, HR reviews (brief §20)', () => {
  let id: string;

  it('scenario 3: HR assigns to a teacher → My Tasks, in-app notification, delivered_at', async () => {
    const t = await create(hr, brief(teacher.staffId));
    expect(t.status).toBe(201);
    id = t.data!.id;
    expect(t.data).toMatchObject({ status: 'pending', acknowledgedAt: null, originalDueOn: due });
    expect(t.data!.deliveredAt).toEqual(expect.any(String));
    const mine = await list(teacher, `?staffId=${teacher.staffId}&open=1`);
    expect(mine.data!.rows.map((r) => r.id)).toContain(id);
    expect(mine.data!.rows.find((r) => r.id === id)).toMatchObject({
      expectedDeliverable: 'Practice sheet with an answer key',
    });
    const [note] = await notesFor(teacher);
    expect(note).toMatchObject({ kind: 'task.assigned', link: `/academic/tasks/${id}` });
    const d = await taskDetail(ctx.db, teacher, id);
    expect(d.checklist.map((c) => c.text)).toEqual(['Write 20 questions', 'Write the answer key']);
    expect(d.next?.label).toBe('Acknowledge');
  });

  it('scenario 4: the teacher submits the worksheet → HR sees it awaiting review', async () => {
    await act(teacher, id, 'acknowledge', { expectedVersion: 1 });
    await act(teacher, id, 'start', { expectedVersion: 2 });
    const item = (await taskDetail(ctx.db, teacher, id)).checklist[0]!;
    const tick = await callRoute(
      checklistRoute,
      authedRequest(teacher, url(teacher, `/${id}/checklist`), {
        method: 'POST',
        json: { itemId: item.id, done: true },
      }),
      { id },
    );
    expect(tick.status).toBe(200);
    expect((await act(teacher, id, 'submit-for-review', { expectedVersion: 3 })).status).toBe(400);
    const noDeliverable = await act(teacher, id, 'submit-for-review', {
      expectedVersion: 3,
      completionNote: 'Sheet written',
    });
    expect(noDeliverable.status).toBe(400);
    const sent = await act(teacher, id, 'submit-for-review', {
      expectedVersion: 3,
      completionNote: 'Sheet written',
      evidence: 'Shared drive: Class 12 / integration v1 (sample)',
    });
    expect(sent.data).toMatchObject({ status: 'in_review' });
    expect(sent.data!.firstSubmittedAt).toEqual(sent.data!.lastSubmittedAt);
    const queue = await list(hr, '?status=in_review&sort=submitted');
    expect(queue.data!.rows.map((r) => r.id)).toContain(id);
    expect((await notesFor(hr)).map((n) => n.kind)).toContain('task.submitted');
    // Duplicate submit: the stale version is refused, nothing new is stored.
    expect(
      (
        await act(teacher, id, 'submit-for-review', {
          expectedVersion: 3,
          completionNote: 'x',
          evidence: 'y',
        })
      ).status,
    ).toBe(409);
  });

  it('scenario 5: HR requests the answer key → the teacher resubmits as version 2', async () => {
    const v = await version(hr, id);
    expect((await act(hr, id, 'request-changes', { expectedVersion: v })).status).toBe(400);
    const asked = await act(hr, id, 'request-changes', {
      expectedVersion: v,
      reason: 'Please attach the answer key.',
    });
    expect(asked.data).toMatchObject({ status: 'changes_requested' });
    expect((await notesFor(teacher)).map((n) => n.kind)).toContain('task.changes_requested');
    expect((await taskDetail(ctx.db, teacher, id)).next?.label).toBe('Respond to changes');
    const again = await act(teacher, id, 'submit-for-review', {
      expectedVersion: v + 1,
      completionNote: 'Answer key added',
      evidence: 'Shared drive: Class 12 / integration v2 (sample)',
    });
    expect(again.data).toMatchObject({ status: 'in_review' });
    expect(again.data!.lastSubmittedAt).not.toEqual(again.data!.firstSubmittedAt);
  });

  it('scenario 6: approval keeps both versions and the review history', async () => {
    const done = await act(hr, id, 'approve', { expectedVersion: await version(hr, id) });
    expect(done.data).toMatchObject({ status: 'done' });
    expect(done.data!.approvedAt).toEqual(expect.any(String));
    const subs = await ctx.db
      .select()
      .from(opsTaskSubmissions)
      .where(eq(opsTaskSubmissions.taskId, id as never));
    expect(subs.map((s) => s.version).sort()).toEqual([1, 2]);
    const reviews = await ctx.db
      .select()
      .from(opsTaskReviews)
      .where(eq(opsTaskReviews.taskId, id as never));
    const byVersion = (sid: string | null) => subs.find((s) => s.id === sid)!.version;
    expect(reviews.map((r) => [r.decision, byVersion(r.submissionId), r.note])).toEqual([
      ['changes_requested', 1, 'Please attach the answer key.'],
      ['approved', 2, null],
    ]);
    const d = await taskDetail(ctx.db, teacher, id);
    expect(d.submissions.map((s) => s.submittedBy)).toEqual([
      'Sample Teacher One',
      'Sample Teacher One',
    ]);
    expect(d.onTime).toBe(true);
  });

  it('only the reviewer or a listed role reopens an approved task, with a reason', async () => {
    const v = await version(hr, id);
    expect((await act(teacher, id, 'reopen', { expectedVersion: v, reason: 'x' })).status).toBe(
      403,
    );
    expect((await act(hr, id, 'reopen', { expectedVersion: v })).status).toBe(400);
    const back = await act(hr, id, 'reopen', { expectedVersion: v, reason: 'Key has an error' });
    expect(back.data).toMatchObject({ status: 'in_progress', approvedAt: null });
  });
});

describe('delivery to Marketing, deadlines and timeliness', () => {
  it('scenario 7: a task assigned to a marketer is available through Marketing OS', async () => {
    const t = await create(hr, {
      title: 'Sample three IPMAT campaign creatives',
      staffId: marketer.staffId,
      expectedDeliverable: 'Source files and previews',
      reviewRequired: true,
      reviewerStaffId: hr.staffId,
      dueOn: due,
      dueTime: '16:00',
    });
    expect(t.status).toBe(201);
    expect((await get(marketer, t.data!.id)).status).toBe(200);
    const [note] = await notesFor(marketer);
    expect(note!.link).toBe(`/marketing/tasks/${t.data!.id}`);
    // Ops' own API refuses a marketer (D-072): the task lives in their workspace, never a copy.
    const viaOps = await callRoute(
      getRoute,
      authedRequest(marketer, `/ops/api/v1/staff-tasks/${t.data!.id}`),
      {
        id: t.data!.id,
      },
    );
    expect(viaOps.status).toBe(403);
    expect(
      await ctx.db.$count(
        opsStaffTasks,
        eq(opsStaffTasks.title, 'Sample three IPMAT campaign creatives'),
      ),
    ).toBe(1);
  });

  it('scenario 8: a deadline change needs a reason and keeps the original deadline', async () => {
    const t = (await create(hr, brief(teacher.staffId, { title: 'Sample deadline move' }))).data!;
    const patch = (json: Record<string, unknown>) =>
      callRoute<Task>(
        patchRoute,
        authedRequest(hr, url(hr, `/${t.id}`), { method: 'PATCH', json }),
        {
          id: t.id,
        },
      );
    const later = addDays(today, 6);
    const noReason = await patch({ expectedVersion: 1, dueOn: later });
    expect(noReason.status).toBe(400);
    expect(noReason.error!.details).toEqual([expect.objectContaining({ path: ['changeReason'] })]);
    const moved = await patch({ expectedVersion: 1, dueOn: later, changeReason: 'Exam moved' });
    expect(moved.data).toMatchObject({ dueOn: later, originalDueOn: due });
    const [ev] = await ctx.db
      .select()
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.taskId, t.id as never), eq(opsTaskEvents.kind, 'due_changed')));
    expect(ev).toMatchObject({ reason: 'Exam moved', data: { fromDueOn: due, toDueOn: later } });
  });

  it('scenario 9: an on-time submission stays on time when it is approved after the deadline', async () => {
    const t = (await create(hr, brief(teacher.staffId, { title: 'Sample on time' }))).data!;
    await act(teacher, t.id, 'acknowledge', { expectedVersion: 1 });
    await act(teacher, t.id, 'start', { expectedVersion: 2 });
    await act(teacher, t.id, 'submit-for-review', {
      expectedVersion: 3,
      completionNote: 'Done early',
      evidence: 'Shared drive (sample)',
    });
    // Submitted 3 days ago, due 2 days ago (both moved back in time); HR approves only now.
    const sent = new Date(`${addDays(today, -3)}T10:00:00+05:30`);
    await ctx.db
      .update(opsStaffTasks)
      .set({
        dueOn: addDays(today, -2),
        originalDueOn: addDays(today, -2),
        firstSubmittedAt: sent,
        lastSubmittedAt: sent,
      })
      .where(eq(opsStaffTasks.id, t.id as never));
    const done = await act(hr, t.id, 'approve', { expectedVersion: 4 });
    expect(done.data).toMatchObject({ status: 'done' });
    const d = await taskDetail(ctx.db, hr, t.id);
    expect(new Date(d.approvedAt!) > new Date(`${addDays(today, -2)}T23:59:00+05:30`)).toBe(true);
    expect(d.onTime).toBe(true);
  });
});

describe('several assignees, drafts, blocked flag and scope', () => {
  it('one request for several people: a parent and independent children', async () => {
    const t = await create(hr, {
      ...brief(teacher.staffId, { title: 'Sample chapter test papers' }),
      staffId: undefined,
      assignees: { [teacher.staffId]: true, [teacher2.staffId]: true, [marketer.staffId]: false },
    });
    expect(t.status).toBe(201);
    const [a, b] = t.data!.childIds!;
    expect(t.data).toMatchObject({ staffId: hr.staffId });
    expect(t.data!.childIds).toHaveLength(2);
    await act(teacher, a!, 'acknowledge', { expectedVersion: 1 });
    await act(teacher, a!, 'start', { expectedVersion: 2 });
    await act(teacher, a!, 'submit-for-review', {
      expectedVersion: 3,
      completionNote: 'Done',
      evidence: 'x',
    });
    await act(hr, a!, 'approve', { expectedVersion: 4 });
    expect((await get(teacher2, b!)).data).toMatchObject({ status: 'pending' });
    expect((await taskDetail(ctx.db, hr, t.data!.id)).group).toEqual({ total: 2, done: 1 });
    expect((await get(teacher, b!)).status).toBe(404);
    // The parent is HR's container, not work in HR's own task list for the day.
    const mine = await list(hr, `?staffId=${hr.staffId}&groups=exclude`);
    expect(mine.data!.rows.map((r) => r.id)).not.toContain(t.data!.id);
  });

  it('a draft is invisible to the assignee until it is assigned, then delivered', async () => {
    const t = (await create(hr, brief(teacher2.staffId, { title: 'Sample draft', publish: false })))
      .data!;
    expect(t).toMatchObject({ status: 'draft', deliveredAt: null });
    expect((await get(teacher2, t.id)).status).toBe(404);
    expect((await list(teacher2)).data!.rows.map((r) => r.id)).not.toContain(t.id);
    const before = (await notesFor(teacher2)).length;
    const out = await act(hr, t.id, 'publish', { expectedVersion: 1 });
    expect(out.data).toMatchObject({ status: 'pending', deliveredAt: expect.any(String) });
    expect((await get(teacher2, t.id)).status).toBe(200);
    expect((await notesFor(teacher2)).length).toBe(before + 1);
  });

  it('blocked is a flag with a reason: the status is kept', async () => {
    const t = (await create(hr, brief(teacher.staffId, { title: 'Sample blocked' }))).data!;
    await act(teacher, t.id, 'acknowledge', { expectedVersion: 1 });
    await act(teacher, t.id, 'start', { expectedVersion: 2 });
    expect((await act(teacher, t.id, 'block', { expectedVersion: 3 })).status).toBe(400);
    const b = await act(teacher, t.id, 'block', {
      expectedVersion: 3,
      reason: 'No projector room',
    });
    expect(b.data).toMatchObject({
      status: 'in_progress',
      blockedKind: 'blocked',
      blockedReason: 'No projector room',
    });
    expect((await list(hr, '?flag=blocked')).data!.rows.map((r) => r.id)).toContain(t.id);
    const r = await act(teacher, t.id, 'resume', { expectedVersion: 4 });
    expect(r.data).toMatchObject({ status: 'in_progress', blockedAt: null });
  });

  it('HR assigns only within hr.staff_scope_departments', async () => {
    expect((await create(hr, brief(financeClerk.staffId, { reviewerStaffId: null }))).status).toBe(
      403,
    );
  });

  it('the HR Overview counts link to the filtered lists', async () => {
    const counts = await hrTaskCounts(ctx.db, hr);
    expect(counts.map((c) => c.key)).toEqual([
      'tasks_due_today',
      'tasks_overdue',
      'tasks_blocked',
      'tasks_awaiting_approval',
      'tasks_draft',
    ]);
    expect(counts.find((c) => c.key === 'tasks_awaiting_approval')).toMatchObject({
      value: expect.any(Number),
      href: '/ops/hr/review',
    });
  });
});

describe('IDOR and self-review (brief §5, §20 scenario 14)', () => {
  it('another teacher changing the task id gets 404 on read, submit, checklist and review', async () => {
    const t = (await create(hr, brief(teacher.staffId, { title: 'Sample private' }))).data!;
    expect((await get(teacher2, t.id)).status).toBe(404);
    expect((await act(teacher2, t.id, 'acknowledge', { expectedVersion: 1 })).status).toBe(404);
    expect(
      (await act(teacher2, t.id, 'submit-for-review', { expectedVersion: 1, completionNote: 'x' }))
        .status,
    ).toBe(404);
    expect((await act(teacher2, t.id, 'approve', { expectedVersion: 1 })).status).toBe(404);
    const tick = await callRoute(
      checklistRoute,
      authedRequest(teacher2, url(teacher2, `/${t.id}/checklist`), {
        method: 'POST',
        json: { itemId: t.id, done: true },
      }),
      { id: t.id },
    );
    expect(tick.status).toBe(404);
    expect((await list(teacher2, `?staffId=${teacher.staffId}`)).data!.total).toBe(0);
  });

  it('nobody approves their own submission', async () => {
    const own = (
      await create(hr, brief(hr.staffId, { title: 'Sample HR own work', reviewerStaffId: null }))
    ).data!;
    await act(hr, own.id, 'start', { expectedVersion: 1 });
    await act(hr, own.id, 'submit-for-review', {
      expectedVersion: 2,
      completionNote: 'x',
      evidence: 'y',
    });
    expect((await act(hr, own.id, 'approve', { expectedVersion: 3 })).status).toBe(403);
  });
});
