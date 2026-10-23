import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  departments,
  notifications,
  opsEodReportVersions,
  opsLeaveRecords,
  opsStaffTasks,
  opsTaskEvents,
  opsWorkSchedules,
  staffMembers,
} from '@elevate/database';
import { GET as inboxRoute, POST as draftRoute } from '../../src/app/api/v1/eod-reports/route';
import { GET as reportRoute } from '../../src/app/api/v1/eod-reports/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/eod-reports/[id]/submit/route';
import { POST as reviewRoute } from '../../src/app/api/v1/eod-reports/[id]/review/route';
import { GET as listRoute } from '../../src/app/api/v1/work-reports/route';
import type { EodFacts } from '../../src/domain/eod';
import { eodInbox } from '../../src/server/eod-review';
import { hrReportCounts } from '../../src/server/work-reports-hr';
import { myReports, type WorkReportList } from '../../src/server/work-reports';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
// A past Monday-to-Sunday week (reports.week_start default: Monday).
const MON = '2026-09-14';
let lead: StaffUser;
let a: StaffUser;
let b: StaffUser;
let hr: StaffUser;
let taskId: string;

type Report = {
  id: string;
  status: string;
  version: number;
  periodKind: string;
  periodStart: string;
  periodEnd: string;
  reportDate: string | null;
  snapshot: EodFacts;
  submittedVersion?: { id: string; version: number; revisionOfVersionId: string | null };
};
const draft = (u: TestUser, json: Record<string, unknown> = {}) =>
  callRoute<Report>(
    draftRoute,
    authedRequest(u, '/ops/api/v1/eod-reports', {
      method: 'POST',
      json: { reportDate: '2026-09-16', periodKind: 'week', ...json },
    }),
  );
const post = (route: typeof submitRoute, u: TestUser, id: string, json: unknown = {}) =>
  callRoute<Report>(
    route,
    authedRequest(u, `/ops/api/v1/eod-reports/${id}/x`, { method: 'POST', json }),
    { id },
  );
const read = (u: TestUser, id: string) =>
  callRoute<{ facts: EodFacts; sourceChanged: boolean | null; periodLabel: string }>(
    reportRoute,
    authedRequest(u, `/ops/api/v1/eod-reports/${id}`),
    { id },
  );
const versions = (id: string) =>
  ctx.db
    .select()
    .from(opsEodReportVersions)
    .where(eq(opsEodReportVersions.reportId, id as never))
    .orderBy(opsEodReportVersions.version);

beforeAll(async () => {
  await setupReference(ctx.db);
  lead = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Lead' });
  a = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: lead.staffId,
    name: 'Sample Teacher A',
  });
  b = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: lead.staffId,
    name: 'Sample Teacher B',
  });
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Manager' });
  // Monday–Saturday 9 to 5, Sunday off: the default schedule HR attendance derives workdays from.
  const nine = { start: '09:00', end: '17:00' };
  await ctx.db.insert(opsWorkSchedules).values({
    name: 'Sample default schedule',
    weeklyPattern: { mon: nine, tue: nine, wed: nine, thu: nine, fri: nine, sat: nine, sun: null },
    isDefault: true,
    createdBy: hr.id,
  });
  const [t] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: a.staffId,
      title: 'Sample worksheet on integration',
      dueOn: '2026-09-18',
      dueTime: '17:00',
      originalDueOn: '2026-09-18',
      originalDueTime: '17:00',
      status: 'done',
      progressPercent: 100,
      completedAt: ist('2026-09-21', '10:00'),
      firstSubmittedAt: ist('2026-09-18', '16:42'),
      lastSubmittedAt: ist('2026-09-18', '16:42'),
      approvedAt: ist('2026-09-21', '10:00'),
      reviewRequired: true,
      createdBy: lead.id,
      createdAt: ist(MON, '09:00'),
    })
    .returning();
  taskId = t!.id;
  const ev = (kind: typeof opsTaskEvents.$inferInsert.kind, at: Date, over = {}) =>
    ctx.db
      .insert(opsTaskEvents)
      .values({ taskId: t!.id, kind, actorUserId: lead.id, occurredAt: at, ...over });
  await ev('created', ist(MON, '09:00'), { toStaffId: a.staffId, toStatus: 'pending' });
  await ev('submitted_for_review', ist('2026-09-18', '16:42'), {
    fromStatus: 'in_progress',
    toStatus: 'in_review',
  });
  // Approved the next week: not "approved" in this week, and it never makes the submission late.
  await ev('review_approved', ist('2026-09-21', '10:00'), {
    fromStatus: 'in_review',
    toStatus: 'done',
  });
});
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('scenario 11: weekly reports derive from real records and keep their snapshots', () => {
  let id: string;

  it('a weekly draft covers Monday–Sunday and is built from the task history', async () => {
    const r = await draft(a, { summary: 'Sample outcomes', nextDayPlan: 'Sample plan' });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      periodKind: 'week',
      periodStart: MON,
      periodEnd: '2026-09-20',
      reportDate: null,
    });
    id = r.data!.id;
    const f = r.data!.snapshot;
    expect(f.submitted!.map((x) => x.title)).toEqual(['Sample worksheet on integration']);
    expect(f.completed).toEqual([]);
    expect(f.timeliness).toMatchObject({ eligible: 1, onTime: 1, rate: 1, delivered: 0 });
    expect(f.academic).toMatchObject({ status: 'unavailable' });
    expect(f.attendance).toBeDefined();
  });

  it('submitting sends it to the manager’s inbox with a notification; nothing external', async () => {
    const ok = await post(submitRoute, a, id);
    expect(ok.status).toBe(200);
    expect(ok.data!.submittedVersion).toMatchObject({ version: 1 });
    const sent = await ctx.db.select().from(notifications).where(eq(notifications.entityId, id));
    expect(sent.map((n) => [n.userId, n.link])).toEqual([[lead.id, `/ops/tasks/inbox?open=${id}`]]);
    expect(sent[0]!.title).toContain('Weekly report');
    const inbox = await callRoute<{ rows: { id: string; periodKind: string }[] }>(
      inboxRoute,
      authedRequest(lead, '/ops/api/v1/eod-reports?kind=week'),
    );
    expect(inbox.data!.rows.map((x) => x.id)).toEqual([id]);
  });

  it('editing a source task after submission never changes the submitted snapshot', async () => {
    const [before] = await versions(id);
    await ctx.db
      .update(opsStaffTasks)
      .set({ title: 'Sample worksheet renamed later' })
      .where(eq(opsStaffTasks.id, taskId as never));
    const [after] = await versions(id);
    expect(after!.snapshot).toEqual(before!.snapshot);
    const view = await read(lead, id);
    expect(view.data!.facts.submitted![0]!.title).toBe('Sample worksheet on integration');
    expect(view.data!.sourceChanged).toBe(true);
    expect(view.data!.periodLabel).toBe('Week 14 Sept 2026 – 20 Sept 2026');
  });

  it('changes requested → a revision makes version 2; both versions stay', async () => {
    const req = await post(reviewRoute, lead, id, {
      kind: 'revision_requested',
      text: 'Sample: add the answer key status',
    });
    expect(req.data!.status).toBe('revision_requested');
    expect((await draft(a, { summary: 'Sample outcomes with answer key' })).status).toBe(200);
    const v2 = await post(submitRoute, a, id);
    expect(v2.data!.submittedVersion).toMatchObject({ version: 2 });
    const rows = await versions(id);
    expect(rows.map((v) => v.version)).toEqual([1, 2]);
    expect(rows[1]!.revisionOfVersionId).toBe(rows[0]!.id);
    expect((rows[0]!.snapshot as EodFacts).submitted![0]!.title).toBe(
      'Sample worksheet on integration',
    );
    expect((rows[1]!.snapshot as EodFacts).submitted![0]!.title).toBe(
      'Sample worksheet renamed later',
    );
    expect((await post(reviewRoute, lead, id, { kind: 'acknowledged' })).data!.status).toBe(
      'acknowledged',
    );
  });

  it('another employee opening the report by id gets 404', async () => {
    expect((await read(b, id)).status).toBe(404);
    expect((await post(submitRoute, b, id)).status).toBe(404);
  });

  it('My reports lists the employee’s own weekly reports with their status', async () => {
    const mine = await myReports(ctx.db, a, 'week', { date: '2026-09-16' });
    expect(mine!.selected).toMatchObject({ start: MON, end: '2026-09-20' });
    expect(mine!.rows.map((r) => [r.periodStart, r.standing, r.late])).toEqual([
      [MON, 'acknowledged', false],
    ]);
  });
});

describe('HR work-report list and overview counts', () => {
  const list = (u: TestUser, q: string) =>
    callRoute<WorkReportList>(listRoute, authedRequest(u, `/ops/api/v1/work-reports${q}`));

  it('403 without ops:work_reports:read; HR sees Missing for a due report never submitted', async () => {
    expect((await list(b, '?kind=week&date=2026-09-16')).status).toBe(403);
    const r = await list(hr, '?kind=week&date=2026-09-16');
    expect(r.status).toBe(200);
    const by = (s: StaffUser) => r.data!.rows.find((x) => x.staffId === s.staffId);
    expect(by(a)).toMatchObject({ standing: 'acknowledged', late: false });
    expect(by(b)).toMatchObject({ standing: 'missing', standingLabel: 'Missing' });
    const missing = await list(hr, '?kind=week&date=2026-09-16&standing=missing');
    expect(missing.data!.rows.map((x) => x.staffId)).toContain(b.staffId);
    expect(missing.data!.rows.map((x) => x.staffId)).not.toContain(a.staffId);
    expect(missing.data!.total).toBe(missing.data!.rows.length);
  });

  it('approved leave for the whole week: not expected, never Missing', async () => {
    const c = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Teacher C' });
    await ctx.db.insert(opsLeaveRecords).values({
      staffId: c.staffId,
      fromDate: MON,
      toDate: '2026-09-20',
      kind: 'Sample leave',
      approvedBy: hr.id,
    });
    const r = await list(hr, '?kind=week&date=2026-09-16');
    expect(r.data!.rows.find((x) => x.staffId === c.staffId)).toMatchObject({
      standing: 'not_expected',
    });
    const missing = await list(hr, '?kind=week&date=2026-09-16&standing=missing');
    expect(missing.data!.rows.map((x) => x.staffId)).not.toContain(c.staffId);
    // Sunday is a weekly off in the schedule: nobody is expected to send a day report.
    const sunday = await list(hr, '?kind=day&date=2026-09-20&standing=missing');
    expect(sunday.data!.total).toBe(0);
  });

  it('HR department scope applies only to an HR-only manager', async () => {
    const [finance] = await ctx.db
      .insert(departments)
      .values({ code: 'SAMPLE_FINANCE', name: 'Sample Finance' })
      .returning();
    const f = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Finance Staff' });
    await ctx.db
      .update(staffMembers)
      .set({ departmentId: finance!.id })
      .where(eq(staffMembers.id, f.staffId));
    const ops = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
    const ids = async (u: TestUser) =>
      (await list(u, '?kind=week&date=2026-09-16')).data!.rows.map((x) => x.staffId);
    expect(await ids(ops)).toContain(f.staffId);
    expect(await ids(hr)).not.toContain(f.staffId);
  });

  it('a draft task is not "received" until it is published', async () => {
    const [t] = await ctx.db
      .insert(opsStaffTasks)
      .values({
        staffId: b.staffId,
        title: 'Sample draft brief',
        dueOn: '2026-09-25',
        originalDueOn: '2026-09-25',
        status: 'draft',
        createdBy: lead.id,
        createdAt: ist('2026-09-22', '09:00'),
      })
      .returning();
    await ctx.db.insert(opsTaskEvents).values({
      taskId: t!.id,
      kind: 'created',
      actorUserId: lead.id,
      toStaffId: b.staffId,
      toStatus: 'draft',
      occurredAt: ist('2026-09-22', '09:00'),
    });
    const r = await draft(b, { reportDate: '2026-09-22', periodKind: 'day' });
    expect(r.data!.snapshot.received.map((x) => x.title)).not.toContain('Sample draft brief');
    expect(r.data!.snapshot.backlog.map((x) => x.title)).not.toContain('Sample draft brief');
  });

  it('hrReportCounts returns linked counts for the HR overview', async () => {
    const counts = await hrReportCounts(ctx.db, hr);
    expect(counts.map((c) => c.key)).toEqual([
      'reports_missing_eod',
      'reports_missing_weekly',
      'reports_awaiting_review',
    ]);
    const waiting = counts.find((c) => c.key === 'reports_awaiting_review')!;
    expect(waiting.href).toBe('/ops/hr/reports?view=waiting');
    expect(waiting.value).toBe(
      (await eodInbox(ctx.db, hr, { status: 'submitted', page: 1 }, 25, { hr: true })).total,
    );
    for (const c of counts) {
      expect(typeof c.value).toBe('number');
      expect(c.href).toMatch(/^\/ops\//);
    }
  });
});
