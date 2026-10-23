import { NotificationsBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

/** Shared notifications inbox (brief §9, D-073); reached from the bell in the top bar. */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('platform:notifications:read', `${MODULE.basePath}/notifications`);
  return (
    // No sidebar item: the bell in the top bar is the entry.
    <AcademicShell access={access} active="notifications">
      {access.status === 'allowed' ? (
        <NotificationsBody
          user={access.user}
          base={MODULE.basePath}
          searchParams={await searchParams}
        />
      ) : null}
    </AcademicShell>
  );
}
