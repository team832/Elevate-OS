/** Homework pages' shared pieces (F4-05): paths, tabs and the count columns. */
import { StatusBadge, Subnav, type Column } from '@elevate/shared-ui';
import { modulePath } from '../domain';
import { completionText, type HomeworkCounts } from '../domain/homework';

export const HOMEWORK_PATHS = {
  list: modulePath('homework'),
  completion: modulePath('homework/completion'),
  create: modulePath('homework/new'),
  one: (id: string) => modulePath(`homework/${id}`),
  api: (sub = '') => modulePath(`api/v1/homework${sub}`),
};

export function HomeworkTabs({ current }: { current: string }) {
  return (
    <Subnav
      label="Homework views"
      items={[
        [HOMEWORK_PATHS.list, 'Homework'],
        [HOMEWORK_PATHS.completion, 'Completion by batch and teacher'],
      ]}
      current={current}
    />
  );
}

/** Completion in words; "Not marked yet" is a warning, never 0 %. */
export function Completion({ counts }: { counts: HomeworkCounts }) {
  const text = completionText(counts);
  return counts.completion === null ? <StatusBadge tone="neutral">{text}</StatusBadge> : <>{text}</>;
}

export const countColumns = <T extends { counts: HomeworkCounts }>(): Column<T>[] => [
  { key: 'marked', header: 'Marked', numeric: true, render: (r) => `${r.counts.students - r.counts.unmarked} of ${r.counts.students}` },
  { key: 'submitted', header: 'Submitted', numeric: true, render: (r) => r.counts.submitted },
  { key: 'late', header: 'Late', numeric: true, render: (r) => r.counts.late },
  { key: 'not_submitted', header: 'Not submitted', numeric: true, render: (r) => r.counts.not_submitted },
  { key: 'excused', header: 'Excused', numeric: true, render: (r) => r.counts.excused },
  { key: 'completion', header: 'Completion', numeric: true, render: (r) => <Completion counts={r.counts} /> },
];

export const COMPLETION_RULE =
  'Completion = students who handed the homework in (on time or late) ÷ students marked submitted, late or not submitted. Excused students and students not marked yet are left out, so a homework nobody has marked shows "Not marked yet", never 0 %.';
