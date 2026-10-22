import { MeetingsBody } from '@elevate/business-ops-os/work';
import { MODULE } from '../../domain';
import { MODULE_PATHS } from '../../server/paths';
import { AcademicShell, gate } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My meetings' };

/** The caller's own meetings and events, read-only (shared Ops entry, D-073). */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await gate('ops:appointments:read', MODULE_PATHS.meetings);
  const sp = await searchParams;
  return (
    <AcademicShell access={access} active="meetings">
      {access.status === 'allowed' ? <MeetingsBody user={access.user} base={MODULE.basePath} searchParams={sp} /> : null}
    </AcademicShell>
  );
}
