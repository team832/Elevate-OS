import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { sessions, userRoles, users, type Database } from '@elevate/database';
import { isRoleKey, type RoleKey, type SessionId, type UserId } from '@elevate/shared-types';
import { isAllowedEmail } from './email-domain';

/** Default session lifetime: 7 days (absolute; not extended by activity). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How often `last_seen_at` is refreshed (avoids a write on every request). */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

/** The signed-in user as every app sees it. Also an authorization `Principal`. */
export interface AuthenticatedUser {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly RoleKey[];
  readonly sessionId: SessionId;
  /** Remembered default workspace (D-072); trust it only while the roles still grant it. */
  readonly preferredWorkspace?: string | null;
}

/** HMAC the raw token with SESSION_SECRET; only this digest is stored. */
export function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateSessionInput {
  userId: UserId;
  secret: string;
  ttlMs?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
}

/** Create a session row and return the raw token (put it in the cookie, never store it). */
export async function createSession(
  db: Database,
  input: CreateSessionInput,
): Promise<{ token: string; sessionId: SessionId; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? SESSION_TTL_MS));
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashSessionToken(token, input.secret),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('session insert returned no row');
  return { token, sessionId: row.id, expiresAt };
}

/** Load a user's roles (unknown role strings in the table are ignored). */
export async function loadRoles(db: Database, userId: UserId): Promise<RoleKey[]> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows
    .map((r) => r.role)
    .filter(isRoleKey)
    .sort();
}

/**
 * Resolve a raw session token to the signed-in user. Returns null when the
 * token is unknown, expired, revoked, or the user is disabled.
 */
export async function validateSession(
  db: Database,
  token: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): Promise<AuthenticatedUser | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = hashSessionToken(token, secret);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      preferredWorkspace: users.preferredWorkspace,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  if (row.status !== 'active') return null;
  if (!isAllowedEmail(row.email)) return null; // D-030: a non-organisation account never has a live session

  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  const roles = await loadRoles(db, row.userId);
  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
    roles,
    sessionId: row.sessionId,
    preferredWorkspace: row.preferredWorkspace,
  };
}

/** Revoke the session behind a raw token. Returns the session id when one was revoked. */
export async function revokeSessionByToken(
  db: Database,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<SessionId | null> {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token, secret)), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return row?.id ?? null;
}

/** Revoke every active session of a user (e.g. after a password reset or when disabling them). */
export async function revokeAllSessionsForUser(
  db: Database,
  userId: UserId,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/** Delete sessions that expired or were revoked more than `olderThanMs` ago (housekeeping). */
export async function purgeOldSessions(
  db: Database,
  olderThanMs = 30 * 24 * 60 * 60 * 1000,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const rows = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, cutoff),
        and(sql`${sessions.revokedAt} IS NOT NULL`, lt(sessions.revokedAt, cutoff)),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}
