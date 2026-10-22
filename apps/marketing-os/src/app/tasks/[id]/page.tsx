import type { Metadata } from 'next';
import { TaskBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <MarketingPage permission="ops:tasks:read" path={modulePath(`tasks/${id}`)} active="tasks">
      {(user) => <TaskBody user={user} base={MODULE.basePath} id={id} />}
    </MarketingPage>
  );
}
