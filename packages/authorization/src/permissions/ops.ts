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
  { key: 'ops:sops:acknowledge', description: 'Acknowledge an SOP version one is asked to read.' },
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
  { key: 'ops:policies:approve', description: 'Approve or reject a policy register version.' },
  {
    key: 'ops:jobs:run',
    description:
      'Run Ops jobs by hand: follow-up reminders, task escalations, enrolment-reply processing.',
  },
  // --- admissions administration (OPS-070…) -------------------------------------------------
  {
    key: 'ops:fees:read',
    description: 'Read manually recorded admission fee records (never verified transactions).',
  },
  {
    key: 'ops:fees:record',
    description: 'Record fee amounts due/received, receipt references, refunds (manual records).',
  },
  {
    key: 'ops:students:read',
    description: 'Student administration: admitted students, admission history, handoff status.',
  },
  {
    key: 'ops:student_private:read',
    description: 'Student and guardian contact details, consent and administrative documents.',
  },
  // --- HR records (OPS-030…) ----------------------------------------------------------------
  {
    key: 'ops:employees:read',
    description: 'Employee directory and non-sensitive employee record fields.',
  },
  {
    key: 'ops:employees:manage',
    description: 'Create and edit employee records, assignments and their history.',
  },
  {
    key: 'ops:employee_private:read',
    description: 'Private HR fields: personal contacts, emergency contacts, identity references.',
  },
  { key: 'ops:employee_private:manage', description: 'Edit private HR fields.' },
  {
    key: 'ops:employee_documents:read',
    description: 'Employment document metadata and authorised downloads.',
  },
  {
    key: 'ops:employee_documents:manage',
    description: 'Add, replace and retire employment document records.',
  },
  {
    key: 'ops:compensation:read',
    description: 'Compensation records (approved terms, components, effective dates).',
  },
  { key: 'ops:compensation:manage', description: 'Record and change compensation terms.' },
  { key: 'ops:compensation:approve', description: 'Approve drafted compensation terms.' },
  {
    key: 'ops:compensation:export',
    description: 'Export compensation records for an authorised payroll process (no payroll run).',
  },
  { key: 'ops:assets:read', description: 'Read work assets and their assignments.' },
  { key: 'ops:assets:manage', description: 'Register assets, assign and record returns.' },
  // --- recruitment, onboarding, offboarding (OPS-040…) --------------------------------------
  {
    key: 'ops:recruitment:read',
    description: 'Read requisitions, candidates, applications, interviews and offers.',
  },
  {
    key: 'ops:recruitment:manage',
    description: 'Work requisitions, candidates, applications, interviews and feedback.',
  },
  {
    key: 'ops:recruitment:decide',
    description: 'Select or reject candidates, approve offers, convert a candidate to an employee.',
  },
  { key: 'ops:lifecycle:read', description: 'Read onboarding and offboarding cases.' },
  {
    key: 'ops:lifecycle:manage',
    description: 'Open onboarding/offboarding cases and work their checklists.',
  },
  {
    key: 'ops:lifecycle:approve',
    description: 'Give the final approval on onboarding completion or a separation.',
  },
  // --- staff attendance, shifts, leave (OPS-050…) -------------------------------------------
  { key: 'ops:attendance:read', description: 'Read staff attendance sessions and summaries.' },
  {
    key: 'ops:attendance:record',
    description: 'Clock in/out and request corrections for oneself.',
  },
  {
    key: 'ops:attendance:manage',
    description: 'Manual attendance entries (reason required) and validated CSV imports.',
  },
  {
    key: 'ops:attendance:approve',
    description: 'Review and decide attendance correction requests.',
  },
  { key: 'ops:shifts:read', description: 'Read shift templates, assignments and calendars.' },
  {
    key: 'ops:shifts:manage',
    description: 'Maintain shift templates, assignments, work calendars and holidays.',
  },
  { key: 'ops:leave:read', description: 'Read leave requests, balances and team availability.' },
  { key: 'ops:leave:request', description: 'Request and cancel leave for oneself.' },
  { key: 'ops:leave:approve', description: 'Approve or reject leave requests.' },
  {
    key: 'ops:leave:manage',
    description: 'Maintain leave types, balances and the holiday calendar (policy stays proposed).',
  },
  // --- reporting ----------------------------------------------------------------------------
  { key: 'ops:hr_reports:read', description: 'Read HR dashboards and timesheet summaries.' },
  {
    key: 'ops:hr_reports:export',
    description: 'Export employee-level attendance and timesheet reports.',
  },
] as const satisfies readonly PermissionDefinition[];

export type OpsPermission = (typeof opsPermissionList)[number]['key'];

const keys: OpsPermission[] = opsPermissionList.map((p) => p.key);

/**
 * Sensitive record sets (D-028): private HR fields, employment documents,
 * compensation and student/guardian contact data. Nobody receives them through a
 * blanket "all reads" grant — every holder is listed explicitly below.
 */
const SENSITIVE_RESOURCES = [
  'employee_private',
  'employee_documents',
  'compensation',
  'student_private',
] as const;
const isSensitive = (k: OpsPermission) =>
  SENSITIVE_RESOURCES.some((r) => k.startsWith(`ops:${r}:`));

/** Read/access permissions outside the sensitive sets (director and auditor baseline). */
const reads = keys.filter((k) => (k.endsWith(':read') || k.endsWith(':access')) && !isSensitive(k));

const own = (permission: OpsPermission) => ({ permission, scope: 'own' as const });

export const opsPermissions = definePermissions<OpsPermission>({
  module: 'ops',
  permissions: opsPermissionList,
  grants: {
    // Everything except the sensitive HR sets (salary, private HR fields, employment
    // documents); student/guardian contacts are part of running admissions.
    operations_manager: keys.filter((k) => !isSensitive(k) || k === 'ops:student_private:read'),
    admissions_counsellor: [
      'ops:module:access',
      own('ops:leads:read'),
      own('ops:leads:write'),
      own('ops:admissions:read'),
      own('ops:admissions:write'),
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      own('ops:fees:read'),
      own('ops:students:read'),
      own('ops:student_private:read'),
      'ops:sops:read',
      'ops:sops:acknowledge',
      'ops:organisation:read',
      'ops:employees:read',
    ],
    director: [
      ...reads,
      'ops:sops:approve',
      'ops:admissions:approve',
      'ops:decisions:write',
      'ops:recruitment:decide',
      'ops:lifecycle:approve',
      'ops:policies:approve',
      'ops:sops:acknowledge',
    ],
    teacher: [own('ops:tasks:read'), own('ops:tasks:write')],
    auditor: reads,
    // Sees admitted students and their enrolment-handoff status only.
    academic_coordinator: ['ops:module:access', 'ops:students:read'],
    hr_manager: [
      'ops:module:access',
      'ops:organisation:read',
      'ops:organisation:manage',
      'ops:employees:read',
      'ops:employees:manage',
      'ops:employee_private:read',
      'ops:employee_private:manage',
      'ops:employee_documents:read',
      'ops:employee_documents:manage',
      'ops:compensation:read',
      'ops:compensation:manage',
      'ops:compensation:approve',
      'ops:assets:read',
      'ops:assets:manage',
      'ops:recruitment:read',
      'ops:recruitment:manage',
      'ops:recruitment:decide',
      'ops:lifecycle:read',
      'ops:lifecycle:manage',
      'ops:lifecycle:approve',
      'ops:attendance:read',
      'ops:attendance:manage',
      'ops:attendance:approve',
      own('ops:attendance:record'),
      'ops:shifts:read',
      'ops:shifts:manage',
      'ops:leave:read',
      'ops:leave:approve',
      'ops:leave:manage',
      own('ops:leave:request'),
      'ops:hr_reports:read',
      'ops:hr_reports:export',
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      'ops:sops:read',
      'ops:sops:acknowledge',
      'ops:settings:read',
      'ops:policies:approve',
    ],
    hr_contributor: [
      'ops:module:access',
      'ops:organisation:read',
      'ops:employees:read',
      'ops:employees:manage',
      'ops:employee_documents:read',
      'ops:employee_documents:manage',
      'ops:assets:read',
      'ops:assets:manage',
      'ops:recruitment:read',
      'ops:recruitment:manage',
      'ops:lifecycle:read',
      'ops:lifecycle:manage',
      'ops:attendance:read',
      'ops:attendance:manage',
      own('ops:attendance:record'),
      'ops:shifts:read',
      'ops:shifts:manage',
      'ops:leave:read',
      'ops:leave:manage',
      own('ops:leave:request'),
      'ops:hr_reports:read',
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      'ops:sops:read',
      'ops:sops:acknowledge',
    ],
    // `own` = requisitions, candidates and interviews assigned to the recruiter.
    recruiter: [
      'ops:module:access',
      'ops:organisation:read',
      own('ops:recruitment:read'),
      own('ops:recruitment:manage'),
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      'ops:sops:read',
      'ops:sops:acknowledge',
    ],
    // `own` = themselves plus everyone in their reporting chain (server/hr-scope.ts).
    department_manager: [
      'ops:module:access',
      'ops:organisation:read',
      own('ops:employees:read'),
      own('ops:attendance:read'),
      own('ops:attendance:approve'),
      own('ops:attendance:record'),
      own('ops:shifts:read'),
      own('ops:leave:read'),
      own('ops:leave:approve'),
      own('ops:leave:request'),
      own('ops:lifecycle:read'),
      // Interview panels: applications the manager sits on (server/hr/recruitment.ts).
      own('ops:recruitment:read'),
      own('ops:assets:read'),
      own('ops:hr_reports:read'),
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      'ops:sops:read',
      'ops:sops:acknowledge',
    ],
    // Self-service. The directory (ops:employees:read) shows non-sensitive fields only.
    employee: [
      'ops:module:access',
      'ops:organisation:read',
      'ops:employees:read',
      own('ops:employee_private:read'),
      own('ops:employee_private:manage'),
      own('ops:employee_documents:read'),
      own('ops:attendance:read'),
      own('ops:attendance:record'),
      own('ops:shifts:read'),
      own('ops:leave:read'),
      own('ops:leave:request'),
      own('ops:assets:read'),
      own('ops:tasks:read'),
      own('ops:tasks:write'),
      'ops:sops:read',
      'ops:sops:acknowledge',
    ],
    finance_officer: [
      'ops:module:access',
      'ops:employees:read',
      'ops:compensation:read',
      'ops:compensation:manage',
      'ops:compensation:approve',
      'ops:compensation:export',
      'ops:fees:read',
      'ops:fees:record',
      'ops:admissions:read',
      'ops:hr_reports:read',
    ],
  },
});
