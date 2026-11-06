import { createHmac } from 'node:crypto';
import { and, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { loginAttempts, type Database } from '@elevate/database';
import { getSessionSecret } from './sessions';

/**
 * Sign-in throttling shared by every app and process (owner step 4): after `maxFailures`
 * failed attempts for the same key within 15 minutes, further attempts are refused for
 * 15 minutes. One row per key in `core.login_attempts`, changed by single atomic statements.
 * The key is stored only as HMAC-SHA256(SESSION_SECRET, "<bucket>|<key>"); without
 * SESSION_SECRET every call throws, so sign-in is refused (fails closed).
 * The atomic count decides, not a prior read: idea from better-auth's database rate limiter (MIT).
 */
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

/** Failures allowed per bucket within the window (sign-in D-020, D-122; confirm re-check D-041; portal and website form Proposed, D-150, D-152). */
const LIMITS = {
  login: 5,
  'login-ip': 50,
  'login-email': 20,
  'google-ip': 50,
  reauth: 5,
  /** Portal (F4-13), Proposed: never the staff buckets, so a parent's typos never lock staff. */
  portal: 5, // per login and address
  'portal-ip': 50, // per address (sign-in and setup)
  'portal-login': 20, // per login, any address
  'portal-setup': 5, // per login: one login's code is not guessed from many addresses
  'portal-all': 500, // every portal sign-in failure (the address can be forged)
  'portal-setup-all': 200, // every setup failure
  /** Proposed (F4-15): website enquiry form posts per address. */
  'website-form': 5,
  'website-form-all': 300, // Proposed (F4-15): every website form post, any address
};
export type ThrottleBucket = keyof typeof LIMITS;

export class LoginThrottle {
  constructor(
    private readonly bucket: ThrottleBucket,
    private readonly maxFailures = LIMITS[bucket],
  ) {}

  private row(key: string) {
    return eq(loginAttempts.keyHash, this.hash(key));
  }

  private hash(key: string) {
    return createHmac('sha256', getSessionSecret()).update(`${this.bucket}|${key}`).digest('hex');
  }

  /** Milliseconds until the key may try again; 0 when allowed now. */
  async retryAfterMs(db: Database, key: string, now: number = Date.now()): Promise<number> {
    const [hit] = await db
      .select({ until: loginAttempts.lockedUntil })
      .from(loginAttempts)
      .where(and(this.row(key), gt(loginAttempts.lockedUntil, new Date(now))));
    return hit?.until ? hit.until.getTime() - now : 0;
  }

  /**
   * Count one failure (one upsert). False when it went past the limit, i.e. the attempt raced
   * past `retryAfterMs` while the key was being locked: the caller undoes it and refuses.
   */
  async recordFailure(db: Database, key: string, now: number = Date.now()): Promise<boolean> {
    const restart = sql`${loginAttempts.windowStartedAt} < ${new Date(now - WINDOW_MS).toISOString()}::timestamptz`;
    const failures = sql`CASE WHEN ${restart} THEN 1 ELSE ${loginAttempts.failures} + 1 END`;
    const lockEnd = new Date(now + LOCK_MS);
    const [counted] = await db
      .insert(loginAttempts)
      .values({
        keyHash: this.hash(key),
        failures: 1,
        windowStartedAt: new Date(now),
        lockedUntil: this.maxFailures <= 1 ? lockEnd : null,
        expiresAt: new Date(now + Math.max(WINDOW_MS, LOCK_MS)),
      })
      .onConflictDoUpdate({
        target: loginAttempts.keyHash,
        set: {
          failures,
          windowStartedAt: sql`CASE WHEN ${restart} THEN excluded.window_started_at ELSE ${loginAttempts.windowStartedAt} END`,
          lockedUntil: sql`CASE WHEN ${failures} >= ${this.maxFailures} THEN ${lockEnd.toISOString()}::timestamptz END`,
          expiresAt: sql`excluded.expires_at`,
        },
      })
      .returning({ failures: loginAttempts.failures });
    return counted!.failures <= this.maxFailures;
  }

  /** Take back one recorded failure: the attempt turned out not to be a wrong guess. */
  async undo(db: Database, key: string): Promise<void> {
    const mine = this.row(key);
    await db.delete(loginAttempts).where(and(mine, lte(loginAttempts.failures, 1)));
    await db
      .update(loginAttempts)
      .set({
        failures: sql`${loginAttempts.failures} - 1`,
        lockedUntil: sql`CASE WHEN ${loginAttempts.failures} > ${this.maxFailures} THEN ${loginAttempts.lockedUntil} END`,
      })
      .where(and(mine, gt(loginAttempts.failures, 1)));
  }

  async reset(db: Database, key: string): Promise<void> {
    await db.delete(loginAttempts).where(this.row(key));
  }
}

/** Housekeeping: delete counters whose window and lock are both over. Returns how many. */
export async function purgeExpiredLoginAttempts(db: Database, now = new Date()): Promise<number> {
  const gone = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.expiresAt, now))
    .returning({ keyHash: loginAttempts.keyHash });
  return gone.length;
}
