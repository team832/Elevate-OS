/**
 * Marketing OS domain layer — pure, deterministic functions only: no I/O, no
 * database, no Next.js or React imports. Exported as `@elevate/marketing-os/domain`.
 * Every algorithm here is documented in docs/ALGORITHMS.md.
 */
export const MODULE = { key: 'marketing', label: 'Marketing OS', basePath: '/marketing' } as const;

/** Build an in-module browser path, e.g. modulePath('items/1') → '/marketing/items/1'. */
export function modulePath(subpath = ''): string {
  const clean = subpath.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean ? `${MODULE.basePath}/${clean}` : MODULE.basePath;
}

export * from './vocabulary';
export * from './codes';
export * from './duplicates';
export * from './content-state';
export * from './rules';
export * from './week';
export * from './schedule';
export * from './collab';
export * from './publishing';
export * from './metrics-csv';
export * from './metrics-aggregate';
export * from './legacy-mapping';
