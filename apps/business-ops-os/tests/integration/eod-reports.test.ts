import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
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
  opsEodReportVersions,
  opsEodReviewEvents,
  opsSettings,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskUpdates,
  staffMembers,
} from '@elevate/database';
import { GET as inboxRoute, POST as draftRoute } from '../../src/app/api/v1/eod-reports/route';
import { GET as reportRoute } from '../../src/app/api/v1/eod-reports/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/eod-reports/[id]/submit/route';
import { POST as reviewRoute } from '../../src/app/api/v1/eod-reports/[id]/review/route';
import { POST as followUpRoute } from '../../src/app/api/v1/eod-reports/[id]/follow-up/route';
import { GET as pdfRoute } from '../../src/app/api/v1/eod-reports/[id]/pdf/route';
import { GET as csvRoute } from '../../src/app/api/v1/eod-reports/[id]/csv/route';
import type { EodFacts } from '../../src/domain/eod';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const D = '2026-09-15';
const ist = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
let manager: StaffUser; // operations_manager (EOD reviewer, all scope)
let lead: StaffUser; // counsellor; manages a (own scope only)
let a: StaffUser;
let b: StaffUser; // no manager
let director: StaffUser;
let outsider: TestUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director' });
  lead = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Lead' });
  a = await staffUser(ctx.db, ['admissions_counsellor'], {
    managerId: lead.staffId,
    name: 'Sample A',
  });
  b = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample B' });
  outsider = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
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

type Report = {
  id: string;
  status: string;
  version: number;
  snapshot: EodFacts;
  submittedToStaffId: string | null;
  submittedVersion?: { id: string; version: number; revisionOfVersionId: string | null };
  replayed?: boolean;
};
const draft = (u: TestUser, json: Record<string, unknown> = {}) =>
  callRoute<Report>(
    draftRoute,
    authedRequest(u, '/ops/api/v1/eod-reports', {
      method: 'POST',
      json: { reportDate: D, ...json },
    }),
  );
const post = (route: typeof submitRoute, u: TestUser, id: string, json: unknown = {}) =>
  callRoute<Report>(
    route,
    authedRequest(u, `/ops/api/v1/eod-reports/${id}/x`, { method: 'POST', json }),
    { id },
  );
const read = (u: TestUser, id: string) =>
  callRoute<{
    facts: EodFacts;
    sourceChanged: boolean | null;
    canReview: boolean;
    versions: unknown[];
  }>(reportRoute, authedRequest(u, `/ops/api/v1/eod-reports/${id}`), { id });
const download = (route: typeof pdfRoute, u: TestUser | null, id: string) => {
  const url = `/ops/api/v1/eod-reports/${id}/file`;
  return route(u ? authedRequest(u, url) : buildRequest(url), { params: Promise.resolve({ id }) });
};

async function task(
  owner: StaffUser,
  title: string,
  over: Partial<typeof opsStaffTasks.$inferInsert> = {},
) {
  const [t] = await ctx.db
    .insert(opsStaffTasks)
    .values({
      staffId: owner.staffId,
      title,
      dueOn: D,
      createdBy: owner.id,
      createdAt: ist(D, '08:00'),
      status: 'in_progress',
      ...over,
    })
    .returning();
  return t!;
}
const event = (
  taskId: string,
  actor: TestUser,
  kind: typeof opsTaskEvents.$inferInsert.kind,
  at: Date,
  over: Partial<typeof opsTaskEvents.$inferInsert> = {},
) =>
  ctx.db
    .insert(opsTaskEvents)
    .values({ taskId: taskId as never, kind, actorUserId: actor.id, occurredAt: at, ...over });
const update = (
  taskId: string,
  author: StaffUser,
  over: Partial<typeof opsTaskUpdates.$inferInsert> = {},
) =>
  ctx.db.insert(opsTaskUpdates).values({
    taskId: taskId as never,
    authorUserId: author.id,
    authorStaffId: author.staffId,
    occurredOn: D,
    recordedAt: ist(D, '17:00'),
    workPerformed: 'Called three Sample parents',
    durationMinutes: 45,
    ...over,
  });

describe('EOD draft: facts from events, narrative, concurrency', () => {
  let id: string;
  it('401 signed out, 403 without task write, 400 for a future day', async () => {
    const out = await callRoute(
      draftRoute,
      buildRequest('/ops/api/v1/eod-reports', { method: 'POST', json: { reportDate: D } }),
    );
    expect(out.status).toBe(401);
    expect((await draft(outsider)).status).toBe(403);
    expect((await draft(a, { reportDate: '2099-01-01' })).status).toBe(400);
  });

  it('test 5 + 6: only events dated on the day count; a task finished the next day stays open; HR and a failed Academic call are unavailable', async () => {
    const done = await task(a, 'Sample fee slip run', {
      status: 'done',
      progressPercent: 100,
      completedAt: ist(D, '15:00'),
    });
    await event(done.id, a, 'created', ist(D, '08:00'), {
      toStaffId: a.staffId,
      toStatus: 'pending',
    });
    await event(done.id, a, 'status_changed', ist(D, '15:00'), {
      fromStatus: 'pending',
      toStatus: 'done',
    });
    const later = await task(a, 'Sample call list', {
      status: 'done',
      progressPercent: 100,
      completedAt: ist('2026-09-16', '10:00'),
      reason: null,
    });
    await event(later.id, a, 'status_changed', ist('2026-09-16', '10:00'), {
      fromStatus: 'in_progress',
      toStatus: 'done',
    });
    await update(later.id, a);
    const r = await draft(a, { summary: 'Sample summary', nextDayPlan: 'Sample plan' });
    expect(r.status).toBe(200);
    id = r.data!.id;
    const f = r.data!.snapshot;
    expect(f.completed.map((c) => c.title)).toEqual(['Sample fee slip run']);
    expect(f.backlog.map((x) => x.title)).toEqual(['Sample call list']);
    expect(f.work).toHaveLength(1);
    expect(f.duration.minutes).toBe(45);
    expect(f.hr).toEqual({ status: 'unavailable' });
    expect(f.academic).toMatchObject({ status: 'unavailable' });
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'eod_report.drafted')));
    expect(audit).toHaveLength(1);
  });

  it('a stale editor version is refused; the current one saves', async () => {
    expect((await draft(a, { notes: 'x', version: 99 })).status).toBe(409);
    const ok = await draft(a, { notes: 'Sample notes', version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.data!.version).toBe(2);
  });

  it('test 10: submit goes to the reporting manager; reasons are required for open tasks', async () => {
    // Finished the next day: no reason can be added now, so it does not block submission.
    const open = await task(a, 'Sample callback');
    await draft(a);
    const refused = await post(submitRoute, a, id);
    expect(refused.status).toBe(400);
    expect(refused.error!.message).toContain('Sample callback');
    expect(refused.error!.message).not.toContain('Sample call list');
    await ctx.db
      .update(opsStaffTasks)
      .set({ reason: 'Parent asked to call tomorrow' })
      .where(eq(opsStaffTasks.id, open.id));
    expect((await post(submitRoute, b, id)).status).toBe(404);
    expect((await post(reviewRoute, b, id, { kind: 'viewed' })).status).toBe(404);
    expect((await post(reviewRoute, lead, id, { kind: 'viewed' })).status).toBe(404);
    expect((await post(submitRoute, a, id, { expectedVersion: 1 })).status).toBe(409);
    expect((await post(submitRoute, a, id, { recipientStaffId: manager.staffId })).status).toBe(
      400,
    );
    const ok = await post(submitRoute, a, id);
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({
      status: 'submitted',
      submittedToStaffId: lead.staffId,
      replayed: false,
    });
    expect(ok.data!.submittedVersion).toMatchObject({ version: 1, revisionOfVersionId: null });
    const sent = await ctx.db.select().from(notifications).where(eq(notifications.entityId, id));
    expect(sent.map((n) => n.userId)).toEqual([lead.id]);
  });

  it('test 9: submitting again (double click, retry) returns the same version', async () => {
    expect((await read(lead, id)).data!.sourceChanged).toBe(false);
    const again = await post(submitRoute, a, id);
    expect(again.status).toBe(200);
    expect(again.data!.replayed).toBe(true);
    expect(
      await ctx.db
        .select()
        .from(opsEodReportVersions)
        .where(eq(opsEodReportVersions.reportId, id as never)),
    ).toHaveLength(1);
    expect((await draft(a, { summary: 'changed' })).status).toBe(409);
  });

  it('test 8: a later source edit never changes the submitted version; the report flags it', async () => {
    const [before] = await ctx.db
      .select()
      .from(opsEodReportVersions)
      .where(eq(opsEodReportVersions.reportId, id as never));
    const [t] = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.title, 'Sample fee slip run'));
    await update(t!.id, a, { workPerformed: 'Late entry: printed slips', recordedAt: new Date() });
    const [after] = await ctx.db
      .select()
      .from(opsEodReportVersions)
      .where(eq(opsEodReportVersions.reportId, id as never));
    expect(after!.snapshot).toEqual(before!.snapshot);
    const view = await read(lead, id);
    expect(view.status).toBe(200);
    expect(view.data!.sourceChanged).toBe(true);
    expect(view.data!.facts.work).toHaveLength(1);
  });

  it('readers: the recipient and all-scope readers read it; another counsellor gets 404', async () => {
    expect((await read(b, id)).status).toBe(404);
    expect((await read(director, id)).status).toBe(200);
    expect((await read(lead, id)).data!.canReview).toBe(true);
  });

  it('test 11: review actions — viewed once, revision needs text, acknowledgement is separate from tasks', async () => {
    expect((await post(reviewRoute, a, id, { kind: 'acknowledged' })).status).toBe(403);
    expect((await post(reviewRoute, b, id, { kind: 'viewed' })).status).toBe(404);
    expect((await post(reviewRoute, lead, id, { kind: 'revision_requested' })).status).toBe(400);
    await post(reviewRoute, lead, id, { kind: 'viewed' });
    await post(reviewRoute, lead, id, { kind: 'viewed' });
    const events = () =>
      ctx.db
        .select()
        .from(opsEodReviewEvents)
        .where(eq(opsEodReviewEvents.reportId, id as never));
    expect((await events()).filter((e) => e.kind === 'viewed')).toHaveLength(1);
    const rev = await post(reviewRoute, lead, id, {
      kind: 'revision_requested',
      text: 'Add the parent names you called',
    });
    expect(rev.data!.status).toBe('revision_requested');
    expect((await post(reviewRoute, lead, id, { kind: 'acknowledged' })).status).toBe(409);
  });

  it('during a revision the manager still reads the submitted version; inbox counts come from it', async () => {
    await task(a, 'Sample blocked visit', { status: 'blocked', reason: 'Parent away' });
    const d = await draft(a, { summary: 'Unsent rewrite' });
    expect(d.data!.snapshot.counts.blocked).toBe(1);
    const asManager = await read(lead, id);
    expect(asManager.data).toMatchObject({ summary: 'Sample summary', nextDayPlan: 'Sample plan' });
    expect(asManager.data!.facts.counts.blocked).toBe(0);
    expect((await read(a, id)).data).toMatchObject({ summary: 'Unsent rewrite' });
    const inbox = await callRoute<{ rows: { id: string; counts: { blocked: number } }[] }>(
      inboxRoute,
      authedRequest(lead, '/ops/api/v1/eod-reports?blockers=1'),
    );
    expect(inbox.data!.rows.map((r) => r.id)).not.toContain(id);
  });

  it('test 9: after a revision request the owner edits and resubmits version 2, linked to version 1', async () => {
    expect((await draft(a, { summary: 'Sample summary with names' })).status).toBe(200);
    const v2 = await post(submitRoute, a, id);
    expect(v2.data!.submittedVersion).toMatchObject({ version: 2 });
    const rows = await ctx.db
      .select()
      .from(opsEodReportVersions)
      .where(eq(opsEodReportVersions.reportId, id as never))
      .orderBy(opsEodReportVersions.version);
    expect(rows[1]!.revisionOfVersionId).toBe(rows[0]!.id);
    expect(rows[1]!.revisionRequestEventId).not.toBeNull();
    expect(rows[1]!.narrative.summary).toBe('Sample summary with names');
    const taskBefore = await ctx.db
      .select({ s: opsStaffTasks.status })
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.staffId, a.staffId));
    const ack = await post(reviewRoute, lead, id, { kind: 'acknowledged' });
    expect(ack.data!.status).toBe('acknowledged');
    const taskAfter = await ctx.db
      .select({ s: opsStaffTasks.status })
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.staffId, a.staffId));
    expect(taskAfter).toEqual(taskBefore);
    expect((await post(reviewRoute, lead, id, { kind: 'acknowledged' })).status).toBe(200);
  });

  it('follow-up task: created for the owner and recorded on the report', async () => {
    const res = await callRoute<{ id: string; staffId: string }>(
      followUpRoute,
      authedRequest(manager, `/ops/api/v1/eod-reports/${id}/follow-up`, {
        method: 'POST',
        json: { title: 'Sample follow-up: share parent list' },
      }),
      { id },
    );
    expect(res.status).toBe(201);
    expect(res.data!.staffId).toBe(a.staffId);
    // An EOD reviewer whose task write is own-scope cannot give a.staff a task.
    const outside = await callRoute(
      followUpRoute,
      authedRequest(director, `/ops/api/v1/eod-reports/${id}/follow-up`, {
        method: 'POST',
        json: { title: 'Sample follow-up from outside' },
      }),
      { id },
    );
    expect(outside.status).toBe(403);
    const ev = await ctx.db
      .select()
      .from(opsEodReviewEvents)
      .where(eq(opsEodReviewEvents.kind, 'follow_up_task_created'));
    expect(ev.map((e) => e.taskId)).toEqual([res.data!.id]);
  });

  it('inbox: the recipient sees it, EOD reviewers see all, others see nothing', async () => {
    const list = (u: TestUser, q = '') =>
      callRoute<{ rows: { id: string }[]; total: number }>(
        inboxRoute,
        authedRequest(u, `/ops/api/v1/eod-reports${q}`),
      );
    expect((await list(lead)).data!.rows.map((r) => r.id)).toEqual([id]);
    expect((await list(manager)).data!.rows.map((r) => r.id)).toContain(id);
    expect((await list(b)).data!.total).toBe(0);
    expect((await list(manager, '?status=submitted')).data!.rows.map((r) => r.id)).not.toContain(
      id,
    );
    expect((await list(manager, '?q=Sample%20A')).data!.rows.map((r) => r.id)).toEqual([id]);
  });

  it('test 17: PDF and CSV — 401, 403, 404, 200 for owner and recipient; downloads audited; CSV neutralises formulas', async () => {
    expect((await download(pdfRoute, null, id)).status).toBe(401);
    expect((await download(pdfRoute, outsider, id)).status).toBe(403);
    expect((await download(csvRoute, b, id)).status).toBe(404);
    for (const u of [a, lead]) {
      const res = await download(pdfRoute, u, id);
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(595, 0);
      // PDF_SAMPLE_OUT=<file.pdf> writes one rendered report for a visual check.
      if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, bytes);
    }
    const own = await (await download(csvRoute, a, id)).text();
    expect(own).toContain('Manager');
    expect(own).toContain('Sample Lead');
    await task(b, '=SUM(A1)');
    const bId = (await draft(b)).data!.id;
    const csv = await download(csvRoute, b, bId);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text).toContain("'=SUM(A1)");
    const exported = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'eod_report.exported'));
    expect(exported.length).toBeGreaterThanOrEqual(3);
  });

  it('history (R3): a new manager reads earlier reports only when eod.manager_history is current_team_all', async () => {
    const next = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample New Lead' });
    await ctx.db
      .update(staffMembers)
      .set({ managerId: next.staffId })
      .where(eq(staffMembers.id, a.staffId));
    expect((await read(next, id)).status).toBe(404);
    await ctx.db.insert(opsSettings).values({
      key: 'eod.manager_history',
      value: { scope: 'current_team_all' },
      decisionState: 'approved',
    });
    expect((await read(next, id)).status).toBe(200);
    await ctx.db.delete(opsSettings).where(eq(opsSettings.key, 'eod.manager_history'));
    await ctx.db
      .update(staffMembers)
      .set({ managerId: lead.staffId })
      .where(eq(staffMembers.id, a.staffId));
  });
});

describe('EOD recipient when no manager resolves (test 10) and external delivery (test 12)', () => {
  it('blocks only submission until the employee chooses an EOD reviewer; the reporting line is not changed', async () => {
    const r = await draft(b, { reportDate: '2026-09-14' });
    const refused = await post(submitRoute, b, r.data!.id);
    expect(refused.status).toBe(400);
    expect(refused.error!.details).toEqual([
      expect.objectContaining({ path: ['recipientStaffId'] }),
    ]);
    expect(
      (await post(submitRoute, b, r.data!.id, { recipientStaffId: lead.staffId })).status,
    ).toBe(400);
    const ok = await post(submitRoute, b, r.data!.id, { recipientStaffId: director.staffId });
    expect(ok.data).toMatchObject({ status: 'submitted', submittedToStaffId: director.staffId });
    const [me] = await ctx.db.select().from(staffMembers).where(eq(staffMembers.id, b.staffId));
    expect(me!.managerId).toBeNull();
    const sent = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, r.data!.id));
    expect(sent.map((n) => n.userId)).toEqual([director.id]);
  });

  it('an inactive manager is not a recipient', async () => {
    const gone = await staffUser(ctx.db, ['admissions_counsellor']);
    const d = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: gone.staffId });
    await ctx.db
      .update(staffMembers)
      .set({ status: 'inactive' })
      .where(eq(staffMembers.id, gone.staffId));
    const r = await draft(d);
    const res = await post(submitRoute, d, r.data!.id);
    expect(res.status).toBe(400);
    expect(res.error!.message).toContain('not active');
  });

  it('test 7: Academic activity for the day is read from the teacher activity contract', async () => {
    const window = { from: '2026-09-13', to: '2026-09-13' };
    const m = (value: number) => ({
      status: 'ok',
      value,
      definition: 'Sample',
      window,
      unit: 'count',
    });
    const fetch = vi.fn(async (_url: string) =>
      Response.json({
        data: {
          contract: 'academic.teacher_activity',
          version: 1,
          generatedAt: new Date().toISOString(),
          staffId: b.staffId,
          window,
          assignments: [],
          sessions: { planned: m(2), delivered: m(1), cancelled: m(1), substituted: m(0) },
          logsPending: m(1),
          attendancePending: m(0),
          markingPending: m(0),
          reviews: { submitted: m(0), draft: m(0) },
          unavailability: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const r = await draft(b, { reportDate: '2026-09-13' });
    expect(r.data!.snapshot.academic).toMatchObject({
      status: 'available',
      planned: 2,
      delivered: 1,
    });
    expect(r.data!.snapshot.duration.minutes).toBeNull();
    expect(String(fetch.mock.calls[0]![0])).toContain(
      `/academic/api/internal/v1/teachers/${b.staffId}/activity?from=2026-09-13&to=2026-09-13`,
    );
  });

  it('two submits at once make one version', async () => {
    const e = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: lead.staffId });
    const r = await draft(e);
    const both = await Promise.all([
      post(submitRoute, e, r.data!.id),
      post(submitRoute, e, r.data!.id),
    ]);
    expect(both.map((x) => x.status)).toEqual([200, 200]);
    expect(both.map((x) => x.data!.submittedVersion!.id)[0]).toBe(
      both[1]!.data!.submittedVersion!.id,
    );
    const rows = await ctx.db
      .select()
      .from(opsEodReportVersions)
      .where(eq(opsEodReportVersions.reportId, r.data!.id as never));
    expect(rows).toHaveLength(1);
  });

  it('imported tracker reports are labelled, never parsed as facts and cannot be reviewed', async () => {
    const snapshot = { kind: 'legacy_tracker_report', reportDate: '2026-09-10', legacy: {} };
    const [rep] = await ctx.db
      .insert(opsEodReports)
      .values({
        staffId: a.staffId,
        reportDate: '2026-09-10',
        status: 'submitted',
        snapshot,
        summary: 'Sample imported text',
        currentVersion: 1,
        submittedAt: ist('2026-09-10', '19:00'),
        createdBy: manager.id,
      })
      .returning();
    await ctx.db.insert(opsEodReportVersions).values({
      reportId: rep!.id,
      version: 1,
      snapshot,
      narrative: { summary: 'Sample imported text', nextDayPlan: null, notes: null },
      sourceCutoffAt: ist('2026-09-10', '19:00'),
      submittedByUserId: manager.id,
    });
    const inbox = await callRoute<{ rows: { id: string; imported: boolean; counts: unknown }[] }>(
      inboxRoute,
      authedRequest(manager, '/ops/api/v1/eod-reports'),
    );
    expect(inbox.data!.rows.find((r) => r.id === rep!.id)).toMatchObject({
      imported: true,
      counts: null,
    });
    const view = await read(manager, rep!.id);
    expect(view.data).toMatchObject({ canReview: false, sourceChanged: null });
    expect((await post(reviewRoute, manager, rep!.id, { kind: 'acknowledged' })).status).toBe(409);
    expect((await download(pdfRoute, manager, rep!.id)).status).toBe(200);
  });

  it('there is no simulated share route; nothing claims to be sent', () => {
    const share = path.resolve(__dirname, '../../src/app/api/v1/eod-reports/[id]/share/route.ts');
    expect(existsSync(share)).toBe(false);
  });
});
