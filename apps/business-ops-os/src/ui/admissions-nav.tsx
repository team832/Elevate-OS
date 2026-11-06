import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Subnav } from '@elevate/shared-ui';
import { FEE_APPROVERS } from './open-link';

/** One permission, or a list of which any one is enough. */
export type AnyOf = Permission | readonly Permission[];
type Area = readonly [key: string, label: string, href: string, permission: AnyOf];

/** Area tabs along the bottom of the page header; a tab shows only with its permission. */
function areaNav<const A extends readonly Area[]>(label: string, areas: A) {
  return function AreaNav({ current, user }: { current: A[number][0]; user: AuthenticatedUser }) {
    return (
      <Subnav
        label={label}
        items={areas
          .filter(([, , , p]) => [p].flat().some((x) => can(user, x)))
          .map(([, text, href]) => [href, text])}
        current={areas.find(([key]) => key === current)?.[2]}
      />
    );
  };
}

/** Admissions areas (owner brief 21 Oct 2026 §4, 22 Oct 2026 §5); the dashboard is the first tab. */
const ADMISSIONS = [
  ['overview', 'Admissions overview', '/ops/admissions/overview', 'ops:admissions:read'],
  ['leads', 'Leads', '/ops/leads', 'ops:leads:read'],
  ['sharing', 'Lead sharing', '/ops/leads/sharing', 'ops:leads:assign'],
  ['follow-ups', 'Follow-ups', '/ops/follow-ups', 'ops:leads:read'],
  ['demos', 'Demos', '/ops/admissions', 'ops:leads:read'],
  ['applications', 'Applications', '/ops/admissions/applications', 'ops:admissions:read'],
  ['meetings', 'Counselling and events', '/ops/meetings', 'ops:appointments:read'],
  ['active', 'Active students', '/ops/students', 'ops:students:read'],
  ['past', 'Past students', '/ops/students/past', 'ops:students:read'],
  ['settings', 'Settings', '/ops/settings?group=admissions', 'ops:settings:read'],
] as const satisfies readonly Area[];

export type AdmissionsArea = (typeof ADMISSIONS)[number][0];
export const AdmissionsNav = areaNav('Admissions areas', ADMISSIONS);

export const FeesNav = areaNav('Fee areas', [
  ['structure', 'Fee structure', '/ops/fees', 'ops:fees:read'],
  ['collections', 'Collections', '/ops/fees/collections', 'ops:fees:read'],
  ['outstanding', 'Outstanding instalments', '/ops/fees/outstanding', 'ops:fees:read'],
  ['defaulters', 'Overdue fees', '/ops/fees/defaulters', 'ops:fees:read'],
  ['approvals', 'Fee approvals', '/ops/operations/approvals', FEE_APPROVERS],
] as const);

/** Teachers and the staff directory. */
export const PeopleNav = areaNav('People areas', [
  ['teachers', 'Teachers', '/ops/teachers', 'ops:teachers:read'],
  ['staff', 'All staff', '/ops/staff', 'ops:organisation:read'],
] as const);

/** HR "Task review": the submission queue, and every task; one rail entry (same permission). */
export const TaskReviewNav = areaNav('Task review areas', [
  ['review', 'Task review', '/ops/hr/review', 'ops:tasks:review'],
  ['tasks', 'Tasks', '/ops/hr/tasks', 'ops:tasks:review'],
] as const);
