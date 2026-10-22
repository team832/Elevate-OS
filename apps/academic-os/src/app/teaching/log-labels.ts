/** Screen labels for teaching-log vocabularies (no raw codes on screen). */
const ACTIVITY_LABELS: Record<string, string> = {
  main: 'First teaching (counts as coverage)',
  practice: 'Practice',
  revision: 'Revision',
  test: 'Test',
  doubt_solving: 'Doubt solving',
  catch_up: 'Catch-up',
  discussion: 'Discussion',
};

export const activityLabel = (a: string) => ACTIVITY_LABELS[a] ?? a;
export const ACTIVITY_OPTIONS = Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }));
export const COMPLETION_OPTIONS = [
  { value: 'completed', label: 'Topic completed' },
  { value: 'partial', label: 'Topic partly covered' },
];
