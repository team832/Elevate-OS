import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { auditEvents, opsStaffTasks } from '@elevate/database';
import { istToday } from '../../src/domain/dates';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { GET as getRoute, PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
let manager: StaffUser; // operations_manager, A's reporting manager
let a: StaffUser; // counsellor reporting to manager
let b: StaffUser; // counsellor with no manager
let lead: StaffUser; // counsellor who manages c (own scope only)
let director: StaffUser;
let auditor: StaffUser;
let teacher: StaffUser;
let outsider: TestUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  director = await staffUser(ctx.db, ['director']);
  a = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  b = await staffUser(ctx.db, ['admissions_counsellor']);
  lead = await staffUser(ctx.db, ['admissions_counsellor']);
  await staffUser(ctx.db, ['admissions_counsellor'], { managerId: lead.staffId });
  auditor = await staffUser(ctx.db, ['auditor']);
  teacher = await staffUser(ctx.db, ['teacher']);
  outsider = await createTestUser(ctx.db, { roles: ['platform_admin'] }); // no Ops task access
});

type Task = {
  id: string;
  status: string;
  progressPercent: number;
  staffId: string;
  nextTaskId?: string | null;
};
const create = (user: TestUser, json: Record<string, unknown>) =>
  callRoute<Task>(
    createRoute,
    authedRequest(user, '/ops/api/v1/staff-tasks', { method: 'POST', json }),
  );
/** PATCH with the task's current version (the edit form always sends the one it showed). */
const patch = async (user: TestUser, id: string, json: Record<string, unknown>) => {
  const [row] = await ctx.db
    .select()
    .from(opsStaffTasks)
    .where(eq(opsStaffTasks.id, id as never));
  return callRoute<Task>(
    patchRoute,
    authedRequest(user, `/ops/api/v1/staff-tasks/${id}`, {
      method: 'PATCH',
      json: { expectedVersion: row!.version, ...json },
    }),
    { id },
  );
};
// End-of-day report tests: eod-reports.test.ts, eod-review.test.ts, task-reports.test.ts.
describe('staff tasks: access and own scope', () => {
  it('401 signed out, 403 without Ops tasks access, 400 for a blank title', async () => {
    const out = await callRoute(
      createRoute,
      buildRequest('/ops/api/v1/staff-tasks', { method: 'POST', json: { title: 'x' } }),
    );
    expect(out.status).toBe(401);
    expect((await create(outsider, { title: 'x' })).status).toBe(403);
    expect((await create(auditor, { title: 'x' })).status).toBe(403);
    const bad = await create(a, { title: '  ' });
    expect(bad.status).toBe(400);
  });

  it("staff B cannot see, change or log tasks for staff A; managers and the auditor see everyone's", async () => {
    const t = await create(a, {
      title: 'Call back Sample parent',
      priority: 'high',
      dueTime: '17:30',
    });
    expect(t.status).toBe(201);
    expect(t.data).toMatchObject({ staffId: a.staffId, dueOn: today, status: 'pending' });
    const id = t.data!.id;
    expect(
      (await callRoute(getRoute, authedRequest(b, `/ops/api/v1/staff-tasks/${id}`), { id })).status,
    ).toBe(404);
    expect((await patch(b, id, { status: 'in_progress' })).status).toBe(404);
    expect((await create(b, { title: 'For A', staffId: a.staffId })).status).toBe(403);
    expect((await create(manager, { title: 'Prepare fee slips', staffId: a.staffId })).status).toBe(
      201,
    );

    const list = (u: TestUser, q = '') =>
      callRoute<{ rows: { id: string; staffName: string }[]; total: number }>(
        listRoute,
        authedRequest(u, `/ops/api/v1/staff-tasks${q}`),
      );
    const bList = await list(b);
    expect(bList.data!.rows.some((r) => r.id === id)).toBe(false);
    const aList = await list(a);
    expect(aList.data!.total).toBe(2);
    expect((await list(manager, `?staffId=${a.staffId}`)).data!.total).toBe(2);
    expect((await list(auditor, `?staffId=${a.staffId}`)).data!.total).toBe(2);
    expect((await list(director)).status).toBe(200);
    // D-072: a teacher logs work through Academic OS; Business Ops' own API refuses non-members.
    expect((await create(teacher, { title: 'Mark registers' })).status).toBe(403);
    const viaAcademic = await callRoute<Task>(
      createRoute,
      authedRequest(teacher, '/academic/api/v1/staff-tasks', {
        method: 'POST',
        json: { title: 'Mark registers' },
      }),
    );
    expect(viaAcademic.status).toBe(201);
  });
});

describe('staff tasks: status rules and recurrence', () => {
  it('blocked needs a reason; done forces 100%', async () => {
    const t = await create(a, { title: 'Collect documents' });
    const id = t.data!.id;
    const noReason = await patch(a, id, { status: 'blocked' });
    expect(noReason.status).toBe(400);
    expect(noReason.error!.details).toEqual([expect.objectContaining({ path: ['reason'] })]);
    expect((await patch(a, id, { status: 'blocked', reason: 'Parent travelling' })).status).toBe(
      200,
    );
    const done = await patch(a, id, { status: 'done', progressPercent: 20 });
    expect(done.data).toMatchObject({ status: 'done', progressPercent: 100, nextTaskId: null });
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audits.map((r) => r.action).sort()).toEqual([
      'staff_task.completed',
      'staff_task.created',
      'staff_task.updated',
    ]);
  });

  it('completing a recurring task creates exactly one next occurrence, even when retried', async () => {
    const t = await create(a, {
      title: 'Daily lead call list',
      recurrence: 'daily',
      dueOn: '2026-10-20',
    });
    const id = t.data!.id;
    // Two clicks with the same version: one completes, the other is refused as stale (or replays).
    const results = await Promise.all([
      patch(a, id, { status: 'done', expectedVersion: 1 }),
      patch(a, id, { status: 'done', expectedVersion: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    // Reopening a done task is a lifecycle step: it needs a reason.
    expect((await patch(a, id, { status: 'in_progress', progressPercent: 90 })).status).toBe(400);
    const reopened = await patch(a, id, { status: 'in_progress', reason: 'Two calls missed' });
    expect(reopened.status).toBe(200);
    await patch(a, id, { status: 'done' });
    const children = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.recurrenceParentId, id as never));
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      dueOn: '2026-10-21',
      status: 'pending',
      recurrence: 'daily',
      staffId: a.staffId,
    });
  });

  it('monthly keeps the series day: 31 Jan → 28 Feb → 31 Mar', async () => {
    let id = (
      await create(a, { title: 'Month-end fee report', recurrence: 'monthly', dueOn: '2026-01-31' })
    ).data!.id;
    const due: string[] = [];
    for (let i = 0; i < 2; i++) {
      id = (await patch(a, id, { status: 'done' })).data!.nextTaskId!;
      const [next] = await ctx.db
        .select()
        .from(opsStaffTasks)
        .where(eq(opsStaffTasks.id, id as never));
      due.push(next!.dueOn);
    }
    expect(due).toEqual(['2026-02-28', '2026-03-31']);
  });
});
