import { Frame, gate } from '../../../ui/frame';
import { LeadBody } from '../leads-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead' };

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ act?: string }>;
}) {
  const { id } = await params;
  const access = await gate('ops:leads:read', `/ops/leads/${id}`);
  return (
    <Frame access={access} active="leads">
      <LeadBody user={access.user} base="/ops" id={id} searchParams={await searchParams} />
    </Frame>
  );
}
