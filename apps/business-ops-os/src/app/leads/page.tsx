import { AdmissionsNav } from '../../ui/admissions-nav';
import { Frame, gate } from '../../ui/frame';
import { LeadsBody } from './leads-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:read', '/ops/leads');
  return (
    <Frame access={access} active="leads">
      <LeadsBody
        user={access.user}
        base="/ops"
        searchParams={await searchParams}
        tabs={<AdmissionsNav current="leads" user={access.user} />}
      />
    </Frame>
  );
}
