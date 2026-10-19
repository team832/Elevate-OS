import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { notifications, opsEscalations, opsTasks } from '@elevate/database';
import { GET as listTasks, POST as createTask } from '../../src/app/api/v1/tasks/route';
import { GET as getTask } from '../../src/app/api/v1/tasks/[id]/route';
import { POST as setStatus } from '../../src/app/api/v1/tasks/[id]/status/route';
import { POST as addDep } from '../../src/app/api/v1/tasks/[id]/dependencies/route';
import { POST as escalationAction } from '../../src/app/api/v1/escalations/[id]/route';
import { runTaskEscalations } from '../../src/server/escalations';
import { isoDaysFromNow, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let director: StaffUser;
let manager: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;

const post = (user: { token: string }, json: unknown) =>
  authedRequest(user, '/ops/api/v1/x', { method: 'POST', json });
type Task = { id: string; code: string; status: string };

beforeAll(async () => {
  await setupReference(ctx.db);
  director = await staffUser(ctx.db, ['director']);
  manager = await staffUser(ctx.db, ['operations_manager'], { managerId: director.staffId });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  teacher = await staffUser(ctx.db, ['teacher'], { managerId: manager.staffId });
});

const task = async (over: Record<string, unknown> = {}, as: StaffUser = manager) =>
  (
    await callRoute<Task>(
      createTask,
      post(as, {
        title: 'Test task (fictional)',
        ownerStaffId: counsellor.staffId,
        dueDate: isoDaysFromNow(3),
        ...over,
      }),
    )
  ).data!;

describe('tasks: permissions and own scope', () => {
  it('auditor can read but not write; teacher sees only own tasks', async () => {
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await callRoute(createTask, post(auditor, { title: 'x' }))).status).toBe(403);
    expect((await callRoute(listTasks, authedRequest(auditor, '/x'))).status).toBe(200);
    const mine = await task({ ownerStaffId: teacher.staffId });
    const other = await task();
    const list = await callRoute<Task[]>(listTasks, authedRequest(teacher, '/x?view=open'));
    expect(list.data?.map((t) => t.id)).toEqual([mine.id]);
    expect((await callRoute(getTask, authedRequest(teacher, '/x'), { id: other.id })).status).toBe(
      403,
    );
    expect(
      (await callRoute(setStatus, post(teacher, { to: 'in_progress' }), { id: mine.id })).status,
    ).toBe(200);
    expect(
      (await callRoute(setStatus, post(teacher, { to: 'in_progress' }), { id: other.id })).status,
    ).toBe(403);
  });

  it('a counsellor can only create tasks for themselves', async () => {
    expect(
      (await callRoute(createTask, post(counsellor, { title: 'x', ownerStaffId: teacher.staffId })))
        .status,
    ).toBe(403);
    const own = await callRoute<Task & { ownerStaffId: string }>(
      createTask,
      post(counsellor, { title: 'Call back (fictional)' }),
    );
    expect(own.data?.ownerStaffId).toBe(counsellor.staffId);
  });

  it('owner and backup must differ', async () => {
    expect(
      (
        await callRoute(
          createTask,
          post(manager, {
            title: 'x',
            ownerStaffId: teacher.staffId,
            backupStaffId: teacher.staffId,
          }),
        )
      ).status,
    ).toBe(400);
  });
});

describe('dependencies and completion rules', () => {
  it('rejects a dependency cycle with 409 and the path', async () => {
    const a = await task();
    const b = await task();
    const c = await task();
    expect(
      (await callRoute(addDep, post(manager, { blockedByTaskId: b.id }), { id: a.id })).status,
    ).toBe(201);
    expect(
      (await callRoute(addDep, post(manager, { blockedByTaskId: c.id }), { id: b.id })).status,
    ).toBe(201);
    const cyc = await callRoute(addDep, post(manager, { blockedByTaskId: a.id }), { id: c.id });
    expect(cyc.status).toBe(409);
    expect(cyc.error?.message).toContain(`${c.code} → ${a.code} → ${b.code} → ${c.code}`);
    expect(
      (await callRoute(addDep, post(manager, { blockedByTaskId: a.id }), { id: a.id })).status,
    ).toBe(400);
  });

  it('cannot complete while a blocker is open; evidence required; override is audited', async () => {
    const blocker = await task();
    const t = await task();
    await callRoute(addDep, post(manager, { blockedByTaskId: blocker.id }), { id: t.id });
    expect(
      (await callRoute(setStatus, post(counsellor, { to: 'completed' }), { id: t.id })).status,
    ).toBe(400);
    const blocked = await callRoute(
      setStatus,
      post(counsellor, { to: 'completed', completionNote: 'Done' }),
      { id: t.id },
    );
    expect(blocked.status).toBe(409);
    const ok = await callRoute<Task & { blockerOverrideReason: string }>(
      setStatus,
      post(counsellor, {
        to: 'completed',
        completionNote: 'Done',
        blockerOverrideReason: 'Manager accepted',
      }),
      { id: t.id },
    );
    expect(ok.data).toMatchObject({
      status: 'completed',
      blockerOverrideReason: 'Manager accepted',
    });
    expect(
      (
        await callRoute(
          setStatus,
          post(counsellor, { to: 'completed', evidenceLink: 'https://example.test/evidence' }),
          { id: blocker.id },
        )
      ).status,
    ).toBe(200);
    expect(
      (await callRoute(setStatus, post(counsellor, { to: 'in_progress' }), { id: t.id })).status,
    ).toBe(400); // reopen needs a reason
  });
});

describe('escalation (OPS-017)', () => {
  it('overdue tasks escalate to the owner’s manager (L2) and up; the job is idempotent; recipient acknowledges', async () => {
    const t = await task({ dueDate: isoDaysFromNow(-6) });
    const first = await runTaskEscalations(ctx.db);
    const mine = first.raised.filter((r) => r.taskCode === t.code);
    expect(mine.map((r) => [r.level, r.recipientStaffId])).toEqual([
      [2, manager.staffId],
      [3, director.staffId],
    ]);
    const again = await runTaskEscalations(ctx.db);
    expect(again.raised.filter((r) => r.taskCode === t.code)).toEqual([]);
    const [row] = await ctx.db
      .select()
      .from(opsTasks)
      .where(eq(opsTasks.id, t.id as never));
    expect(row?.escalationLevel).toBe(3);
    expect(row?.ownerStaffId).toBe(counsellor.staffId); // owner keeps the task
    const notes = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, manager.id), eq(notifications.kind, 'task.escalated')));
    expect(notes.length).toBeGreaterThan(0);
    const [esc] = await ctx.db
      .select()
      .from(opsEscalations)
      .where(and(eq(opsEscalations.taskId, t.id as never), eq(opsEscalations.level, 2)));
    expect(
      (await callRoute(escalationAction, post(teacher, { action: 'acknowledge' }), { id: esc!.id }))
        .status,
    ).toBe(403);
    expect(
      (await callRoute(escalationAction, post(manager, { action: 'acknowledge' }), { id: esc!.id }))
        .status,
    ).toBe(200);
    expect(
      (await callRoute(escalationAction, post(manager, { action: 'resolve' }), { id: esc!.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await callRoute(
          escalationAction,
          post(manager, { action: 'resolve', note: 'Extended with owner' }),
          { id: esc!.id },
        )
      ).status,
    ).toBe(200);
    const escalated = await callRoute<Task[]>(
      listTasks,
      authedRequest(manager, '/x?view=escalated'),
    );
    expect(escalated.data?.map((x) => x.id)).toContain(t.id); // L3 still open
  });

  it('a task with no owner escalates with no recipient (routed to operations managers)', async () => {
    const t = await task({ ownerStaffId: null, dueDate: isoDaysFromNow(-3) });
    const res = await runTaskEscalations(ctx.db);
    expect(res.raised.find((r) => r.taskCode === t.code)).toMatchObject({
      level: 2,
      recipientStaffId: null,
      via: 'no_owner',
    });
  });
});
