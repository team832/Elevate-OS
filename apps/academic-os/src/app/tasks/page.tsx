import { TasksBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { MODULE_PATHS } from '../../server/paths';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My tasks' };

/** Shared task tracker (D-073); `?tab=eod` is the EOD report. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await gate('ops:tasks:read', MODULE_PATHS.tasks);
  const sp = await searchParams;
  return (
    <AcademicShell access={access} active={sp.tab === 'eod' ? 'eod' : 'tasks'}>
      {access.status === 'allowed' ? <TasksBody user={access.user} base={MODULE.basePath} searchParams={sp} /> : null}
    </AcademicShell>
  );
}
