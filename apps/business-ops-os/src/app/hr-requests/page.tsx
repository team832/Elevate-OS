import { Frame, gate } from '../../ui/frame';
import { HrRequestsBody } from './hr-requests-body';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Requests through HR' };

export default async function HrRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:hr_requests:create', '/ops/hr-requests');
  return (
    <Frame access={access} active="hr-requests">
      <HrRequestsBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
