import type { Metadata } from 'next';
import { FollowUpsBody } from '@elevate/business-ops-os/leads';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Follow-ups' };

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:leads:read" path={modulePath('follow-ups')} active="follow-ups">
      {(user) => <FollowUpsBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
