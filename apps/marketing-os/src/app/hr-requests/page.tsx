import type { Metadata } from 'next';
import { HrRequestsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Requests through HR' };

/** Requests sent through HR and what HR forwarded to you (brief §6, §9, D-073); Ops' one implementation. */
export default async function HrRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage
      permission="ops:hr_requests:create"
      path={modulePath('hr-requests')}
      active="hr-requests"
    >
      {(user) => <HrRequestsBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
