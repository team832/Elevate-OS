/** A course's chapters by subject, with the weight catch-up priority uses (1 = unweighted). */
import { Card, DataTable, EmptyState } from '@elevate/shared-ui';
import { StateBadge } from './badges';

type Subject = { id: string; code: string; name: string };
type Chapter = {
  id: string;
  subjectId: string;
  code: string;
  title: string;
  weight: number;
  status: string;
};

export function CourseChapters({
  subjects,
  chapters,
}: {
  subjects: readonly Subject[];
  chapters: readonly Chapter[];
}) {
  if (!subjects.length) return <EmptyState title="No subjects on this course yet" />;
  return (
    <>
      {subjects.map((s) => {
        const rows = chapters.filter((c) => c.subjectId === s.id);
        return (
          <Card key={s.id} title={`${s.name} (${s.code})`} description={`${rows.length} chapters`}>
            <DataTable
              compact
              caption={`Chapters of ${s.name}`}
              rows={rows}
              rowKey={(c) => c.id}
              empty={<EmptyState title="No chapters in this subject yet" />}
              columns={[
                { key: 'code', header: 'Chapter' },
                { key: 'title', header: 'Title' },
                { key: 'weight', header: 'Weight', numeric: true, render: (c) => c.weight },
                { key: 'status', header: 'Status', render: (c) => <StateBadge state={c.status} /> },
              ]}
            />
          </Card>
        );
      })}
    </>
  );
}
