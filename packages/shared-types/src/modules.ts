/** The four zones of Elevate OS (D-004). `platform` is the integrated shell. */
export const MODULE_KEYS = ['platform', 'marketing', 'academic', 'ops'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Human labels and URL base paths for each module (D-004). Each module app is also a
 * workspace on its own origin (D-072); origins come from the *_URL variables, see
 * `appOrigin` in @elevate/configuration.
 */
export const MODULES: Readonly<
  Record<ModuleKey, { readonly label: string; readonly basePath: string }>
> = {
  platform: { label: 'Home', basePath: '' },
  marketing: { label: 'Marketing OS', basePath: '/marketing' },
  academic: { label: 'Academic OS', basePath: '/academic' },
  ops: { label: 'Business Ops OS', basePath: '/ops' },
};

/** Feature status vocabulary (D-013). Order matters: each step requires the previous. */
export const FEATURE_STATUSES = [
  'Proposed',
  'Approved',
  'Implemented',
  'Tested',
  'Deployed',
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

/**
 * Planning-data provenance labels from the legacy source (D-016). A planned
 * count is never reported as delivered work.
 */
export const PLANNING_STATUSES = ['locked', 'provisional', 'proposed', 'delivered'] as const;
export type PlanningStatus = (typeof PLANNING_STATUSES)[number];
