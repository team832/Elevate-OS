import * as academicSchema from './academic';
import * as coreSchema from './core';
import * as marketingSchema from './marketing';
import * as opsSchema from './ops';

export * from './core';
export * from './marketing';
export * from './academic';
export * from './ops';

/** The schema files in load order, keyed by Postgres schema name. */
export const SCHEMA_MODULES = {
  core: coreSchema,
  marketing: marketingSchema,
  academic: academicSchema,
  ops: opsSchema,
} as const;

/** Postgres schemas managed by Elevate OS migrations. */
export const MANAGED_SCHEMAS = ['core', 'marketing', 'academic', 'ops'] as const;

/**
 * Merge the four schema files into one object for Drizzle. Throws if two files
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
  typeof opsSchema;

export type Schema = typeof schema;
