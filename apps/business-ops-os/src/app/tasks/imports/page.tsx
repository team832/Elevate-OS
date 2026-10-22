import type { AuthenticatedUser } from '@elevate/authentication';
import { getDb } from '@elevate/database';
import { Alert, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { z } from 'zod';
import type { OpsTaskImportOutcome } from '@elevate/database';
import { hasInbox } from '../../../server/eod-review';
import { getImport, importStaffOptions, listImports } from '../../../server/task-import';
import { ActionForm } from '../../../ui/action-form';
import { StatCard } from '../../../ui/charts';
import { fmtDateTime } from '../../../ui/format';
import { Frame, gate, load, Section } from '../../../ui/frame';
import { RecordTable } from '../../../ui/record-table';
import { Segment } from '../../../ui/sections';
import { TasksNav } from '../_components/eod-nav';
import { ImportUpload } from './_components/import-upload';

export const dynamic = 'force-dynamic';

const BASE = '/ops/tasks/imports';
const OUTCOMES: [
  OpsTaskImportOutcome,
  string,
  'success' | 'info' | 'warning' | 'danger' | 'neutral',
][] = [
  ['accepted', 'Accepted', 'success'],
  ['duplicate', 'Already imported', 'neutral'],
  ['changed', 'Changed since last import', 'warning'],
  ['skipped', 'Skipped', 'neutral'],
  ['unresolved', 'Needs a person', 'warning'],
  ['failed', 'Unreadable', 'danger'],
];
const LABEL = Object.fromEntries(OUTCOMES.map(([k, l, t]) => [k, { l, t }]));

export default async function TaskImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const access = await gate('ops:tasks:import', BASE);
  const { batch } = await searchParams;
  const inbox = await hasInbox(getDb(), access.user).catch(() => false);
  return (
    <Frame access={access} active="tasks">
      <PageHeader
        title="Tracker imports"
        tabs={<TasksNav user={access.user} current="imports" inbox={inbox} />}
        description="Bring one person’s tasks and end-of-day reports from the old task tracker into Elevate. Preview first; nothing is imported or sent until you commit."
      />
      <Section>
        {!batch ? null : z.uuid().safeParse(batch).success ? (
          <BatchView user={access.user} id={batch} />
        ) : (
          <Alert tone="danger">
            This import link is not valid. Open the file from Import history.
          </Alert>
        )}
        <Upload user={access.user} />
        <History user={access.user} />
      </Section>
    </Frame>
  );
}

async function Upload({ user }: { user: AuthenticatedUser }) {
  const staff = await load((db) => importStaffOptions(db, user));
  if (!staff.ok) return staff.view;
  return (
    <Segment title="Upload a backup file">
      <ImportUpload staff={staff.data} />
    </Segment>
  );
}

async function BatchView({ user, id }: { user: AuthenticatedUser; id: string }) {
  const res = await load((db) => getImport(db, user, id));
  if (!res.ok) return res.view;
  const { batch, rows, counts, notes } = res.data;
  const committed = batch.status === 'committed';
  return (
    <Segment
      title={committed ? `Imported: ${batch.sourceFilename}` : `Preview: ${batch.sourceFilename}`}
      actions={
        committed ? null : (
          <ActionForm
            action={`/ops/api/v1/task-imports/${batch.id}/commit`}
            submitLabel={`Import ${counts.accepted ?? 0} records for ${batch.staffName}`}
            successText="Imported."
            compact
          />
        )
      }
    >
      <p>
        For <strong>{batch.staffName}</strong> ·{' '}
        {batch.sourceVersion ?? 'No export date in the file name'} · SHA-256{' '}
        <code>{batch.sourceSha256.slice(0, 12)}…</code>
        {committed ? ` · committed ${fmtDateTime(batch.committedAt)}` : ' · not imported yet'}
      </p>
      <ul className="el-grid ops-kpis">
        <StatCard label="Records in the file" value={counts.parsed ?? 0} />
        {OUTCOMES.map(([k, label]) => (
          <StatCard key={k} label={label} value={counts[k] ?? 0} />
        ))}
      </ul>
      {notes.map((n) => (
        <Alert key={n} tone="info">
          {n}
        </Alert>
      ))}
      <RecordTable
        caption={`${rows.length} records`}
        columns={[
          { key: 'title', header: 'Record', render: (r) => r.title },
          {
            key: 'kind',
            header: 'Type',
            render: (r) => (r.kind === 'task' ? 'Task' : 'End-of-day report'),
          },
          { key: 'legacyId', header: 'Tracker id' },
          {
            key: 'outcome',
            header: 'Outcome',
            render: (r) => (
              <StatusBadge tone={LABEL[r.outcome]!.t}>{LABEL[r.outcome]!.l}</StatusBadge>
            ),
          },
          { key: 'message', header: 'What to do', render: (r) => r.message ?? '—' },
        ]}
        rows={rows}
        rowKey={(r) => `${r.kind}:${r.legacyId}`}
        empty="The file holds no tasks or reports."
      />
    </Segment>
  );
}

async function History({ user }: { user: AuthenticatedUser }) {
  const res = await load((db) => listImports(db, user));
  if (!res.ok) return res.view;
  if (!res.data.length)
    return (
      <EmptyState
        title="No tracker files imported yet"
        description="Ask each person to open the old task tracker in their browser, choose Backup → Export backup and send you the Task-EOD-backup-….json file it downloads. Records live only in each person’s browser, so the tracker HTML itself has nothing to import. Until those files arrive, parity with the old tracker is pending source data."
      />
    );
  return (
    <Segment title="Import history" flush>
      <RecordTable
        caption={`${res.data.length} files`}
        columns={[
          { key: 'sourceFilename', header: 'File' },
          { key: 'staffName', header: 'Person' },
          {
            key: 'status',
            header: 'Status',
            render: (b) =>
              b.status === 'committed' ? (
                <StatusBadge tone="success">Imported</StatusBadge>
              ) : (
                <StatusBadge tone="info">Preview only</StatusBadge>
              ),
          },
          {
            key: 'counts',
            header: 'Imported / in file',
            numeric: true,
            render: (b) => `${b.counts.accepted ?? 0} / ${b.counts.parsed ?? 0}`,
          },
          { key: 'createdAt', header: 'Uploaded', render: (b) => fmtDateTime(b.createdAt) },
        ]}
        rows={res.data}
        rowKey={(b) => b.id}
        rowHref={(b) => `${BASE}?batch=${b.id}`}
      />
    </Segment>
  );
}
