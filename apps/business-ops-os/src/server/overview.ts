/**
 * Business Operations overview (owner brief 22 Oct 2026 §5, §9): one read per block for a date
 * range, each block only with its permission (null = omitted) and each from the service that owns
 * the figure. A block that fails is `{ ok: false }` on its own; Academic and Marketing come from
 * their summary contracts and say "source unavailable", never 0. Aggregates only.
 */
import { can, type Permission } from '@elevate/authorization';
import type { Database } from '@elevate/database';
import { addDays, daysBetween, isIsoDate, istToday, type IsoDate, type KpiWindow } from '../domain';
import { reviewsAuthored } from './academic-reviews';
import { buildAdmissionsOverview } from './admissions-overview';
import type { Actor } from './context';
import { buildDashboard } from './dashboard';
import { listCollections, listOutstanding } from './fee-collections';
import { buildAdmissionsFunnel, buildAdmissionsReport } from './reports/admissions';
import { fetchCrossModuleSummaries, type SummaryFetchOptions } from './summaries';
import { MAX_PERIOD_DAYS, periodReport } from './task-period-report';
import { listTeachers } from './teachers';

/** Longest range the overview and summary pages accept (inclusive days). */
export const MAX_RANGE_DAYS = 366;

/**
 * `?from&to` (Asia/Kolkata days) when both are real dates, in order and at most a year long;
 * otherwise this month to date. `rejected` = dates were given but not used.
 */
export function rangeOf(sp: { from?: string; to?: string }, now = new Date()) {
  const today = istToday(now);
  const month = { from: `${today.slice(0, 7)}-01` as IsoDate, to: today };
  const lastMonthEnd = addDays(month.from, -1);
  const presets: [string, KpiWindow][] = [
    ['This month', month],
    ['Last month', { from: `${lastMonthEnd.slice(0, 7)}-01` as IsoDate, to: lastMonthEnd }],
    ['Last 30 days', { from: addDays(today, -29), to: today }],
  ];
  const { from, to } = sp;
  const ok =
    isIsoDate(from) && isIsoDate(to) && from <= to && daysBetween(from, to) < MAX_RANGE_DAYS;
  return {
    range: ok ? { from, to } : month,
    presets,
    rejected: Boolean((sp.from || sp.to) && !ok),
  };
}

type Part<T> = { ok: true; data: T } | { ok: false; reason?: string } | null;

/** Run `fn` only with the permission(s); a failure stays inside its block. */
function part<T>(allowed: boolean, fn: () => Promise<T>): Promise<Part<T>> {
  if (!allowed) return Promise.resolve(null);
  return fn().then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => {
      console.error('ops overview block failed', error);
      return { ok: false as const };
    },
  );
}

/**
 * Teacher reviews whose latest version was submitted in the range, per teacher the reader may see
 * (withdrawn ones hidden by `reviewsAuthored`). Unavailable when Academic cannot be read.
 * shortcut: one Academic call per teacher (as teacher-ops does); ask Academic for a range count
 * on its summary contract if the directory grows past ~50 teachers.
 */
export async function reviewsInRange(db: Database, actor: Actor, range: KpiWindow) {
  const { teachers } = await listTeachers(db, actor);
  const results = await Promise.all(teachers.map((t) => reviewsAuthored(db, actor, t.id)));
  const checkedAt = results[0]?.checkedAt ?? new Date().toISOString();
  const down = results.find((r) => r.status === 'unavailable');
  if (down) return down;
  const inRange = (at: string) => {
    const day = istToday(new Date(at));
    return day >= range.from && day <= range.to;
  };
  const rows = teachers.map((t, i) => {
    const r = results[i]!;
    const reviews = r.status === 'available' ? r.reviews : [];
    return {
      staffId: t.id as string,
      name: t.displayName,
      count: reviews.filter(
        (x) => !x.superseded && x.status === 'submitted' && inRange(x.submittedAt),
      ).length,
    };
  });
  return {
    status: 'available' as const,
    checkedAt,
    total: rows.reduce((n, r) => n + r.count, 0),
    rows,
  };
}

export async function buildOverview(
  db: Database,
  actor: Actor,
  range: KpiWindow,
  { now = new Date(), summaries = {} }: { now?: Date; summaries?: SummaryFetchOptions } = {},
) {
  const has = (...p: Permission[]) => p.every((k) => can(actor, k));
  const admissions = has('ops:admissions:read');
  const fees = has('ops:fees:read');
  const dashboard = has('ops:dashboard:read');
  const tooLong = daysBetween(range.from, range.to) >= MAX_PERIOD_DAYS;
  const [funnel, report, pipeline, collections, outstanding, crossModule, reviews, team, kpis] =
    await Promise.all([
      part(admissions, () => buildAdmissionsFunnel(db, actor, { ...range, now })),
      part(admissions, () => buildAdmissionsReport(db, actor, { ...range, now })),
      part(admissions, () => buildAdmissionsOverview(db, actor, { ...range, now })),
      part(fees, () => listCollections(db, actor, { ...range, page: 1 })),
      part(fees, () => listOutstanding(db, actor, { page: 1 }, now)),
      part(dashboard, () => fetchCrossModuleSummaries(range, summaries)),
      part(has('ops:feedback:read', 'ops:teachers:read'), () => reviewsInRange(db, actor, range)),
      has('ops:tasks:read') && tooLong
        ? {
            ok: false as const,
            reason: `Choose ${MAX_PERIOD_DAYS} days or fewer to see task and EOD figures.`,
          }
        : part(has('ops:tasks:read'), () => periodReport(db, actor, range)),
      part(dashboard, () => buildDashboard(db, actor, { now, window: range, summaries: false })),
    ]);
  return {
    asOf: now.toISOString(),
    range,
    funnel,
    report,
    pipeline,
    collections,
    outstanding,
    crossModule,
    reviews,
    team,
    kpis,
  };
}
export type Overview = Awaited<ReturnType<typeof buildOverview>>;
