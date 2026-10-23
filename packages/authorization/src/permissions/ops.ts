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
 * - HR (brief 23 Oct 2026, supersedes D-032 in part): hr_manager runs HR for teachers and
 *   marketing staff. Staff-private details are held only by hr_manager, raw student feedback about
 *   teachers only by hr_manager + operations_manager; neither is in the broad `reads`. Teachers
 *   and marketing roles get own-scope HR grants only.
 *   PROPOSED-GRANTS-2026-10-23 marks every grant that is Proposed (owner to confirm).
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
  // --- HR for teachers and marketing staff (brief 23 Oct 2026) --------------------------------
  {
    key: 'ops:tasks:review',
    description:
      'Approve a submitted task, request changes or comment (own = tasks you review or that belong to people who report to you).',
  },
  { key: 'ops:hr:read', description: 'Open HR: overview, staff directory and staff records.' },
  {
    key: 'ops:staff:manage',
    description:
      'Maintain employee records: employment status and dates, branch, schedule, departments, reporting line, end of employment.',
  },
  {
    key: 'ops:staff_private:read',
    description:
      'See staff-private details: personal phone and email, address, emergency contact, photo.',
  },
  { key: 'ops:staff_private:manage', description: 'Edit staff-private details.' },
  {
    key: 'ops:teaching_assignments:read',
    description: 'Read teachers’ teaching assignments (from Academic OS).',
  },
  {
    key: 'ops:attendance:read',
    description:
      'Read staff attendance: punches, daily status, leave, corrections (own = your own).',
  },
  {
    key: 'ops:attendance:manage',
    description:
      'Enter and import punches, decide daily status, record leave, holidays and schedules, decide correction requests.',
  },
  {
    key: 'ops:attendance:request',
    description: 'Ask HR to correct a day’s attendance (own = your own days).',
  },
  {
    key: 'ops:work_reports:read',
    description:
      'Read the consolidated EOD, weekly and monthly work reports of every staff member.',
  },
  {
    key: 'ops:teacher_feedback:read',
    description:
      'Read raw student feedback about teachers, including student identities where collected.',
  },
  {
    key: 'ops:teacher_feedback:manage',
    description:
      'Record and review student feedback about teachers, write and approve summaries, agree development actions.',
  },
  {
    key: 'ops:teacher_feedback:import',
    description: 'Preview and commit imports of student feedback files.',
  },
  {
    key: 'ops:teacher_feedback_summaries:read',
    description:
      'Read approved feedback summaries and development actions (own = about yourself). Never raw rows.',
  },
  { key: 'ops:hr_settings:manage', description: 'Change HR, report and feedback settings.' },
  // --- requests through HR, tests (brief 23 Oct 2026 §6, §17–§21) PROPOSED-GRANTS-2026-10-23b ---
  {
    key: 'ops:hr_requests:create',
    description:
      'Send a request through HR and follow it; read and answer what HR forwards to you (own).',
  },
  {
    key: 'ops:hr_requests:read',
    description: 'Read the HR request queue: every request, its routing log and replies.',
  },
  {
    key: 'ops:hr_requests:manage',
    description:
      'Review, forward, resolve or decline requests sent through HR, relay replies, create a task from one.',
  },
  {
    key: 'ops:assessments:read',
    description:
      'Read Tests and Mock Tests: tests, rosters, papers, score imports and results (the Academic record).',
  },
  {
    key: 'ops:assessments:manage',
    description:
      'Plan tests, upload and release papers and answer keys, import and confirm scores (writes the Academic record).',
  },
  {
    key: 'ops:assessments:publish',
    description: 'Publish or correct a test’s results and ranks after the completeness checks.',
  },
] as const satisfies readonly PermissionDefinition[];

export type OpsPermission = (typeof opsPermissionList)[number]['key'];

const keys: OpsPermission[] = opsPermissionList.map((p) => p.key);

/** Reads kept out of the director/auditor baseline: contacts, staff-private, raw feedback. */
const PRIVATE_READS: readonly OpsPermission[] = [
  'ops:student_private:read',
  'ops:lead_contacts:read',
  'ops:staff_private:read',
  'ops:teacher_feedback:read',
  'ops:hr_requests:read',
];
const reads = keys.filter(
  (k) => (k.endsWith(':read') || k.endsWith(':access')) && !PRIVATE_READS.includes(k),
);

/** Retired keys still referenced by code awaiting removal; no role may hold them. */
const RETIRED: readonly OpsPermission[] = ['ops:feedback:write', 'ops:feedback:manage'];
/** Held by hr_manager alone (PROPOSED-GRANTS-2026-10-23). */
const HR_ONLY: readonly OpsPermission[] = ['ops:staff_private:read', 'ops:staff_private:manage'];

const own = (permission: OpsPermission) => ({ permission, scope: 'own' as const });
const ownTasks = [own('ops:tasks:read'), own('ops:tasks:write')];
/** A staff member's own attendance and correction requests (PROPOSED-GRANTS-2026-10-23). */
const ownAttendance = [own('ops:attendance:read'), own('ops:attendance:request')];
/** Send requests through HR and answer what HR forwards (PROPOSED-GRANTS-2026-10-23b). */
const ownHrRequests = own('ops:hr_requests:create');

export const opsPermissions = definePermissions<OpsPermission>({
  module: 'ops',
  permissions: opsPermissionList,
  grants: {
    operations_manager: keys.filter((k) => !RETIRED.includes(k) && !HR_ONLY.includes(k)),
    // PROPOSED-GRANTS-2026-10-23 (the whole role).
    hr_manager: [
      'ops:module:access',
      'ops:hr:read',
      'ops:organisation:read',
      'ops:teachers:read',
      'ops:staff:manage',
      ...HR_ONLY,
      'ops:teaching_assignments:read',
      'ops:tasks:read',
      'ops:tasks:write',
      'ops:tasks:review',
      'ops:eod:review',
      'ops:work_reports:read',
      'ops:attendance:read',
      'ops:attendance:manage',
      'ops:attendance:request',
      'ops:teacher_feedback:read',
      'ops:teacher_feedback:manage',
      'ops:teacher_feedback:import',
      'ops:teacher_feedback_summaries:read',
      'ops:settings:read',
      'ops:hr_settings:manage',
      'ops:hr_requests:read', // PROPOSED-GRANTS-2026-10-23b
      'ops:hr_requests:manage', // PROPOSED-GRANTS-2026-10-23b
    ],
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
      ...ownAttendance,
      ownHrRequests,
    ],
    // ops:admissions:confirm holders are PROPOSED (brief §1: "who may finalize admissions"; D-041).
    director: [
      ...reads,
      'ops:admissions:approve',
      'ops:admissions:confirm',
      'ops:teacher_reports:generate',
      // Owner, 23 Oct 2026 (D-079): directors download Internal and PTM student reports.
      'ops:student_reports:generate',
      own('ops:tasks:write'),
      'ops:eod:review',
      own('ops:tasks:review'), // PROPOSED-GRANTS-2026-10-23
      ownHrRequests,
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
      'ops:assessments:read', // PROPOSED-GRANTS-2026-10-23b
      ...ownTasks,
      ...ownAttendance,
      ownHrRequests,
      own('ops:tasks:review'), // PROPOSED-GRANTS-2026-10-23
    ],
    teacher: [
      own('ops:appointments:read'),
      ...ownTasks,
      ...ownAttendance,
      ownHrRequests,
      own('ops:teacher_feedback_summaries:read'), // PROPOSED-GRANTS-2026-10-23
    ],
    // PROPOSED (owner to confirm, D-073): Marketing OS works leads, sources and follow-ups on the
    // one lead record, plus its own tasks/EOD. No ops:module:access, no student-private, KYC,
    // fee or review permissions.
    marketing_manager: [
      'ops:leads:read',
      'ops:leads:write',
      'ops:leads:assign',
      'ops:leads:merge', // PROPOSED-GRANTS-2026-10-23b: explicit merge review (brief §11)
      'ops:lead_contacts:read',
      ...ownTasks,
      ...ownAttendance,
      ownHrRequests,
      own('ops:tasks:review'), // PROPOSED-GRANTS-2026-10-23: their team's work
    ],
    marketing_contributor: [
      own('ops:leads:read'),
      own('ops:leads:write'),
      own('ops:lead_contacts:read'),
      ...ownTasks,
      ...ownAttendance,
      ownHrRequests,
    ],
    finance_officer: [
      'ops:module:access',
      'ops:fees:read',
      'ops:fees:record',
      'ops:admissions:read',
      ...ownTasks,
      ...ownAttendance,
      ownHrRequests,
    ],
  },
});
