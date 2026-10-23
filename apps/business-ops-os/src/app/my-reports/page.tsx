import { MyReportsBody } from '../tasks/reports/my-reports-body';
import { Frame, gate } from '../../ui/frame';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My reports' };

/** `/ops/my-reports`: weekly and monthly work reports of Ops staff (brief 23 Oct 2026 §13). */
export default async function MyReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:tasks:read', '/ops/my-reports');
  return (
    <Frame access={access} active="my-reports">
      <MyReportsBody user={access.user} base="/ops" searchParams={await searchParams} />
    </Frame>
  );
}
