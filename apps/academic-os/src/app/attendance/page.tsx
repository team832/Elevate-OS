import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge, Subnav } from '@elevate/shared-ui';
import { attendanceWorklist } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { StateBadge } from '../../ui/badges';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Student attendance' };

const PATH = MODULE_PATHS.studentAttendance;
const TABS = [
  [PATH, 'Needs marking'],
  [`${PATH}?view=all`, 'All classes'],
] as const;

/** Student class attendance worklist. Staff (HR) attendance, class delivery and the teaching log are separate records. */
export default async function StudentAttendancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const access = await gate('academic:attendance:read', PATH);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="attendance">{null}</AcademicShell>;
  const all = (await searchParams).view === 'all';
  const data = await load(() => attendanceWorklist(getDb(), actorFor(access.user)));
  if (!data.ok) return <AcademicShell access={access} active="attendance"><LoadError error={data.error} /></AcademicShell>;
  const { window, rows } = data.data;
  const shown = all ? rows : rows.filter((s) => s.ended && s.unmarked > 0);
  return (
    <AcademicShell access={access} active="attendance">
      <PageHeader
        title="Student attendance"
        description={`Classes from ${window.from} to ${window.to} (IST), newest first. This records whether students attended a class; it is not your staff attendance, and it does not mark the class delivered or write the teaching log.`}
        tabs={<Subnav label="Attendance lists" items={TABS} current={all ? TABS[1][0] : PATH} />}
      />
      <Card>
        <DataTable
          compact
          rows={shown}
          rowKey={(s) => s.id}
          empty={
            all
              ? <EmptyState title="No classes in these two weeks" description="Classes appear here once they are on the timetable." />
              : <EmptyState title="Every ended class is marked" description="Each placed student has a mark for every class that has ended. Later classes appear here after they end." />
          }
          columns={[
            { key: 'when', header: 'Class', render: (s) => <strong>{`${s.date} ${s.startTime}`}</strong> },
            { key: 'batch', header: 'Batch', render: (s) => `${s.batchCode} · ${s.subjectName ?? s.sessionType.replace('_', ' ')}` },
            { key: 'delivery', header: 'Delivery', render: (s) => <StateBadge state={s.status === 'held' ? 'delivered' : s.status} /> },
            {
              key: 'marks',
              header: 'Attendance',
              render: (s) =>
                !s.ended ? 'Class not over yet'
                : s.unmarked > 0 ? <StatusBadge tone="warning">{`${s.unmarked} not marked`}</StatusBadge>
                : <StatusBadge tone="success">Every placed student marked</StatusBadge>,
            },
            { key: 'go', header: '', render: (s) => <a href={MODULE_PATHS.attendance(s.id)}>{s.ended && s.unmarked > 0 ? 'Record attendance' : 'Open class'}<span className="el-visually-hidden">{` for ${s.batchCode} ${s.date} ${s.startTime}`}</span></a> },
          ]}
        />
      </Card>
    </AcademicShell>
  );
}
