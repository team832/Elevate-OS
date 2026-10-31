import type { Metadata } from 'next';
import { getDb } from '@elevate/database';
import { REFERENCE_DATA_HELP } from '@elevate/shared-contracts';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge, Subnav } from '@elevate/shared-ui';
import { listConceptBooks } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { PlanBadge, words } from '../../../ui/badges';
import { AcademicShell, LoadError, gate, load, CURRICULUM_TABS } from '../../../ui/shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Concept-book indices' };

export default async function ConceptBooksPage() {
  const access = await gate('academic:courses:read', MODULE_PATHS.conceptBooks);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="curriculum">{null}</AcademicShell>;
  const data = await load(() => listConceptBooks(getDb()));
  return (
    <AcademicShell access={access} active="curriculum">
      <PageHeader
        title="Concept-book indices"
        meta={<StatusBadge tone="neutral">Planning record</StatusBadge>}
        description="Chapter indices only: planning records, not teaching material yet. Question counts are planned allocations, not written questions."
        tabs={<Subnav label="Curriculum" items={CURRICULUM_TABS} current={MODULE_PATHS.conceptBooks} />}
      />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : data.data.books.length === 0 ? (
        <EmptyState title="No concept-book indices" description={REFERENCE_DATA_HELP} />
      ) : (
        <div className="el-stack">
          <Alert tone="info">
            {data.data.numberedChapters} numbered chapters across {data.data.books.length} books; content has been started for {data.data.books.flatMap((b) => b.chapters).filter((c) => c.contentStatus !== 'not_started').length}. {data.data.note}
          </Alert>
          {data.data.books.map((b) => (
            <Card key={b.bookCode} title={`${b.bookCode} — ${b.bookTitle}`} description={`${b.numberedChapters} numbered chapters`}>
              <DataTable compact
                rows={b.chapters}
                rowKey={(c) => c.id}
                columns={[
                  { key: 'code', header: 'Chapter', render: (c) => c.chapterCode },
                  { key: 'title', header: 'Title' },
                  { key: 'section', header: 'Section', render: (c) => c.section ?? '—' },
                  { key: 'status', header: 'Index', render: (c) => (c.status === 'active' ? <PlanBadge status={c.indexStatus} /> : <StatusBadge tone="neutral">{words(c.status)}{c.aliasOfCode ? ` → ${c.aliasOfCode}` : ''}</StatusBadge>) },
                  { key: 'content', header: 'Chapter content', render: (c) => <StatusBadge tone="neutral">{words(c.contentStatus)}</StatusBadge> },
                  {
                    key: 'q',
                    header: 'Questions (planned)',
                    render: (c) =>
                      c.questionCountStatus === 'planned'
                        ? `${(c.plannedConceptQuestions ?? 0) + (c.plannedPracticeQuestions ?? 0) + (c.plannedRankerQuestions ?? 0)} planned (${c.plannedConceptQuestions}/${c.plannedPracticeQuestions}/${c.plannedRankerQuestions})`
                        : 'Not decided',
                  },
                ]}
              />
            </Card>
          ))}
        </div>
      )}
    </AcademicShell>
  );
}
