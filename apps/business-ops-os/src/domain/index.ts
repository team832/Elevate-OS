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
export * from './staff';
export * from './kpis';
export * from './registers';
export * from './admissions-kpis';
export * from './fees';
export * from './students';
