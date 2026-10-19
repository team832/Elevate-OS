/**
 * Field-level access for HR records (D-028, OPS-037). Builds on `hrScope`
 * (server/hr-scope.ts) with one deliberate narrowing: for the SENSITIVE sets
 * (private HR fields, employment documents) an `own` grant means the user's own
 * record ONLY — never their reporting chain, even when the user is also a
 * department manager. Compensation has no `own` grants at all.
 */
import { can, requirePermission, type Permission } from '@elevate/authorization';
import type { Database } from '@elevate/database';
import { ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { employeeFieldTiers } from '../../domain/hr/employees';
import { staffIdForUser, type Actor } from '../context';
import { hrCovers, hrScope, type HrScope } from '../hr-scope';

/** 400 with a field path, as the route validators produce. */
export const invalidField = (path: string, message: string) =>
  new ValidationError(message, { details: [{ location: 'body', path: [path], message }] });

/** `%q%` for ILIKE with the wildcard characters escaped. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Permission check; `own` = the user's own staff record only. Throws FORBIDDEN when not held. */
export async function selfOrAllScope(
  db: Database,
  actor: Actor,
  permission: Permission,
): Promise<HrScope> {
  const granted = requirePermission(actor, permission);
  const staffId = await staffIdForUser(db, actor.id);
  if (granted === 'all') return { scope: 'all', staffId };
  return {
    scope: 'own',
    staffId,
    staffIds: new Set<StaffMemberId>(staffId ? [staffId] : []),
  };
}

/** Like `hrScope` / `selfOrAllScope` but returns null instead of throwing when not held. */
export async function optionalScope(
  db: Database,
  actor: Actor,
  permission: Permission,
  own: 'chain' | 'self',
): Promise<HrScope | null> {
  if (!can(actor, permission)) return null;
  return own === 'chain' ? hrScope(db, actor, permission) : selfOrAllScope(db, actor, permission);
}

export interface EmployeeVisibility {
  staffId: StaffMemberId | null;
  canManage: boolean;
  lifecycle: HrScope | null;
  private: HrScope | null;
  tiers(staffId: string): { record: boolean; private: boolean };
}

/** What the actor may see on employee records (A-HR-01). */
export async function employeeVisibility(db: Database, actor: Actor): Promise<EmployeeVisibility> {
  const [staffId, manage, lifecycle, priv] = await Promise.all([
    staffIdForUser(db, actor.id),
    optionalScope(db, actor, 'ops:employees:manage', 'chain'),
    optionalScope(db, actor, 'ops:lifecycle:read', 'chain'),
    optionalScope(db, actor, 'ops:employee_private:read', 'self'),
  ]);
  return {
    staffId,
    canManage: manage?.scope === 'all',
    lifecycle,
    private: priv,
    tiers: (id: string) =>
      employeeFieldTiers({
        isSelf: Boolean(staffId) && staffId === id,
        canManage: manage ? hrCovers(manage, id) : false,
        lifecycleCovers: lifecycle ? hrCovers(lifecycle, id) : false,
        privateCovers: priv ? hrCovers(priv, id) : false,
      }),
  };
}
