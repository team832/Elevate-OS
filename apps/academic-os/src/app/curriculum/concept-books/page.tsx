import { getDb } from '@elevate/database';
import { Alert, Card, DataTable, EmptyState, PageHeader, StatusBadge } from '@elevate/shared-ui';
import { listConceptBooks } from '../../../server';
import { MODULE_PATHS } from '../../../server/paths';
import { PlanBadge } from '../../../ui/badges';
import { AcademicShell, LoadError, gate, load } from '../../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function ConceptBooksPage() {
  const access = await gate('academic:courses:read', MODULE_PATHS.conceptBooks);
  if (access.status !== 'allowed') return <AcademicShell access={access} active="curriculum">{null}</AcademicShell>;
  const data = await load(() => listConceptBooks(getDb()));
  return (
    <AcademicShell access={access} active="curriculum">
      <PageHeader title="Concept-book indices" description="Chapter indices only (locked). Content is deliberately empty; question counts are planned allocations, not written questions. Chapter codes are never renumbered." />
      {!data.ok ? (
        <LoadError error={data.error} />
      ) : data.data.books.length === 0 ? (
        <EmptyState title="No concept-book indices" description="Run the Academic OS seed to import the six legacy indices." />
      ) : (
        <div className="el-stack">
          <Alert tone="info">
            {data.data.numberedChapters} numbered chapters across {data.data.books.length} books. {data.data.note}
          </Alert>
          {data.data.books.map((b) => (
            <Card key={b.bookCode} title={`${b.bookCode} — ${b.bookTitle}`} description={`${b.numberedChapters} numbered chapters`}>
              <DataTable
                rows={b.chapters}
                rowKey={(c) => c.id}
                columns={[
                  { key: 'code', header: 'Chapter', render: (c) => c.chapterCode },
                  { key: 'title', header: 'Title' },
                  { key: 'section', header: 'Section', render: (c) => c.section ?? '—' },
                  { key: 'status', header: 'Index', render: (c) => (c.status === 'active' ? <PlanBadge status={c.indexStatus} /> : <StatusBadge tone="neutral">{c.status}{c.aliasOfCode ? ` → ${c.aliasOfCode}` : ''}</StatusBadge>) },
                  { key: 'content', header: 'Content', render: (c) => <StatusBadge tone="neutral">{c.contentStatus.replace(/_/g, ' ')}</StatusBadge> },
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
