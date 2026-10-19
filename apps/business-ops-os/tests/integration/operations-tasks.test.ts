import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
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
import { department, post, staffIn } from './operations-fixtures';

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

describe('task comments (append-only, hidden with a reason)', () => {
  it('401 / 403 / 400 / 201 and own scope', async () => {
    const t = await task();
    const anon = new Request('http://localhost/ops/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect((await callRoute(addComment, anon, { id: t.id })).status).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await callRoute(addComment, post(auditor, { body: 'x' }), { id: t.id })).status).toBe(
      403,
    );
    expect((await callRoute(addComment, post(counsellor, { body: '' }), { id: t.id })).status).toBe(
      400,
    );
    expect(
      (await callRoute(addComment, post(counsellor2, { body: 'Not mine' }), { id: t.id })).status,
    ).toBe(403); // own scope: not owner/accountable/backup
    const ok = await callRoute<{ id: string }>(
      addComment,
      post(counsellor, { body: 'Called the parent; waiting for the form.' }),
      { id: t.id },
    );
    expect(ok.status).toBe(201);
    expect(await audits(t.id, 'task.comment_added')).toHaveLength(1);
  });

  it('only the author or a manager hides; the reason is kept; hidden body withheld from own-scope readers', async () => {
    const t = await task({ backupStaffId: teacher.staffId });
    const c = await callRoute<{ id: string }>(
      addComment,
      post(counsellor, { body: 'Wrong number recorded (fictional).' }),
      { id: t.id },
    );
    const cid = c.data!.id;
    expect(
      (
        await callRoute(hideComment, post(teacher, { reason: 'mine now' }), {
          id: t.id,
          commentId: cid,
        })
      ).status,
    ).toBe(403);
    expect(
      (await callRoute(hideComment, post(counsellor, { reason: '' }), { id: t.id, commentId: cid }))
        .status,
    ).toBe(400);
    expect(
      (
        await callRoute(hideComment, post(counsellor, { reason: 'Posted on the wrong task' }), {
          id: t.id,
          commentId: cid,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callRoute(hideComment, post(manager, { reason: 'again' }), {
          id: t.id,
          commentId: cid,
        })
      ).status,
    ).toBe(409);
    const [row] = await ctx.db
      .select()
      .from(opsTaskComments)
      .where(eq(opsTaskComments.id, cid as never));
    expect(row).toMatchObject({
      body: 'Wrong number recorded (fictional).',
      hiddenReason: 'Posted on the wrong task',
    });
    type C = { id: string; body: string | null; hidden: boolean; hiddenReason: string };
    const asOwner = await callRoute<C[]>(listComments, authedRequest(counsellor, '/x'), {
      id: t.id,
    });
    expect(asOwner.data?.[0]).toMatchObject({
      hidden: true,
      body: null,
      hiddenReason: 'Posted on the wrong task',
    });
    const asManager = await callRoute<C[]>(listComments, authedRequest(manager, '/x'), {
      id: t.id,
    });
    expect(asManager.data?.[0]?.body).toBe('Wrong number recorded (fictional).');
    expect(await audits(t.id, 'task.comment_hidden')).toHaveLength(1);
  });
});

describe('task document references', () => {
  it('stores label + location only; unsafe links are rejected; removal needs a reason', async () => {
    const t = await task();
    expect(
      (
        await callRoute(
          addReference,
          post(counsellor, { label: 'Form', location: 'javascript:alert(1)' }),
          { id: t.id },
        )
      ).status,
    ).toBe(400);
    const ref = await callRoute<{ id: string }>(
      addReference,
      post(counsellor, {
        label: 'Signed form',
        location: 'Admissions drive › 2026 › forms',
        kind: 'evidence',
      }),
      { id: t.id },
    );
    expect(ref.status).toBe(201);
    expect(
      (
        await callRoute(removeReference, post(counsellor2, { reason: 'x' }), {
          id: t.id,
          referenceId: ref.data!.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callRoute(removeReference, post(counsellor, { reason: 'Superseded by v2' }), {
          id: t.id,
          referenceId: ref.data!.id,
        })
      ).status,
    ).toBe(200);
  });
});

describe('task ownership, completion with evidence and blockers', () => {
  it('completion needs evidence; only the owner (or manager) changes status', async () => {
    const t = await task();
    expect(
      (await callRoute(setStatus, post(counsellor, { to: 'completed' }), { id: t.id })).status,
    ).toBe(400);
    expect(
      (
        await callRoute(setStatus, post(counsellor2, { to: 'completed', completionNote: 'x' }), {
          id: t.id,
        })
      ).status,
    ).toBe(403);
    const done = await callRoute<{ status: string; awaitingReview: boolean }>(
      setStatus,
      post(counsellor, { to: 'completed', evidenceLink: 'https://example.test/evidence' }),
      { id: t.id },
    );
    expect(done.data).toMatchObject({ status: 'completed', awaitingReview: false });
  });
});

describe('supervisor review (completed → awaiting review)', () => {
  it('manager-only requirement; completion opens a review; completer/owner cannot decide; accountable accepts', async () => {
    const t = await task({ accountableStaffId: manager2.staffId });
    expect((await callRoute(requireReview, post(counsellor, {}, 'PUT'), { id: t.id })).status).toBe(
      403,
    );
    expect(
      (
        await callRoute(
          requireReview,
          post(manager, { reviewerStaffId: counsellor.staffId }, 'PUT'),
          {
            id: t.id,
          },
        )
      ).status,
    ).toBe(400); // reviewer = owner
    expect((await callRoute(requireReview, post(manager, {}, 'PUT'), { id: t.id })).status).toBe(
      200,
    );
    const done = await callRoute<{ awaitingReview: boolean; status: string }>(
      setStatus,
      post(counsellor, { to: 'completed', completionNote: 'Forms filed (fictional).' }),
      { id: t.id },
    );
    expect(done.data).toMatchObject({ status: 'completed', awaitingReview: true });
    const reviewNotes = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, manager2.id), eq(notifications.kind, 'task.review_requested')),
      );
    expect(reviewNotes).toHaveLength(1);
    // Listed in the awaiting_review view
    const view = await callRoute<Task[]>(
      listTasks,
      authedRequest(manager, '/x?view=awaiting_review'),
    );
    expect(view.data?.map((x) => x.id)).toContain(t.id);
    // The owner cannot reopen while a review is pending
    expect(
      (
        await callRoute(setStatus, post(counsellor, { to: 'in_progress', reason: 'oops' }), {
          id: t.id,
        })
      ).status,
    ).toBe(409);
    // The completer / owner cannot decide (counsellor has own-scope write)
    expect(
      (await callRoute(decideReview, post(counsellor, { decision: 'accept' }), { id: t.id }))
        .status,
    ).toBe(403);
    // A counsellor who is not the reviewer cannot decide
    expect(
      (await callRoute(decideReview, post(counsellor2, { decision: 'accept' }), { id: t.id }))
        .status,
    ).toBe(403);
    const accepted = await callRoute<{ status: string }>(
      decideReview,
      post(manager2, { decision: 'accept' }),
      { id: t.id },
    );
    expect(accepted.data?.status).toBe('accepted');
    expect(await audits(t.id, 'task.review_accepted')).toHaveLength(1);
  });

  it('return needs a note and reopens the task; the next completion opens cycle 2', async () => {
    const t = await task();
    await callRoute(requireReview, post(manager, {}, 'PUT'), { id: t.id });
    await callRoute(setStatus, post(counsellor, { to: 'completed', completionNote: 'Done' }), {
      id: t.id,
    });
    expect(
      (await callRoute(decideReview, post(manager, { decision: 'return' }), { id: t.id })).status,
    ).toBe(400);
    expect(
      (await callRoute(removeRequirement, post(manager, undefined, 'DELETE'), { id: t.id })).status,
    ).toBe(409); // review pending
    const returned = await callRoute(
      decideReview,
      post(manager, { decision: 'return', note: 'Attach the receipt reference.' }),
      { id: t.id },
    );
    expect(returned.status).toBe(200);
    const [row] = await ctx.db
      .select()
      .from(opsTasks)
      .where(eq(opsTasks.id, t.id as never));
    expect(row).toMatchObject({ status: 'in_progress', completedAt: null });
    await callRoute(
      setStatus,
      post(counsellor, { to: 'completed', completionNote: 'Receipt REF-1' }),
      {
        id: t.id,
      },
    );
    type D = { review: { state: string; history: { cycle: number; status: string }[] } };
    const d = await callRoute<D>(getTask, authedRequest(manager, '/x'), { id: t.id });
    expect(d.data?.review.state).toBe('awaiting_review');
    expect(d.data?.review.history.map((h) => [h.cycle, h.status])).toEqual([
      [2, 'pending'],
      [1, 'returned'],
    ]);
  });
});

describe('activity history', () => {
  it('shows reassignment, status change, comments and review steps from the audit log', async () => {
    const t = await task();
    await callRoute(patchTask, post(manager, { ownerStaffId: counsellor2.staffId }, 'PATCH'), {
      id: t.id,
    });
    await callRoute(
      setStatus,
      post(counsellor2, { to: 'blocked', reason: 'Waiting for fee slip' }),
      {
        id: t.id,
      },
    );
    await callRoute(addComment, post(counsellor2, { body: 'Chased accounts.' }), { id: t.id });
    const a = await callRoute<{ kind: string; summary: string }[]>(
      activity,
      authedRequest(counsellor2, '/x'),
      { id: t.id },
    );
    expect(a.status).toBe(200);
    const kinds = a.data!.map((x) => x.kind);
    expect(kinds).toEqual(['comment', 'status', 'reassignment', 'created']);
    expect(a.data![1]!.summary).toContain('Waiting for fee slip');
    expect((await callRoute(activity, authedRequest(teacher, '/x'), { id: t.id })).status).toBe(
      403,
    );
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
      authedRequest(manager, `/x?view=open&departmentId=${deptId}&page=1&pageSize=1`),
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
      authedRequest(manager, `/x?view=open&staffId=${teacher.staffId}&role=backup`),
    );
    expect(backup.data?.map((x) => x.id)).toContain(a.id);
    expect(backup.data?.every((x) => x.backupStaffId === teacher.staffId)).toBe(true);
    const mineBackup = await callRoute<Task[]>(
      listTasks,
      authedRequest(teacher, '/x?view=mine&role=backup'),
    );
    expect(mineBackup.data?.map((x) => x.id)).toContain(a.id);
    const search = await callRoute<Task[]>(
      listTasks,
      authedRequest(manager, '/x?view=open&q=Filter%20B'),
    );
    expect(search.data).toHaveLength(1);
    expect((await callRoute(listTasks, authedRequest(manager, '/x?pageSize=0'))).status).toBe(400);
  });
});

describe('reminder job (due soon, overdue; idempotent)', () => {
  it('manager-only route; once per task and due date; backup told when overdue', async () => {
    const overdue = await task({ dueDate: isoDaysFromNow(-2), backupStaffId: teacher.staffId });
    const soon = await task({ dueDate: isoDaysFromNow(1) });
    expect((await callRoute(runReminders, post(counsellor))).status).toBe(403);
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
    const backupNote = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, teacher.id), eq(notifications.kind, 'task.overdue')));
    expect(backupNote.length).toBeGreaterThanOrEqual(1);
  });
});
