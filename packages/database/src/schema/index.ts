import * as academicSchema from './academic';
import * as coreSchema from './core';
import * as marketingSchema from './marketing';
import * as opsSchema from './ops';
import * as opsDemosSchema from './ops-demos';
import * as opsStudentsSchema from './ops-students';
import * as opsMeetingsSchema from './ops-meetings';
import * as opsFeesIntakeSchema from './ops-fees-intake';
import * as opsApplicationsSchema from './ops-applications';
import * as opsOnboardingSchema from './ops-onboarding';
import * as opsTasksSchema from './ops-tasks';

export * from './core';
export * from './marketing';
export * from './academic';
export * from './ops';
export * from './ops-demos';
export * from './ops-students';
export * from './ops-meetings';
export * from './ops-fees-intake';
export * from './ops-applications';
export * from './ops-onboarding';
export * from './ops-tasks';

/**
 * The schema files in load order, keyed by file name.
 */
export const SCHEMA_MODULES = {
  core: coreSchema,
  marketing: marketingSchema,
  academic: academicSchema,
  ops: opsSchema,
  'ops-demos': opsDemosSchema,
  'ops-students': opsStudentsSchema,
  'ops-meetings': opsMeetingsSchema,
  'ops-fees-intake': opsFeesIntakeSchema,
  'ops-applications': opsApplicationsSchema,
  'ops-onboarding': opsOnboardingSchema,
  'ops-tasks': opsTasksSchema,
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
  typeof opsDemosSchema &
  typeof opsStudentsSchema &
  typeof opsMeetingsSchema &
  typeof opsFeesIntakeSchema &
  typeof opsApplicationsSchema &
  typeof opsOnboardingSchema &
  typeof opsTasksSchema;

export type Schema = typeof schema;
