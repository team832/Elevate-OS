import type { Metadata } from 'next';
import { MyReportsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My reports' };

/** Weekly and monthly work reports (brief 23 Oct 2026 §13, §16; D-073: Ops owns the body). */
export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:tasks:read" path={modulePath('my-reports')} active="my-reports">
      {(user) => <MyReportsBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
