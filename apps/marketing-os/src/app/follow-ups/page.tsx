import type { Metadata } from 'next';
import { FollowUpsBody } from '@elevate/business-ops-os/leads';
import { Subnav } from '@elevate/shared-ui';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage, tabsFor } from '../../ui/shell';

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
      {(user) => (
        <FollowUpsBody
          user={user}
          base={MODULE.basePath}
          searchParams={sp}
          tabs={
            <Subnav
              label="Sales calls and follow-ups"
              items={tabsFor(user, 'follow-ups')}
              current={modulePath('follow-ups')}
            />
          }
        />
      )}
    </MarketingPage>
  );
}
