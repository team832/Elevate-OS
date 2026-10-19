/**
 * OWNER: Business Ops OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Business Ops OS permissions and which roles hold them (refined in wave 2).
 * Rules:
 * - keys are `ops:<resource>:<action>` in lower snake case;
 * - `read` / `access` actions are read-only — the auditor holds only those;
 * - never grant platform:users:manage / platform:roles:manage here;
 * - Ops stewards core.departments and core.staff_members: only holders of
 *   `ops:organisation:manage` may write them.
 *
 * Role intent (apps/business-ops-os/README.md → "Permissions"):
 * - admissions_counsellor works OWN leads/admissions/tasks (scope `own` = records
 *   whose owner or counsellor is the staff member linked to the user). No SOP
 *   administration, no staff administration, no planning registers.
 * - operations_manager holds every Ops permission.
 * - director reads everything, approves SOPs and fee arrangements, records decisions.
 * - auditor reads only.
 * - teacher sees and updates only tasks assigned to them (scope `own`). The teacher
 *   is NOT granted `ops:module:access` because a Foundation test pins
 *   modulesFor(teacher) to platform + academic; see INTEGRATION_REQUESTS.md IR-OPS-01.
 */
import { definePermissions, type PermissionDefinition } from '../types';

export const opsPermissionList = [
  { key: 'ops:module:access', description: 'Open Business Ops OS.' },
  {
    key: 'ops:dashboard:read',
    description: 'Read the operations dashboard (incl. academic and marketing summaries).',
  },
  { key: 'ops:leads:read', description: 'Read leads, enquiries, contact activity and follow-ups.' },
  {
    key: 'ops:leads:write',
    description:
      'Create and update leads, enquiries, contact attempts, follow-ups, counselling and demos.',
  },
  { key: 'ops:leads:assign', description: 'Assign or reassign the owner of any lead.' },
  {
    key: 'ops:leads:merge',
    description: 'Review duplicate flags and merge duplicate leads (explicit, audited).',
  },
  { key: 'ops:admissions:read', description: 'Read the admissions pipeline.' },
  {
    key: 'ops:admissions:write',
    description: 'Move admissions through the pipeline, record checks and request enrolment.',
  },
  {
    key: 'ops:admissions:approve',
    description: 'Approve or reject a fee arrangement (authorised approval, BR-OPS-7).',
  },
  { key: 'ops:tasks:read', description: 'Read tasks and escalations.' },
  { key: 'ops:tasks:write', description: 'Create, assign and update tasks; handle escalations.' },
  { key: 'ops:sops:read', description: 'Read SOPs and their versions.' },
  { key: 'ops:sops:write', description: 'Draft and edit SOPs, submit them for approval.' },
  { key: 'ops:sops:approve', description: 'Approve or reject an SOP version.' },
  { key: 'ops:incidents:read', description: 'Read operational exceptions and incidents.' },
  { key: 'ops:incidents:write', description: 'Record and resolve exceptions and incidents.' },
  { key: 'ops:decisions:read', description: 'Read the decision log.' },
  { key: 'ops:decisions:write', description: 'Record decisions.' },
  {
    key: 'ops:risks:read',
    description: 'Read risks, issues, blockers, projects, milestones and the work inventory.',
  },
  {
    key: 'ops:risks:write',
    description: 'Record and update risks, issues, blockers, projects and milestones.',
  },
  {
    key: 'ops:organisation:read',
    description: 'Read departments, staff, reporting lines and responsibilities.',
  },
  {
    key: 'ops:organisation:manage',
    description:
      'Maintain departments, staff, responsibilities and onboarding checklists (steward of core.departments / core.staff_members).',
  },
  { key: 'ops:settings:read', description: 'Read Ops configuration and policy states.' },
  {
    key: 'ops:settings:manage',
    description: 'Change Ops configuration values (changes stay "proposed").',
  },
  {
    key: 'ops:jobs:run',
    description:
      'Run Ops jobs by hand: follow-up reminders, task escalations, enrolment-reply processing.',
  },
] as const satisfies readonly PermissionDefinition[];

export type OpsPermission = (typeof opsPermissionList)[number]['key'];

const reads = opsPermissionList
  .map((p) => p.key)
  .filter((k) => k.endsWith(':read') || k.endsWith(':access'));

export const opsPermissions = definePermissions<OpsPermission>({
  module: 'ops',
  permissions: opsPermissionList,
  grants: {
    operations_manager: opsPermissionList.map((p) => p.key),
    admissions_counsellor: [
      'ops:module:access',
      { permission: 'ops:leads:read', scope: 'own' },
      { permission: 'ops:leads:write', scope: 'own' },
      { permission: 'ops:admissions:read', scope: 'own' },
      { permission: 'ops:admissions:write', scope: 'own' },
      { permission: 'ops:tasks:read', scope: 'own' },
      { permission: 'ops:tasks:write', scope: 'own' },
      'ops:sops:read',
      'ops:organisation:read',
    ],
    director: [...reads, 'ops:sops:approve', 'ops:admissions:approve', 'ops:decisions:write'],
    teacher: [
      { permission: 'ops:tasks:read', scope: 'own' },
      { permission: 'ops:tasks:write', scope: 'own' },
    ],
    auditor: reads,
  },
});
