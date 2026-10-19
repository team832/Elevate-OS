/**
 * HR records metrics for the HR dashboard (K-HR-01 … K-HR-03, docs/parts/hr-records.md).
 * Missing is never zero: with no employee records at all the value is
 * `missing` ("no employee records yet"), not 0. Permission `ops:hr_reports:read`;
 * department managers (own scope) get figures for their reporting chain only.
 */
import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { departments, opsEmployeeRecords, staffMembers, type Database } from '@elevate/database';
import { metric, type Metric } from '@elevate/shared-contracts';
import { addDays, istToday, type IsoDate } from '../../domain/dates';
import type { Actor } from '../context';
import { hrScope, hrScopeIds } from '../hr-scope';

const NO_RECORDS = 'No employee records have been created yet.';

async function scopeFilter(db: Database, actor: Actor): Promise<{ where: SQL[]; label: string }> {
  const scope = await hrScope(db, actor, 'ops:hr_reports:read');
  const ids = hrScopeIds(scope);
  return {
    where: ids ? [ids.length ? inArray(opsEmployeeRecords.staffId, ids) : sql`false`] : [],
    label: ids ? 'your reporting chain' : 'all employees',
  };
}

async function hasAnyRecord(db: Database, where: SQL[]): Promise<boolean> {
  const [row] = await db
    .select({ id: opsEmployeeRecords.staffId })
    .from(opsEmployeeRecords)
    .where(where.length ? and(...where) : undefined)
    .limit(1);
  return Boolean(row);
}

/** K-HR-01: employees whose employment status is `active` today (onboarding/on-notice excluded). */
export async function activeEmployeesMetric(
  db: Database,
  actor: Actor,
  now = new Date(),
): Promise<Metric> {
  const { where, label } = await scopeFilter(db, actor);
  const today = istToday(now);
  const meta = {
    definition: `Employee records with status "active" on the day (${label}); onboarding, on notice and separated are not counted.`,
    window: { from: today, to: today },
    unit: 'count' as const,
  };
  if (!(await hasAnyRecord(db, where))) return metric.missing(NO_RECORDS, meta);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opsEmployeeRecords)
    .where(and(...where, eq(opsEmployeeRecords.employmentStatus, 'active')));
  return metric.ok(row?.n ?? 0, meta);
}

/**
 * K-HR-02: current employees (not separated) per department. Departments with
 * no employee get an `ok` 0 only when employee records exist at all; employees
 * without a department are reported as their own row.
 */
export async function employeesByDepartmentMetric(
  db: Database,
  actor: Actor,
  now = new Date(),
): Promise<{ departmentId: string | null; departmentName: string; metric: Metric }[]> {
  const { where, label } = await scopeFilter(db, actor);
  const today = istToday(now);
  const meta = (name: string) => ({
    definition: `Current employee records (not separated) in ${name} (${label}).`,
    window: { from: today, to: today },
    unit: 'count' as const,
  });
  const depts = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(ne(departments.status, 'archived'))
    .orderBy(asc(departments.name));
  if (!(await hasAnyRecord(db, where)))
    return depts.map((d) => ({
      departmentId: d.id,
      departmentName: d.name,
      metric: metric.missing(NO_RECORDS, meta(d.name)),
    }));
  const counts = await db
    .select({ departmentId: staffMembers.departmentId, n: sql<number>`count(*)::int` })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(and(...where, ne(opsEmployeeRecords.employmentStatus, 'separated')))
    .groupBy(staffMembers.departmentId);
  const byDept = new Map(counts.map((c) => [c.departmentId as string | null, c.n]));
  const out = depts.map((d) => ({
    departmentId: d.id as string | null,
    departmentName: d.name,
    metric: metric.ok(byDept.get(d.id) ?? 0, meta(d.name)),
  }));
  const none = byDept.get(null);
  if (none)
    out.push({
      departmentId: null,
      departmentName: 'No department recorded',
      metric: metric.ok(none, meta('no recorded department')),
    });
  return out;
}

/** K-HR-03: employees with a recorded start date in the next `days` days (default 30). */
export async function upcomingJoiningDates(
  db: Database,
  actor: Actor,
  options: { days?: number; now?: Date } = {},
): Promise<{
  metric: Metric;
  employees: { staffId: string; employeeCode: string; fullName: string; startDate: string }[];
  /** Onboarding employees with no start date recorded (shown, never guessed). */
  withoutStartDate: number;
}> {
  const { where, label } = await scopeFilter(db, actor);
  const days = Math.min(365, Math.max(1, Math.trunc(options.days ?? 30)));
  const from = istToday(options.now ?? new Date());
  const to = addDays(from as IsoDate, days);
  const meta = {
    definition: `Employees (onboarding or active) whose recorded employment start date is from ${from} to ${to} (${label}).`,
    window: { from, to },
    unit: 'count' as const,
  };
  if (!(await hasAnyRecord(db, where)))
    return { metric: metric.missing(NO_RECORDS, meta), employees: [], withoutStartDate: 0 };
  const rows = await db
    .select({
      staffId: opsEmployeeRecords.staffId,
      employeeCode: opsEmployeeRecords.employeeCode,
      fullName: staffMembers.fullName,
      startDate: opsEmployeeRecords.employmentStartDate,
    })
    .from(opsEmployeeRecords)
    .innerJoin(staffMembers, eq(staffMembers.id, opsEmployeeRecords.staffId))
    .where(
      and(
        ...where,
        inArray(opsEmployeeRecords.employmentStatus, ['onboarding', 'active']),
        gte(opsEmployeeRecords.employmentStartDate, from),
        lte(opsEmployeeRecords.employmentStartDate, to),
      ),
    )
    .orderBy(asc(opsEmployeeRecords.employmentStartDate), asc(staffMembers.fullName));
  const [noDate] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opsEmployeeRecords)
    .where(
      and(
        ...where,
        eq(opsEmployeeRecords.employmentStatus, 'onboarding'),
        sql`${opsEmployeeRecords.employmentStartDate} IS NULL`,
      ),
    );
  return {
    metric: metric.ok(rows.length, meta),
    employees: rows.map((r) => ({ ...r, startDate: r.startDate as string })),
    withoutStartDate: noDate?.n ?? 0,
  };
}
