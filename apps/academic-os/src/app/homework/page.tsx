import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import type { PageAccess } from '@elevate/server-kit/next';
import { Alert, Button, ButtonLink, Card, DataTable, fmtDay, ListEmpty, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listBatches, listHomework } from '../../server';
import { homeworkQuery } from '../../server/schemas-homework';
import { Filter } from '../../ui/filters';
import { countColumns, HOMEWORK_PATHS, HomeworkTabs } from '../../ui/homework';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Homework' };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** /academic/homework — homework set for batches (teachers: batches they teach), newest due date first (F4-05). */
export default async function HomeworkPage({ searchParams }: { searchParams: Search }) {
  const access = await gate('academic:classes:read', HOMEWORK_PATHS.list);
  return (
    <AcademicShell access={access} active="homework" loading="Loading homework…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Search }) {
  const parsed = homeworkQuery.safeParse(await searchParams);
  const q = parsed.success ? { batchId: parsed.data.batchId, from: parsed.data.from, to: parsed.data.to } : {};
  const actor = actorFor(access.user);
  const db = getDb();
  const data = await load(async () => ({ ...(await listHomework(db, actor, q)), batches: await listBatches(db, actor) }));
  const canSet = can(access.user, 'academic:classes:record');
  const download = `${HOMEWORK_PATHS.api()}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), format: 'csv' })}`;
  return (
    <>
      <PageHeader
        title="Homework"
        description="Homework set for each batch and how many students have been marked. A student nobody has marked yet is shown as not marked, never as not submitted."
        actions={
          <>
            {canSet ? <ButtonLink variant="primary" href={HOMEWORK_PATHS.create}>Set homework</ButtonLink> : null}
            <ButtonLink href={download}>Download spreadsheet (CSV)</ButtonLink>
          </>
        }
        tabs={<HomeworkTabs current={HOMEWORK_PATHS.list} />}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <form method="get" className="el-inline-form">
            <Filter id="hw-batch" name="batchId" label="Batch" type="select" options={data.data.batches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} value={q.batchId} />
            <Filter id="hw-from" name="from" label="Due from" type="date" value={q.from} />
            <Filter id="hw-to" name="to" label="Due until" type="date" value={q.to} />
            <Button type="submit" variant="secondary">Show homework</Button>
          </form>
          {data.data.total > data.data.rows.length ? (
            <Alert tone="info">
              Showing the first {data.data.rows.length.toLocaleString('en-IN')} of {data.data.total.toLocaleString('en-IN')}, newest due date first. Choose a batch or dates to see the others; the download has them all.
            </Alert>
          ) : null}
          <Card>
            <DataTable
              rows={data.data.rows}
              rowKey={(h) => h.id}
              sampleOf={(h) => h.isSample}
              caption={`${data.data.total} homework`}
              empty={<ListEmpty noun="homework" params={q} first={canSet ? 'Set homework for one of your batches; it can be copied from a teaching log.' : 'Teachers set homework from this page.'} />}
              columns={[
                {
                  key: 'title',
                  header: 'Homework',
                  render: (h) => (
                    <>
                      <a href={HOMEWORK_PATHS.one(h.id)}>
                        <strong>{h.title}</strong>
                      </a>{' '}
                      {h.cancelledAt ? <StatusBadge tone="neutral">Cancelled</StatusBadge> : null}
                    </>
                  ),
                },
                { key: 'batch', header: 'Batch', render: (h) => `${h.batchCode} · ${h.subjectName ?? 'No subject'}` },
                { key: 'teacher', header: 'Teacher', render: (h) => h.teacherName },
                { key: 'dates', header: 'Set · due', render: (h) => `${fmtDay(h.setOn)} · ${fmtDay(h.dueOn)}` },
                ...countColumns<(typeof data.data.rows)[number]>(),
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}
