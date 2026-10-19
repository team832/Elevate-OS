import { PageHeader } from '@elevate/shared-ui';
import { Frame, gate, Section } from '../../../ui/frame';
import type { SearchParams } from '../recruitment/_components/lifecycle-ui';
import { CaseList } from './_components/case-list';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await gate('ops:lifecycle:read', '/ops/hr/onboarding');
  const sp = await searchParams;
  return (
    <Frame access={access} active="onboarding">
      <PageHeader
        title="Onboarding"
        description="New employees from first day to approval: documents, policy acknowledgements, manager confirmation, assets, system-access requests and induction."
      />
      <Section>
        <CaseList user={access.user} kind="onboarding" sp={sp} />
      </Section>
    </Frame>
  );
}
