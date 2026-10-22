import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
  opsEodReports,
  opsEodReviewEvents,
  opsStaffTasks,
  opsTaskEvents,
} from '@elevate/database';
import { GET as reportRoute } from '../../src/app/api/v1/task-reports/route';
import type { PeriodReport } from '../../src/server/task-period-report';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
let manager: StaffUser;
let lead: StaffUser;
let a: StaffUser;
let b: StaffUser;
let outsider: TestUser;
const Q = '?from=2026-09-14&to=2026-09-16';

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  lead = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Lead' });
  a = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: lead.staffId,
    name: 'Sample A',
  });
  b = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample B' });
  outsider = await createTestUser(ctx.db, { roles: ['platform_admin'] }); // no Ops task access (marketing has its own tasks since D-073)
  const add = async (
    owner: StaffUser,
    title: string,
    over: Partial<typeof opsStaffTasks.$inferInsert> = {},
  ) =>
    (
      await ctx.db
        .insert(opsStaffTasks)
        .values({
          staffId: owner.staffId,
          title,
          dueOn: '2026-09-14',
          createdBy: owner.id,
          createdAt: ist('2026-09-14', '09:00'),
          ...over,
        })
        .returning()
    )[0]!;
  const ev = (
    taskId: string,
    kind: typeof opsTaskEvents.$inferInsert.kind,
    at: Date,
    over: Partial<typeof opsTaskEvents.$inferInsert> = {},
  ) =>
    ctx.db
      .insert(opsTaskEvents)
      .values({ taskId: taskId as never, kind, actorUserId: lead.id, occurredAt: at, ...over });
  // Assigned and finished inside the period.
  const t1 = await add(a, 'Sample fee slips', {
    status: 'done',
    progressPercent: 100,
    completedAt: ist('2026-09-15', '12:00'),
  });
  await ev(t1.id, 'created', ist('2026-09-14', '09:00'), {
    toStaffId: a.staffId,
    toStatus: 'pending',
  });
  await ev(t1.id, 'status_changed', ist('2026-09-15', '12:00'), {
    fromStatus: 'pending',
    toStatus: 'done',
  });
  // Finished after the period: open (and overdue) at the cut-off, not completed in it.
  const t2 = await add(a, 'Sample callbacks', {
    status: 'done',
    progressPercent: 100,
    completedAt: ist('2026-09-18', '10:00'),
  });
  await ev(t2.id, 'created', ist('2026-09-14', '09:00'), {
    toStaffId: a.staffId,
    toStatus: 'pending',
  });
  await ev(t2.id, 'status_changed', ist('2026-09-18', '10:00'), {
    fromStatus: 'pending',
    toStatus: 'done',
  });
  // Blocked since the 15th; clarification asked and never answered.
  const t3 = await add(a, 'Sample parent visit', {
    status: 'blocked',
    reason: 'Parent travelling',
  });
  await ev(t3.id, 'created', ist('2026-09-14', '09:00'), {
    toStaffId: a.staffId,
    toStatus: 'pending',
  });
  await ev(t3.id, 'clarification_requested', ist('2026-09-14', '11:00'), {
    reason: 'Which centre?',
  });
  await ev(t3.id, 'status_changed', ist('2026-09-15', '10:00'), {
    fromStatus: 'pending',
    toStatus: 'blocked',
    reason: 'Parent travelling',
  });
  // Due on the 14th during the period; moved to the 30th afterwards: overdue at the cut-off.
  const t4 = await add(a, 'Sample report card print', { dueOn: '2026-09-30' });
  await ev(t4.id, 'created', ist('2026-09-14', '09:00'), {
    toStaffId: a.staffId,
    toStatus: 'pending',
  });
  await ev(t4.id, 'due_changed', ist('2026-09-17', '09:00'), {
    data: { fromDueOn: '2026-09-14', toDueOn: '2026-09-30', fromDueTime: null, toDueTime: null },
  });
  // Someone outside lead's team.
  await add(b, 'Sample other team task');
  await ctx.db.insert(opsEodReports).values({
    staffId: a.staffId,
    reportDate: '2026-09-15',
    status: 'acknowledged',
    snapshot: {},
    submittedAt: ist('2026-09-15', '19:00'),
    reviewedBy: lead.id,
    reviewedAt: ist('2026-09-15', '20:00'),
    currentVersion: 1,
    createdBy: a.id,
  });
  const [revised] = await ctx.db
    .insert(opsEodReports)
    .values({
      staffId: a.staffId,
      reportDate: '2026-09-16',
      status: 'revision_requested',
      snapshot: {},
      submittedAt: ist('2026-09-16', '19:00'),
      currentVersion: 1,
      createdBy: a.id,
    })
    .returning();
  await ctx.db.insert(opsEodReviewEvents).values({
    reportId: revised!.id,
    kind: 'revision_requested',
    actorUserId: lead.id,
    text: 'Sample: add the call list',
    createdAt: ist('2026-09-16', '21:00'),
  });
});

const get = (u: TestUser, q = Q) =>
  callRoute<PeriodReport>(reportRoute, authedRequest(u, `/ops/api/v1/task-reports${q}`));

describe('team / period report', () => {
  it('401 signed out, 403 without task access, 400 for a reversed or too-long period', async () => {
    expect(
      (await callRoute(reportRoute, buildRequest(`/ops/api/v1/task-reports${Q}`))).status,
    ).toBe(401);
    expect((await get(outsider)).status).toBe(403);
    expect((await get(lead, '?from=2026-09-16&to=2026-09-14')).status).toBe(400);
    expect((await get(lead, '?from=2026-01-01&to=2026-09-14')).status).toBe(400);
  });

  it('counts come from dated events: assigned and completed during the period, open and overdue at the cut-off', async () => {
    const r = await get(lead);
    expect(r.status).toBe(200);
    const row = r.data!.people.find((p) => p.staffId === a.staffId)!;
    expect(row).toMatchObject({ assigned: 4, completed: 1, open: 3, overdue: 3, blocked: 1 });
    expect(row.eod).toEqual({ days: 3, submitted: 2, acknowledged: 1, missing: 1 });
    expect(r.data!.revisions).toEqual([
      expect.objectContaining({ since: ist('2026-09-16', '21:00').toISOString() }),
    ]);
    expect(r.data!.blockers).toEqual([
      expect.objectContaining({
        title: 'Sample parent visit',
        ageDays: 1,
        reason: 'Parent travelling',
      }),
    ]);
    expect(r.data!.decisions.map((d) => d.what)).toEqual(['Clarification requested']);
  });

  it('own scope: a manager sees themselves and their reports, not other teams; all scope sees everyone', async () => {
    const mine = (await get(lead)).data!.people.map((p) => p.staffId).sort();
    expect(mine).toEqual([lead.staffId, a.staffId].sort());
    expect((await get(b)).data!.people.map((p) => p.staffId)).toEqual([b.staffId]);
    expect((await get(manager)).data!.people.map((p) => p.staffId)).toEqual(
      expect.arrayContaining([a.staffId, b.staffId]),
    );
  });

  it('test 17: CSV and PDF downloads keep the scope and are audited', async () => {
    const csv = await reportRoute(authedRequest(lead, `/ops/api/v1/task-reports${Q}&format=csv`), {
      params: Promise.resolve({}),
    });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain('Sample A');
    expect(text).toContain('EOD calendar days');
    expect(text).not.toContain('Sample B');
    const pdf = await reportRoute(authedRequest(lead, `/ops/api/v1/task-reports${Q}&format=pdf`), {
      params: Promise.resolve({}),
    });
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(
      (await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPageCount(),
    ).toBeGreaterThanOrEqual(1);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'task_report.exported'));
    expect(audits.map((x) => (x.metadata as { format: string }).format).sort()).toEqual([
      'csv',
      'pdf',
    ]);
    expect(
      (
        await reportRoute(authedRequest(outsider, `/ops/api/v1/task-reports${Q}&format=csv`), {
          params: Promise.resolve({}),
        })
      ).status,
    ).toBe(403);
  });
});
