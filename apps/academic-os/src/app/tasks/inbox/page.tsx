import { InboxBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../../domain';
import { MODULE_PATHS } from '../../../server/paths';
import { AcademicShell, gate } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report inbox' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await gate('ops:tasks:read', `${MODULE_PATHS.tasks}/inbox`);
  return (
    <AcademicShell access={access} active="tasks">
      {access.status === 'allowed' ? <InboxBody user={access.user} base={MODULE.basePath} searchParams={await searchParams} /> : null}
    </AcademicShell>
  );
}
