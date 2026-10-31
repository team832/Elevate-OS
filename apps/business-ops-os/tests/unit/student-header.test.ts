import { describe, expect, it } from 'vitest';
import { batchLabel, programmesLine, type Profile } from '../../src/app/students/_components/profile-sections';

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

  it.each([
    ['enrolled, Academic unreadable: not known', {}, 'IPMAT preparation (batch not known, Academic OS unavailable)'],
    ['a batch Ops knows stays', { enrolledBatchId: 'b' }, 'IPMAT preparation (batch assigned)'],
    ['not enrolled: Ops knows no batch was asked for', { enrolmentId: null }, 'IPMAT preparation (batch to be assigned)'],
    ['not enrolled, requested', { enrolmentId: null, intendedBatchId: 'b' }, 'IPMAT preparation (batch requested)'],
  ])('Academic down: %s', (_name, c, line) => {
    expect(programmesLine(profile(c), null)).toBe(line);
  });
});

describe('batch label where Ops reads no source', () => {
  it.each([
    ['b', null, 'e', 'Assigned in Academic OS'],
    [null, null, 'e', 'Kept in Academic OS'],
    [null, 'b', null, 'Requested from Academic OS'],
    [null, null, null, 'To be assigned'],
  ])('enrolled %s, intended %s, enrolment %s: %s', (enrolled, intended, enrolment, label) => {
    expect(batchLabel(enrolled, intended, enrolment)).toBe(label);
  });
});
