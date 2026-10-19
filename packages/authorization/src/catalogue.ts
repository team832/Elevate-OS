import { ForbiddenError } from '@elevate/shared-contracts';
import {
  MODULE_KEYS,
  ROLE_KEYS,
  type ModuleKey,
  type RoleKey,
  type UserId,
} from '@elevate/shared-types';
import { academicPermissions, type AcademicPermission } from './permissions/academic';
import { marketingPermissions, type MarketingPermission } from './permissions/marketing';
import { opsPermissions, type OpsPermission } from './permissions/ops';
import { platformPermissions, type PlatformPermission } from './permissions/platform';
import { READ_ONLY_ACTIONS } from './roles';
import type {
  Grant,
  GrantScope,
  ModulePermissions,
  PermissionDefinition,
  PermissionString,
  Principal,
} from './types';

/** Every permission key known to Elevate OS (union of the four module files). */
export type Permission =
  PlatformPermission | MarketingPermission | AcademicPermission | OpsPermission;

export const PERMISSION_FILES: readonly ModulePermissions[] = [
  platformPermissions,
  marketingPermissions,
  academicPermissions,
  opsPermissions,
];

const definitions = new Map<string, PermissionDefinition & { module: ModuleKey }>();
const roleGrants = new Map<RoleKey, Map<string, GrantScope>>();

function grantParts(grant: Grant): { permission: PermissionString; scope: GrantScope } {
  return typeof grant === 'string' ? { permission: grant, scope: 'all' } : grant;
}

function isReadOnly(permission: string): boolean {
  const action = permission.split(':')[2] ?? '';
  return (READ_ONLY_ACTIONS as readonly string[]).includes(action);
}

// Build and validate the catalogue once at import time. Mistakes fail fast.
for (const file of PERMISSION_FILES) {
  for (const def of file.permissions) {
    if (definitions.has(def.key)) throw new Error(`Permission "${def.key}" is declared twice`);
    definitions.set(def.key, { ...def, module: file.module });
  }
}
for (const role of ROLE_KEYS) roleGrants.set(role, new Map());
for (const file of PERMISSION_FILES) {
  for (const [role, grants] of Object.entries(file.grants) as [RoleKey, readonly Grant[]][]) {
    const target = roleGrants.get(role);
    if (!target) throw new Error(`Unknown role "${role}" in ${file.module} permissions`);
    for (const grant of grants) {
      const { permission, scope } = grantParts(grant);
      const def = definitions.get(permission);
      if (!def) throw new Error(`Role "${role}" is granted undeclared permission "${permission}"`);
      if (def.module !== file.module) {
        throw new Error(
          `${file.module} permissions may only grant ${file.module}:* (found "${permission}")`,
        );
      }
      if (role === 'auditor' && !isReadOnly(permission)) {
        throw new Error(`The auditor role is read-only and cannot hold "${permission}"`);
      }
      if (
        role !== 'platform_admin' &&
        (permission === 'platform:users:manage' || permission === 'platform:roles:manage')
      ) {
        throw new Error(`Only platform_admin may hold "${permission}"`);
      }
      // The broadest scope wins when a role is granted the same permission twice.
      if (target.get(permission) !== 'all') target.set(permission, scope);
    }
  }
}

export function isPermission(value: string): value is Permission {
  return definitions.has(value);
}

export function listPermissions(): readonly (PermissionDefinition & { module: ModuleKey })[] {
  return [...definitions.values()];
}

/** Permissions (with scope) granted to a role. */
export function grantsForRole(role: RoleKey): ReadonlyMap<Permission, GrantScope> {
  return (roleGrants.get(role) ?? new Map()) as ReadonlyMap<Permission, GrantScope>;
}

/**
 * The scope the principal holds for a permission: `all`, `own`, or null when
 * not granted. Unknown role strings are ignored (deny by default).
 */
export function scopeFor(
  principal: Principal | null | undefined,
  permission: Permission,
): GrantScope | null {
  if (!principal) return null;
  let result: GrantScope | null = null;
  for (const role of principal.roles) {
    const scope = roleGrants.get(role)?.get(permission);
    if (scope === 'all') return 'all';
    if (scope === 'own') result = 'own';
  }
  return result;
}

/** True when the principal holds the permission at any scope. */
export function can(principal: Principal | null | undefined, permission: Permission): boolean {
  return scopeFor(principal, permission) !== null;
}

/** Throw FORBIDDEN unless the principal holds the permission; returns the scope held. */
export function requirePermission(
  principal: Principal | null | undefined,
  permission: Permission,
): GrantScope {
  const scope = scopeFor(principal, permission);
  if (scope === null) {
    throw new ForbiddenError('You do not have permission to do this.', { details: { permission } });
  }
  return scope;
}

/** All permissions the principal holds, with the broadest scope. */
export function permissionsFor(
  principal: Principal | null | undefined,
): ReadonlyMap<Permission, GrantScope> {
  const out = new Map<Permission, GrantScope>();
  for (const role of principal?.roles ?? []) {
    for (const [permission, scope] of roleGrants.get(role) ?? []) {
      if (out.get(permission as Permission) !== 'all') out.set(permission as Permission, scope);
    }
  }
  return out;
}

/** Modules whose `<module>:module:access` the principal holds, in display order. */
export function modulesFor(principal: Principal | null | undefined): ModuleKey[] {
  return MODULE_KEYS.filter((m) => can(principal, `${m}:module:access` as Permission));
}

/**
 * Record-level scoping hook. Pick the query/filter for the scope the principal
 * holds; throws FORBIDDEN when the permission is not held at all.
 *
 *   const where = scopedValue(user, 'academic:assignments:read', {
 *     all: () => undefined,
 *     own: (userId) => eq(academicAssignments.teacherUserId, userId),
 *   });
 */
export function scopedValue<T>(
  principal: Principal | null | undefined,
  permission: Permission,
  branches: { all: () => T; own: (userId: UserId) => T },
): T {
  const scope = requirePermission(principal, permission);
  // requirePermission throws when principal is missing, so it is defined here.
  return scope === 'all' ? branches.all() : branches.own((principal as Principal).id);
}

/** True when the principal may act on a record owned by `ownerUserIds` under this permission. */
export function canAccessRecord(
  principal: Principal | null | undefined,
  permission: Permission,
  record: { ownerUserIds: readonly (UserId | null | undefined)[] },
): boolean {
  const scope = scopeFor(principal, permission);
  if (scope === 'all') return true;
  if (scope === 'own' && principal) return record.ownerUserIds.includes(principal.id);
  return false;
}
