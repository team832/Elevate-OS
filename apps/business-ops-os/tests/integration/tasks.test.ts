import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { notifications, opsEscalations, opsTasks } from '@elevate/database';
import { GET as listTasks, POST as createTask } from '../../src/app/api/v1/tasks/route';
import { GET as getTask } from '../../src/app/api/v1/tasks/[id]/route';
import { POST as setStatus } from '../../src/app/api/v1/tasks/[id]/status/route';
import { POST as addDep } from '../../src/app/api/v1/tasks/[id]/dependencies/route';
import { POST as escalationAction } from '../../src/app/api/v1/escalations/[id]/route';
import { runTaskEscalations } from '../../src/server/escalations';
import { isoDaysFromNow, setupReference, staffUser, type StaffUser } from './fixtures';
import { get, post, statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
let director: StaffUser;
let manager: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;

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
    expect(await statusOf(createTask, post(auditor, { title: 'x' }))).toBe(403);
    expect(await statusOf(listTasks, get(auditor))).toBe(200);
    const mine = await task({ ownerStaffId: teacher.staffId });
    const other = await task();
    const list = await callRoute<Task[]>(listTasks, get(teacher, '/x?view=open'));
    expect(list.data?.map((t) => t.id)).toEqual([mine.id]);
    expect(await statusOf(getTask, get(teacher), { id: other.id })).toBe(403);
    const start = () => post(teacher, { to: 'in_progress' });
    expect(await statusOf(setStatus, start(), { id: mine.id })).toBe(200);
    expect(await statusOf(setStatus, start(), { id: other.id })).toBe(403);
  });

  it('a counsellor can only create tasks for themselves', async () => {
    const forOther = post(counsellor, { title: 'x', ownerStaffId: teacher.staffId });
    expect(await statusOf(createTask, forOther)).toBe(403);
    const own = await callRoute<Task & { ownerStaffId: string }>(
      createTask,
      post(counsellor, { title: 'Call back (fictional)' }),
    );
    expect(own.data?.ownerStaffId).toBe(counsellor.staffId);
  });

  it('owner and backup must differ', async () => {
    const same = { title: 'x', ownerStaffId: teacher.staffId, backupStaffId: teacher.staffId };
    expect(await statusOf(createTask, post(manager, same))).toBe(400);
  });
});

describe('dependencies and completion rules', () => {
  const dep = (id: string, blockedByTaskId: string) =>
    callRoute(addDep, post(manager, { blockedByTaskId }), { id });

  it('rejects a dependency cycle with 409 and the path', async () => {
    const a = await task();
    const b = await task();
    const c = await task();
    expect((await dep(a.id, b.id)).status).toBe(201);
    expect((await dep(b.id, c.id)).status).toBe(201);
    const cyc = await dep(c.id, a.id);
    expect(cyc.status).toBe(409);
    expect(cyc.error?.message).toContain(`${c.code} → ${a.code} → ${b.code} → ${c.code}`);
    expect((await dep(a.id, a.id)).status).toBe(400);
  });

  it('cannot complete while a blocker is open; evidence required; override is audited', async () => {
    const blocker = await task();
    const t = await task();
    await dep(t.id, blocker.id);
    const complete = (json: object, id = t.id) =>
      callRoute<Task & { blockerOverrideReason: string }>(
        setStatus,
        post(counsellor, { to: 'completed', ...json }),
        { id },
      );
    expect((await complete({})).status).toBe(400);
    expect((await complete({ completionNote: 'Done' })).status).toBe(409);
    const ok = await complete({
      completionNote: 'Done',
      blockerOverrideReason: 'Manager accepted',
    });
    expect(ok.data).toMatchObject({
      status: 'completed',
      blockerOverrideReason: 'Manager accepted',
    });
    const evidence = { evidenceLink: 'https://example.test/evidence' };
    expect((await complete(evidence, blocker.id)).status).toBe(200);
    // reopen needs a reason
    expect(await statusOf(setStatus, post(counsellor, { to: 'in_progress' }), { id: t.id })).toBe(
      400,
    );
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
    const handle = (user: StaffUser, json: object) =>
      statusOf(escalationAction, post(user, json), { id: esc!.id });
    expect(await handle(teacher, { action: 'acknowledge' })).toBe(403);
    expect(await handle(manager, { action: 'acknowledge' })).toBe(200);
    expect(await handle(manager, { action: 'resolve' })).toBe(400);
    expect(await handle(manager, { action: 'resolve', note: 'Extended with owner' })).toBe(200);
    const escalated = await callRoute<Task[]>(listTasks, get(manager, '/x?view=escalated'));
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
