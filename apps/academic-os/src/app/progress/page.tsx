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
    const selected = batches.find((b) => b.id === sp.batchId) ?? batches[0] ?? null;
    return { batches, selected, catchup: selected ? await listCatchup(db, actor, selected.id) : null, interventions: await listInterventions(db, actor) };
  });
  return (
    <>
      <PageHeader title="Progress, catch-up and interventions" description="Catch-up tasks come from missed classes (absent, excused, or held before a late joiner’s start). The order is deterministic and every score is explained." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
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
              <DataTable
                rows={data.data.catchup.ranked}
                rowKey={(r) => r.taskId}
                empty={<EmptyState title="No open catch-up tasks" />}
                columns={[
                  { key: 'rank', header: 'Rank', numeric: true },
                  { key: 'student', header: 'Student', render: (r) => <a href={MODULE_PATHS.student(r.studentId)}>{r.studentName}</a> },
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
          <Card title="Interventions" description="Open interventions with a responsible staff member. Automated risk flagging is not implemented (ACD-022 Proposed); open interventions from a student’s page.">
            <InterventionsTable rows={data.data.interventions} canWrite={canWrite} />
          </Card>
        </div>
      )}
    </>
  );
}
