import { AdmissionsNav } from '../../../ui/admissions-nav';
import { Frame, gate } from '../../../ui/frame';
import { LeadSharingBody } from '../lead-sharing-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead sharing' };

export default async function LeadSharingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:leads:assign', '/ops/leads/sharing');
  return (
    <Frame access={access} active="leads">
      <LeadSharingBody
        user={access.user}
        base="/ops"
        sp={await searchParams}
        tabs={<AdmissionsNav current="sharing" user={access.user} />}
      />
    </Frame>
  );
}
