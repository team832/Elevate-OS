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
 * - admissions_counsellor works OWN leads/admissions (scope `own` = records
 *   whose owner or counsellor is the staff member linked to the user). No staff
 *   administration.
 * - operations_manager holds every Ops permission.
 * - director reads everything, approves fee arrangements and confirms admissions.
 * - auditor reads only.
 * - teacher reads own appointments; never moderates feedback about themselves.
 *   Teachers write student reviews in Academic OS (owner answer 21 Oct 2026, supersedes D-043):
 *   Ops reads submitted versions and acknowledges them, and never edits a teacher's words, so
 *   `ops:feedback:write` and `ops:feedback:manage` are held by no role (kept until their routes go).
 * - every staff role that opens Ops logs its own daily tasks and EOD report (own scope);
 *   operations_manager, director and auditor read everyone's; EOD review = manager + director.
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
    key: 'ops:lead_contacts:read',
    description:
      'See the contact details recorded on a lead (student and parent phone/email, city, school, consent) to follow it up (own = leads you own). Never KYC documents, student records or fees.',
  },
  {
    key: 'ops:leads:merge',
    description: 'Review duplicate flags and merge duplicate leads (explicit, audited).',
  },
  { key: 'ops:admissions:read', description: 'Read the admissions pipeline.' },
  {
    key: 'ops:admissions:write',
    description:
      'Move admissions through the pipeline, edit applications, record checks and onboarding items, and request enrolment.',
  },
  {
    key: 'ops:admissions:approve',
    description: 'Approve or reject a fee arrangement (authorised approval, BR-OPS-7).',
  },
  {
    key: 'ops:organisation:read',
    description: 'Read departments, staff and reporting lines.',
  },
  {
    key: 'ops:organisation:manage',
    description:
      'Maintain departments and staff (steward of core.departments / core.staff_members).',
  },
  { key: 'ops:settings:read', description: 'Read Ops configuration and policy states.' },
  {
    key: 'ops:settings:manage',
    description: 'Change Ops configuration values (changes stay "proposed").',
  },
  {
    key: 'ops:jobs:run',
    description: 'Run Ops jobs by hand: follow-up reminders and enrolment-reply processing.',
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
  // --- Marketing attribution (owner brief §10; the lead handoff flow was retired, D-075) -------
  {
    key: 'ops:lead_attribution:read',
    description: 'See Marketing attribution of leads (source reference, campaign).',
  },
  // --- conversion, admission numbers, student lifecycle, guardians, reports (brief §6–§9) ----
  {
    key: 'ops:admissions:convert',
    description:
      'Convert a demo to an admission (links the canonical student, assigns the number).',
  },
  {
    key: 'ops:admission_number:override',
    description:
      'Enter an admission number by hand where none was given (reason required, logged); a given number never changes (D-040).',
  },
  {
    key: 'ops:admissions:confirm',
    description:
      'Confirm an admission after a password re-check (assigns the admission number, D-040/D-041); reconcile legacy admissions. Holders are proposed (owner to confirm).',
  },
  {
    key: 'ops:kyc:verify',
    description:
      'Mark a student or guardian identity document verified or rejected. Holders are proposed (owner to confirm).',
  },
  {
    key: 'ops:students:lifecycle',
    description: 'Put a student on hold, resume, or record an exit (withdrawn, completed …).',
  },
  {
    key: 'ops:students:reactivate',
    description: 'Reactivate a former student whose exit record allows it (approver).',
  },
  {
    key: 'ops:guardians:write',
    description: 'Add or edit guardians of a student (restricted contact data).',
  },
  {
    key: 'ops:student_reports:generate',
    description: 'Generate a student report (export reference and audit row are written).',
  },
  {
    key: 'ops:student_reports:review',
    description:
      'Review and finalise a student report written by someone else. Holders are proposed (owner to confirm).',
  },
  {
    key: 'ops:teacher_reports:generate',
    description:
      'Generate and download a teacher’s internal report (BDM meetings, analysis; stored snapshot, audited). Director and operations manager; teachers never report on themselves.',
  },
  // --- counselling & meetings, teachers, feedback (brief §8H, §11, §12) ----------------------
  {
    key: 'ops:appointments:read',
    description:
      'Read counselling and meeting appointments (own = assigned, organised or taking part).',
  },
  {
    key: 'ops:appointments:manage',
    description:
      'Schedule, confirm, reschedule, cancel and record outcomes of appointments, events and webinars.',
  },
  {
    key: 'ops:event_messages:send',
    description:
      'Send a previewed message to event participants through the messaging provider. Holders are proposed (owner to confirm).',
  },
  { key: 'ops:teachers:read', description: 'Read the teacher directory and teacher profiles.' },
  {
    key: 'ops:teachers:manage',
    description:
      'Edit teacher display name, staff reference, verification, role note and subjects.',
  },
  {
    key: 'ops:feedback:read',
    description:
      'Read teachers’ submitted student reviews (from Academic OS; older Ops records read-only) and moderated student/guardian→teacher feedback (own = students you counsel).',
  },
  {
    key: 'ops:feedback:acknowledge',
    description:
      'Acknowledge a teacher’s submitted student review and add an Ops follow-up (own = students you counsel). Holders are proposed (owner to confirm).',
  },
  {
    key: 'ops:feedback:write',
    description: 'Retired 21 Oct 2026 (reviews are written in Academic OS); held by no role.',
  },
  {
    key: 'ops:feedback:manage',
    description: 'Retired 21 Oct 2026 (Ops never edits a teacher’s words); held by no role.',
  },
  {
    key: 'ops:feedback:record',
    description: 'Record student/guardian feedback about a teacher on their behalf.',
  },
  {
    key: 'ops:feedback:moderate',
    description: 'Approve, reject or hide student/guardian feedback about teachers.',
  },
  // --- staff daily tasks and end-of-day reports (owner decision 21 Oct 2026) -----------------
  {
    key: 'ops:tasks:read',
    description:
      'Read daily tasks and end-of-day reports (own = your own, plus reports sent to you as manager, which you may mark reviewed).',
  },
  {
    key: 'ops:tasks:write',
    description:
      'Log and update daily tasks; build and submit the end-of-day report (own = own tasks).',
  },
  {
    key: 'ops:eod:review',
    description: 'See every staff member’s end-of-day report for a day and mark it reviewed.',
  },
  {
    key: 'ops:tasks:import',
    description:
      'Preview and commit imports of the original task tracker’s backup files, and read the protected source copy.',
  },
] as const satisfies readonly PermissionDefinition[];

export type OpsPermission = (typeof opsPermissionList)[number]['key'];

const keys: OpsPermission[] = opsPermissionList.map((p) => p.key);

/** Read/access permissions except contact details (director and auditor baseline). */
const CONTACTS: readonly OpsPermission[] = ['ops:student_private:read', 'ops:lead_contacts:read'];
const reads = keys.filter(
  (k) => (k.endsWith(':read') || k.endsWith(':access')) && !CONTACTS.includes(k),
);

/** Retired keys still referenced by code awaiting removal; no role may hold them. */
const RETIRED: readonly OpsPermission[] = ['ops:feedback:write', 'ops:feedback:manage'];

const own = (permission: OpsPermission) => ({ permission, scope: 'own' as const });
const ownTasks = [own('ops:tasks:read'), own('ops:tasks:write')];

export const opsPermissions = definePermissions<OpsPermission>({
  module: 'ops',
  permissions: opsPermissionList,
  grants: {
    operations_manager: keys.filter((k) => !RETIRED.includes(k)),
    admissions_counsellor: [
      'ops:module:access',
      own('ops:leads:read'),
      own('ops:leads:write'),
      own('ops:admissions:read'),
      own('ops:admissions:write'),
      own('ops:fees:read'),
      own('ops:students:read'),
      own('ops:student_private:read'),
      own('ops:admissions:convert'),
      own('ops:students:lifecycle'),
      own('ops:guardians:write'),
      own('ops:student_reports:generate'),
      'ops:organisation:read',
      own('ops:appointments:read'),
      own('ops:appointments:manage'),
      'ops:teachers:read',
      'ops:feedback:record',
      // Proposed holders (owner answer 21 Oct 2026): reviews of the students the counsellor counsels.
      own('ops:feedback:read'),
      own('ops:feedback:acknowledge'),
      ...ownTasks,
    ],
    // ops:admissions:confirm holders are PROPOSED (brief §1: "who may finalize admissions"; D-041).
    director: [
      ...reads,
      'ops:admissions:approve',
      'ops:admissions:confirm',
      'ops:teacher_reports:generate',
      own('ops:tasks:write'),
      'ops:eod:review',
    ],

    auditor: reads,
    // Workspaces (D-072/D-073, Proposed): coordinators belong to Academic OS and Business
    // Operations (students, onboarding materials, feedback live in Ops); teachers only to
    // Academic OS, where their own tasks/EOD and meetings are mounted from Ops' entries.
    // Admitted students + handoff status; teacher directory and feedback (read only).
    academic_coordinator: [
      'ops:module:access',
      'ops:students:read',
      'ops:teachers:read',
      'ops:feedback:read',
      ...ownTasks,
    ],
    teacher: [own('ops:appointments:read'), ...ownTasks],
    // PROPOSED (owner to confirm, D-073): Marketing OS works leads, sources and follow-ups on the
    // one lead record, plus its own tasks/EOD. No ops:module:access, no student-private, KYC,
    // fee or review permissions.
    marketing_manager: [
      'ops:leads:read',
      'ops:leads:write',
      'ops:leads:assign',
      'ops:lead_contacts:read',
      ...ownTasks,
    ],
    marketing_contributor: [
      own('ops:leads:read'),
      own('ops:leads:write'),
      own('ops:lead_contacts:read'),
      ...ownTasks,
    ],
    finance_officer: [
      'ops:module:access',
      'ops:fees:read',
      'ops:fees:record',
      'ops:admissions:read',
      ...ownTasks,
    ],
  },
});
