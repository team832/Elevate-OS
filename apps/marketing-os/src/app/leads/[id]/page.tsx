import type { Metadata } from 'next';
import { LeadBody } from '@elevate/business-ops-os/leads';
import { MODULE, modulePath } from '../../../domain';
import { MarketingPage } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lead' };

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <MarketingPage permission="ops:leads:read" path={modulePath(`leads/${id}`)} active="leads">
      {(user) => <LeadBody user={user} base={MODULE.basePath} id={id} searchParams={sp} />}
    </MarketingPage>
  );
}
