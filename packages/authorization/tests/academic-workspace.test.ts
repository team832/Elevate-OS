import { describe, expect, it } from 'vitest';
import { asId, type RoleKey, type UserId } from '@elevate/shared-types';
import { grantsForRole, scopeFor, type Permission } from '../src/index';

const as = (role: RoleKey) => ({
  id: asId<UserId>('00000000-0000-4000-8000-000000000001'),
  roles: [role],
});

describe('teacher workspace grants (brief 20)', () => {
  it.each<[Permission, Partial<Record<RoleKey, 'all' | 'own'>>]>([
    [
      'academic:reviews:read',
      { teacher: 'own', academic_coordinator: 'all', director: 'all', auditor: 'all' },
    ],
    ['academic:reviews:write', { teacher: 'own', academic_coordinator: 'own' }],
    ['academic:assessments:mark', { teacher: 'own', academic_coordinator: 'all' }],
    ['academic:assessments:publish', { academic_coordinator: 'all' }],
    ['academic:timetable:publish', { academic_coordinator: 'all' }],
  ])('%s', (permission, expected) => {
    const roles = Object.keys(expected) as RoleKey[];
    const others: RoleKey[] = [
      'admissions_counsellor',
      'operations_manager',
      'marketing_manager',
      'finance_officer',
      'platform_admin',
    ];
    for (const role of roles) expect(scopeFor(as(role), permission)).toBe(expected[role]);
    for (const role of others) expect(scopeFor(as(role), permission)).toBeNull();
  });

  it('Ops roles hold no academic keys', () => {
    for (const role of [
      'admissions_counsellor',
      'operations_manager',
      'finance_officer',
      'hr_manager',
    ] as RoleKey[]) {
      expect([...grantsForRole(role).keys()].filter((k) => k.startsWith('academic:'))).toEqual([]);
    }
  });
});
