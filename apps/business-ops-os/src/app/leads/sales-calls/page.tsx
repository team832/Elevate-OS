import { AdmissionsNav } from '../../../ui/admissions-nav';
import { Frame, gate } from '../../../ui/frame';
import { SalesCallsBody } from '../sales-calls-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sales calls' };

export default async function SalesCallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:read', '/ops/leads/sales-calls');
  return (
    <Frame access={access} active="leads">
      <SalesCallsBody
        user={access.user}
        base="/ops"
        searchParams={await searchParams}
        tabs={<AdmissionsNav current="leads" user={access.user} />}
      />
    </Frame>
  );
}
