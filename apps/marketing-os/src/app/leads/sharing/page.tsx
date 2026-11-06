import type { Metadata } from 'next';
import { LeadSharingBody } from '@elevate/business-ops-os/leads';
import { Subnav } from '@elevate/shared-ui';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage, tabsFor } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lead sharing' };

export default async function LeadSharingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:leads:assign" path={modulePath('leads/sharing')} active="leads">
      {(user) => (
        <LeadSharingBody
          user={user}
          base={MODULE.basePath}
          sp={sp}
          tabs={
            <Subnav
              label="Leads"
              items={tabsFor(user, 'leads')}
              current={modulePath('leads/sharing')}
            />
          }
        />
      )}
    </MarketingPage>
  );
}
