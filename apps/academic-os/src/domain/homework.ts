/**
 * Homework counts (F4-05). A student without a mark is "not marked yet": never "not submitted",
 * never 0 %. Completion = handed in (on time or late) ÷ students marked submitted, late or not
 * submitted; excused and unmarked students are left out. null = nothing to count yet.
 */
export const HOMEWORK_STATUSES = ['submitted', 'late', 'not_submitted', 'excused'] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];

export const HOMEWORK_STATUS_LABELS: Record<HomeworkStatus, string> = {
  submitted: 'Submitted',
  late: 'Late',
  not_submitted: 'Not submitted',
  excused: 'Excused',
};

export type HomeworkCounts = Record<HomeworkStatus | 'unmarked', number> & {
  students: number;
  completion: number | null;
};

export type HomeworkTally = Record<HomeworkStatus, number> & { students: number };

/** Counts from tallies of students and marks: unmarked = students − marked. */
export function countsOf(t: HomeworkTally): HomeworkCounts {
  const counted = t.submitted + t.late + t.not_submitted;
  const { students, submitted, late, not_submitted, excused } = t;
  return { students, submitted, late, not_submitted, excused, unmarked: students - counted - excused, completion: counted === 0 ? null : (submitted + late) / counted };
}

/** Counts over one homework's students. */
export function homeworkCounts(statuses: readonly (HomeworkStatus | null)[]): HomeworkCounts {
  const t = { students: statuses.length, submitted: 0, late: 0, not_submitted: 0, excused: 0 };
  for (const s of statuses) if (s) t[s] += 1;
  return countsOf(t);
}

/** Several homework together (a batch, a teacher): tallies added, completion worked out again. */
export const sumCounts = (list: readonly HomeworkTally[]) =>
  countsOf(list.reduce((a, c) => ({ students: a.students + c.students, submitted: a.submitted + c.submitted, late: a.late + c.late, not_submitted: a.not_submitted + c.not_submitted, excused: a.excused + c.excused }), { students: 0, submitted: 0, late: 0, not_submitted: 0, excused: 0 }));

/** "75 %", or why there is no figure: never shown as 0 %. */
export function completionText(c: HomeworkCounts): string {
  if (c.completion !== null) return `${Math.round(c.completion * 100)} %`;
  if (c.students === 0) return 'No students';
  return c.unmarked > 0 ? 'Not marked yet' : 'All excused';
}
