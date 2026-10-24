import { HrRequestsBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Requests through HR' };

/** Requests sent through HR and what HR forwarded to you (brief §6, D-073); Ops' one implementation. */
export default async function HrRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:hr_requests:create', `${MODULE.basePath}/hr-requests`);
  return (
    <AcademicShell access={access} active="hr-requests">
      {access.status === 'allowed' ? (
        <HrRequestsBody
          user={access.user}
          base={MODULE.basePath}
          searchParams={await searchParams}
        />
      ) : null}
    </AcademicShell>
  );
}
