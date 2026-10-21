import { can, type Permission } from '@elevate/authorization';
import type { AuthenticatedUser } from '@elevate/authentication';
import { Subnav } from '@elevate/shared-ui';

/** Admissions areas (owner brief 21 Oct 2026 §4); a tab shows only with its permission. */
const AREAS = [
  ['overview', 'Overview', '/ops/admissions/overview', 'ops:admissions:read'],
  ['demos', 'Demo students', '/ops/admissions', 'ops:leads:read'],
  ['applications', 'Applications', '/ops/admissions/applications', 'ops:admissions:read'],
  ['active', 'Active students', '/ops/students', 'ops:students:read'],
  ['past', 'Past students', '/ops/students/past', 'ops:students:read'],
  ['meetings', 'Events and counselling', '/ops/meetings', 'ops:appointments:read'],
  ['settings', 'Settings', '/ops/settings?group=admissions', 'ops:settings:read'],
] as const satisfies readonly (readonly [string, string, string, Permission])[];

export type AdmissionsArea = (typeof AREAS)[number][0];

export function AdmissionsNav({
  current,
  user,
}: {
  current: AdmissionsArea;
  user: AuthenticatedUser;
}) {
  return (
    <Subnav
      label="Admissions areas"
      items={AREAS.filter(([, , , p]) => can(user, p)).map(([, label, href]) => [href, label])}
      current={AREAS.find(([key]) => key === current)?.[2]}
    />
  );
}
