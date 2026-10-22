import type { Metadata } from 'next';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { listBatches, listCatchup, listInterventions } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { ApiButton, ApiForm } from '../../ui/api-form';
import { StateBadge } from '../../ui/badges';
import { InterventionsTable } from '../../ui/interventions';
import type { PageAccess } from '@elevate/server-kit/next';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Progress' };

export default async function ProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Gate before the Suspense boundary so a signed-out visitor gets a real 307 (D-022).
  const access = await gate('academic:progress:read', MODULE_PATHS.progress);
  return (
    <AcademicShell access={access} active="progress" loading="Loading progress…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = getDb();
  const actor = actorFor(access.user);
  const canWrite = can(access.user, 'academic:progress:write');
  const data = await load(async () => {
    const batches = can(access.user, 'academic:batches:read') ? await listBatches(db, actor) : [];
    const selected = batches.find((b) => b.id === sp.batchId) ?? batches.find((b) => b.activeEnrolments > 0) ?? batches[0] ?? null;
    return { batches, selected, catchup: selected ? await listCatchup(db, actor, selected.id) : null, interventions: await listInterventions(db, actor), mine: await listInterventions(db, actor, { responsible: 'me' }) };
  });
  return (
    <>
      <PageHeader title="Progress, catch-up and support" description="Catch-up tasks from missed classes and support plans. Every priority score is explained; open a student for their four progress dimensions." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          {data.data.mine.some((i) => i.status === 'open' || i.status === 'in_progress') ? (
            <Card title="Your next support actions" description="Support plans where you are the responsible staff member, earliest due first.">
              <ul>
                {data.data.mine
                  .filter((i) => i.status === 'open' || i.status === 'in_progress')
                  .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
                  .map((i) => (
                    <li key={i.id}>
                      <a href={MODULE_PATHS.studentProgress(i.studentId)}>{i.studentName}</a>: {i.action} · due {i.dueDate ?? 'no date'} · review {i.reviewOn ?? 'no date'}
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
          <form method="get" className="el-grid" style={{ alignItems: 'end' }}>
            <label>
              Batch{' '}
              <select name="batchId" defaultValue={data.data.selected?.id ?? ''} className="el-select">
                {data.data.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="el-button el-button-secondary">Show</button>
          </form>
          {!data.data.selected || !data.data.catchup ? (
            <EmptyState title="No batch" description="You have no batches to show." />
          ) : (
            <Card
              title={`Catch-up list — ${data.data.selected.code}`}
              description={`As of ${data.data.catchup.asOf}. Weights: recency ${data.data.catchup.weights.recency}, chapter ${data.data.catchup.weights.chapter}, upcoming assessment ${data.data.catchup.weights.assessment}, horizon ${data.data.catchup.weights.horizonDays} days. ${data.data.catchup.closed} task(s) closed.`}
            >
              {canWrite ? <ApiButton action={MODULE_PATHS.api(`batches/${data.data.selected.id}/catch-up`)} label="Generate tasks from missed classes" successMessage="Catch-up tasks generated (existing tasks are not duplicated)." showResult /> : null}
              <DataTable compact
                rows={data.data.catchup.ranked}
                rowKey={(r) => r.taskId}
                empty={<EmptyState title="No open catch-up tasks" />}
                columns={[
                  { key: 'rank', header: 'Rank', numeric: true },
                  { key: 'student', header: 'Student', render: (r) => <a href={MODULE_PATHS.studentProgress(r.studentId)}>{r.studentName}</a> },
                  { key: 'missed', header: 'Missed class', render: (r) => `${r.sessionDate}${r.chapterCode ? ` · ${r.chapterCode}` : ''}` },
                  { key: 'score', header: 'Score', numeric: true },
                  { key: 'why', header: 'Why', render: (r) => r.explanation },
                  { key: 'status', header: 'Status', render: (r) => <StateBadge state={r.task.status} /> },
                  {
                    key: 'update',
                    header: '',
                    render: (r) =>
                      canWrite ? (
                        <details>
                          <summary>Update</summary>
                          <ApiForm
                            action={MODULE_PATHS.api(`catch-up-tasks/${r.taskId}`)}
                            method="PATCH"
                            submitLabel="Save"
                            successMessage="Task updated."
                            idPrefix={`cu-${r.taskId}`}
                            fields={[
                              { name: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'done', 'cancelled'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) },
                              { name: 'dueDate', label: 'Due', type: 'date' },
                              { name: 'note', label: 'Note' },
                            ]}
                          />
                        </details>
                      ) : null,
                  },
                ]}
              />
            </Card>
          )}
          <Card title="Support plans" description="Each plan has a responsible staff member, a due date and a review date. Nothing flags students automatically; each student's progress page lists the raw facts (recent absences, overdue catch-up, declining comparable scores).">
            <InterventionsTable rows={data.data.interventions} canWrite={canWrite} />
          </Card>
        </div>
      )}
    </>
  );
}
