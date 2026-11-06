/**
 * Student and parent portal logins (F4-13). A portal login is `<login>@portal.invalid`: not an
 * address, refused by every staff way in (isAllowedEmail), and accepted only by
 * `validatePortalSession`, which the portal reads from its own cookie. Staff give access from the
 * student record and print a one-time 8-character setup code; only
 * HMAC-SHA256(SESSION_SECRET, "portal-setup|" + code) is stored (core.portal_setup_codes).
 */
import { createHmac, randomInt } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { portalSetupCodes, users, type Database } from '@elevate/database';
import { ROLE_KEYS, type RoleKey, type UserId } from '@elevate/shared-types';
import { hashPassword } from './password';
import { getSessionSecret, revokeAllSessionsForUser, validateSession } from './sessions';

export const PORTAL_EMAIL_DOMAIN = 'portal.invalid';
/** Not the staff cookie: signing in to the portal never replaces or opens a staff session. */
export const PORTAL_COOKIE = 'elevate_portal';
export const SETUP_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** No 0/O or 1/I/L: the code is read off a paper slip. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const PORTAL_ROLE_KEYS: readonly RoleKey[] = ['student', 'guardian'];
/** Roles a staff account may hold: portal roles are given only from the student record. */
export const STAFF_ROLE_KEYS = ROLE_KEYS.filter((r) => !PORTAL_ROLE_KEYS.includes(r));

export const portalEmail = (login: string) => `${login}@${PORTAL_EMAIL_DOMAIN}`;
export const isPortalEmail = (email: string) => /^[^@\s]+@portal\.invalid$/.test(email);

export const generateSetupCode = () =>
  Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
/** What a person types: any case, spaces or dashes ("abcd-efgh"). */
export const normaliseSetupCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, '');
export const hashSetupCode = (code: string, secret = getSessionSecret()) =>
  createHmac('sha256', secret).update(`portal-setup|${code}`).digest('hex');

/**
 * Revoke the login's live code and issue a new one, in the caller's transaction. The raw code is
 * returned once (for the slip) and never stored or logged.
 */
export async function issueSetupCode(
  tx: Database,
  input: { userId: UserId; createdBy: UserId; now?: Date },
): Promise<{ code: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  await revokeSetupCodes(tx, input.userId, now);
  const code = generateSetupCode();
  const expiresAt = new Date(now.getTime() + SETUP_CODE_TTL_MS);
  await tx.insert(portalSetupCodes).values({
    userId: input.userId,
    codeHash: hashSetupCode(code),
    expiresAt,
    createdBy: input.createdBy,
    createdAt: now,
  });
  return { code, expiresAt };
}

export const revokeSetupCodes = (tx: Database, userId: UserId, now = new Date()) =>
  tx
    .update(portalSetupCodes)
    .set({ revokedAt: now })
    .where(
      and(
        eq(portalSetupCodes.userId, userId),
        isNull(portalSetupCodes.usedAt),
        isNull(portalSetupCodes.revokedAt),
      ),
    );

/**
 * Use a setup code once, in the caller's transaction: set the login's password and end its
 * sessions. The code must belong to `login` (typed beside it, so guesses are counted per login).
 * Null for an unknown login, or an unknown, used, revoked or expired code: the caller says the
 * same for all. The password is hashed first, so every attempt costs the same time.
 */
export async function redeemSetupCode(
  tx: Database,
  input: { login: string; code: string; password: string; now?: Date },
): Promise<UserId | null> {
  const now = input.now ?? new Date();
  const passwordHash = await hashPassword(input.password);
  const [used] = await tx
    .update(portalSetupCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(portalSetupCodes.codeHash, hashSetupCode(normaliseSetupCode(input.code))),
        inArray(
          portalSetupCodes.userId,
          tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, portalEmail(input.login))),
        ),
        isNull(portalSetupCodes.usedAt),
        isNull(portalSetupCodes.revokedAt),
        gt(portalSetupCodes.expiresAt, now),
      ),
    )
    .returning({ userId: portalSetupCodes.userId });
  if (!used) return null;
  await tx.update(users).set({ passwordHash }).where(eq(users.id, used.userId));
  await revokeAllSessionsForUser(tx, used.userId, now);
  return used.userId;
}

/**
 * The portal login behind a raw portal-cookie token; never a staff account. Only its portal roles
 * count, so a portal session can hold nothing but `platform:portal:access`.
 */
export async function validatePortalSession(
  db: Database,
  token: string | null | undefined,
  secret: string,
  now: Date = new Date(),
) {
  const user = await validateSession(db, token, secret, now, isPortalEmail);
  return user && { ...user, roles: user.roles.filter((r) => PORTAL_ROLE_KEYS.includes(r)) };
}
