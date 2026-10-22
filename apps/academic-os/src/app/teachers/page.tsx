import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import type { PageAccess } from '@elevate/server-kit/next';
import { listTeachers, todayIst, unavailableOn } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Teachers' };

export default async function TeachersPage() {
  const access = await gate('academic:assignments:read', MODULE_PATHS.teachers);
  return (
    <AcademicShell access={access} active="teachers" loading="Loading teachers…">
      {access.status === 'allowed' ? <Body access={access} /> : null}
    </AcademicShell>
  );
}

async function Body({ access }: { access: PageAccess }) {
  const db = getDb();
  const today = todayIst();
  const data = await load(async () => {
    const teachers = await listTeachers(db, actorFor(access.user));
    return { teachers, away: await unavailableOn(db, teachers.map((t) => t.staffId), today) };
  });
  return (
    <>
      <PageHeader title="Teachers" description="Staff with a teaching assignment. Names come from the staff record; subjects and batches from current assignments. No ratings or rankings." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <Card>
          <DataTable
            compact
            rows={data.data.teachers}
            rowKey={(t) => t.staffId}
            empty={<EmptyState title="No teachers yet" description="Assign a staff member to a batch and subject from the batch page; they appear here." />}
            columns={[
              { key: 'name', header: 'Teacher', render: (t) => <><a href={MODULE_PATHS.teacher(t.staffId)}><strong>{t.name}</strong></a> {data.data.away.has(t.staffId) ? <StatusBadge tone="warning">Unavailable today (academic record)</StatusBadge> : null}</> },
              { key: 'subjects', header: 'Subjects', render: (t) => t.subjects.join(', ') || 'No current assignment' },
              { key: 'batches', header: 'Batches', render: (t) => t.batches.join(', ') || '—' },
              { key: 'today', header: `Classes today (${today})`, numeric: true, render: (t) => t.todayClasses },
              { key: 'logs', header: 'Logs not submitted', numeric: true, render: (t) => <span title={`Delivered classes ${t.pendingLogsRange.from} to ${t.pendingLogsRange.to}`}>{t.pendingLogs}</span> },
            ]}
          />
          <details className="el-explain">
            <summary>How this list is defined</summary>
            <p>Logs not submitted counts classes this teacher delivered in the last 14 days without a submitted class record. HR attendance and leave are not shown: there is no HR source yet (HR attendance unavailable).</p>
          </details>
        </Card>
      )}
    </>
  );
}
