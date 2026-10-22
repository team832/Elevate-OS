import { describe, expect, it } from 'vitest';
import { assignmentPhase, enrolmentView, findSessionClashes, isBatchFull, transferEndDate, type PlacementSession } from '../../src/domain/placements';

const s = (over: Partial<PlacementSession>): PlacementSession => ({ id: 'x', batchId: 'A', date: '2026-11-02', startTime: '09:00', durationMinutes: 60, status: 'scheduled', ...over });

describe('placement rules (ACD-019)', () => {
  it.each([
    [null, 500, false],
    [2, 1, false],
    [2, 2, true],
    [2, 3, true],
  ] as const)('capacity %s with %s seats taken → full %s', (capacity, taken, full) => {
    expect(isBatchFull(capacity, taken)).toBe(full);
  });

  it.each([
    ['same date, overlapping time', s({ id: 'b', startTime: '09:30' }), 1],
    ['touching end-to-start does not clash', s({ id: 'b', startTime: '10:00' }), 0],
    ['another date', s({ id: 'b', date: '2026-11-03' }), 0],
    ['cancelled session', s({ id: 'b', status: 'cancelled' }), 0],
    ['rescheduled session', s({ id: 'b', status: 'rescheduled' }), 0],
    ['before the start date', s({ id: 'b', date: '2026-10-30' }), 0],
    ['held session still clashes', s({ id: 'b', status: 'held' }), 1],
    ['unreadable start time', s({ id: 'b', startTime: '9am' }), 0],
  ] as const)('clash: %s', (_label, incoming, n) => {
    const existing = [s({ id: 'a' }), s({ id: 'a2', date: '2026-10-30' })];
    expect(findSessionClashes(existing, [incoming], '2026-11-01')).toHaveLength(n);
  });

  it('a transfer ends the old placement the day before (month and year edges)', () => {
    expect(transferEndDate('2026-11-01')).toBe('2026-10-31');
    expect(transferEndDate('2027-01-01')).toBe('2026-12-31');
  });

  it.each([
    [null, null, 'current'],
    ['2026-10-01', '2026-10-21', 'current'],
    ['2026-10-22', null, 'upcoming'],
    ['2026-09-01', '2026-10-20', 'ended'],
  ] as const)('assignment %s to %s on 2026-10-21 is %s', (start, end, phase) => {
    expect(assignmentPhase(start, end, '2026-10-21')).toBe(phase);
  });

  it.each([
    ['active', true, 'placed'],
    ['active', false, 'awaiting'],
    ['paused', false, 'awaiting'],
    ['withdrawn', false, 'ended'],
    ['completed', true, 'ended'],
  ] as const)('enrolment %s with open placement %s → %s', (status, open, view) => {
    expect(enrolmentView(status, open)).toBe(view);
  });
});
