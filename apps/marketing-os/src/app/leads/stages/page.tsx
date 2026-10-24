import type { Metadata } from 'next';
import { LeadStagesBody } from '@elevate/business-ops-os/leads';
import { Subnav } from '@elevate/shared-ui';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage, tabsFor } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lead stages' };

export default async function LeadStagesPage() {
  return (
    <MarketingPage permission="ops:leads:read" path={modulePath('leads/stages')} active="leads">
      {(user) => (
        <LeadStagesBody
          user={user}
          base={MODULE.basePath}
          tabs={
            <Subnav
              label="Leads"
              items={tabsFor(user, 'leads')}
              current={modulePath('leads/stages')}
            />
          }
        />
      )}
    </MarketingPage>
  );
}
