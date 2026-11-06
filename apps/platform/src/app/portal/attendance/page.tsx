import type { Metadata } from 'next';
import { fmtClock } from '@elevate/academic-os/domain';
import { getDb } from '@elevate/database';
import { fmtDay } from '@elevate/shared-types';
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { portalPage } from '../../../server/portal';
import { portalAttendance } from '../../../server/portal-data';
import { NotInAcademic, PortalClosed, PortalFrame } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;

export default async function PortalAttendance({ searchParams }: { searchParams: Params }) {
  const view = await portalPage('/portal/attendance', (await searchParams).student);
  if (view.closed) return <PortalClosed />;
  const a = await portalAttendance(getDb(), view.child.id);
  return (
    <PortalFrame
      view={view}
      path="/portal/attendance"
      title="Attendance"
      description={view.child.fullName}
    >
      {a === null ? (
        <NotInAcademic />
      ) : (
        <>
          <Card title="By batch">
            <DataTable
              rows={a.batches}
              rowKey={(b) => b.id}
              empty={
                <EmptyState
                  title="No batch yet"
                  description="The student has not been placed in a batch."
                />
              }
              columns={[
                { key: 'batch', header: 'Batch', render: (b) => b.name },
                {
                  key: 'rate',
                  header: 'Attendance',
                  render: (b) =>
                    b.ratePercent === null ? 'Not enough recorded' : `${b.ratePercent}%`,
                },
                {
                  key: 'held',
                  header: 'Classes held',
                  numeric: true,
                  render: (b) => b.heldSessions,
                },
                {
                  key: 'present',
                  header: 'Present',
                  numeric: true,
                  render: (b) => b.present + b.partial,
                },
                { key: 'late', header: 'Late', numeric: true, render: (b) => b.late },
                { key: 'absent', header: 'Absent', numeric: true, render: (b) => b.absent },
                { key: 'excused', header: 'Excused', numeric: true, render: (b) => b.excused },
                {
                  key: 'none',
                  header: 'Not recorded',
                  numeric: true,
                  render: (b) => b.notRecorded,
                },
              ]}
            />
            <details className="el-explain">
              <summary>How attendance is counted</summary>
              {a.definition} Classes with no mark are “not recorded”, never counted as absent.
            </details>
          </Card>
          <Card title="Recent absences" description="The last 10 classes marked absent.">
            <DataTable
              rows={a.recentAbsences}
              rowKey={(s) => s.id}
              empty={<EmptyState title="No absences recorded" />}
              columns={[
                { key: 'day', header: 'Day', render: (s) => fmtDay(s.date) },
                { key: 'time', header: 'Time', render: (s) => fmtClock(s.startTime) },
                { key: 'subject', header: 'Subject', render: (s) => s.subject ?? 'Not recorded' },
                { key: 'batch', header: 'Batch', render: (s) => s.batch },
              ]}
            />
          </Card>
        </>
      )}
    </PortalFrame>
  );
}
