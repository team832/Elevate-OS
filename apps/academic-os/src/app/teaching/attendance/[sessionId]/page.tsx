import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Alert, Card, EmptyState, PageHeader } from '@elevate/shared-ui';
import { getSessionAttendance } from '../../../../server';
import { MODULE_PATHS } from '../../../../server/paths';
import { AttendanceForm } from '../../../../ui/attendance-form';
import { StateBadge } from '../../../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function AttendancePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const access = await gate('academic:attendance:read', MODULE_PATHS.attendance(sessionId));
  if (access.status !== 'allowed') return <AcademicShell access={access} active="teaching">{null}</AcademicShell>;
  const data = await load(() => getSessionAttendance(getDb(), actorFor(access.user), sessionId));
  if (!data.ok) return <AcademicShell access={access} active="teaching"><LoadError error={data.error} /></AcademicShell>;
  const { session, roster, recorded, notRecorded } = data.data;
  const canRecord = can(access.user, 'academic:attendance:record') && (session.status === 'scheduled' || session.status === 'held');
  return (
    <AcademicShell access={access} active="teaching">
      <PageHeader
        title={`Attendance — ${session.date} ${session.startTime}`}
        description={<>{session.durationMinutes} min · <StateBadge state={session.status} /> · {recorded} recorded, {notRecorded} not recorded</>}
        actions={<a href={MODULE_PATHS.teaching}>Teaching log</a>}
      />
      <div className="el-stack">
        <Alert tone="info">Students without a mark stay “not recorded”: they are excluded from attendance rates, never counted as absent. Changes are audited.</Alert>
        <Card title="Roster" description="Active enrolments in the batch that had started by the session date.">
          {roster.length === 0 ? (
            <EmptyState title="No students enrolled" description="Nobody was enrolled in this batch on the session date." />
          ) : (
            <AttendanceForm
              action={MODULE_PATHS.api(`sessions/${session.id}/attendance`)}
              canRecord={canRecord}
              roster={roster.map((r) => ({ studentId: r.studentId, code: r.code, fullName: r.fullName, status: r.mark?.status ?? null, minutesPresent: r.mark?.minutesPresent ?? null }))}
            />
          )}
        </Card>
      </div>
    </AcademicShell>
  );
}
