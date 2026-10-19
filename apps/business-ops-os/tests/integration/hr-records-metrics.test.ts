import { beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { departments } from '@elevate/database';
import { parseIsoDate } from '@elevate/shared-types';
import {
  activeEmployeesMetric,
  employeesByDepartmentMetric,
  upcomingJoiningDates,
} from '../../src/server/reports/hr-records-metrics';
import { createEmployee } from '../../src/server/hr/employees';
import { setupReference } from './fixtures';
import { employeeUser } from './hr-records-fixtures';

const ctx = setupTestDatabase();
let hrManager: TestUser;
const now = new Date('2026-10-19T06:00:00Z');

beforeAll(async () => {
  await setupReference(ctx.db);
  hrManager = await createTestUser(ctx.db, { roles: ['hr_manager'] });
});

describe('HR records metrics (K-HR-01 … K-HR-03)', () => {
  it('reports MISSING (not zero) before any employee record exists', async () => {
    const active = await activeEmployeesMetric(ctx.db, hrManager, now);
    expect(active).toMatchObject({ status: 'missing', value: null });
    const byDept = await employeesByDepartmentMetric(ctx.db, hrManager, now);
    expect(byDept.every((d) => d.metric.status === 'missing')).toBe(true);
    const upcoming = await upcomingJoiningDates(ctx.db, hrManager, { now });
    expect(upcoming.metric.status).toBe('missing');
  });

  it('counts active employees, per department and upcoming joiners; department managers see their chain', async () => {
    const [dept] = await ctx.db.select({ id: departments.id }).from(departments).limit(1);
    await createEmployee(ctx.db, hrManager, {
      fullName: 'Active (fictional)',
      employmentStatus: 'active',
      departmentId: dept!.id,
    });
    await createEmployee(ctx.db, hrManager, {
      fullName: 'Joiner (fictional)',
      employmentStartDate: parseIsoDate('2026-10-25'),
    });
    await createEmployee(ctx.db, hrManager, {
      fullName: 'Far joiner (fictional)',
      employmentStartDate: parseIsoDate('2027-02-01'),
    });
    await createEmployee(ctx.db, hrManager, { fullName: 'No date (fictional)' });
    expect(await activeEmployeesMetric(ctx.db, hrManager, now)).toMatchObject({
      status: 'ok',
      value: 1,
    });
    const byDept = await employeesByDepartmentMetric(ctx.db, hrManager, now);
    expect(byDept.find((d) => d.departmentId === dept!.id)!.metric).toMatchObject({
      status: 'ok',
      value: 1,
    });
    expect(byDept.find((d) => d.departmentId === null)!.metric).toMatchObject({ value: 3 });
    const upcoming = await upcomingJoiningDates(ctx.db, hrManager, { now, days: 30 });
    expect(upcoming.metric).toMatchObject({ status: 'ok', value: 1 });
    expect(upcoming.employees[0]!.fullName).toBe('Joiner (fictional)');
    expect(upcoming.withoutStartDate).toBe(1);

    const mgr = await employeeUser(ctx.db, ['department_manager']);
    await employeeUser(ctx.db, ['employee'], { managerId: mgr.staffId });
    expect(await activeEmployeesMetric(ctx.db, mgr, now)).toMatchObject({ status: 'ok', value: 2 });
    const employee = await createTestUser(ctx.db, { roles: ['employee'] });
    await expect(activeEmployeesMetric(ctx.db, employee, now)).rejects.toThrow();
  });
});
