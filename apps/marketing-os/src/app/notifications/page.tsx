import type { Metadata } from 'next';
import { NotificationsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Notifications' };

/** Shared notifications inbox (brief §9, D-073); reached from the bell in the top bar. */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage
      permission="platform:notifications:read"
      path={modulePath('notifications')}
      active="notifications"
    >
      {(user) => <NotificationsBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
