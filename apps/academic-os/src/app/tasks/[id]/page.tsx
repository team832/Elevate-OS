import { TaskBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../../domain';
import { MODULE_PATHS } from '../../../server/paths';
import { AcademicShell, gate } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:tasks:read', `${MODULE_PATHS.tasks}/${id}`);
  return (
    <AcademicShell access={access} active="tasks">
      {access.status === 'allowed' ? <TaskBody user={access.user} base={MODULE.basePath} id={id} /> : null}
    </AcademicShell>
  );
}
