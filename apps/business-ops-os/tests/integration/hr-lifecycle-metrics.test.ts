import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { opsCandidates, opsRequisitions, staffMembers } from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { hrLifecycleMetrics } from '../../src/server/reports/hr-lifecycle-metrics';
import { POST as createCase } from '../../src/app/api/v1/hr/lifecycle-cases/route';
import { seedHrLifecycleSamples } from '../../seed/hr-lifecycle';
import { employeeWithLogin, json, setupCast, type Cast, status } from './hr-lifecycle-fixtures';

const ctx = setupTestDatabase();
let cast: Cast;

beforeAll(async () => {
  cast = await setupCast(ctx.db);
});

describe('HR lifecycle metrics', () => {
  it('missing (never zero) without HR-wide access or without a denominator', async () => {
    const m = await hrLifecycleMetrics(ctx.db, cast.recruiter);
    expect(m.pipelineByStage.applied.status).toBe('missing');
    expect(m.onboardingCompletionRate.status).toBe('missing');
    const hr = await hrLifecycleMetrics(ctx.db, cast.hrManager);
    expect(hr.pipelineByStage.applied.status).toBe('ok');
    expect(hr.openRequisitions.status).toBe('ok');
    expect(hr.onboardingCompletionRate.status).toBe('missing');
    if (hr.onboardingCompletionRate.status === 'missing')
      expect(hr.onboardingCompletionRate.reason).toBe('No open onboarding cases.');
  });

  it('reports onboarding completion once a case is open', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'onboarding' });
    expect(
      await status(createCase, json(cast.hrManager, { kind: 'onboarding', staffId: emp.staffId })),
    ).toBe(201);
    const m = await hrLifecycleMetrics(ctx.db, cast.auditor);
    expect(m.onboardingCompletionRate.status).toBe('ok');
    expect(m.onboardingCompletionRate.value).toBe(0);
    expect(m.openOnboardingCases.value).toBeGreaterThanOrEqual(1);
  });
});

describe('offboarding dates', () => {
  it('refuses a last working day before the employment start date', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'active' });
    const offboard = (lastWorkingDay: string) =>
      status(
        createCase,
        json(cast.hrManager, {
          kind: 'offboarding',
          staffId: emp.staffId,
          separationType: 'resignation',
          lastWorkingDay,
        }),
      );
    expect(await offboard('2024-01-01')).toBe(400);
    expect(await offboard(addDays(istToday(new Date()), 20))).toBe(201);
  });
});

describe('seed', () => {
  it('creates one draft requisition and one candidate, idempotently, fictional only', async () => {
    const manager = await createTestUser(ctx.db, {
      roles: ['operations_manager'],
      email: 'operations-manager@example.test',
      displayName: 'Omar Ops (fictional)',
    });
    await ctx.db
      .insert(staffMembers)
      .values({ userId: manager.id, fullName: 'Omar Ops (fictional)' });
    await seedHrLifecycleSamples(ctx.db);
    await seedHrLifecycleSamples(ctx.db);
    const cands = await ctx.db
      .select()
      .from(opsCandidates)
      .where(eq(opsCandidates.email, 'riya.candidate.sample@example.test'));
    expect(cands).toHaveLength(1);
    expect(cands[0]!.fullName).toContain('(fictional)');
    expect(cands[0]!.phone).toBeNull();
    const reqs = await ctx.db
      .select()
      .from(opsRequisitions)
      .where(eq(opsRequisitions.createdBy, manager.id));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.status).toBe('draft');
  });
});
