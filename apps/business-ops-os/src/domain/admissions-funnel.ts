/**
 * Admissions funnel, demo conversion and student summary counts (owner brief §15; nav
 * "Reports: Admissions Funnel, Demo Conversion"). Pure; callers pass rows built from
 * persisted records. Definitions: docs/parts/admissions-fees-intake.md → A-REP-1 … A-REP-3.
 *
 * MISSING IS NOT ZERO: a rate whose denominator is 0 is `null` ("not enough data"), and
 * every rate carries its denominator.
 */
import type { StudentPopulation } from './student-lifecycle';

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Per lead of the cohort (leads first received in the period, merged duplicates excluded). */
export interface FunnelLead {
  demoBooked: boolean;
  /** At least one demo session `present`; null = not known (Academic OS cannot be read). */
  attended: boolean | null;
  /** Some demo with every planned day attended; null = not known. */
  completed: boolean | null;
  /** Some demo with outcome `converted`. */
  converted: boolean;
  /** The converted admission was confirmed enrolled by Academic OS. */
  enrolled: boolean;
}

/** Stage → [label, stage whose count is the denominator]. Each stage requires its denominator stage. */
export const FUNNEL_STAGES = {
  leads: ['Leads received', null],
  demoBooked: ['Demo booked', 'leads'],
  attended: ['Attended at least one demo class', 'demoBooked'],
  completed: ['Attended every planned demo day', 'attended'],
  converted: ['Converted to admission', 'attended'],
  enrolled: ['Enrolled (confirmed by Academic OS)', 'converted'],
} as const satisfies Record<string, readonly [string, string | null]>;
export type FunnelStageKey = keyof typeof FUNNEL_STAGES;

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  /** null = missing: a lead's place at this stage is not known. Never 0 in its stead. */
  count: number | null;
  /** Denominator stage and its count; null for the first stage. */
  of: { key: FunnelStageKey; count: number | null } | null;
  /** Percent of the denominator, one decimal; null = not enough data (denominator 0). */
  ratePct: number | null;
}

/** A-REP-1: nested funnel counts — a lead counts at a stage only if it also counts at the denominator stage. */
export function admissionsFunnel(leads: readonly FunnelLead[]): FunnelStage[] {
  const reached = (key: FunnelStageKey, l: FunnelLead): boolean | null => {
    if (key === 'leads') return true;
    const parent = reached(FUNNEL_STAGES[key][1] as FunnelStageKey, l);
    if (l[key] === false || parent === false) return false;
    return l[key] === null || parent === null ? null : true;
  };
  const counts = new Map<FunnelStageKey, number | null>();
  return (Object.keys(FUNNEL_STAGES) as FunnelStageKey[]).map((key) => {
    const at = leads.map((l) => reached(key, l));
    const count = at.includes(null) ? null : at.filter(Boolean).length;
    counts.set(key, count);
    const parent = FUNNEL_STAGES[key][1] as FunnelStageKey | null;
    const of = parent ? { key: parent, count: counts.get(parent)! } : null;
    return {
      key,
      label: FUNNEL_STAGES[key][0],
      count,
      of,
      ratePct: of && count !== null && of.count !== null ? rate(count, of.count) : null,
    };
  });
}

export interface DemoConversionRow {
  outcome: string;
}
export interface ConversionGroup {
  group: string;
  demos: number;
  /** Demos with an outcome (not `open`): the denominator of the rate. */
  decided: number;
  converted: number;
  ratePct: number | null;
}

/** A-REP-2: demos per group, with conversion rate = converted ÷ decided (open demos excluded). */
export function conversionBy<R extends DemoConversionRow>(
  rows: readonly R[],
  groupOf: (r: R) => string,
): ConversionGroup[] {
  const groups = new Map<string, R[]>();
  for (const r of rows) groups.set(groupOf(r), [...(groups.get(groupOf(r)) ?? []), r]);
  return [...groups]
    .map(([group, rs]) => {
      const decided = rs.filter((r) => r.outcome !== 'open').length;
      const converted = rs.filter((r) => r.outcome === 'converted').length;
      return { group, demos: rs.length, decided, converted, ratePct: rate(converted, decided) };
    })
    .sort((a, b) => b.demos - a.demos || a.group.localeCompare(b.group));
}

const PRECEDENCE: readonly StudentPopulation[] = ['active', 'on_hold', 'former'];

/** A-REP-3: students per population right now; a student with several admissions counts once (active > on hold > former). */
export function studentSummary(
  rows: readonly { studentId: string; population: StudentPopulation }[],
) {
  const best = new Map<string, number>();
  for (const r of rows) {
    const rank = PRECEDENCE.indexOf(r.population);
    if (rank < 0) continue;
    best.set(r.studentId, Math.min(best.get(r.studentId) ?? rank, rank));
  }
  const counts = { active: 0, on_hold: 0, former: 0 };
  for (const rank of best.values()) counts[PRECEDENCE[rank] as keyof typeof counts] += 1;
  return counts;
}
