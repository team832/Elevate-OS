import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  notifications,
  opsTaskComments,
  opsTaskReminders,
  opsTasks,
} from '@elevate/database';
import type { DepartmentId } from '@elevate/shared-types';
import { GET as listTasks, POST as createTask } from '../../src/app/api/v1/tasks/route';
import { GET as getTask } from '../../src/app/api/v1/tasks/[id]/route';
import { POST as setStatus } from '../../src/app/api/v1/tasks/[id]/status/route';
import {
  GET as listComments,
  POST as addComment,
} from '../../src/app/api/v1/tasks/[id]/comments/route';
import { POST as hideComment } from '../../src/app/api/v1/tasks/[id]/comments/[commentId]/hide/route';
import { POST as addReference } from '../../src/app/api/v1/tasks/[id]/references/route';
import { POST as removeReference } from '../../src/app/api/v1/tasks/[id]/references/[referenceId]/remove/route';
import {
  DELETE as removeRequirement,
  PUT as requireReview,
} from '../../src/app/api/v1/tasks/[id]/review-requirement/route';
import { POST as decideReview } from '../../src/app/api/v1/tasks/[id]/review/route';
import { GET as activity } from '../../src/app/api/v1/tasks/[id]/activity/route';
import { PATCH as patchTask } from '../../src/app/api/v1/tasks/[id]/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { runTaskReminders } from '../../src/server/escalations';
import { isoDaysFromNow, setupReference, type StaffUser } from './fixtures';
import { department, get, post, staffIn, statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
const runReminders = (req: Request) =>
  runJob(req, { params: Promise.resolve({ job: 'task-reminders' }) });
let manager: StaffUser;
let manager2: StaffUser;
let counsellor: StaffUser;
let counsellor2: StaffUser;
let teacher: StaffUser;
let deptId: DepartmentId;

type Task = { id: string; code: string; status: string };

beforeAll(async () => {
  await setupReference(ctx.db);
  deptId = (await department(ctx.db, 'Operations test desk (fictional)')).id;
  manager = await staffIn(ctx.db, ['operations_manager']);
  manager2 = await staffIn(ctx.db, ['operations_manager']);
  counsellor = await staffIn(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  counsellor2 = await staffIn(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  teacher = await staffIn(ctx.db, ['teacher'], { managerId: manager.staffId });
});

const task = async (over: Record<string, unknown> = {}, as: StaffUser = manager) => {
  const r = await callRoute<Task>(
    createTask,
    post(as, {
      title: 'Operations test task (fictional)',
      ownerStaffId: counsellor.staffId,
      dueDate: isoDaysFromNow(3),
      ...over,
    }),
  );
  expect(r.status).toBe(201);
  return r.data!;
};
const audits = (entityId: string, action: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
const notes = (userId: string, kind: string) =>
  ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId as never), eq(notifications.kind, kind)));

describe('task comments (append-only, hidden with a reason)', () => {
  it('401 / 403 / 400 / 201 and own scope', async () => {
    const { id } = await task();
    const anon = new Request('http://localhost/ops/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(await statusOf(addComment, anon, { id })).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect(await statusOf(addComment, post(auditor, { body: 'x' }), { id })).toBe(403);
    expect(await statusOf(addComment, post(counsellor, { body: '' }), { id })).toBe(400);
    // own scope: not owner/accountable/backup
    expect(await statusOf(addComment, post(counsellor2, { body: 'Not mine' }), { id })).toBe(403);
    const body = 'Called the parent; waiting for the form.';
    expect(await statusOf(addComment, post(counsellor, { body }), { id })).toBe(201);
    expect(await audits(id, 'task.comment_added')).toHaveLength(1);
  });

  it('only the author or a manager hides; the reason is kept; hidden body withheld from own-scope readers', async () => {
    const { id } = await task({ backupStaffId: teacher.staffId });
    const body = 'Wrong number recorded (fictional).';
    const hiddenReason = 'Posted on the wrong task';
    const c = await callRoute<{ id: string }>(addComment, post(counsellor, { body }), { id });
    const at = { id, commentId: c.data!.id };
    expect(await statusOf(hideComment, post(teacher, { reason: 'mine now' }), at)).toBe(403);
    expect(await statusOf(hideComment, post(counsellor, { reason: '' }), at)).toBe(400);
    expect(await statusOf(hideComment, post(counsellor, { reason: hiddenReason }), at)).toBe(200);
    expect(await statusOf(hideComment, post(manager, { reason: 'again' }), at)).toBe(409);
    const [row] = await ctx.db
      .select()
      .from(opsTaskComments)
      .where(eq(opsTaskComments.id, at.commentId as never));
    expect(row).toMatchObject({ body, hiddenReason });
    type C = { id: string; body: string | null; hidden: boolean; hiddenReason: string };
    const asOwner = await callRoute<C[]>(listComments, get(counsellor), { id });
    expect(asOwner.data?.[0]).toMatchObject({ hidden: true, body: null, hiddenReason });
    const asManager = await callRoute<C[]>(listComments, get(manager), { id });
    expect(asManager.data?.[0]?.body).toBe(body);
    expect(await audits(id, 'task.comment_hidden')).toHaveLength(1);
  });
});

describe('task document references', () => {
  it('stores label + location only; unsafe links are rejected; removal needs a reason', async () => {
    const { id } = await task();
    const unsafe = { label: 'Form', location: 'javascript:alert(1)' };
    expect(await statusOf(addReference, post(counsellor, unsafe), { id })).toBe(400);
    const ref = await callRoute<{ id: string }>(
      addReference,
      post(counsellor, {
        label: 'Signed form',
        location: 'Admissions drive › 2026 › forms',
        kind: 'evidence',
      }),
      { id },
    );
    expect(ref.status).toBe(201);
    const at = { id, referenceId: ref.data!.id };
    expect(await statusOf(removeReference, post(counsellor2, { reason: 'x' }), at)).toBe(403);
    expect(
      await statusOf(removeReference, post(counsellor, { reason: 'Superseded by v2' }), at),
    ).toBe(200);
  });
});

describe('task ownership, completion with evidence and blockers', () => {
  it('completion needs evidence; only the owner (or manager) changes status', async () => {
    const { id } = await task();
    expect(await statusOf(setStatus, post(counsellor, { to: 'completed' }), { id })).toBe(400);
    expect(
      await statusOf(setStatus, post(counsellor2, { to: 'completed', completionNote: 'x' }), {
        id,
      }),
    ).toBe(403);
    const done = await callRoute<{ status: string; awaitingReview: boolean }>(
      setStatus,
      post(counsellor, { to: 'completed', evidenceLink: 'https://example.test/evidence' }),
      { id },
    );
    expect(done.data).toMatchObject({ status: 'completed', awaitingReview: false });
  });
});

describe('supervisor review (completed → awaiting review)', () => {
  it('manager-only requirement; completion opens a review; completer/owner cannot decide; accountable accepts', async () => {
    const { id } = await task({ accountableStaffId: manager2.staffId });
    expect(await statusOf(requireReview, post(counsellor, {}, 'PUT'), { id })).toBe(403);
    const ownerAsReviewer = post(manager, { reviewerStaffId: counsellor.staffId }, 'PUT');
    expect(await statusOf(requireReview, ownerAsReviewer, { id })).toBe(400); // reviewer = owner
    expect(await statusOf(requireReview, post(manager, {}, 'PUT'), { id })).toBe(200);
    const done = await callRoute<{ awaitingReview: boolean; status: string }>(
      setStatus,
      post(counsellor, { to: 'completed', completionNote: 'Forms filed (fictional).' }),
      { id },
    );
    expect(done.data).toMatchObject({ status: 'completed', awaitingReview: true });
    expect(await notes(manager2.id, 'task.review_requested')).toHaveLength(1);
    const view = await callRoute<Task[]>(listTasks, get(manager, '/x?view=awaiting_review'));
    expect(view.data?.map((x) => x.id)).toContain(id);
    // The owner cannot reopen while a review is pending
    const reopen = post(counsellor, { to: 'in_progress', reason: 'oops' });
    expect(await statusOf(setStatus, reopen, { id })).toBe(409);
    // Neither the completer / owner nor a counsellor who is not the reviewer can decide
    for (const u of [counsellor, counsellor2])
      expect(await statusOf(decideReview, post(u, { decision: 'accept' }), { id })).toBe(403);
    const accepted = await callRoute<{ status: string }>(
      decideReview,
      post(manager2, { decision: 'accept' }),
      { id },
    );
    expect(accepted.data?.status).toBe('accepted');
    expect(await audits(id, 'task.review_accepted')).toHaveLength(1);
  });

  it('return needs a note and reopens the task; the next completion opens cycle 2', async () => {
    const { id } = await task();
    await callRoute(requireReview, post(manager, {}, 'PUT'), { id });
    await callRoute(setStatus, post(counsellor, { to: 'completed', completionNote: 'Done' }), {
      id,
    });
    expect(await statusOf(decideReview, post(manager, { decision: 'return' }), { id })).toBe(400);
    // review pending
    expect(await statusOf(removeRequirement, post(manager, undefined, 'DELETE'), { id })).toBe(409);
    const note = 'Attach the receipt reference.';
    expect(await statusOf(decideReview, post(manager, { decision: 'return', note }), { id })).toBe(
      200,
    );
    const [row] = await ctx.db
      .select()
      .from(opsTasks)
      .where(eq(opsTasks.id, id as never));
    expect(row).toMatchObject({ status: 'in_progress', completedAt: null });
    const again = post(counsellor, { to: 'completed', completionNote: 'Receipt REF-1' });
    await callRoute(setStatus, again, { id });
    type D = { review: { state: string; history: { cycle: number; status: string }[] } };
    const d = await callRoute<D>(getTask, get(manager), { id });
    expect(d.data?.review.state).toBe('awaiting_review');
    expect(d.data?.review.history.map((h) => [h.cycle, h.status])).toEqual([
      [2, 'pending'],
      [1, 'returned'],
    ]);
  });
});

describe('activity history', () => {
  it('shows reassignment, status change, comments and review steps from the audit log', async () => {
    const { id } = await task();
    await callRoute(patchTask, post(manager, { ownerStaffId: counsellor2.staffId }, 'PATCH'), {
      id,
    });
    const block = post(counsellor2, { to: 'blocked', reason: 'Waiting for fee slip' });
    await callRoute(setStatus, block, { id });
    await callRoute(addComment, post(counsellor2, { body: 'Chased accounts.' }), { id });
    const a = await callRoute<{ kind: string; summary: string }[]>(activity, get(counsellor2), {
      id,
    });
    expect(a.status).toBe(200);
    expect(a.data!.map((x) => x.kind)).toEqual(['comment', 'status', 'reassignment', 'created']);
    expect(a.data![1]!.summary).toContain('Waiting for fee slip');
    expect(await statusOf(activity, get(teacher), { id })).toBe(403);
  });
});

describe('views, filters and pagination', () => {
  it('department and backup filters; page meta; teacher still sees only own tasks', async () => {
    const a = await task({
      departmentId: deptId,
      backupStaffId: teacher.staffId,
      title: 'Filter A (fictional)',
    });
    await task({ departmentId: deptId, title: 'Filter B (fictional)' });
    const byDept = await callRoute<Task[]>(
      listTasks,
      get(manager, `/x?view=open&departmentId=${deptId}&page=1&pageSize=1`),
    );
    expect(byDept.data).toHaveLength(1);
    expect(byDept.ok && byDept.meta).toMatchObject({
      total: 2,
      pageNumber: 1,
      pageSize: 1,
      pages: 2,
    });
    const backup = await callRoute<(Task & { backupStaffId: string })[]>(
      listTasks,
      get(manager, `/x?view=open&staffId=${teacher.staffId}&role=backup`),
    );
    expect(backup.data?.map((x) => x.id)).toContain(a.id);
    expect(backup.data?.every((x) => x.backupStaffId === teacher.staffId)).toBe(true);
    const mineBackup = await callRoute<Task[]>(listTasks, get(teacher, '/x?view=mine&role=backup'));
    expect(mineBackup.data?.map((x) => x.id)).toContain(a.id);
    const search = await callRoute<Task[]>(listTasks, get(manager, '/x?view=open&q=Filter%20B'));
    expect(search.data).toHaveLength(1);
    expect(await statusOf(listTasks, get(manager, '/x?pageSize=0'))).toBe(400);
  });
});

describe('reminder job (due soon, overdue; idempotent)', () => {
  it('manager-only route; once per task and due date; backup told when overdue', async () => {
    const overdue = await task({ dueDate: isoDaysFromNow(-2), backupStaffId: teacher.staffId });
    const soon = await task({ dueDate: isoDaysFromNow(1) });
    expect(await statusOf(runReminders, post(counsellor))).toBe(403);
    const r1 = await callRoute<{ sent: { taskCode: string; kind: string }[] }>(
      runReminders,
      post(manager),
    );
    expect(r1.status).toBe(200);
    expect(r1.data?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskCode: overdue.code, kind: 'overdue' }),
        expect.objectContaining({ taskCode: soon.code, kind: 'due_soon' }),
      ]),
    );
    const again = await runTaskReminders(ctx.db, {});
    expect(again.sent.filter((s) => [overdue.code, soon.code].includes(s.taskCode))).toEqual([]);
    const rows = await ctx.db
      .select()
      .from(opsTaskReminders)
      .where(eq(opsTaskReminders.taskId, overdue.id as never));
    expect(rows).toHaveLength(1);
    expect((await notes(teacher.id, 'task.overdue')).length).toBeGreaterThanOrEqual(1);
  });
});
