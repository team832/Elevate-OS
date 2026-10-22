import { describe, expect, it } from 'vitest';
import { programmesLine, type Profile } from '../../src/app/students/_components/profile-sections';

const profile = (c: object) =>
  ({
    cases: [
      {
        status: 'enrolled',
        population: 'current',
        programme: { name: 'IPMAT preparation' },
        enrolmentId: 'enr-1',
        enrolledBatchId: null,
        intendedBatchId: null,
        ...c,
      },
    ],
  }) as unknown as Profile;

describe('student header programmes line', () => {
  it.each([
    [
      'Academic placed the enrolment',
      {},
      { 'enr-1': 'Sample IPMAT A' },
      'IPMAT preparation (batch Sample IPMAT A, from Academic OS)',
    ],
    ['Academic has no batch for it', {}, {}, 'IPMAT preparation (batch to be assigned)'],
    [
      'requested in Ops only',
      { intendedBatchId: 'b' },
      { other: 'X' },
      'IPMAT preparation (batch requested)',
    ],
  ])('%s', (_name, c, placed, line) => {
    expect(programmesLine(profile(c), new Map(Object.entries(placed)))).toBe(line);
  });
});
