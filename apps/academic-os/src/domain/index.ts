/**
 * Academic OS domain layer — pure, deterministic functions only: no I/O, no
 * database, no Next.js or React imports. Exported as `@elevate/academic-os/domain`.
 *
 * Algorithms (documented in docs/ALGORITHMS.md):
 * - coverage.ts             planned vs completed hours per chapter / subject / course
 * - timetable.ts            timetable conflict detection (hard vs preference)
 * - capacity.ts             capacity feasibility (gross − exclusions = net vs required)
 * - assessment-schedule.ts  assessment scheduling constraints
 * - scoring.ts              exact scoring, validation, aggregation, percentiles
 * - progress.ts             attendance summary, missed classes, least-squares trend, support signals
 * - analysis.ts             assessment analysis (scored-only average) and comparability
 * - catchup.ts              catch-up prioritisation
 * - intake.ts               enrolment intake decision
 * - plans.ts                curriculum plan status rules
 */
export const MODULE = { key: 'academic', label: 'Academic OS', basePath: '/academic' } as const;

/** Build an in-module browser path, e.g. modulePath('items/1') → '/academic/items/1'. */
export function modulePath(subpath = ''): string {
  const clean = subpath.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `${MODULE.basePath}/${clean}` : MODULE.basePath;
}

export * from './time';
export * from './marks';
export * from './scoring';
export * from './timetable';
export * from './capacity';
export * from './assessment-schedule';
export * from './coverage';
export * from './progress';
export * from './catchup';
export * from './plans';
export * from './intake';
export * from './responses-csv';
export * from './settings';
export * from './analysis';
