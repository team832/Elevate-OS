import { describe, expect, it } from 'vitest';
import { contentDeliverableStates, dueText } from '../../src/domain';

describe('deliverable states: approved and published externally are separate facts', () => {
  it.each([
    ['draft', 'Not submitted', 'Not published'],
    ['in_review', 'Awaiting review', 'Not published'],
    ['changes_requested', 'Changes requested', 'Not published'],
    ['approved', 'Approved', 'Not published'],
    ['scheduled', 'Approved', 'Not published'],
    ['published', 'Approved', 'Published externally'],
    ['archived', 'Archived', 'Not published'],
  ] as const)('%s → %s / %s', (state, review, published) => {
    expect(contentDeliverableStates(state)).toEqual({ review, published });
  });

  it.each([
    ['2026-10-29', '16:00', '29 Oct 2026, 4:00 pm'],
    ['2026-10-29', '16:00:00', '29 Oct 2026, 4:00 pm'],
    ['2026-10-29', null, '29 Oct 2026, end of day'],
  ])('deadline %s %s reads "%s" (IST)', (day, time, text) => {
    expect(dueText(day, time)).toBe(text);
  });
});
