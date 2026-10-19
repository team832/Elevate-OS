import type { RoleKey } from '@elevate/shared-types';

export { ROLE_KEYS, isRoleKey, type RoleKey } from '@elevate/shared-types';

/** Role catalogue (D-008). Who holds which role is an owner decision. */
export const ROLES: Readonly<Record<RoleKey, { label: string; description: string }>> = {
  platform_admin: {
    label: 'Platform administrator',
    description:
      'Manages user accounts and role assignments. No access to business records by default.',
  },
  director: {
    label: 'Director',
    description: 'Leadership: reads everything, decides approvals, sees consolidated reporting.',
  },
  marketing_manager: {
    label: 'Marketing manager',
    description:
      'Runs Marketing OS: plans, approves and publishes content, reads marketing metrics.',
  },
  marketing_contributor: {
    label: 'Marketing contributor',
    description: 'Drafts ideas and content in Marketing OS; cannot approve or publish.',
  },
  academic_coordinator: {
    label: 'Academic coordinator',
    description: 'Runs Academic OS: courses, batches, timetables, assignments, enrolments.',
  },
  teacher: {
    label: 'Teacher',
    description:
      'Sees only own teaching assignments and records class delivery and attendance for them.',
  },
  admissions_counsellor: {
    label: 'Admissions counsellor',
    description: 'Works leads, counselling, demos and admissions in Business Ops OS.',
  },
  operations_manager: {
    label: 'Operations manager',
    description:
      'Runs Business Ops OS: tasks, SOPs, departments and staff (steward), admissions oversight.',
  },
  auditor: {
    label: 'Auditor',
    description:
      'Read-only access to explicitly authorised record sets. Never sees private HR, compensation or student-contact records. Can never change anything.',
  },
  hr_manager: {
    label: 'HR manager',
    description:
      'Runs HR in Business Ops OS: employee records incl. private fields, recruitment decisions, onboarding/offboarding approval, attendance and leave approval, compensation records.',
  },
  hr_contributor: {
    label: 'HR contributor',
    description:
      'Maintains employee records, recruitment, onboarding/offboarding checklists, attendance and leave records. No private HR fields, no compensation, no final approvals.',
  },
  recruiter: {
    label: 'Recruitment staff',
    description:
      'Works requisitions, candidates, applications and interviews assigned to them. No selection decisions, no employee records.',
  },
  department_manager: {
    label: 'Department manager',
    description:
      'Sees and approves attendance, corrections and leave for the people who report to them (directly or indirectly). No private HR fields or compensation.',
  },
  employee: {
    label: 'Employee',
    description:
      'Self-service: own attendance, leave requests, shifts, documents and tasks; the non-sensitive staff directory.',
  },
  finance_officer: {
    label: 'Finance-authorised user',
    description:
      'Compensation records and exports, and manually recorded admission fee records. No payroll execution.',
  },
};

/** Actions considered read-only. The auditor role may only hold these. */
export const READ_ONLY_ACTIONS = ['read', 'access'] as const;
