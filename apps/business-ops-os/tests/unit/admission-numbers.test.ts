import { describe, expect, it } from 'vitest';
import {
  checkManualNumber,
  counterScopeKey,
  formatAdmissionNumber,
} from '../../src/domain/admission-numbers';
import { SETTING_DEFINITIONS } from '../../src/domain';

const DEFAULT = SETTING_DEFINITIONS['admissions.number.format'].defaultValue;
const WITH_YEAR = { prefix: 'EE', separator: '-', includeYear: true, width: 4 } as const;

describe('admission number format (A-STU-1)', () => {
  it("default is the owner's approved format: 001, 002, 003 … (D-037)", () => {
    expect(SETTING_DEFINITIONS['admissions.number.format'].defaultState).toBe('approved');
    expect(DEFAULT.prefix).toBe('');
    expect(DEFAULT.includeYear).toBe(false);
  });

  it.each([
    [DEFAULT, 1, 2026, '001', 'all'],
    [DEFAULT, 3, 2026, '003', 'all'],
    [DEFAULT, 1000, 2026, '1000', 'all'],
    [WITH_YEAR, 42, 2026, 'EE-2026-0042', 'Y2026'],
    [{ ...WITH_YEAR, includeYear: false, separator: '/' } as const, 7, 2027, 'EE/0007', 'all'],
  ])('%o #%i in %i → %s (counter %s)', (format, seq, year, expected, scope) => {
    expect(formatAdmissionNumber(format, seq, year)).toBe(expected);
    expect(counterScopeKey(format, year)).toBe(scope);
  });

  it.each([0, -1, 1.5])('refuses sequence %d', (seq) => {
    expect(() => formatAdmissionNumber(DEFAULT, seq, 2026)).toThrow();
  });
});

describe('manual admission number', () => {
  const ok = { number: 'ADM/2026/7', reason: 'Number issued on paper form', hasPermission: true };
  it.each([
    [{ ...ok }, true, null],
    [{ ...ok, hasPermission: false }, false, 'permission'],
    [{ ...ok, number: '' }, false, 'admissionNumber'],
    [{ ...ok, number: '-12' }, false, 'admissionNumber'],
    [{ ...ok, number: 'A B' }, false, 'admissionNumber'],
    [{ ...ok, number: 'X'.repeat(41) }, false, 'admissionNumber'],
    [{ ...ok, reason: 'too short' }, false, 'reason'],
    [{ ...ok, reason: '   padded    ' }, false, 'reason'],
  ])('%o → ok=%s field=%s', (input, expectedOk, field) => {
    const r = checkManualNumber(input);
    expect(r.ok).toBe(expectedOk);
    if (!r.ok) expect(r.field).toBe(field);
  });
});
