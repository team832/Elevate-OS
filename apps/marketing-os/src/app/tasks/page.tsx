import type { Metadata } from 'next';
import { TasksBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tasks' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage
      permission="ops:tasks:read"
      path={modulePath('tasks')}
      active={sp.tab === 'eod' ? 'eod' : sp.status === 'in_review' ? 'team-review' : 'tasks'}
    >
      {(user) => <TasksBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
