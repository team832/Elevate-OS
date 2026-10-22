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

/** Summary-fetch options with a stubbed fetch. */
const stub = (handler: (url: string) => Response | Promise<Response>) => ({
  fetchImpl: (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch,
  token: 'test-only-token-0123456789-0123456789',
});

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
});

describe('cross-module summaries (stubbed fetch)', () => {
  it('a failing or unreachable source is "unavailable", never zeros', async () => {
    const res = await fetchCrossModuleSummaries(
      window,
      stub(() => new Response('nope', { status: 503 })),
    );
    expect(res.academic).toMatchObject({ status: 'unavailable', reason: 'HTTP 503' });
    expect(res.marketing).toMatchObject({ status: 'unavailable' });
    const thrown = await fetchCrossModuleSummaries(
      window,
      stub(() => {
        throw new TypeError('connect ECONNREFUSED');
      }),
    );
    expect(thrown.academic).toMatchObject({
      status: 'unavailable',
      reason: 'Could not reach the source',
    });
  });

  it('a wrong-shaped payload is unavailable; a valid one is available', async () => {
    const res = await fetchCrossModuleSummaries(
      window,
      stub((url) =>
        url.includes('/academic/')
          ? Response.json({ data: academicPayload })
          : Response.json({ data: { contract: 'marketing.summary', version: 1, metrics: {} } }),
      ),
    );
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
      ...stub((u) => {
        urls.push(u);
        return new Response('', { status: 404 });
      }),
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

  it('no "Missing" tile for metrics no source measures (at risk; engagement, followers, attributed leads)', () => {
    const metrics = (keys: string[], missing: string[]) =>
      Object.fromEntries(keys.map((k, i) => [k, m(missing.includes(k) ? null : i)]));
    const at = '2026-10-18T06:00:00Z';
    const html = renderToStaticMarkup(
      CrossModulePanels({
        summaries: {
          academic: {
            status: 'available',
            fetchedAt: at,
            data: {
              ...academicPayload,
              metrics: metrics(Object.keys(academicPayload.metrics), ['studentsAtRisk']),
            } as never,
          },
          marketing: {
            status: 'available',
            fetchedAt: at,
            data: {
              contract: 'marketing.summary',
              version: 1,
              generatedAt: at,
              window,
              metrics: metrics(
                [
                  'ideasCaptured',
                  'contentApproved',
                  'postsScheduled',
                  'postsPublished',
                  'totalReach',
                  'engagementRate',
                  'followerGrowth',
                  'leadsAttributed',
                ],
                ['engagementRate', 'followerGrowth', 'leadsAttributed'],
              ),
              accounts: [],
              dataSources: [],
            } as never,
          },
        },
      }),
    );
    expect(html).toContain('Active enrolments (now)');
    expect(html).toContain('Posts published');
    for (const dead of [
      'Missing',
      'Students at risk',
      'Engagement rate',
      'Follower growth',
      'Leads attributed',
    ])
      expect(html).not.toContain(dead);
  });
});

describe('dashboard KPIs (live DB)', () => {
  it('counsellor cannot read the dashboard (403); manager can; empty rates are missing, counts are 0', async () => {
    expect(
      (await callRoute(dashboardRoute, authedRequest(counsellor, '/ops/api/v1/dashboard'))).status,
    ).toBe(403);
    const d = await buildDashboard(ctx.db, manager, { summaries: false });
    expect(d.kpis.conversion.status).toBe('missing');
    expect(d.kpis.followUpCompliance.status).toBe('missing');
    expect(d.kpis.overdueWork).toMatchObject({ status: 'ok', value: 0 });
    expect(d.crossModule).toBeNull();
  });

  it('counts new leads and overdue follow-ups; workload is alphabetical, not ranked', async () => {
    const { lead } = await createLead(ctx.db, counsellor, {
      studentName: 'Dash Test',
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
      summaries: stub(() => new Response('', { status: 500 })),
    });
    expect(d.kpis.newLeads.value).toBeGreaterThanOrEqual(1);
    expect(d.kpis.overdueWork.value).toBeGreaterThanOrEqual(1);
    expect(d.crossModule?.academic.status).toBe('unavailable');
    const names = d.workload.rows.map((r) => r.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('reminder job notifies the owner once per day (idempotent) and is manager-only', async () => {
    const run = (u: { token: string }) =>
      callRoute<{ sent: number }>(runJob, authedRequest(u, '/x', { method: 'POST', json: {} }), {
        job: 'follow-up-reminders',
      });
    expect((await run(counsellor)).status).toBe(403);
    expect((await run(manager)).data?.sent).toBeGreaterThanOrEqual(1);
    expect((await run(manager)).data?.sent).toBe(0);
  });
});
