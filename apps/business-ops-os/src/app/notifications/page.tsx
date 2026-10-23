import { Frame, gate } from '../../ui/frame';
import type { Params } from '../tasks/_components/task-views';
import { NotificationsBody } from './notifications-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const access = await gate('platform:notifications:read', '/ops/notifications');
  return (
    <Frame access={access} active="notifications">
      <NotificationsBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
