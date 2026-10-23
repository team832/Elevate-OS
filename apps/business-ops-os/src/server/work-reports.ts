/**
 * Work reports by period (brief 23 Oct 2026 §6, §13): the employee's own reports with where each
 * current period stands, and the HR list — one row per staff member HR manages for a period,
 * "Missing" when the report is due and not submitted. A report is expected only when the period
 * holds at least one scheduled workday by HR attendance rules (ATT's deriveDays: approved
 * holidays, approved leave and weekly offs are exempt; proposed holidays are not); with no work
 * schedule the expectation is unknown and never counted Missing. Rows are listed by name only —
 * never ranked (R13).
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import {
  departments,
  opsEodReports as reports,
  opsEodReportVersions as versions,
  staffMembers,
  type Database,
} from '@elevate/database';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { addDays, istToday, type IsoDate } from '../domain/dates';
import {
  expectation,
  periodEndsAt,
  periodLabel,
  periodOf,
  reportDeadline,
  reportStanding,
  STANDING_LABELS,
  type Period,
  type PeriodKind,
  type ReportStatus,
} from '../domain/work-report';
import { attendanceStaff, deriveDays } from './attendance';
import { accessScope, staffIdForUser, type Actor } from './context';
import { periodOfRow, reportSettings } from './eod-reports';
import type { WorkReportListQuery } from './eod-schemas';
import { hrScopeFor, hrScopeWhere } from './organisation';

export const WORK_REPORT_PAGE_SIZE = 25;
const firstSubmitted = sql<
  Date | string | null
>`(select ${versions.submittedAt} from ${versions} where ${versions.reportId} = ${reports.id} and ${versions.version} = 1)`;
/** The deadline frozen on version 1: an ISO time, 'none' (none was set), or NULL (not stored). */
const firstDeadline = sql<
  string | null
>`(select case when jsonb_exists(${versions.snapshot}, 'deadline') then coalesce(${versions.snapshot}->>'deadline', 'none') end from ${versions} where ${versions.reportId} = ${reports.id} and ${versions.version} = 1)`;

// Raw SQL timestamps come back as strings from some drivers.
const toDate = (v: Date | string | null) => (v === null ? null : new Date(v));
const sent = (r: {
  status: ReportStatus | null;
  firstSubmittedAt: Date | string | null;
  firstDeadline: string | null;
}) =>
  r.status
    ? {
        status: r.status,
        firstSubmittedAt: toDate(r.firstSubmittedAt),
        deadlineAtSubmit:
          r.firstDeadline === null
            ? undefined
            : r.firstDeadline === 'none'
              ? null
              : new Date(r.firstDeadline),
      }
    : null;

/** Per staff member: is a report expected for the period (domain `expectation`). */
export async function expectations(db: Database, staffIds: readonly string[], p: Period) {
  const days = staffIds.length
    ? await deriveDays(db, await attendanceStaff(db, { ids: staffIds }), p.start, p.end)
    : new Map<string, never[]>();
  return new Map(staffIds.map((id) => [id, expectation(days.get(id) ?? [])]));
}

/**
 * The caller's own reports of a kind (newest first), where the current and the previous period
 * stand, and the period to open (`date`, clamped to today; default the current period).
 */
export async function myReports(
  db: Database,
  actor: Actor,
  kind: PeriodKind,
  { page = 1, date }: { page?: number; date?: string } = {},
) {
  await accessScope(db, actor, 'ops:tasks:read');
  const staffId = await staffIdForUser(db, actor.id);
  if (!staffId) return null;
  const now = new Date();
  const today = istToday(now);
  const s = await reportSettings(db);
  const current = periodOf(kind, today, s.weekStart);
  const recent = [current, periodOf(kind, addDays(current.start, -1), s.weekStart)];
  const mine = and(eq(reports.staffId, staffId), eq(reports.periodKind, kind));
  const fields = {
    id: reports.id,
    periodKind: reports.periodKind,
    periodStart: reports.periodStart,
    periodEnd: reports.periodEnd,
    status: reports.status,
    currentVersion: reports.currentVersion,
    submittedAt: reports.submittedAt,
    firstSubmittedAt: firstSubmitted,
    firstDeadline,
    reviewedAt: reports.reviewedAt,
  };
  const [rows, [total], latest] = await Promise.all([
    db
      .select(fields)
      .from(reports)
      .where(mine)
      .orderBy(desc(reports.periodStart))
      .limit(WORK_REPORT_PAGE_SIZE)
      .offset((page - 1) * WORK_REPORT_PAGE_SIZE),
    db.select({ n: count() }).from(reports).where(mine),
    db
      .select(fields)
      .from(reports)
      .where(
        and(
          mine,
          inArray(
            reports.periodStart,
            recent.map((p) => p.start),
          ),
        ),
      ),
  ]);
  type Row = (typeof rows)[number];
  // Expectation matters only where nothing was sent: the two recent periods and drafts.
  const view = async (p: Period, r: Row | undefined) => {
    const deadline = reportDeadline(p, s.deadlines);
    const expected =
      r && r.status !== 'draft' ? true : (await expectations(db, [staffId], p)).get(staffId)!;
    return {
      period: p,
      label: periodLabel(p),
      deadline: deadline?.toISOString() ?? null,
      reportId: r?.id ?? null,
      ...reportStanding(r ? sent(r) : null, p, deadline, now, expected),
    };
  };
  const recentViews = [];
  for (const p of recent)
    recentViews.push(
      await view(
        p,
        latest.find((r) => r.periodStart === p.start),
      ),
    );
  const rowViews = [];
  for (const r of rows) rowViews.push({ ...r, ...(await view(periodOfRow(r), r)) });
  return {
    selected: periodOf(kind, (date && date < today ? date : today) as IsoDate, s.weekStart),
    recent: recentViews,
    rows: rowViews,
    total: total?.n ?? 0,
    page,
    pageSize: WORK_REPORT_PAGE_SIZE,
  };
}

/**
 * HR list (ops:work_reports:read): the staff HR manages × the period containing `q.date`
 * (default: the previous period, the one most recently due). The standing filter runs in SQL
 * (with each person's expectation resolved first) so the page and the total agree.
 */
export async function workReportList(db: Database, actor: Actor, q: WorkReportListQuery) {
  await accessScope(db, actor, 'ops:work_reports:read');
  const now = new Date();
  const s = await reportSettings(db);
  const day = (q.date ??
    addDays(periodOf(q.kind, istToday(now), s.weekStart).start, -1)) as IsoDate;
  const period = periodOf(q.kind, day, s.weekStart);
  const deadline = reportDeadline(period, s.deadlines);
  const due = now >= (deadline ?? periodEndsAt(period));
  const people = and(
    eq(staffMembers.status, 'active'),
    sql`${staffMembers.userId} is not null`,
    hrScopeWhere(await hrScopeFor(db, actor)),
    q.q ? ilike(staffMembers.fullName, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    q.departmentId ? eq(staffMembers.departmentId, q.departmentId as DepartmentId) : undefined,
  );
  // shortcut: derives every listed person's days for the period (as ATT's own lists do); page people in SQL past a few hundred staff.
  const ids = (await db.select({ id: staffMembers.id }).from(staffMembers).where(people)).map(
    (x) => x.id as string,
  );
  const expected = await expectations(db, ids, period);
  const whose = (want: boolean | null) => {
    const list = ids.filter((id) => expected.get(id) === want);
    return list.length ? inArray(staffMembers.id, list as StaffMemberId[]) : sql`false`;
  };
  const notSent = or(isNull(reports.id), eq(reports.status, 'draft'));
  const standing: Record<NonNullable<WorkReportListQuery['standing']>, SQL | undefined> = {
    missing: due ? and(notSent, whose(true)) : sql`false`,
    not_started: due ? sql`false` : and(isNull(reports.id), whose(true)),
    draft: due ? sql`false` : and(eq(reports.status, 'draft'), whose(true)),
    not_expected: and(notSent, whose(false)),
    no_schedule: and(notSent, whose(null)),
    submitted: eq(reports.status, 'submitted'),
    revision_requested: eq(reports.status, 'revision_requested'),
    acknowledged: eq(reports.status, 'acknowledged'),
  };
  const where = and(people, q.standing ? standing[q.standing] : undefined);
  const joined = <T extends PgSelect>(qb: T) =>
    qb
      .leftJoin(departments, eq(departments.id, staffMembers.departmentId))
      .leftJoin(
        reports,
        and(
          eq(reports.staffId, staffMembers.id),
          eq(reports.periodKind, period.kind),
          eq(reports.periodStart, period.start),
        ),
      )
      .where(where);
  const [rows, [total]] = await Promise.all([
    joined(
      db
        .select({
          staffId: staffMembers.id,
          name: staffMembers.fullName,
          department: departments.name,
          reportId: reports.id,
          status: reports.status,
          currentVersion: reports.currentVersion,
          firstSubmittedAt: firstSubmitted,
          firstDeadline,
          reviewedAt: reports.reviewedAt,
          isSample: reports.isSample,
        })
        .from(staffMembers)
        .orderBy(asc(staffMembers.fullName))
        .limit(WORK_REPORT_PAGE_SIZE)
        .offset((q.page - 1) * WORK_REPORT_PAGE_SIZE)
        .$dynamic(),
    ),
    joined(db.select({ n: count() }).from(staffMembers).$dynamic()),
  ]);
  return {
    period,
    label: periodLabel(period),
    deadline: deadline?.toISOString() ?? null,
    due,
    rows: rows.map((r) => {
      const st = reportStanding(sent(r), period, deadline, now, expected.get(r.staffId));
      return { ...r, ...st, standingLabel: STANDING_LABELS[st.standing] };
    }),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: WORK_REPORT_PAGE_SIZE,
  };
}
export type WorkReportList = Awaited<ReturnType<typeof workReportList>>;
