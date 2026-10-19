import { beforeAll, describe, expect, it } from 'vitest';
import type { Metric } from '@elevate/shared-contracts';
import { callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as report } from '../../src/app/api/v1/admissions/report/route';
import { POST as requestEnrolment } from '../../src/app/api/v1/admissions/[id]/enrolment-request/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { admittedCase, get, pendingCase, post } from './admissions-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let director: TestUser;
let coordinator: TestUser;

type Report = {
  scope: 'all' | 'own';
  kpis: {
    newEnquiries: Metric;
    conversion: Metric;
    decisions: { awaitingDecision: Metric; offersAwaitingResponse: Metric };
    handoff: { requested: Metric; successRate: Metric; awaiting: Metric };
    overdueFollowUps: Metric;
  };
  byStatus: Record<string, number>;
  bySource: { sourceCode: string; count: number }[];
};

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
});

describe('admissions report (ops:admissions:read)', () => {
  it('403 without ops:admissions:read; 400 on a bad date', async () => {
    expect((await callRoute(report, get(coordinator))).status).toBe(403);
    expect(
      (await callRoute(report, get(manager, '/ops/api/v1/admissions/report?from=19-10-2026')))
        .status,
    ).toBe(400);
  });

  it('empty data: counts are a real 0, rates are missing (never 0 %)', async () => {
    const r = await callRoute<Report>(report, get(manager));
    expect(r.status).toBe(200);
    expect(r.data?.kpis.newEnquiries).toMatchObject({ status: 'ok', value: 0 });
    expect(r.data?.kpis.handoff.successRate).toMatchObject({ status: 'missing', value: null });
    expect(r.data?.kpis.conversion.status).toBe('missing');
  });

  it('counts real cases; counsellors see only their own', async () => {
    await pendingCase(counsellor);
    const a = await admittedCase({ counsellor, manager, director });
    await callRoute(requestEnrolment, post(counsellor, {}), { id: a.admissionId });
    const all = await callRoute<Report>(report, get(director));
    expect(all.data?.scope).toBe('all');
    expect(all.data?.kpis.newEnquiries.value).toBe(2);
    expect(all.data?.byStatus).toMatchObject({ admission_pending: 1, enrolment_requested: 1 });
    expect(all.data?.bySource).toEqual([
      expect.objectContaining({ sourceCode: 'WEBINAR', count: 2 }),
    ]);
    expect(all.data?.kpis.handoff.requested.value).toBe(1);
    expect(all.data?.kpis.handoff.awaiting.value).toBe(1);
    expect(all.data?.kpis.handoff.successRate.status).toBe('missing');
    expect(all.data?.kpis.decisions.awaitingDecision.value).toBe(1);
    const mine = await callRoute<Report>(report, get(counsellor));
    expect(mine.data?.scope).toBe('own');
    expect(mine.data?.kpis.newEnquiries.value).toBe(2);
    const theirs = await callRoute<Report>(report, get(colleague));
    expect(theirs.data?.kpis.newEnquiries.value).toBe(0);
    expect(theirs.data?.kpis.handoff.requested.value).toBe(0);
  });
});
