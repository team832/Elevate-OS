import { Frame, gate, Section } from '../../../../ui/frame';
import { CaseDetail } from '../_components/case-detail';

export const dynamic = 'force-dynamic';

export default async function OnboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:lifecycle:read', `/ops/hr/onboarding/${id}`);
  return (
    <Frame access={access} active="onboarding">
      <p>
        <a href="/ops/hr/onboarding">Back to onboarding</a>
      </p>
      <Section>
        <CaseDetail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}
