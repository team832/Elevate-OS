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
      'Runs Business Ops OS: departments and staff (steward), settings, admissions oversight.',
  },
  auditor: {
    label: 'Auditor',
    description:
      'Read-only access to explicitly authorised record sets. Never sees private student-contact records. Can never change anything.',
  },
  finance_officer: {
    label: 'Finance-authorised user',
    description: 'Manually recorded admission fee records. No payroll execution.',
  },
};

/** Actions considered read-only. The auditor role may only hold these. */
export const READ_ONLY_ACTIONS = ['read', 'access'] as const;
