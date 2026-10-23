import type { Metadata } from 'next';
import { MyAttendanceBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My attendance' };

/** Your own staff attendance, kept by HR (brief §12, §16, D-073). */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MarketingPage
      permission="ops:attendance:read"
      path={modulePath('my-attendance')}
      active="my-attendance"
    >
      {(user) => <MyAttendanceBody user={user} base={MODULE.basePath} searchParams={sp} />}
    </MarketingPage>
  );
}
