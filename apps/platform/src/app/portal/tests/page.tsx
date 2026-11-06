import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { fmtDay } from '@elevate/shared-types';
import { Card, DataTable, EmptyState, StatusBadge } from '@elevate/shared-ui';
import { portalPage } from '../../../server/portal';
import { portalResults } from '../../../server/portal-data';
import { NotInAcademic, PortalClosed, PortalFrame } from '../../../ui/portal-frame';

export const metadata: Metadata = { title: 'Tests and results' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;

export default async function PortalTests({ searchParams }: { searchParams: Params }) {
  const view = await portalPage('/portal/tests', (await searchParams).student);
  if (view.closed) return <PortalClosed />;
  const rows = await portalResults(getDb(), view.child.id);
  return (
    <PortalFrame
      view={view}
      path="/portal/tests"
      title="Tests and results"
      description={view.child.fullName}
    >
      {rows === null ? (
        <NotInAcademic />
      ) : (
        <Card title="Published results">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title="No published results yet"
                description="Results appear here once the institute publishes them."
              />
            }
            columns={[
              {
                key: 'test',
                header: 'Test',
                render: (r) => (
                  <>
                    {r.title}
                    {r.provisional ? (
                      <>
                        {' '}
                        <StatusBadge tone="warning">Provisional</StatusBadge>
                      </>
                    ) : null}
                  </>
                ),
              },
              { key: 'subject', header: 'Subject', render: (r) => r.subject ?? 'Several subjects' },
              { key: 'date', header: 'Date', render: (r) => fmtDay(r.date) },
              {
                key: 'score',
                header: 'Score',
                render: (r) =>
                  r.absent ? 'Absent' : r.score === null ? 'Not scored' : `${r.score} of ${r.max}`,
              },
              {
                key: 'rank',
                header: 'Rank',
                render: (r) => (r.rank ? `${r.rank.position} of ${r.rank.of} ranked` : 'Not shown'),
              },
            ]}
          />
          <details className="el-explain">
            <summary>About ranks</summary>A rank is shown only when the institute shows ranks for
            that test. It is the position among the students ranked; other students are never named.
          </details>
        </Card>
      )}
    </PortalFrame>
  );
}
