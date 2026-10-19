import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { metric } from '@elevate/shared-contracts';
import { GET as dashboardRoute } from '../../src/app/api/v1/dashboard/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { buildDashboard } from '../../src/server/dashboard';
import { fetchCrossModuleSummaries } from '../../src/server/summaries';
import { createLead } from '../../src/server/leads';
import { createFollowUp } from '../../src/server/follow-ups';
import { CrossModulePanels } from '../../src/ui/cross-module';
import { isoDaysFromNow, phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
const window = { from: '2026-10-12', to: '2026-10-18' };

const m = (value: number | null) =>
  value === null
    ? metric.missing('Not connected (test)', { definition: 'test', window, unit: 'count' })
    : metric.ok(value, { definition: 'test', window, unit: 'count' });

const academicPayload = {
  contract: 'academic.delivery_summary',
  version: 1,
  generatedAt: '2026-10-18T06:00:00.000Z',
  window,
  metrics: Object.fromEntries(
    [
      'activeStudents',
      'activeBatches',
      'classesPlanned',
      'classesDelivered',
      'classesCancelled',
      'attendanceRate',
      'assessmentsPlanned',
      'assessmentsConducted',
      'studentsAtRisk',
      'syllabusCompletionRate',
    ].map((k, i) => [k, m(i === 3 ? null : i)]),
  ),
  programmes: [],
};

const stub = (handler: (url: string) => Response | Promise<Response>) =>
  (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
});

describe('cross-module summaries (stubbed fetch)', () => {
  it('a failing or unreachable source is "unavailable", never zeros', async () => {
    const res = await fetchCrossModuleSummaries(window, {
      fetchImpl: stub(() => new Response('nope', { status: 503 })),
      token: 'test-only-token-0123456789-0123456789',
    });
    expect(res.academic).toMatchObject({ status: 'unavailable', reason: 'HTTP 503' });
    expect(res.marketing).toMatchObject({ status: 'unavailable' });
    const thrown = await fetchCrossModuleSummaries(window, {
      fetchImpl: stub(() => {
        throw new TypeError('connect ECONNREFUSED');
      }),
      token: 'test-only-token-0123456789-0123456789',
    });
    expect(thrown.academic).toMatchObject({
      status: 'unavailable',
      reason: 'Could not reach the source',
    });
  });

  it('a wrong-shaped payload is unavailable; a valid one is available', async () => {
    const res = await fetchCrossModuleSummaries(window, {
      fetchImpl: stub((url) =>
        url.includes('/academic/')
          ? Response.json({ data: academicPayload })
          : Response.json({ data: { contract: 'marketing.summary', version: 1, metrics: {} } }),
      ),
      token: 'test-only-token-0123456789-0123456789',
    });
    expect(res.academic.status).toBe('available');
    expect(res.marketing).toMatchObject({
      status: 'unavailable',
      reason: 'Response did not match the contract',
    });
  });

  it('calls the documented endpoints with the window', async () => {
    const urls: string[] = [];
    await fetchCrossModuleSummaries(window, {
      academicBaseUrl: 'http://a.test',
      marketingBaseUrl: 'http://m.test',
      fetchImpl: stub((u) => {
        urls.push(u);
        return new Response('', { status: 404 });
      }),
      token: 'test-only-token-0123456789-0123456789',
    });
    expect(urls.sort()).toEqual([
      'http://a.test/academic/api/internal/v1/summary?from=2026-10-12&to=2026-10-18',
      'http://m.test/marketing/api/internal/v1/summary?from=2026-10-12&to=2026-10-18',
    ]);
  });

  it('the panel renders "Source unavailable" for a failed source and "Missing" (not 0) for a missing metric', async () => {
    const html = renderToStaticMarkup(
      CrossModulePanels({
        summaries: {
          academic: {
            status: 'available',
            data: academicPayload as never,
            fetchedAt: '2026-10-18T06:00:00Z',
          },
          marketing: {
            status: 'unavailable',
            reason: 'HTTP 503',
            fetchedAt: '2026-10-18T06:00:00Z',
          },
        },
      }),
    );
    expect(html).toContain('Source unavailable');
    expect(html).toContain('HTTP 503');
    expect(html).toContain('Missing');
  });
});

describe('dashboard KPIs (live DB)', () => {
  it('counsellor cannot read the dashboard (403); manager can; empty rates are missing, counts are 0', async () => {
    expect(
      (await callRoute(dashboardRoute, authedRequest(counsellor, '/ops/api/v1/dashboard'))).status,
    ).toBe(403);
    const d = await buildDashboard(ctx.db, manager, { summaries: false });
    expect(d.kpis.conversion.status).toBe('missing');
    expect(d.kpis.taskCompletionRate).toMatchObject({ status: 'missing', value: null });
    expect(d.kpis.followUpCompliance.status).toBe('missing');
    expect(d.kpis.overdueWork).toMatchObject({ status: 'ok', value: 0 });
    expect(d.crossModule).toBeNull();
  });

  it('counts new leads and overdue follow-ups; workload is alphabetical, not ranked', async () => {
    const { lead } = await createLead(ctx.db, counsellor, {
      studentName: 'Dash Test (fictional)',
      studentPhone: phone(),
      interestMode: 'undecided',
      sourceCode: 'UNKNOWN',
    });
    await createFollowUp(ctx.db, counsellor, {
      leadId: lead.id,
      kind: 'general',
      dueDate: isoDaysFromNow(-2),
    });
    const d = await buildDashboard(ctx.db, manager, {
      summaries: {
        fetchImpl: stub(() => new Response('', { status: 500 })),
        token: 'test-only-token-0123456789-0123456789',
      },
    });
    expect(d.kpis.newLeads.value).toBeGreaterThanOrEqual(1);
    expect(d.breakdown.overdueFollowUps).toBeGreaterThanOrEqual(1);
    expect(d.crossModule?.academic.status).toBe('unavailable');
    const names = d.workload.rows.map((r) => r.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('reminder job notifies the owner once per day (idempotent) and is manager-only', async () => {
    const post = (u: { token: string }) => authedRequest(u, '/x', { method: 'POST', json: {} });
    expect((await callRoute(runJob, post(counsellor), { job: 'follow-up-reminders' })).status).toBe(
      403,
    );
    const first = await callRoute<{ sent: number }>(runJob, post(manager), {
      job: 'follow-up-reminders',
    });
    expect(first.data?.sent).toBeGreaterThanOrEqual(1);
    const second = await callRoute<{ sent: number }>(runJob, post(manager), {
      job: 'follow-up-reminders',
    });
    expect(second.data?.sent).toBe(0);
  });
});
