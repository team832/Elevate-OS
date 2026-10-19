/**
 * Login throttling: after `maxFailures` failed attempts for the same key
 * within `windowMs`, further attempts are refused for `lockMs`.
 *
 * KNOWN LIMITATION: state is in memory, per process. It resets when the app
 * restarts and is not shared between the four apps or between replicas. It
 * slows down online guessing against one app instance; it is not a complete
 * brute-force defence. A database- or proxy-backed limiter is needed before
 * exposing Elevate OS to the internet (see docs/SECURITY_AND_PERMISSIONS.md).
 */
export interface ThrottleOptions {
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  /** Upper bound on tracked keys (oldest are evicted). */
  maxKeys?: number;
}

interface Entry {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly maxKeys: number;

  constructor(options: ThrottleOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.lockMs = options.lockMs ?? 15 * 60 * 1000;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Milliseconds until the key may try again; 0 when allowed now. */
  retryAfterMs(key: string, now: number = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return entry.lockedUntil > now ? entry.lockedUntil - now : 0;
  }

  recordFailure(key: string, now: number = Date.now()): void {
    let entry = this.entries.get(key);
    if (!entry || now - entry.firstFailureAt > this.windowMs) {
      entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) entry.lockedUntil = now + this.lockMs;
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
