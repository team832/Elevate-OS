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
