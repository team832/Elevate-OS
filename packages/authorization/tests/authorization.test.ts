import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '@elevate/shared-contracts';
import { ROLE_KEYS, asId, type RoleKey, type UserId } from '@elevate/shared-types';
import {
  can,
  canAccessRecord,
  grantsForRole,
  listPermissions,
  modulesFor,
  permissionsFor,
  renderPermissionMatrix,
  requirePermission,
  scopeFor,
  scopedValue,
  type Principal,
} from '../src/index';

const id = (n: number) => asId<UserId>(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const as = (...roles: RoleKey[]): Principal => ({ id: id(1), roles });

describe('can / requirePermission', () => {
  it('grants by role and denies by default', () => {
    expect(can(as('marketing_manager'), 'marketing:content:approve')).toBe(true);
    expect(can(as('marketing_contributor'), 'marketing:content:approve')).toBe(false);
    expect(can(as(), 'platform:module:access')).toBe(false);
    expect(can(null, 'platform:module:access')).toBe(false);
  });

  it('requirePermission throws a FORBIDDEN AppError', () => {
    expect(() => requirePermission(as('teacher'), 'academic:batches:write')).toThrow(
      ForbiddenError,
    );
    try {
      requirePermission(undefined, 'ops:leads:read');
    } catch (e) {
      expect((e as ForbiddenError).code).toBe('FORBIDDEN');
      expect((e as ForbiddenError).status).toBe(403);
    }
    expect(requirePermission(as('academic_coordinator'), 'academic:batches:write')).toBe('all');
  });

  it('unions grants across multiple roles with the broadest scope', () => {
    const p = as('teacher', 'academic_coordinator');
    expect(scopeFor(p, 'academic:assignments:read')).toBe('all');
    expect(can(p, 'academic:batches:write')).toBe(true);
  });

  it('ignores unknown role strings (deny by default)', () => {
    const p = { id: id(1), roles: ['superuser' as RoleKey] };
    expect(permissionsFor(p).size).toBe(0);
  });
});

describe('least privilege', () => {
  it('auditor is read-only everywhere', () => {
    const granted = [...grantsForRole('auditor').keys()];
    expect(granted.length).toBeGreaterThan(0);
    for (const permission of granted) {
      expect(permission).toMatch(/:(read|access)$/);
    }
    expect(can(as('auditor'), 'marketing:content:write')).toBe(false);
    expect(can(as('auditor'), 'ops:leads:write')).toBe(false);
    expect(can(as('auditor'), 'academic:attendance:record')).toBe(false);
    expect(can(as('auditor'), 'platform:users:manage')).toBe(false);
  });

  it('only platform_admin administers users and roles', () => {
    for (const role of ROLE_KEYS) {
      const expected = role === 'platform_admin';
      expect(can(as(role), 'platform:users:manage')).toBe(expected);
      expect(can(as(role), 'platform:roles:manage')).toBe(expected);
    }
  });

  it('platform_admin has no business-record access by default', () => {
    expect(modulesFor(as('platform_admin'))).toEqual(['platform']);
  });

  it('teacher sees only own assignments (record-level scope)', () => {
    const teacher: Principal = { id: id(7), roles: ['teacher'] };
    expect(scopeFor(teacher, 'academic:assignments:read')).toBe('own');
    expect(canAccessRecord(teacher, 'academic:assignments:read', { ownerUserIds: [id(7)] })).toBe(
      true,
    );
    expect(canAccessRecord(teacher, 'academic:assignments:read', { ownerUserIds: [id(8)] })).toBe(
      false,
    );
    const filter = scopedValue(teacher, 'academic:assignments:read', {
      all: () => 'ALL',
      own: (userId) => `teacher=${userId}`,
    });
    expect(filter).toBe(`teacher=${id(7)}`);
    expect(() =>
      scopedValue(teacher, 'academic:assignments:write', { all: () => 'ALL', own: () => 'OWN' }),
    ).toThrow(ForbiddenError);
  });
});

describe('Business Ops approval and acknowledgement grants', () => {
  const holders = (permission: Parameters<typeof can>[1]) =>
    ROLE_KEYS.filter((r) => can(as(r), permission)).sort();
  it.each([
    ['ops:compensation:approve', ['finance_officer', 'hr_manager']],
    ['ops:policies:approve', ['director', 'hr_manager', 'operations_manager']],
    [
      'ops:sops:acknowledge',
      ROLE_KEYS.filter((r) => r !== 'auditor' && can(as(r), 'ops:sops:read')).sort(),
    ],
  ] as const)('%s is held by exactly %j', (permission, roles) => {
    expect(holders(permission)).toEqual([...roles]);
  });

  it('department managers read recruitment only for their interview panels (own)', () => {
    expect(scopeFor(as('department_manager'), 'ops:recruitment:read')).toBe('own');
  });
});

describe('modulesFor', () => {
  it('lists the modules a user can open', () => {
    expect(modulesFor(as('director'))).toEqual(['platform', 'marketing', 'academic', 'ops']);
    expect(modulesFor(as('teacher'))).toEqual(['platform', 'academic']);
    expect(modulesFor(as('admissions_counsellor'))).toEqual(['platform', 'ops']);
    expect(modulesFor(as('auditor'))).toEqual(['platform', 'marketing', 'academic', 'ops']);
  });
});

describe('catalogue', () => {
  it('every permission follows <module>:<resource>:<action>', () => {
    for (const p of listPermissions()) {
      expect(p.key).toMatch(/^(platform|marketing|academic|ops):[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/);
      expect(p.key.startsWith(`${p.module}:`)).toBe(true);
    }
  });
  it('renders a role × permission matrix', () => {
    const md = renderPermissionMatrix();
    expect(md).toContain('| `platform:users:manage` | ✓ |');
    expect(md).toContain('own');
  });
});
