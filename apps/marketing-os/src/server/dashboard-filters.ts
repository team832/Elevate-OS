/**
 * Overview filters (brief 23 Oct 2026 §10): an explicit reporting period (`?from&to`, IST
 * calendar days) plus owner, campaign and course. With no filter in the URL the person's saved
 * defaults apply (Personal Settings); without those, the current IST month.
 */
import { z } from 'zod';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { weekStart } from '../domain';

export const PERIOD_PRESETS = ['this_month', 'this_week', 'last_30_days'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  this_week: 'This week (Monday to Sunday)',
  last_30_days: 'Last 30 days',
};

/** Saved default filters (also the shape inside core.user_preferences). */
export const dashboardDefaultsSchema = z
  .object({
    period: z.enum(PERIOD_PRESETS).default('this_month'),
    owner: z.uuid().nullable().default(null),
    campaign: z.uuid().nullable().default(null),
    course: z.uuid().nullable().default(null),
  })
  .strict();
export type DashboardDefaults = z.output<typeof dashboardDefaultsSchema>;

export interface DashboardFilters {
  from: IsoDate;
  to: IsoDate;
  /** Staff member whose records are counted; undefined = everyone in the reader's scope. */
  owner?: string;
  campaign?: string;
  course?: string;
  /** True when the URL named no filter and the saved defaults were used. */
  fromDefaults: boolean;
}

const FILTER_KEYS = ['from', 'to', 'owner', 'campaign', 'course'] as const;
const MAX_DAYS = 366;

export function periodRange(
  preset: PeriodPreset,
  now = new Date(),
): { from: IsoDate; to: IsoDate } {
  const today = toIsoDate(now);
  if (preset === 'this_week') {
    const from = weekStart(today);
    return { from, to: addDays(from, 6) };
  }
  if (preset === 'last_30_days') return { from: addDays(today, -29), to: today };
  const from = `${today.slice(0, 8)}01` as IsoDate;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(toIsoDate(next, 'UTC'), -1) };
}

const uuidOr = (v: string | undefined) => (v && z.uuid().safeParse(v).success ? v : undefined);

/** Filters from the URL; an invalid or missing period falls back to the default period. */
export function dashboardFilters(
  sp: Record<string, string | string[] | undefined>,
  defaults: DashboardDefaults = dashboardDefaultsSchema.parse({}),
  now = new Date(),
): DashboardFilters {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const fromDefaults = FILTER_KEYS.every((k) => !one(k));
  const fallback = periodRange(defaults.period, now);
  const from = one('from');
  const to = one('to');
  const valid = isIsoDate(from) && isIsoDate(to) && from <= to && addDays(from, MAX_DAYS) > to;
  return {
    ...(valid ? { from, to } : fallback),
    owner: fromDefaults ? (defaults.owner ?? undefined) : uuidOr(one('owner')),
    campaign: fromDefaults ? (defaults.campaign ?? undefined) : uuidOr(one('campaign')),
    course: fromDefaults ? (defaults.course ?? undefined) : uuidOr(one('course')),
    fromDefaults,
  };
}

/** The URL query for these filters (drill-down links keep them). */
export function filterQuery(f: DashboardFilters): Record<string, string> {
  return Object.fromEntries(FILTER_KEYS.flatMap((k) => (f[k] ? [[k, f[k] as string]] : [])));
}

export type FilterKey = 'period' | 'owner' | 'campaign' | 'course';

/** "Not filtered by owner, course": the active filters a figure does not apply ('' when none). */
export function notFiltered(f: DashboardFilters, applied: readonly FilterKey[]): string {
  const missing = (['period', 'owner', 'campaign', 'course'] as const).filter(
    (k) => (k === 'period' || f[k]) && !applied.includes(k),
  );
  return missing.length ? `Not filtered by ${missing.join(', ')}` : '';
}
