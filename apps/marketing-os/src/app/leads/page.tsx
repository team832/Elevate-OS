import type { Metadata } from 'next';
import { LeadsBody } from '@elevate/business-ops-os/leads';
import { Subnav } from '@elevate/shared-ui';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage, tabsFor } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:leads:read" path={modulePath('leads')} active="leads">
      {(user) => (
        <LeadsBody
          user={user}
          base={MODULE.basePath}
          searchParams={sp}
          tabs={
            <Subnav label="Leads" items={tabsFor(user, 'leads')} current={modulePath('leads')} />
          }
        />
      )}
    </MarketingPage>
  );
}
