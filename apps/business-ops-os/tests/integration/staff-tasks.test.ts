import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  auditEvents,
  notifications,
  opsEodReports,
  opsStaffTasks,
  staffMembers,
} from '@elevate/database';
import { istToday } from '../../src/domain/dates';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { GET as getRoute, PATCH as patchRoute } from '../../src/app/api/v1/staff-tasks/[id]/route';
import { GET as teamRoute, POST as draftRoute } from '../../src/app/api/v1/eod-reports/route';
import { GET as reportRoute } from '../../src/app/api/v1/eod-reports/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/eod-reports/[id]/submit/route';
import { POST as reviewRoute } from '../../src/app/api/v1/eod-reports/[id]/review/route';
import { POST as shareRoute } from '../../src/app/api/v1/eod-reports/[id]/share/route';
import { GET as pdfRoute } from '../../src/app/api/v1/eod-reports/[id]/pdf/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
let manager: StaffUser; // operations_manager, A's reporting manager
let a: StaffUser; // counsellor reporting to manager
let b: StaffUser; // counsellor with no manager
let lead: StaffUser; // counsellor who manages c (own scope only)
let c: StaffUser;
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
  c = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: lead.staffId });
  auditor = await staffUser(ctx.db, ['auditor']);
  teacher = await staffUser(ctx.db, ['teacher']);
  outsider = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
});

type Task = {
  id: string;
  status: string;
  progressPercent: number;
  staffId: string;
  nextTaskId?: string | null;
};
type Report = { id: string; status: string; snapshot: { counts: Record<string, number> } };
const create = (user: TestUser, json: Record<string, unknown>) =>
  callRoute<Task>(
    createRoute,
    authedRequest(user, '/ops/api/v1/staff-tasks', { method: 'POST', json }),
  );
const patch = (user: TestUser, id: string, json: Record<string, unknown>) =>
  callRoute<Task>(
    patchRoute,
    authedRequest(user, `/ops/api/v1/staff-tasks/${id}`, { method: 'PATCH', json }),
    { id },
  );
const draft = (user: TestUser, json: Record<string, unknown> = {}) =>
  callRoute<Report>(
    draftRoute,
    authedRequest(user, '/ops/api/v1/eod-reports', {
      method: 'POST',
      json: { reportDate: today, ...json },
    }),
  );
const post = (route: typeof submitRoute, user: TestUser, id: string, json?: unknown) =>
  callRoute<Report & { message?: string }>(
    route,
    authedRequest(user, `/ops/api/v1/eod-reports/${id}/x`, { method: 'POST', json }),
    { id },
  );
const pdf = (user: TestUser | null, id: string) => {
  const url = `/ops/api/v1/eod-reports/${id}/pdf`;
  return pdfRoute(user ? authedRequest(user, url) : buildRequest(url), {
    params: Promise.resolve({ id }),
  });
};

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
    expect((await create(teacher, { title: 'Mark registers' })).status).toBe(201);
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
    const results = await Promise.all([
      patch(a, id, { status: 'done' }),
      patch(a, id, { status: 'done' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    await patch(a, id, { status: 'in_progress', progressPercent: 90 });
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

describe('end-of-day reports', () => {
  let reportId: string;

  it('one report per staff member and day; a future day is refused', async () => {
    const first = await draft(a, { summary: 'Calls done' });
    expect(first.status).toBe(200);
    const again = await draft(a);
    expect(again.data!.id).toBe(first.data!.id);
    reportId = first.data!.id;
    const rows = await ctx.db
      .select()
      .from(opsEodReports)
      .where(eq(opsEodReports.staffId, a.staffId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe('Calls done');
    expect((await draft(a, { reportDate: '2099-01-01' })).status).toBe(400);
  });

  it('submit needs a reason on every task not done, notifies the manager, then freezes', async () => {
    const refused = await post(submitRoute, a, reportId);
    expect(refused.status).toBe(400);
    expect(refused.error!.message).toContain('Call back Sample parent');
    const open = await ctx.db
      .select({ id: opsStaffTasks.id })
      .from(opsStaffTasks)
      .where(
        and(
          eq(opsStaffTasks.staffId, a.staffId),
          inArray(opsStaffTasks.status, ['pending', 'in_progress']),
        ),
      );
    for (const t of open) await patch(a, t.id, { reason: 'Continuing tomorrow' });
    // A status change drops the earlier reason, so the old "why" cannot pass the check.
    await patch(a, open[0]!.id, { status: 'in_progress' });
    expect((await post(submitRoute, a, reportId)).status).toBe(400);
    await patch(a, open[0]!.id, { reason: 'Parent asked for a call tomorrow' });
    expect((await post(submitRoute, b, reportId)).status).toBe(404);
    const ok = await post(submitRoute, a, reportId);
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ status: 'submitted', submittedToStaffId: manager.staffId });
    const note = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, reportId));
    expect(note.map((n) => n.userId)).toEqual([manager.id]);
    expect((await post(submitRoute, a, reportId)).status).toBe(409);
    expect((await draft(a)).status).toBe(409);
  });

  let bReportId: string;
  it('no reporting manager: the EOD reviewers are notified', async () => {
    const r = await draft(b);
    bReportId = r.data!.id;
    expect((await post(submitRoute, b, r.data!.id)).status).toBe(200);
    const note = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, r.data!.id));
    expect(note.map((n) => n.userId).sort()).toEqual([manager.id, director.id].sort());
  });

  it('an inactive reporting manager is skipped: the EOD reviewers get the report', async () => {
    const gone = await staffUser(ctx.db, ['admissions_counsellor']);
    const d = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: gone.staffId });
    await ctx.db
      .update(staffMembers)
      .set({ status: 'inactive' })
      .where(eq(staffMembers.id, gone.staffId));
    const r = await draft(d);
    const sent = await post(submitRoute, d, r.data!.id);
    expect(sent.data).toMatchObject({ status: 'submitted', submittedToStaffId: null });
    const note = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, r.data!.id));
    expect(note.map((n) => n.userId).sort()).toEqual([manager.id, director.id].sort());
  });

  it('a reporting manager without all scope reads the report sent to them, not the tasks', async () => {
    const t = await create(c, { title: 'Sample follow-up', reason: 'Waiting for reply' });
    const r = await draft(c);
    expect((await post(submitRoute, c, r.data!.id)).status).toBe(200);
    const read = await callRoute<{ canReview: boolean }>(reportRoute, authedRequest(lead, '/x'), {
      id: r.data!.id,
    });
    expect(read.status).toBe(200);
    expect(read.data!.canReview).toBe(true);
    expect((await post(reviewRoute, lead, r.data!.id)).status).toBe(200);
    expect((await post(reviewRoute, lead, bReportId)).status).toBe(403);
    expect((await post(reviewRoute, c, r.data!.id)).status).toBe(403);
    expect((await callRoute(getRoute, authedRequest(lead, '/x'), { id: t.data!.id })).status).toBe(
      404,
    );
    expect((await callRoute(reportRoute, authedRequest(b, '/x'), { id: r.data!.id })).status).toBe(
      404,
    );
  });

  it('share is simulated, never sent', async () => {
    const res = await post(shareRoute, a, reportId, { channel: 'whatsapp' });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      status: 'simulated',
      message: expect.stringContaining('Simulated — not sent'),
    });
    expect((await post(shareRoute, b, reportId, { channel: 'email' })).status).toBe(404);
    const unsent = await draft(teacher);
    expect((await post(shareRoute, teacher, unsent.data!.id, { channel: 'email' })).status).toBe(
      409,
    );
  });

  it('PDF: 401 signed out, 403 without access, 404 for another counsellor, 200 for owner, manager and auditor', async () => {
    expect((await pdf(null, reportId)).status).toBe(401);
    expect((await pdf(outsider, reportId)).status).toBe(403);
    expect((await pdf(b, reportId)).status).toBe(404);
    for (const u of [a, manager, auditor]) {
      const res = await pdf(u, reportId);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(
        (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount(),
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('review: reviewers only, never your own; team view lists who reported and blocked tasks', async () => {
    expect((await post(reviewRoute, a, reportId)).status).toBe(403);
    expect((await post(reviewRoute, auditor, reportId)).status).toBe(403);
    const ok = await post(reviewRoute, manager, reportId);
    expect(ok.status).toBe(200);
    expect((await post(reviewRoute, manager, reportId)).status).toBe(200);
    const own = await draft(manager);
    expect((await post(submitRoute, manager, own.data!.id)).status).toBe(200);
    expect((await post(reviewRoute, manager, own.data!.id)).status).toBe(403);

    const blocked = await create(b, {
      title: 'Sample blocked task',
      status: 'blocked',
      reason: 'No reply',
    });
    const team = await callRoute<{
      people: { staffId: string; status: string | null; reviewedAt: string | null }[];
      stuck: { id: string }[];
    }>(teamRoute, authedRequest(director, `/ops/api/v1/eod-reports?date=${today}`));
    expect(team.status).toBe(200);
    const row = (s: StaffUser) => team.data!.people.find((p) => p.staffId === s.staffId);
    expect(row(a)).toMatchObject({ status: 'submitted', reviewedAt: expect.any(String) });
    expect(row(teacher)).toMatchObject({ status: 'draft' });
    expect(row(lead)).toMatchObject({ status: null });
    expect(team.data!.stuck.map((s) => s.id)).toContain(blocked.data!.id);
    expect((await callRoute(teamRoute, authedRequest(a, '/ops/api/v1/eod-reports'))).status).toBe(
      403,
    );
  });
});
