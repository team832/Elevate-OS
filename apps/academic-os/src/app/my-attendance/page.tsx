import { MyAttendanceBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My attendance' };

/** Your own staff attendance, kept by HR (brief §12, D-073); separate from student attendance and classes taught. */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await gate('ops:attendance:read', `${MODULE.basePath}/my-attendance`);
  return (
    <AcademicShell access={access} active="my-attendance">
      {access.status === 'allowed' ? (
        <MyAttendanceBody
          user={access.user}
          base={MODULE.basePath}
          searchParams={await searchParams}
        />
      ) : null}
    </AcademicShell>
  );
}
