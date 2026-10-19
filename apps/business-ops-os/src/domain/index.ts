/**
 * Business Ops OS domain layer — pure, deterministic functions only: no I/O, no
 * database, no Next.js or React imports. Exported as `@elevate/business-ops-os/domain`.
 * Every algorithm is documented in docs/ALGORITHMS.md (A-01 … A-14).
 */
export const MODULE = { key: 'ops', label: 'Business Ops OS', basePath: '/ops' } as const;

/** Build an in-module browser path, e.g. modulePath('items/1') → '/ops/items/1'. */
export function modulePath(subpath = ''): string {
  const clean = subpath.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `${MODULE.basePath}/${clean}` : MODULE.basePath;
}

export * from './dates';
export * from './contacts';
export * from './pipeline';
export * from './admission-readiness';
export * from './policies';
export * from './follow-ups';
export * from './graph';
export * from './tasks';
export * from './escalation';
export * from './staff';
export * from './sops';
export * from './kpis';
export * from './registers';
export * from './legacy';
export * from './admissions-kpis';
export * from './fees';
export * from './students';
// HR (D-028). `./hr/calendar` is not re-exported: its `isValidTimeZone` clashes with `./hr/employees`.
export * from './hr/assets';
export * from './hr/attendance';
export * from './hr/compensation';
export * from './hr/csv';
export * from './hr/documents';
export * from './hr/employees';
export * from './hr/leave';
export * from './hr/lifecycle';
export * from './hr/org';
export * from './hr/recruitment';
export * from './hr/shifts';
export * from './hr/timesheets';
