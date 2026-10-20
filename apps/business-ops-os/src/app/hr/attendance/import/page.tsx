import type { AuthenticatedUser } from '@elevate/authentication';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listAttendanceImports } from '../../../../server/hr/attendance-import';
import { fmtDateTime } from '../../../../ui/format';
import { Frame, gate, load, Section } from '../../../../ui/frame';
import { TimeNav } from '../time-ui';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const access = await gate('ops:attendance:manage', '/ops/hr/attendance/import');
  return (
    <Frame access={access} active="attendance">
      <PageHeader
        title="Import attendance from CSV"
        description="Check the file first: every row is validated and errors are listed by line. Importing adds only the valid rows, in one step. Employees outside your scope are refused."
      />
      <TimeNav current="/ops/hr/attendance/import" user={access.user} />
      <Card title="File">
        <ImportForm />
      </Card>
      <Section label="Loading earlier imports…">
        <Batches user={access.user} />
      </Section>
    </Frame>
  );
}

async function Batches({ user }: { user: AuthenticatedUser }) {
  const r = await load((db) => listAttendanceImports(db, user));
  if (!r.ok) return r.view;
  return (
    <Card title="Earlier imports">
      <DataTable
        rows={r.data.rows}
        rowKey={(b) => b.id}
        empty={<EmptyState title="No file imported yet" />}
        columns={[
          { key: 'at', header: 'Imported', render: (b) => fmtDateTime(b.createdAt) },
          { key: 'file', header: 'File', render: (b) => b.fileName ?? 'Pasted text' },
          { key: 'by', header: 'By', render: (b) => b.importedByName ?? '—' },
          { key: 'total', header: 'Rows', numeric: true, render: (b) => b.totalRows },
          {
            key: 'created',
            header: 'Sessions created',
            numeric: true,
            render: (b) => b.createdSessions,
          },
          { key: 'invalid', header: 'Rows skipped', numeric: true, render: (b) => b.invalidRows },
        ]}
      />
    </Card>
  );
}
