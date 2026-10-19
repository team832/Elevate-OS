import { can, requirePermission, type Permission, type Principal } from '@elevate/authorization';

/** The acting user as services see it (an AuthenticatedUser satisfies it). */
export type Actor = Principal & { displayName?: string };

/**
 * Defence in depth: every mutating service re-checks the permission even though routes
 * (defineRoute) and server actions already did. Throws FORBIDDEN (403).
 */
export function assertCan(actor: Actor, permission: Permission): void {
  requirePermission(actor, permission);
}

export function actorCan(actor: Actor | null | undefined, permission: Permission): boolean {
  return can(actor ?? null, permission);
}
