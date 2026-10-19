/**
 * Capacity feasibility (ACD-010, BR-ACD-7) — pure.
 *
 *   gross    = Σ teaching days × regular slots per day + extra slots
 *   excluded = dated closures on teaching days (their scheduled slots)
 *            + undated allowances (days × slots per day), each reduced by the
 *              dated closures of the same kind already entered in its period
 *   net      = gross − excluded
 *   headroom = net − required classes
 *
 * Weekends and other non-teaching days are not in `gross`, so a closure on one
 * is never deducted twice. The verdict is `feasible` / `infeasible` (or
 * `not_assessed` when the required count is unknown) — never "optimal". Totals
 * alone do not prove that a dated schedule exists; that caveat is always returned.
 */
import { isIsoDate } from '@elevate/shared-types';
import { eachDate, isoWeekday, monthKey } from './time';

export interface CalendarRule {
  label: string;
  periodStart: string;
  periodEnd: string;
  /** ISO weekdays 1 (Mon) … 7 (Sun). */
  weekdays: readonly number[];
  slotsPerDay: number;
  /** `regular` creates teaching days; `extra` adds slots to days that are already teaching days. */
  kind: 'regular' | 'extra';
}

export interface CapacityExclusion {
  label: string;
  kind: string;
  /** Dated closure. */
  date?: string | null;
  /** Undated allowance. */
  periodStart?: string | null;
  periodEnd?: string | null;
  days?: number | null;
  slotsPerDay?: number | null;
}

export interface CapacityInput {
  window: { from: string; to: string };
  rules: readonly CalendarRule[];
  exclusions: readonly CapacityExclusion[];
  /** Classes the plan needs in the window; null = unknown. */
  requiredClasses: number | null;
  /** Optional planned classes per month (`YYYY-MM`) to flag months over capacity. */
  plannedByMonth?: Readonly<Record<string, number>>;
}

export interface MonthCapacity {
  month: string;
  teachingDays: number;
  grossSlots: number;
  excludedSlots: number;
  netSlots: number;
  planned: number | null;
  /** planned − net when positive ("relocation needed"). */
  overBy: number;
}

export interface CapacityResult {
  verdict: 'feasible' | 'infeasible' | 'not_assessed';
  teachingDays: number;
  regularSlots: number;
  extraSlots: number;
  grossSlots: number;
  excludedSlots: number;
  netSlots: number;
  requiredClasses: number | null;
  headroom: number | null;
  months: MonthCapacity[];
  reasons: string[];
  /** Input problems that make the result unreliable (e.g. overlapping regular rules). */
  errors: string[];
  caveat: string;
}

export const CAPACITY_CAVEAT =
  'Capacity totals alone do not prove that a feasible dated schedule exists (BR-ACD-7). This is a feasibility check, not an optimal schedule.';

function validDate(v: string | null | undefined): v is string {
  return typeof v === 'string' && isIsoDate(v);
}

export function computeCapacity(input: CapacityInput): CapacityResult {
  const errors: string[] = [];
  const reasons: string[] = [];
  const { from, to } = input.window;
  if (!validDate(from) || !validDate(to) || from > to) {
    errors.push('The window needs valid from/to dates with from ≤ to.');
  }
  for (const r of input.rules) {
    if (!validDate(r.periodStart) || !validDate(r.periodEnd) || r.periodStart > r.periodEnd) {
      errors.push(`Rule "${r.label}" has an invalid period.`);
    }
    if (r.weekdays.length === 0 || r.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      errors.push(`Rule "${r.label}" needs weekdays between 1 (Mon) and 7 (Sun).`);
    }
    if (!Number.isInteger(r.slotsPerDay) || r.slotsPerDay < 1) {
      errors.push(`Rule "${r.label}" needs at least one slot per day.`);
    }
  }
  if (input.requiredClasses !== null && (!Number.isInteger(input.requiredClasses) || input.requiredClasses < 0)) {
    errors.push('Required classes must be a whole number ≥ 0.');
  }

  const empty: CapacityResult = {
    verdict: 'not_assessed',
    teachingDays: 0,
    regularSlots: 0,
    extraSlots: 0,
    grossSlots: 0,
    excludedSlots: 0,
    netSlots: 0,
    requiredClasses: input.requiredClasses,
    headroom: null,
    months: [],
    reasons: ['Input is invalid; capacity was not assessed.'],
    errors,
    caveat: CAPACITY_CAVEAT,
  };
  if (errors.length > 0) return empty;

  // 1. Expand the calendar day by day.
  const slotsOnDay = new Map<string, number>();
  const months = new Map<string, MonthCapacity>();
  const month = (key: string) => {
    let m = months.get(key);
    if (!m) {
      m = { month: key, teachingDays: 0, grossSlots: 0, excludedSlots: 0, netSlots: 0, planned: null, overBy: 0 };
      months.set(key, m);
    }
    return m;
  };
  let teachingDays = 0;
  let regularSlots = 0;
  let extraSlots = 0;
  const covers = (r: CalendarRule, d: string, wd: number) =>
    r.periodStart <= d && d <= r.periodEnd && r.weekdays.includes(wd);
  for (const d of eachDate(from, to)) {
    const wd = isoWeekday(d);
    const regular = input.rules.filter((r) => r.kind === 'regular' && covers(r, d, wd));
    if (regular.length > 1) {
      errors.push(`Regular rules overlap on ${d} (${regular.map((r) => r.label).join(', ')}).`);
      continue;
    }
    const base = regular[0];
    const extras = input.rules.filter((r) => r.kind === 'extra' && covers(r, d, wd));
    if (!base) {
      if (extras.length > 0) {
        errors.push(`Extra slots on ${d} fall on a day with no regular teaching rule.`);
      }
      continue;
    }
    const extra = extras.reduce((acc, r) => acc + r.slotsPerDay, 0);
    teachingDays += 1;
    regularSlots += base.slotsPerDay;
    extraSlots += extra;
    slotsOnDay.set(d, base.slotsPerDay + extra);
    const m = month(monthKey(d));
    m.teachingDays += 1;
    m.grossSlots += base.slotsPerDay + extra;
  }
  if (errors.length > 0) return { ...empty, errors };

  // 2. Exclusions: dated closures first, then allowances reduced by dated closures in their period.
  let excludedSlots = 0;
  const datedInWindow: { date: string; kind: string }[] = [];
  const notes: string[] = [];
  for (const x of input.exclusions) {
    if (!x.date) continue;
    if (!validDate(x.date) || x.date < from || x.date > to) continue;
    const lost = slotsOnDay.get(x.date) ?? 0;
    datedInWindow.push({ date: x.date, kind: x.kind });
    if (lost === 0) {
      notes.push(`"${x.label}" on ${x.date} is not a teaching day; nothing deducted (no double counting).`);
      continue;
    }
    excludedSlots += lost;
    month(monthKey(x.date)).excludedSlots += lost;
    slotsOnDay.set(x.date, 0); // two closures on the same day do not deduct twice
  }
  for (const x of input.exclusions) {
    if (x.date) continue;
    if (!validDate(x.periodStart) || !validDate(x.periodEnd)) {
      errors.push(`Allowance "${x.label}" needs a valid period.`);
      continue;
    }
    if (x.periodEnd < from || x.periodStart > to) continue;
    const already = datedInWindow.filter(
      (d) => d.kind === x.kind && d.date >= x.periodStart! && d.date <= x.periodEnd!,
    ).length;
    const days = Math.max(0, (x.days ?? 0) - already);
    const lost = days * (x.slotsPerDay ?? 0);
    if (already > 0) {
      notes.push(`Allowance "${x.label}" reduced by ${already} dated ${x.kind} day(s) already entered.`);
    }
    excludedSlots += lost;
    month(monthKey(x.periodStart! < from ? from : x.periodStart!)).excludedSlots += lost;
  }
  if (errors.length > 0) return { ...empty, errors };

  // 3. Net, headroom, verdict.
  const grossSlots = regularSlots + extraSlots;
  const netSlots = grossSlots - excludedSlots;
  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of monthList) {
    m.netSlots = m.grossSlots - m.excludedSlots;
    const planned = input.plannedByMonth?.[m.month];
    if (planned !== undefined) {
      m.planned = planned;
      m.overBy = Math.max(0, planned - m.netSlots);
      if (m.overBy > 0) reasons.push(`${m.month}: ${planned} planned > ${m.netSlots} net slots (relocation needed: ${m.overBy}).`);
    }
  }
  const required = input.requiredClasses;
  const headroom = required === null ? null : netSlots - required;
  let verdict: CapacityResult['verdict'];
  if (required === null) {
    verdict = 'not_assessed';
    reasons.unshift('Required classes are unknown, so capacity cannot be judged.');
  } else if (headroom! >= 0) {
    verdict = 'feasible';
    reasons.unshift(`${netSlots} net slots ≥ ${required} required classes (headroom ${headroom}).`);
  } else {
    verdict = 'infeasible';
    reasons.unshift(`${netSlots} net slots < ${required} required classes (short by ${-headroom!}).`);
  }
  return {
    verdict,
    teachingDays,
    regularSlots,
    extraSlots,
    grossSlots,
    excludedSlots,
    netSlots,
    requiredClasses: required,
    headroom,
    months: monthList,
    reasons: [...reasons, ...notes],
    errors,
    caveat: CAPACITY_CAVEAT,
  };
}
