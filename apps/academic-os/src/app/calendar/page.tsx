import type { Metadata } from 'next';
import { PageHeader } from '@elevate/shared-ui';
import { modulePath } from '../../domain';
import { AcademicShell, gate } from '../../ui/shell';
import { CalendarBody } from './calendar-body';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate('academic:module:access', modulePath('calendar'));
  const sp = await searchParams;
  return (
    <AcademicShell access={access} active="calendar" loading="Loading calendar…">
      {access.status === 'allowed' ? (
        <>
          <PageHeader
            title="Calendar"
            description="Classes, tests, closures and leave you may see, with your own tasks due and meetings, by day in IST."
          />
          <CalendarBody user={access.user} sp={sp} />
        </>
      ) : null}
    </AcademicShell>
  );
}
