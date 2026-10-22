import type { Metadata } from 'next';
import { TaskReportsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Task reports' };

export default async function TasksReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:tasks:read" path={modulePath('tasks/reports')} active="tasks">
      {(user) => <TaskReportsBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
