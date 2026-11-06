import type { Metadata } from 'next';
import { homeworkForStudent } from '@elevate/academic-os/server';
import { getDb } from '@elevate/database';
import { addDays, fmtDay, toIsoDate } from '@elevate/shared-types';
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { portalPage } from '../../../server/portal';
import { PortalClosed, PortalFrame } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Homework' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;
const STATUS: Record<string, string> = {
  submitted: 'Handed in',
  late: 'Handed in late',
  not_submitted: 'Not handed in',
  excused: 'Excused',
};

export default async function PortalHomework({ searchParams }: { searchParams: Params }) {
  const view = await portalPage('/portal/homework', (await searchParams).student);
  if (view.closed) return <PortalClosed />;
  const today = toIsoDate(new Date());
  const rows = await homeworkForStudent(getDb(), view.child.id, {
    from: addDays(today, -60),
    to: addDays(today, 30),
  });
  return (
    <PortalFrame
      view={view}
      path="/portal/homework"
      title="Homework"
      description={view.child.fullName}
    >
      <Card title="Due in the last 60 days and the next 30">
        <DataTable
          rows={rows}
          rowKey={(h) => h.id}
          empty={<EmptyState title="No homework in these dates" />}
          columns={[
            { key: 'title', header: 'Homework', render: (h) => h.title },
            { key: 'subject', header: 'Subject', render: (h) => h.subjectName ?? 'Not recorded' },
            { key: 'set', header: 'Set on', render: (h) => fmtDay(h.setOn) },
            { key: 'due', header: 'Due', render: (h) => fmtDay(h.dueOn) },
            {
              key: 'status',
              header: 'Status',
              render: (h) => (h.status ? STATUS[h.status] : 'Not marked yet'),
            },
          ]}
        />
      </Card>
    </PortalFrame>
  );
}
