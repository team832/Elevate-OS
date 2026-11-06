import { MyPayslipsBody } from '@elevate/business-ops-os/work';
import { MODULE, modulePath } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My payslips' };

/** Your own payslips, kept by HR (F4-14, D-073). */
export default async function MyPayslipsPage() {
  const access = await gate('ops:payslips:read', modulePath('my-payslips'));
  return (
    <AcademicShell access={access} active="my-payslips">
      {access.status === 'allowed' ? (
        <MyPayslipsBody user={access.user} base={MODULE.basePath} />
      ) : null}
    </AcademicShell>
  );
}
