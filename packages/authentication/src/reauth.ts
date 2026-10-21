import { eq } from 'drizzle-orm';
import { users, type Database } from '@elevate/database';
import type { UserId } from '@elevate/shared-types';
import { isAllowedEmail } from './email-domain';
import { burnVerificationTime, verifyPassword } from './password';
import { LoginThrottle } from './throttle';

export type ReauthResult =
  | { ok: true; method: 'password'; verifiedAt: Date }
  | {
      ok: false;
      reason: 'wrong_password' | 'no_password' | 'locked' | 'inactive';
      retryAfterMs?: number;
    };

// Separate from the login throttle: 5 failures / 15 min per user → 15 min lock (in memory, see throttle.ts).
const reauthThrottle = new LoginThrottle();

/**
 * Fresh password re-check of an already signed-in user (D-041, e.g. confirming an admission).
 * Selects by user id, never by a client-supplied email. The password is never logged, returned or stored.
 * Google-only accounts have no hash → `no_password` after the same scrypt time as a real check.
 */
export async function verifyCurrentUserPassword(
  db: Database,
  userId: UserId,
  password: string,
): Promise<ReauthResult> {
  const key = `reauth|${userId}`;
  const locked = reauthThrottle.retryAfterMs(key);
  if (locked > 0) return { ok: false, reason: 'locked', retryAfterMs: locked };

  const [user] = await db
    .select({ email: users.email, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const ok = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : await burnVerificationTime(password).then(() => false);
  if (!user || user.status !== 'active' || !isAllowedEmail(user.email))
    return { ok: false, reason: 'inactive' };
  if (!user.passwordHash) return { ok: false, reason: 'no_password' };
  if (!ok) {
    reauthThrottle.recordFailure(key);
    const retryAfterMs = reauthThrottle.retryAfterMs(key);
    return retryAfterMs > 0
      ? { ok: false, reason: 'locked', retryAfterMs }
      : { ok: false, reason: 'wrong_password' };
  }
  reauthThrottle.reset(key);
  return { ok: true, method: 'password', verifiedAt: new Date() };
}
