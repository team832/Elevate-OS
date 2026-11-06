import type { Metadata } from 'next';
import { MyPayslipsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { MarketingPage } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My payslips' };

/** Your own payslips, kept by HR (F4-14, D-073). */
export default async function MyPayslipsPage() {
  return (
    <MarketingPage
      permission="ops:payslips:read"
      path={modulePath('my-payslips')}
      active="my-payslips"
    >
      {(user) => <MyPayslipsBody user={user} base={MODULE.basePath} />}
    </MarketingPage>
  );
}
