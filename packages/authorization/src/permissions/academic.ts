/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Academic OS permissions and which roles hold them. Rules:
 * - keys are `academic:<resource>:<action>` in lower snake case;
 * - `read` / `access` actions must be read-only — the auditor may hold only those;
 * - a teacher's grants are scope `own`, enforced in Academic OS queries
 *   (apps/academic-os/src/server/scope.ts): a teacher sees only the sessions
 *   they teach, the batches they are assigned to and the students enrolled in
 *   those batches; they log classes and attendance only for their own sessions;
 * - the academic coordinator manages everything academic; the director and the
 *   auditor read; counsellors and marketing roles get NO student academic records;
 * - never grant platform:users:manage / platform:roles:manage here.
 */
import { definePermissions, type PermissionDefinition } from '../types';

export const academicPermissionList = [
  { key: 'academic:module:access', description: 'Open Academic OS.' },
  {
    key: 'academic:programmes:manage',
    description: 'Maintain the programme catalogue (steward of core.programmes).',
  },
  {
    key: 'academic:courses:read',
    description: 'Read courses, curriculum plans and concept books.',
  },
  {
    key: 'academic:courses:write',
    description: 'Create courses, subjects, chapters and proposed curriculum plan versions.',
  },
  {
    key: 'academic:curriculum:approve',
    description:
      'Decide approval requests that lock, make provisional or supersede curriculum plans (no self-approval).',
  },
  { key: 'academic:batches:read', description: 'Read batches (teachers: their own batches).' },
  { key: 'academic:batches:write', description: 'Create and edit batches and their calendars.' },
  { key: 'academic:students:read', description: 'Read student records (teachers: own batches).' },
  { key: 'academic:students:write', description: 'Create and edit student records.' },
  {
    key: 'academic:enrolments:read',
    description: 'Read enrolments and the enrolment intake queue.',
  },
  {
    key: 'academic:enrolments:decide',
    description: 'Run the enrolment intake consumer and enrol students manually with a reason.',
  },
  { key: 'academic:assignments:read', description: 'Read teaching assignments.' },
  { key: 'academic:assignments:write', description: 'Assign teachers to batches and subjects.' },
  { key: 'academic:timetable:read', description: 'Read the timetable, conflicts and capacity.' },
  {
    key: 'academic:timetable:write',
    description: 'Schedule, cancel and reschedule class sessions; manage rooms and calendars.',
  },
  { key: 'academic:classes:read', description: 'Read class records (teaching log).' },
  {
    key: 'academic:classes:record',
    description: 'Record what was taught in a held session (teachers: their own sessions).',
  },
  {
    key: 'academic:classes:verify',
    description: 'Verify class records and record audited corrections (originals preserved).',
  },
  { key: 'academic:attendance:read', description: 'Read attendance.' },
  { key: 'academic:attendance:record', description: 'Record attendance for a held session.' },
  { key: 'academic:assessments:read', description: 'Read assessments and results.' },
  {
    key: 'academic:assessments:write',
    description: 'Plan assessments, configure scoring rules, answer keys and enter responses.',
  },
  {
    key: 'academic:assessments:finalise',
    description: 'Finalise results (immutable) and re-score into a new result version.',
  },
  {
    key: 'academic:progress:read',
    description: 'Read student progress, catch-up lists and interventions.',
  },
  {
    key: 'academic:progress:write',
    description: 'Create and update catch-up tasks and interventions.',
  },
  {
    key: 'academic:settings:manage',
    description: 'Change configurable academic rules (workload cap, assessment gap, thresholds).',
  },
  {
    key: 'academic:summary:read',
    description: 'Read the academic delivery summary (AcademicDeliverySummaryV1).',
  },
] as const satisfies readonly PermissionDefinition[];

export type AcademicPermission = (typeof academicPermissionList)[number]['key'];

const own = <P extends AcademicPermission>(permission: P) => ({
  permission,
  scope: 'own' as const,
});

const readOnly = academicPermissionList
  .map((p) => p.key)
  .filter((k) => k.endsWith(':read') || k.endsWith(':access'));

export const academicPermissions = definePermissions<AcademicPermission>({
  module: 'academic',
  permissions: academicPermissionList,
  grants: {
    academic_coordinator: academicPermissionList.map((p) => p.key),
    teacher: [
      'academic:module:access',
      'academic:courses:read',
      own('academic:batches:read'),
      own('academic:students:read'),
      own('academic:assignments:read'),
      own('academic:timetable:read'),
      own('academic:classes:read'),
      own('academic:classes:record'),
      own('academic:attendance:read'),
      own('academic:attendance:record'),
      own('academic:assessments:read'),
      own('academic:progress:read'),
    ],
    director: readOnly,
    auditor: readOnly,
  },
});
