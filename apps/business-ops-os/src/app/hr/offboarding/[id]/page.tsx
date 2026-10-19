import { Frame, gate, Section } from '../../../../ui/frame';
import { CaseDetail } from '../../onboarding/_components/case-detail';

export const dynamic = 'force-dynamic';

export default async function OffboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await gate('ops:lifecycle:read', `/ops/hr/offboarding/${id}`);
  return (
    <Frame access={access} active="offboarding">
      <p>
        <a href="/ops/hr/offboarding">Back to offboarding</a>
      </p>
      <Section>
        <CaseDetail user={access.user} id={id} />
      </Section>
    </Frame>
  );
}
