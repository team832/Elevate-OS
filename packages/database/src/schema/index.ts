import * as academicCurriculumSchema from './academic-curriculum';
import * as academicSchema from './academic';
import * as academicAssessmentsSchema from './academic-assessments';
import * as academicDeliverySchema from './academic-delivery';
import * as academicReviewsSchema from './academic-reviews';
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
import * as opsEodSchema from './ops-eod';
import * as opsTaskImportsSchema from './ops-task-imports';
import * as opsReviewAcksSchema from './ops-review-acks';
import * as opsTeacherReportsSchema from './ops-teacher-reports';

export * from './core';
export * from './marketing';
export * from './academic-curriculum';
export * from './academic';
export * from './academic-assessments';
export * from './academic-delivery';
export * from './academic-reviews';
export * from './ops';
export * from './ops-demos';
export * from './ops-students';
export * from './ops-meetings';
export * from './ops-fees-intake';
export * from './ops-applications';
export * from './ops-onboarding';
export * from './ops-tasks';
export * from './ops-eod';
export * from './ops-task-imports';
export * from './ops-review-acks';
export * from './ops-teacher-reports';

/**
 * The schema files in load order, keyed by file name.
 */
export const SCHEMA_MODULES = {
  core: coreSchema,
  marketing: marketingSchema,
  'academic-curriculum': academicCurriculumSchema,
  academic: academicSchema,
  'academic-assessments': academicAssessmentsSchema,
  'academic-delivery': academicDeliverySchema,
  'academic-reviews': academicReviewsSchema,
  ops: opsSchema,
  'ops-demos': opsDemosSchema,
  'ops-students': opsStudentsSchema,
  'ops-meetings': opsMeetingsSchema,
  'ops-fees-intake': opsFeesIntakeSchema,
  'ops-applications': opsApplicationsSchema,
  'ops-onboarding': opsOnboardingSchema,
  'ops-tasks': opsTasksSchema,
  'ops-eod': opsEodSchema,
  'ops-task-imports': opsTaskImportsSchema,
  'ops-review-acks': opsReviewAcksSchema,
  'ops-teacher-reports': opsTeacherReportsSchema,
} as const;

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
  typeof academicCurriculumSchema &
  typeof academicSchema &
  typeof academicAssessmentsSchema &
  typeof academicDeliverySchema &
  typeof academicReviewsSchema &
  typeof opsSchema &
  typeof opsDemosSchema &
  typeof opsStudentsSchema &
  typeof opsMeetingsSchema &
  typeof opsFeesIntakeSchema &
  typeof opsApplicationsSchema &
  typeof opsOnboardingSchema &
  typeof opsTasksSchema &
  typeof opsEodSchema &
  typeof opsTaskImportsSchema &
  typeof opsReviewAcksSchema &
  typeof opsTeacherReportsSchema;

export type Schema = typeof schema;
