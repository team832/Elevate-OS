/**
 * Shell extras for platform pages: platform nav, top-bar search target and the
 * unread-notification count. Every link is shown only to users whose
 * permissions open the target (the target checks again on the server).
 */
import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { countUnread } from '@elevate/notifications';
import type { AppShellProps } from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../lib/shell';

type Extras = Pick<AppShellProps, 'nav' | 'search' | 'settings' | 'unreadNotifications'>;

/** Top-bar search: the first searchable list the user may open. */
export function searchFor(user: AuthenticatedUser): AppShellProps['search'] {
  if (can(user, 'ops:leads:read')) return { action: '/ops/leads', label: 'Search leads' };
  if (can(user, 'academic:students:read'))
    return { action: '/academic/students', label: 'Search students' };
  if (can(user, 'marketing:ideas:read'))
    return { action: '/marketing/ideas', label: 'Search ideas' };
  return undefined;
}

export async function platformShell(
  user: AuthenticatedUser,
  active: 'overview' | 'dashboard' | 'users',
): Promise<Extras> {
  const canUsers = can(user, 'platform:users:read');
  let unread: number | null = null;
  if (can(user, 'platform:notifications:read')) {
    try {
      unread = await countUnread(getDb(), user.id);
    } catch {
      unread = null;
    }
  }
  return {
    nav: [
      ...(can(user, 'platform:dashboard:read')
        ? [
            {
              href: PLATFORM_PATHS.dashboard,
              label: 'Leadership dashboard',
              active: active === 'dashboard',
            },
          ]
        : []),
      ...(canUsers
        ? [{ href: PLATFORM_PATHS.users, label: 'Users & roles', active: active === 'users' }]
        : []),
    ],
    search: searchFor(user),
    settings: canUsers ? { href: PLATFORM_PATHS.users } : undefined,
    unreadNotifications: unread,
  };
}
