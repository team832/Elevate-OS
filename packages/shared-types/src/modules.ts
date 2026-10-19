/** The four zones of Elevate OS (D-004). `platform` is the integrated shell. */
export const MODULE_KEYS = ['platform', 'marketing', 'academic', 'ops'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

/** Human labels and URL base paths for each module (D-004). */
export const MODULES: Readonly<
  Record<ModuleKey, { readonly label: string; readonly basePath: string; readonly port: number }>
> = {
  platform: { label: 'Home', basePath: '', port: 3000 },
  marketing: { label: 'Marketing OS', basePath: '/marketing', port: 3001 },
  academic: { label: 'Academic OS', basePath: '/academic', port: 3002 },
  ops: { label: 'Business Ops OS', basePath: '/ops', port: 3003 },
};

/** Feature status vocabulary (D-013). Order matters: each step requires the previous. */
export const FEATURE_STATUSES = ['Proposed', 'Approved', 'Implemented', 'Tested', 'Deployed'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

/**
 * Planning-data provenance labels from the legacy source (D-016). A planned
 * count is never reported as delivered work.
 */
export const PLANNING_STATUSES = ['locked', 'provisional', 'proposed', 'delivered'] as const;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];
