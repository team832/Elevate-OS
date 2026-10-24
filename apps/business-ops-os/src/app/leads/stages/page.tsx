import { AdmissionsNav } from '../../../ui/admissions-nav';
import { Frame, gate } from '../../../ui/frame';
import { LeadStagesBody } from '../lead-stages-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead stages' };

export default async function LeadStagesPage() {
  const access = await gate('ops:leads:read', '/ops/leads/stages');
  return (
    <Frame access={access} active="leads">
      <LeadStagesBody
        user={access.user}
        base="/ops"
        tabs={<AdmissionsNav current="leads" user={access.user} />}
      />
    </Frame>
  );
}
