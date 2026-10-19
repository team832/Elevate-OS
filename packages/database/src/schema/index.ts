import * as academicSchema from './academic';
import * as coreSchema from './core';
import * as marketingSchema from './marketing';
import * as opsSchema from './ops';
import * as opsHrSchema from './ops-hr';
import * as opsLifecycleSchema from './ops-lifecycle';
import * as opsTimeSchema from './ops-time';
import * as opsWorkSchema from './ops-work';

export * from './core';
export * from './marketing';
export * from './academic';
export * from './ops';
export * from './ops-hr';
export * from './ops-lifecycle';
export * from './ops-time';
export * from './ops-work';

/**
 * The schema files in load order, keyed by file name. The `ops` Postgres schema is
 * split across ops.ts and ops-*.ts (D-029); ops-columns.ts holds helpers only.
 */
export const SCHEMA_MODULES = {
  core: coreSchema,
  marketing: marketingSchema,
  academic: academicSchema,
  ops: opsSchema,
  'ops-hr': opsHrSchema,
  'ops-lifecycle': opsLifecycleSchema,
  'ops-time': opsTimeSchema,
  'ops-work': opsWorkSchema,
} as const;

/** Postgres schemas managed by Elevate OS migrations. */
export const MANAGED_SCHEMAS = ['core', 'marketing', 'academic', 'ops'] as const;

/**
 * Merge the schema files into one object for Drizzle. Throws if two files
 * export the same name (module exports must be prefixed, e.g. `opsLeads`).
 */
function mergeSchemas() {
  const merged: Record<string, unknown> = {};
  const origin: Record<string, string> = {};
  for (const [file, exports] of Object.entries(SCHEMA_MODULES)) {
    for (const [name, value] of Object.entries(exports)) {
      if (name in merged && merged[name] !== value) {
        throw new Error(
          `Schema export "${name}" is defined in both ${origin[name]}.ts and ${file}.ts — prefix module exports with the module name`,
        );
      }
      merged[name] = value;
      origin[name] = file;
    }
  }
  return merged;
}

const merged = mergeSchemas();

export const schema = merged as typeof coreSchema &
  typeof marketingSchema &
  typeof academicSchema &
  typeof opsSchema &
  typeof opsHrSchema &
  typeof opsLifecycleSchema &
  typeof opsTimeSchema &
  typeof opsWorkSchema;

export type Schema = typeof schema;
