import { PageHeader } from '@elevate/shared-ui';
import { Frame, gate, Section } from '../../../ui/frame';
import type { SearchParams } from '../recruitment/_components/lifecycle-ui';
import { CaseList } from '../onboarding/_components/case-list';

export const dynamic = 'force-dynamic';

export default async function OffboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await gate('ops:lifecycle:read', '/ops/hr/offboarding');
  const sp = await searchParams;
  return (
    <Frame access={access} active="offboarding">
      <PageHeader
        title="Offboarding"
        description="Separations: asset returns, hand-over of open work, login revocation and the final settlement reference. Attendance, approvals and records are kept after an employee leaves."
      />
      <Section>
        <CaseList user={access.user} kind="offboarding" sp={sp} />
      </Section>
    </Frame>
  );
}
