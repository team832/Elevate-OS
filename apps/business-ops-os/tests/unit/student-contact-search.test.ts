import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '@elevate/authentication';
import { contactSearch } from '../../src/app/students/_components/student-list';

const as = (role: string) => ({ roles: [role] }) as unknown as AuthenticatedUser;
const manager = as('operations_manager');

describe('student search box: phone or email becomes the audited contact filter', () => {
  it.each([
    ['98765 43210', '98765 43210'],
    ['+91-98765-43210', '+91-98765-43210'],
    ['parent@example.test', 'parent@example.test'],
    ['Vihaan', undefined],
    ['ADM-000009', undefined],
    ['000009', undefined],
    ['001', undefined], // admission numbers are 3 digits (D-037): always a plain search
    // Known edge: any 10+ digit number is read as a phone, so it never matches an admission number.
    ['0000000001', '0000000001'],
    ['parent@', undefined],
  ])('%s → %s', (q, expected) => {
    expect(contactSearch({ q }, manager)).toBe(expected);
  });

  it('keeps an explicit contact filter and never maps for staff without private access', () => {
    expect(contactSearch({ q: 'x', contact: '1234' }, manager)).toBe('1234');
    expect(contactSearch({ q: '9876543210' }, as('director'))).toBeUndefined();
  });
});
