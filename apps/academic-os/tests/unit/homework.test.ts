/** F4-05 completion maths: unmarked is never "not submitted" and never 0 %. */
import { describe, expect, it } from 'vitest';
import { completionText, homeworkCounts, type HomeworkStatus } from '../../src/domain/homework';

const S = 'submitted', L = 'late', N = 'not_submitted', E = 'excused', U = null;

describe('homeworkCounts / completionText', () => {
  it.each<[string, (HomeworkStatus | null)[], number | null, string]>([
    ['on time and late both count as handed in', [S, L, N, N], 0.5, '50 %'],
    ['excused students are left out', [S, E, E], 1, '100 %'],
    ['unmarked students are left out, not counted as not submitted', [S, U, U, U], 1, '100 %'],
    ['nobody marked: no figure, not 0 %', [U, U], null, 'Not marked yet'],
    ['marked but all excused', [E, E], null, 'All excused'],
    ['every marked student missed it: a real 0 %', [N, U], 0, '0 %'],
    ['no students at all', [], null, 'No students'],
  ])('%s', (_, statuses, completion, text) => {
    const c = homeworkCounts(statuses);
    expect(c.completion).toBe(completion);
    expect(completionText(c)).toBe(text);
    expect(c.students).toBe(statuses.length);
    expect(c.unmarked).toBe(statuses.filter((s) => s === null).length);
    expect(c.not_submitted).toBe(statuses.filter((s) => s === N).length);
  });
});
