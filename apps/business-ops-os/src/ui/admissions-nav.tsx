import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Subnav } from '@elevate/shared-ui';

type Area = readonly [key: string, label: string, href: string, permission: Permission];

/** Area tabs along the bottom of the page header; a tab shows only with its permission. */
function areaNav<const A extends readonly Area[]>(label: string, areas: A) {
  return function AreaNav({ current, user }: { current: A[number][0]; user: AuthenticatedUser }) {
    return (
      <Subnav
        label={label}
        items={areas.filter(([, , , p]) => can(user, p)).map(([, text, href]) => [href, text])}
        current={areas.find(([key]) => key === current)?.[2]}
      />
    );
  };
}

/** Admissions areas (owner brief 21 Oct 2026 §4, 22 Oct 2026 §5). */
const ADMISSIONS = [
  ['overview', 'Overview', '/ops/admissions/overview', 'ops:admissions:read'],
  ['demos', 'Demo students', '/ops/admissions', 'ops:leads:read'],
  ['applications', 'Applications', '/ops/admissions/applications', 'ops:admissions:read'],
  ['leads', 'Leads', '/ops/leads', 'ops:leads:read'],
  ['active', 'Active students', '/ops/students', 'ops:students:read'],
  ['past', 'Past students', '/ops/students/past', 'ops:students:read'],
  ['meetings', 'Events and counselling', '/ops/meetings', 'ops:appointments:read'],
  ['settings', 'Settings', '/ops/settings?group=admissions', 'ops:settings:read'],
] as const satisfies readonly Area[];

export type AdmissionsArea = (typeof ADMISSIONS)[number][0];
export const AdmissionsNav = areaNav('Admissions areas', ADMISSIONS);

/** Fees and Collections; Approvals (fee changes waiting for you) lives here too. */
export const FeesNav = areaNav('Fee areas', [
  ['structure', 'Fee structure', '/ops/fees', 'ops:fees:read'],
  ['collections', 'Collections', '/ops/fees/collections', 'ops:fees:read'],
  ['outstanding', 'Outstanding', '/ops/fees/outstanding', 'ops:fees:read'],
  ['approvals', 'Approvals', '/ops/operations/approvals', 'ops:module:access'],
] as const);

/** Teachers and the staff directory. */
export const PeopleNav = areaNav('People areas', [
  ['teachers', 'Teachers', '/ops/teachers', 'ops:teachers:read'],
  ['staff', 'Staff directory', '/ops/staff', 'ops:organisation:read'],
] as const);
