/**
 * Does a link open for this person? The one question lists, tiles and records ask before showing
 * one, so nobody is sent to "No access". This only decides what to show: each page's gate() stays
 * the security check. PAGE_GATES repeats those gates; tests/unit/screens.test.tsx reads every
 * page.tsx and fails if they differ.
 */
import type { ReactNode } from 'react';
import { can, type Permission, type Principal } from '@elevate/authorization';

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
  '/ops/fees': 'ops:fees:read',
  '/ops/fees/collections': 'ops:fees:read',
  '/ops/fees/outstanding': 'ops:fees:read',
  '/ops/hr': 'ops:hr:read',
  '/ops/hr-requests': 'ops:hr_requests:create',
  '/ops/hr/assignments': 'ops:teaching_assignments:read',
  '/ops/hr/attendance': 'ops:attendance:read',
  '/ops/hr/attendance/[staffId]': 'ops:attendance:read',
  '/ops/hr/feedback': 'ops:teacher_feedback:read',
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
  '/ops/leads/stages': 'ops:leads:read',
  '/ops/marketing-summary': 'ops:dashboard:read',
  '/ops/meetings': 'ops:appointments:read',
  '/ops/meetings/[id]': 'ops:appointments:read',
  '/ops/my-attendance': 'ops:attendance:read',
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

const WITH_ID = Object.entries(PAGE_GATES)
  .filter(([route]) => route.includes('['))
  .map(([route, gate]) => [new RegExp(`^${route.replace(/\[\w+\]/g, '[^/]+')}$`), gate] as const);

/** `href` when it opens for this person, else undefined; a tile or row then shows its data unlinked. */
export function openHref(user: Principal, href: string): string | undefined {
  const path = href.split(/[?#]/, 1)[0] ?? '';
  const gate = PAGE_GATES[path] ?? WITH_ID.find(([route]) => route.test(path))?.[1];
  return !gate || can(user, gate) ? href : undefined;
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
