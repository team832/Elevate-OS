/** Leave application rules (owner decision 31 Oct 2026): dates, who may approve, who may cancel what. */
import { describe, expect, it } from 'vitest';
import { cancelRefusal, leaveDatesProblem, leaveRange, mayApproveLeave } from '../../src/domain/leave';

const TODAY = '2026-10-31';

describe('leaveDatesProblem: past-dated leave is fine, an absurd date is not', () => {
  it.each([
    ['today', TODAY, TODAY, null],
    ['next week', '2026-11-07', '2026-11-09', null],
    ['sick leave after the fact', '2026-10-20', '2026-10-22', null],
    ['starts in the past, ends in the future', '2026-10-30', '2026-11-02', null],
    ['exactly a year back', '2025-10-31', '2025-10-31', null],
    ['exactly a year ahead', '2027-10-31', '2027-10-31', null],
    ['a mistyped year back', '2025-10-30', '2025-10-30', 'fromDate'],
    ['a mistyped year ahead', '2027-11-01', '2027-11-01', 'toDate'],
    ['longer than a year', '2026-01-01', '2027-01-02', 'toDate'],
  ])('%s', (_label, from, to, field) => {
    expect(leaveDatesProblem(from, to, TODAY)?.path ?? null).toBe(field);
  });
});

describe('mayApproveLeave: the setting, by role', () => {
  it.each([
    [['hr_manager'], ['hr_manager', 'operations_manager'], true],
    [['operations_manager'], ['hr_manager', 'operations_manager'], true],
    [['operations_manager'], ['hr_manager'], false],
    [['hr_manager'], ['operations_manager'], false],
    [['hr_manager', 'operations_manager'], ['operations_manager'], true],
    [['teacher'], ['hr_manager'], false],
    [[], ['hr_manager'], false],
  ])('%j with %j: %s', (roles, who, expected) => {
    expect(mayApproveLeave(roles, who)).toBe(expected);
  });
});

describe('cancelRefusal: the applicant while pending, HR once approved, never after that', () => {
  it.each([
    ['pending', true, null],
    ['pending', false, 'state'],
    ['approved', true, 'forbidden'],
    ['approved', false, null],
    ['rejected', true, 'state'],
    ['rejected', false, 'state'],
    ['cancelled', true, 'state'],
    ['cancelled', false, 'state'],
  ] as const)('%s, applicant %s', (status, mine, expected) => {
    const refusal = cancelRefusal(status, mine);
    expect(refusal === null ? null : refusal.forbidden ? 'forbidden' : 'state').toBe(expected);
    if (refusal) expect(refusal.message).not.toMatch(/_/);
  });
});

it('leaveRange reads as words, one day once', () => {
  expect(leaveRange('2026-11-02', '2026-11-02')).toBe('2 Nov 2026');
  expect(leaveRange('2026-11-02', '2026-11-04')).toBe('2 Nov 2026 to 4 Nov 2026');
});
