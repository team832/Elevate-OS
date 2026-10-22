import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, asId, type RoleKey, type UserId } from '@elevate/shared-types';
import { scopeFor, type Permission } from '../src/index';

const as = (role: RoleKey) => ({
  id: asId<UserId>('00000000-0000-4000-8000-000000000001'),
  roles: [role],
});
const holders = (permission: Permission) =>
  Object.fromEntries(
    ROLE_KEYS.map((r) => [r, scopeFor(as(r), permission)] as const).filter(([, s]) => s !== null),
  );

// Owner answer 21 Oct 2026: teacher reviews are written in Academic OS; Ops reads and acknowledges.
describe('Ops task-tracker and review grants', () => {
  it.each([
    ['ops:feedback:write', {}],
    ['ops:feedback:manage', {}],
    ['ops:feedback:acknowledge', { admissions_counsellor: 'own', operations_manager: 'all' }],
    [
      'ops:feedback:read',
      {
        admissions_counsellor: 'own',
        operations_manager: 'all',
        director: 'all',
        auditor: 'all',
        academic_coordinator: 'all',
        teacher: 'own',
      },
    ],
    ['ops:tasks:import', { operations_manager: 'all' }],
  ] as const)('%s is held by exactly %j', (permission, expected) => {
    expect(holders(permission)).toEqual(expected);
  });
});
