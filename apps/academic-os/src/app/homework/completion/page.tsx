import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import type { PageAccess } from '@elevate/server-kit/next';
import { Button, ButtonLink, Card, DataTable, EmptyState, PageHeader } from '@elevate/shared-ui';
import { homeworkCompletion } from '../../../server';
import { homeworkQuery } from '../../../server/schemas-homework';
import { fmtRange } from '../../../ui/badges';
import { Filter } from '../../../ui/filters';
import { COMPLETION_RULE, countColumns, HOMEWORK_PATHS, HomeworkTabs } from '../../../ui/homework';
import { AcademicShell, LoadError, actorFor, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Homework completion' };

type Search = Promise<Record<string, string | string[] | undefined>>;
type Group = Awaited<ReturnType<typeof homeworkCompletion>>['batches'][number];

/** /academic/homework/completion — completion by batch and by teacher over homework due in a window (F4-05). */
export default async function HomeworkCompletionPage({ searchParams }: { searchParams: Search }) {
  const access = await gate('academic:classes:read', HOMEWORK_PATHS.completion);
  return (
    <AcademicShell access={access} active="homework" loading="Loading homework completion…">
      {access.status === 'allowed' ? <Body access={access} searchParams={searchParams} /> : null}
    </AcademicShell>
  );
}

const table = (rows: Group[], by: string) => (
  <DataTable
    rows={rows}
    rowKey={(g) => g.id}
    caption={`By ${by}`}
    empty={<EmptyState title="No homework due in these dates" description="Choose other dates, or set homework from the Homework page." />}
    columns={[{ key: 'name', header: by === 'batch' ? 'Batch' : 'Teacher', render: (g) => <strong>{g.name}</strong> }, { key: 'homework', header: 'Homework', numeric: true, render: (g) => g.homework }, ...countColumns<Group>()]}
  />
);

async function Body({ access, searchParams }: { access: PageAccess; searchParams: Search }) {
  const parsed = homeworkQuery.safeParse(await searchParams);
  const q = parsed.success ? { from: parsed.data.from, to: parsed.data.to } : {};
  const data = await load(() => homeworkCompletion(getDb(), actorFor(access.user), q));
  const window = data.ok ? data.data.window : null;
  return (
    <>
      <PageHeader
        title="Homework completion"
        description={window ? `Homework due ${fmtRange(window)}, cancelled homework left out.` : undefined}
        actions={window ? <ButtonLink href={`${HOMEWORK_PATHS.api('/completion')}?${new URLSearchParams({ ...window, format: 'csv' })}`}>Download spreadsheet (CSV)</ButtonLink> : null}
        tabs={<HomeworkTabs current={HOMEWORK_PATHS.completion} />}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : (
        <div className="el-stack">
          <form method="get" className="el-inline-form">
            <Filter id="hc-from" name="from" label="Due from" type="date" value={data.data.window.from} />
            <Filter id="hc-to" name="to" label="Due until" type="date" value={data.data.window.to} />
            <Button type="submit" variant="secondary">Show completion</Button>
          </form>
          <details className="el-explain">
            <summary>How completion is counted</summary>
            <p>{COMPLETION_RULE}</p>
          </details>
          <Card>{table(data.data.batches, 'batch')}</Card>
          <Card>{table(data.data.teachers, 'teacher')}</Card>
        </div>
      )}
    </>
  );
}
