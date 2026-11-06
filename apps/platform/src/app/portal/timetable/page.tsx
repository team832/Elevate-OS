import type { Metadata } from 'next';
import { fmtClock } from '@elevate/academic-os/domain';
import { getDb } from '@elevate/database';
import { fmtDay, toIsoDate } from '@elevate/shared-types';
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { portalPage } from '../../../server/portal';
import { portalTimetable } from '../../../server/portal-data';
import { NotInAcademic, PortalClosed, PortalFrame } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Timetable' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;
const STATUS = {
  scheduled: 'Planned',
  held: 'Held',
  cancelled: 'Cancelled',
  rescheduled: 'Moved',
} as const;

export default async function PortalTimetable({ searchParams }: { searchParams: Params }) {
  const view = await portalPage('/portal/timetable', (await searchParams).student);
  if (view.closed) return <PortalClosed />;
  const rows = await portalTimetable(getDb(), view.child.id, toIsoDate(new Date()));
  return (
    <PortalFrame
      view={view}
      path="/portal/timetable"
      title="Timetable"
      description={view.child.fullName}
    >
      {rows === null ? (
        <NotInAcademic />
      ) : (
        <Card
          title="The next 14 days"
          description="Times are India time (IST). Changes can still happen."
        >
          <DataTable
            rows={rows}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No classes in the next 14 days" />}
            columns={[
              { key: 'day', header: 'Day', render: (s) => fmtDay(s.date) },
              {
                key: 'time',
                header: 'Time',
                render: (s) => `${fmtClock(s.startTime)} (${s.minutes} min)`,
              },
              { key: 'subject', header: 'Subject', render: (s) => s.subject ?? 'Not recorded' },
              { key: 'teacher', header: 'Teacher', render: (s) => s.teacher ?? 'Not set' },
              { key: 'room', header: 'Room', render: (s) => s.room ?? 'Not set' },
              { key: 'status', header: 'Status', render: (s) => STATUS[s.status] },
            ]}
          />
        </Card>
      )}
    </PortalFrame>
  );
}
