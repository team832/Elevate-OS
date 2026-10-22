import type { Metadata } from 'next';
import { InboxBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Report inbox' };

export default async function TasksInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:tasks:read" path={modulePath('tasks/inbox')} active="tasks">
      {(user) => <InboxBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
