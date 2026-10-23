import { MyReportsBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { MODULE_PATHS } from '../../server/paths';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My reports' };

/** Weekly and monthly work reports (brief 23 Oct 2026 §7, §13; D-073: Ops owns the body). */
export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:tasks:read', MODULE_PATHS.myReports);
  return (
    <AcademicShell access={access} active="my-reports">
      {access.status === 'allowed' ? (
        <MyReportsBody
          user={access.user}
          base={MODULE.basePath}
          searchParams={await searchParams}
        />
      ) : null}
    </AcademicShell>
  );
}
