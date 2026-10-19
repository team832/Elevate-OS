import type { ModuleKey, RoleKey, UserId } from '@elevate/shared-types';

/**
 * Permission strings are `<module>:<resource>:<action>` (D-008), e.g.
 * `academic:attendance:record`. Actions named `read` or `access` are
 * read-only by convention; the auditor role may hold nothing else.
 */
export type PermissionString = `${ModuleKey}:${string}:${string}`;

export interface PermissionDefinition<P extends PermissionString = PermissionString> {
  readonly key: P;
  readonly description: string;
}

/**
 * Record-level scope of a grant:
 * - `all`: every record the permission covers
 * - `own`: only records the user is responsible for (e.g. a teacher's own
 *   assignments). The module enforces it with `scopeFor()` in its queries.
 */
export type GrantScope = 'all' | 'own';

export type Grant<P extends PermissionString = PermissionString> =
  P | { readonly permission: P; readonly scope: GrantScope };

/** What a module's permission file exports. */
export interface ModulePermissions<P extends PermissionString = PermissionString> {
  readonly module: ModuleKey;
  readonly permissions: readonly PermissionDefinition<P>[];
  readonly grants: Partial<Record<RoleKey, readonly Grant<P>[]>>;
}

/** The authenticated user as RBAC sees it. */
export interface Principal {
  readonly id: UserId;
  readonly roles: readonly RoleKey[];
}

export function definePermissions<const P extends PermissionString>(
  spec: ModulePermissions<P>,
): ModulePermissions<P> {
  for (const p of spec.permissions) {
    if (!p.key.startsWith(`${spec.module}:`)) {
      throw new Error(`Permission "${p.key}" must start with "${spec.module}:"`);
    }
    if (!/^[a-z]+:[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/.test(p.key)) {
      throw new Error(
        `Permission "${p.key}" must be <module>:<resource>:<action> in lower snake case`,
      );
    }
  }
  return spec;
}
