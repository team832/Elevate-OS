/**
 * Does a link open for this person? The one question lists, tiles and records ask before showing
 * one, so nobody is sent to "No access". This only decides what to show: each page's gate() stays
 * the security check. PAGE_GATES repeats those gates; tests/unit/screens.test.tsx reads every
 * page.tsx and fails if they differ. PAGE_NEEDS adds what a page's body needs to show anything.
 */
import type { ReactNode } from 'react';
import { can, type Permission, type Principal } from '@elevate/authorization';
import { APPROVAL_SOURCES } from '../server/approvals';

/** Fee approvals: the inbox's own check, any approval source's permission (server/approvals.ts). */
export const FEE_APPROVERS: readonly Permission[] = APPROVAL_SOURCES.flatMap((s) =>
  [s.permission].flat(),
);

export const PAGE_GATES: Record<string, Permission> = {
  '/ops': 'ops:module:access',
  '/ops/academic-summary': 'ops:dashboard:read',
  '/ops/admissions': 'ops:leads:read',
  '/ops/admissions/[id]': 'ops:admissions:read',
  '/ops/admissions/applications': 'ops:admissions:read',
  '/ops/admissions/applications/[id]': 'ops:admissions:read',
  '/ops/admissions/demos/[id]': 'ops:leads:read',
  '/ops/admissions/demos/[id]/convert': 'ops:admissions:convert',
  '/ops/admissions/overview': 'ops:admissions:read',
  '/ops/approval-cover': 'ops:module:access',
  '/ops/calendar': 'ops:module:access',
  '/ops/certificates': 'ops:students:read',
  '/ops/fees': 'ops:fees:read',
  '/ops/fees/collections': 'ops:fees:read',
  '/ops/fees/defaulters': 'ops:fees:read',
  '/ops/fees/outstanding': 'ops:fees:read',
  '/ops/follow-ups': 'ops:leads:read',
  '/ops/hr': 'ops:hr:read',
  '/ops/hr-requests': 'ops:hr_requests:create',
  '/ops/hr/assets': 'ops:hr:read',
  '/ops/hr/assignments': 'ops:teaching_assignments:read',
  '/ops/hr/attendance': 'ops:attendance:read',
  '/ops/hr/attendance/[staffId]': 'ops:attendance:read',
  '/ops/hr/checklists': 'ops:hr:read',
  '/ops/hr/feedback': 'ops:teacher_feedback:read',
  '/ops/hr/payroll': 'ops:module:access',
  '/ops/hr/payroll/[id]': 'ops:module:access',
  '/ops/hr/reports': 'ops:work_reports:read',
  '/ops/hr/requests': 'ops:hr_requests:read',
  '/ops/hr/review': 'ops:tasks:review',
  '/ops/hr/settings': 'ops:hr_settings:manage',
  '/ops/hr/staff': 'ops:hr:read',
  '/ops/hr/staff/[id]': 'ops:hr:read',
  '/ops/hr/tasks': 'ops:tasks:review',
  '/ops/leads': 'ops:leads:read',
  '/ops/leads/[id]': 'ops:leads:read',
  '/ops/leads/sales-calls': 'ops:leads:read',
  '/ops/leads/sharing': 'ops:leads:assign',
  '/ops/leads/stages': 'ops:leads:read',
  '/ops/marketing-summary': 'ops:dashboard:read',
  '/ops/meetings': 'ops:appointments:read',
  '/ops/meetings/[id]': 'ops:appointments:read',
  '/ops/my-attendance': 'ops:attendance:read',
  '/ops/my-payslips': 'ops:payslips:read',
  '/ops/my-reports': 'ops:tasks:read',
  '/ops/notifications': 'platform:notifications:read',
  '/ops/operations/approvals': 'ops:module:access',
  '/ops/reports': 'ops:module:access',
  '/ops/reports/admissions': 'ops:admissions:read',
  '/ops/search': 'ops:module:access',
  '/ops/settings': 'ops:settings:read',
  '/ops/staff': 'ops:organisation:read',
  '/ops/staff/[id]': 'ops:organisation:read',
  '/ops/students': 'ops:students:read',
  '/ops/students/[id]': 'ops:students:read',
  '/ops/students/[id]/report': 'ops:student_reports:generate',
  '/ops/students/absences': 'ops:student_private:read',
  '/ops/students/past': 'ops:students:read',
  '/ops/tasks': 'ops:tasks:read',
  '/ops/tasks/[id]': 'ops:tasks:read',
  '/ops/tasks/imports': 'ops:tasks:import',
  '/ops/tasks/inbox': 'ops:tasks:read',
  '/ops/tasks/reports': 'ops:tasks:read',
  '/ops/teachers': 'ops:teachers:read',
  '/ops/teachers/[id]': 'ops:teachers:read',
  '/ops/tests': 'ops:assessments:read',
  '/ops/tests/[id]': 'ops:assessments:read',
  '/ops/tests/[id]/edit': 'ops:assessments:manage',
  '/ops/tests/[id]/imports/[importId]': 'ops:assessments:read',
  '/ops/tests/new': 'ops:assessments:manage',
};

/** Beyond the gate, the page shows nothing without one of these (its own body check). */
export const PAGE_NEEDS: Record<string, readonly Permission[]> = {
  // An approval right (server/approval-cover.ts RIGHT) or fee recording, the coordinator's ruling.
  '/ops/approval-cover': [
    'ops:attendance:manage',
    'ops:hr_requests:manage',
    ...FEE_APPROVERS,
    'ops:fees:record',
  ],
  '/ops/hr/payroll': ['ops:payroll:manage', 'ops:payroll:approve'],
  '/ops/operations/approvals': FEE_APPROVERS,
  '/ops/reports': ['ops:admissions:read'],
};

const WITH_ID = Object.entries(PAGE_GATES)
  .filter(([route]) => route.includes('['))
  .map(([route, gate]) => [new RegExp(`^${route.replace(/\[\w+\]/g, '[^/]+')}$`), gate] as const);

/** `href` when it opens for this person, else undefined; a tile or row then shows its data unlinked. */
export function openHref(user: Principal, href: string): string | undefined {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  const gate = PAGE_GATES[path] ?? WITH_ID.find(([route]) => route.test(path))?.[1];
  const needs = PAGE_NEEDS[path];
  return (!gate || can(user, gate)) && (!needs || needs.some((p) => can(user, p)))
    ? href
    : undefined;
}

/** A link when it opens for this person, else `fallback` (by default the text itself, unlinked). */
export function OpenLink({
  user,
  href,
  fallback,
  children,
}: {
  user: Principal;
  href: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  if (openHref(user, href)) return <a href={href}>{children}</a>;
  return fallback === undefined ? children : fallback;
}
