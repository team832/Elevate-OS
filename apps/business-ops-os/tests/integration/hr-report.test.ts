/**
 * HR dashboard data (`buildHrReport`, /ops/reports/hr): missing on an empty
 * database (never 0), values once employee records and attendance exist.
 */
import { describe, expect, it } from 'vitest';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { clockIn, clockOut } from '../../src/server/hr/attendance';
import { buildHrReport, hrReportWindow } from '../../src/server/reports/hr';
import { setupReference } from './fixtures';
import { employeeUser } from './hr-records-fixtures';

const ctx = setupTestDatabase();
const NOW = new Date('2026-10-20T06:00:00Z');
const at = (iso: string) => new Date(iso);

describe('HR report (/ops/reports/hr)', () => {
  it('periods are IST calendar months', () => {
    expect(hrReportWindow('this_month', NOW)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-20',
    });
    expect(hrReportWindow('last_month', NOW)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('is refused without ops:hr_reports:read', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    await expect(buildHrReport(ctx.db, teacher)).rejects.toMatchObject({ status: 403 });
  });

  it('missing on an empty database; values after fixtures', async () => {
    await setupReference(ctx.db);
    const hr = await createTestUser(ctx.db, { roles: ['hr_manager'] });
    const empty = await buildHrReport(ctx.db, hr, { now: NOW });
    for (const m of [
      empty.activeEmployees,
      empty.joining.metric,
      empty.lifecycle.onboardingCompletionRate,
      empty.time.scheduledHours,
      empty.time.recordedHours,
      ...empty.byDepartment.map((x) => x.metric),
    ])
      expect(m.status).toBe('missing');

    const worker = await employeeUser(ctx.db, ['employee']);
    await clockIn(ctx.db, worker, {}, undefined, at('2026-10-12T04:00:00Z'));
    await clockOut(ctx.db, worker, {}, undefined, at('2026-10-12T08:00:00Z'));
    const after = await buildHrReport(ctx.db, hr, { now: NOW });
    expect(after.activeEmployees).toMatchObject({ status: 'ok', value: 1 });
    expect(after.byDepartment.find((x) => x.departmentId === null)?.metric).toMatchObject({
      status: 'ok',
      value: 1,
    });
    expect(after.joining.metric.status).toBe('ok');
    expect(after.time.recordedHours).toMatchObject({ status: 'ok', value: 4 });
    expect(
      (await buildHrReport(ctx.db, hr, { now: NOW, period: 'last_month' })).time.recordedHours
        .status,
    ).toBe('missing');
  });
});
