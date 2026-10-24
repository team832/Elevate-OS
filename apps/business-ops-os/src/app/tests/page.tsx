import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { ButtonLink, EmptyState, PageHeader, StatusBadge, Tabs } from '@elevate/shared-ui';
import { listTests, testOptions } from '../../server/assessments';
import { testListQuery } from '../../server/assessments-schemas';
import { Unavailable } from '../../ui/cross-module';
import { fmtDateTime } from '../../ui/format';
import { Frame, gate, load, Section } from '../../ui/frame';
import { FilterForm, listHref, Pager } from '../../ui/list-controls';
import { RecordTable } from '../../ui/record-table';
import {
  BASE,
  KIND_LABELS,
  PublicationBadge,
  rosterText,
  SOURCE_LABELS,
  STATUS_LABELS,
  VIEWS,
  when,
} from './_components/labels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tests and Mock Tests' };

type Params = Record<string, string | undefined>;
const FILTERS = ['courseId', 'batchId', 'teacherStaffId', 'from', 'to'] as const;

export default async function TestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await gate('ops:assessments:read', BASE);
  const sp = await searchParams;
  return (
    <Frame access={access} active="tests">
      <PageHeader
        title="Tests and Mock Tests"
        description="Tests are kept in Academic OS; teachers see the same record there. Schedule tests, upload papers, import scores and publish results here."
        actions={
          can(access.user, 'ops:assessments:manage') ? (
            <ButtonLink variant="primary" href={`${BASE}/new`}>
              Schedule a test
            </ButtonLink>
          ) : null
        }
      />
      <Section>
        <TestsList user={access.user} sp={sp} />
      </Section>
    </Frame>
  );
}

async function TestsList({ user, sp }: { user: AuthenticatedUser; sp: Params }) {
  const query = testListQuery.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => v)),
  );
  const q = query.success ? query.data : testListQuery.parse({});
  const r = await load(async (db) => ({
    ...(await listTests(db, user, q)),
    options: await testOptions(),
  }));
  if (!r.ok) return r.view;
  const { list, imports, counts, options } = r.data;
  const params = Object.fromEntries(FILTERS.map((k) => [k, sp[k]]));
  const choices = list.status === 'available' ? list.data.filterOptions : null;
  const asOptions = (xs: { id: string; label: string }[] = []) =>
    xs.map((x) => ({ value: x.id, label: x.label }));
  return (
    <div className="el-stack">
      <FilterForm
        action={BASE}
        hidden={{ view: q.view }}
        submitLabel="Apply filters"
        resetHref={listHref(BASE, { view: q.view })}
        fields={[
          {
            name: 'courseId',
            label: 'Course',
            type: 'select',
            value: sp.courseId,
            options: asOptions(choices?.courses),
          },
          {
            name: 'batchId',
            label: 'Batch',
            type: 'select',
            value: sp.batchId,
            options: asOptions(choices?.batches),
          },
          {
            name: 'teacherStaffId',
            label: 'Teacher or evaluator',
            type: 'select',
            value: sp.teacherStaffId,
            options: options?.teachers ?? [],
          },
          { name: 'from', label: 'From', type: 'date', value: sp.from },
          { name: 'to', label: 'To', type: 'date', value: sp.to },
        ]}
      />
      <details className="el-explain">
        <summary>How these lists are defined</summary>
        Upcoming: drafts, and scheduled tests dated after today (IST). In progress: held tests, and
        scheduled tests dated today or earlier. Previous: finalised or cancelled. A previous test
        can still be waiting for its results to be published, so it can appear in both lists.
        Imports awaiting review: score files read into Business Operations but not yet confirmed.
        Counts are of stored records under the filters above.
      </details>
      {list.status === 'unavailable' ? <Unavailable name="Academic OS" result={list} /> : null}
      <Tabs
        idBase="tests"
        label="Test lists"
        selected={q.view}
        items={VIEWS.map(([key, label]) => ({
          key,
          label,
          href: listHref(BASE, { ...params, view: key }),
          count:
            key === 'imports'
              ? counts.imports
              : list.status === 'available'
                ? list.data.viewCounts[key]
                : null,
        }))}
      >
        {q.view === 'imports' ? (
          <RecordTable
            caption={`${imports.length} imports awaiting review`}
            rows={imports}
            rowKey={(i) => i.id}
            rowHref={(i) => `${BASE}/${i.assessmentId}/imports/${i.id}`}
            empty={
              <EmptyState
                title="No imports waiting"
                description="Score files read from a test page wait here until someone confirms or cancels them."
              />
            }
            columns={[
              {
                key: 'test',
                header: 'Test',
                render: (i) =>
                  i.test ? `${i.test.code} · ${i.test.title}` : 'Test not readable now',
              },
              { key: 'source', header: 'Source', render: (i) => SOURCE_LABELS[i.source] },
              { key: 'rows', header: 'Rows', numeric: true, render: (i) => i.rowsTotal },
              {
                key: 'open',
                header: 'Rows needing a decision',
                numeric: true,
                render: (i) =>
                  ['suggested', 'ambiguous', 'unmatched', 'duplicate', 'withErrors'].reduce(
                    (n, k) => n + (i.counts[k] ?? 0),
                    0,
                  ),
              },
              { key: 'at', header: 'Read', render: (i) => fmtDateTime(i.createdAt) },
            ]}
          />
        ) : list.status === 'available' ? (
          <>
            <RecordTable
              caption={`${list.data.total} tests`}
              rows={list.data.items}
              rowKey={(t) => t.id}
              rowHref={(t) => `${BASE}/${t.id}`}
              empty={
                <EmptyState
                  title="No tests in this list"
                  description="Clear a filter, or schedule a test to start."
                />
              }
              columns={[
                {
                  key: 'title',
                  header: 'Test',
                  render: (t) => (
                    <>
                      {t.code} · {t.title}
                      {t.isSample ? (
                        <>
                          {' '}
                          <span className="el-badge el-badge-sample">SAMPLE DATA</span>
                        </>
                      ) : null}
                    </>
                  ),
                },
                { key: 'kind', header: 'Type', render: (t) => KIND_LABELS[t.kind] },
                {
                  key: 'course',
                  header: 'Course and batches',
                  render: (t) => `${t.courseName} · ${t.batches.map((b) => b.code).join(', ')}`,
                },
                { key: 'date', header: 'Date', render: when },
                {
                  key: 'teacher',
                  header: 'Responsible teacher',
                  render: (t) => t.responsibleTeacher?.name ?? 'Not assigned',
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (t) => <StatusBadge>{STATUS_LABELS[t.status]}</StatusBadge>,
                },
                { key: 'roster', header: 'Roster', render: (t) => rosterText(t.rosterCounts) },
                {
                  key: 'results',
                  header: 'Results',
                  render: (t) => <PublicationBadge state={t.publicationState} />,
                },
              ]}
            />
            <Pager
              basePath={BASE}
              params={{ ...params, view: q.view }}
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
            />
          </>
        ) : null}
      </Tabs>
    </div>
  );
}
