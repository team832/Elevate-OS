import { describe, expect, it } from 'vitest';
import { admissionsFunnel, conversionBy, studentSummary } from '../../src/domain/admissions-funnel';

const lead = (flags: Partial<Parameters<typeof admissionsFunnel>[0][number]> = {}) => ({
  demoBooked: false,
  attended: false,
  completed: false,
  converted: false,
  enrolled: false,
  ...flags,
});

describe('A-REP-1 funnel is nested', () => {
  it('a later flag without its denominator stage does not count', () => {
    const f = admissionsFunnel([
      lead({ converted: true, enrolled: true }),
      lead({ demoBooked: true }),
    ]);
    expect(f.map((s) => s.count)).toEqual([2, 1, 0, 0, 0, 0]);
    expect(f.find((s) => s.key === 'converted')).toMatchObject({
      of: { key: 'attended', count: 0 },
      ratePct: null,
    });
  });
});

describe('A-REP-1 a stage nobody can know is missing, never 0 (D-060, Academic unreadable)', () => {
  const booked = { demoBooked: true };
  it.each([
    ['attendance unknown, not converted', [{ attended: null, completed: null }], [1, 1, null, null, 0, 0]],
    ['attendance unknown, converted', [{ attended: null, completed: null, converted: true }], [1, 1, null, null, null, 0]],
    ['attended here, later days unknown', [{ attended: true, completed: null }], [1, 1, 1, null, 0, 0]],
    ['one known lead beside an unknown one', [{ attended: true, completed: true }, { attended: null, completed: null }], [2, 2, null, null, 0, 0]],
    ['no demo booked: nothing to know', [{ demoBooked: false, attended: null }], [1, 0, 0, 0, 0, 0]],
  ])('%s', (_name, leads, counts) => {
    const f = admissionsFunnel(leads.map((l) => lead({ ...booked, ...l })));
    expect(f.map((s) => s.count)).toEqual(counts);
    for (const s of f) if (s.count === null) expect(s.ratePct).toBeNull();
  });
});

describe('A-REP-2 conversion rate = converted ÷ decided', () => {
  it.each([
    [['open', 'open'], { demos: 2, decided: 0, converted: 0, ratePct: null }],
    [['converted', 'declined', 'open'], { demos: 3, decided: 2, converted: 1, ratePct: 50 }],
  ])('%j', (outcomes, expected) => {
    expect(
      conversionBy(
        outcomes.map((outcome) => ({ outcome })),
        () => 'g',
      ),
    ).toEqual([{ group: 'g', ...expected }]);
  });
});

describe('A-REP-3 student summary', () => {
  it('counts each student once: active over on hold over former; in-admission ignored', () => {
    expect(
      studentSummary([
        { studentId: 'a', population: 'former' },
        { studentId: 'a', population: 'active' },
        { studentId: 'b', population: 'on_hold' },
        { studentId: 'c', population: 'former' },
        { studentId: 'd', population: 'in_admission' },
      ]),
    ).toEqual({ active: 1, on_hold: 1, former: 1 });
  });
});
