import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, asId, type RoleKey, type UserId } from '@elevate/shared-types';
import { grantsForRole, scopeFor, type Permission } from '../src/index';

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
      },
    ],
    ['ops:tasks:import', { operations_manager: 'all' }],
    [
      'ops:student_reports:generate',
      { admissions_counsellor: 'own', operations_manager: 'all', director: 'all' },
    ],
  ] as const)('%s is held by exactly %j', (permission, expected) => {
    expect(holders(permission)).toEqual(expected);
  });
});

// Brief 23 Oct 2026 (HR for teachers and marketing staff). All Proposed.
const all = (...roles: RoleKey[]) => Object.fromEntries(roles.map((r) => [r, 'all']));
const own = (...roles: RoleKey[]) => Object.fromEntries(roles.map((r) => [r, 'own']));
const STAFF = [
  'admissions_counsellor',
  'academic_coordinator',
  'teacher',
  'marketing_manager',
  'marketing_contributor',
  'finance_officer',
] as const;
const LEADERS = ['operations_manager', 'director', 'auditor', 'hr_manager'] as const;

describe('HR grants', () => {
  it.each([
    ['ops:staff_private:read', all('hr_manager')],
    ['ops:staff_private:manage', all('hr_manager')],
    ['ops:teacher_feedback:read', all('operations_manager', 'hr_manager')],
    ['ops:teacher_feedback:manage', all('operations_manager', 'hr_manager')],
    ['ops:teacher_feedback:import', all('operations_manager', 'hr_manager')],
    ['ops:staff:manage', all('operations_manager', 'hr_manager')],
    ['ops:attendance:manage', all('operations_manager', 'hr_manager')],
    ['ops:hr_settings:manage', all('operations_manager', 'hr_manager')],
    ['ops:hr:read', all(...LEADERS)],
    ['ops:work_reports:read', all(...LEADERS)],
    ['ops:teaching_assignments:read', all(...LEADERS)],
    ['ops:attendance:read', { ...own(...STAFF), ...all(...LEADERS) }],
    ['ops:attendance:request', { ...own(...STAFF), ...all('operations_manager', 'hr_manager') }],
    ['ops:teacher_feedback_summaries:read', { ...own('teacher'), ...all(...LEADERS) }],
    [
      'ops:tasks:review',
      {
        ...own('director', 'academic_coordinator', 'marketing_manager'),
        ...all('operations_manager', 'hr_manager'),
      },
    ],
    [
      'ops:tasks:read',
      {
        ...own(...STAFF),
        ...all('operations_manager', 'director', 'auditor', 'hr_manager'),
      },
    ],
  ] as const)('%s is held by exactly %j', (permission, expected) => {
    expect(holders(permission)).toEqual(expected);
  });

  it('teachers and marketing roles hold only own-scope Ops grants and cannot open Ops', () => {
    for (const role of ['teacher', 'marketing_manager', 'marketing_contributor'] as const) {
      const grants = grantsForRole(role);
      expect(grants.has('ops:module:access')).toBe(false);
      const hr = [...grants].filter(([k]) =>
        /^ops:(hr|staff|attendance|teacher_feedback|work_reports)/.test(k),
      );
      expect(hr.every(([, scope]) => scope === 'own')).toBe(true);
    }
  });

  it('staff-private details stay out of every broad read (director, auditor, operations manager)', () => {
    for (const role of ['director', 'auditor', 'operations_manager'] as const) {
      expect(scopeFor(as(role), 'ops:staff_private:read')).toBeNull();
    }
  });
});
