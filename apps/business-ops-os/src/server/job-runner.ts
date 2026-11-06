/**
 * Background runner (D-133): once a minute, each switched-on job whose slot has started runs once,
 * however many Ops processes tick. The slot is claimed as a row in core.idempotency_keys (scope
 * `job:<name>`, key = slot start); the unique index lets one claim win. Started from instrumentation.ts.
 */
import { eq } from 'drizzle-orm';
import { loadRoles } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb, idempotencyKeys, users, type Database } from '@elevate/database';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { UserId } from '@elevate/shared-types';
import { createLogger } from '@elevate/server-kit';
import { jobSlot } from '../domain';
import type { Actor } from './context';
import { JOB_TIME_LIMIT_MS, jobSettingRows, runJob, type OpsJob } from './jobs';

const log = createLogger({ component: 'job-runner' });

/** A switched-on job runs as the person who switched it on, only while they may still run jobs. */
async function switchedOnBy(db: Database, userId: UserId | null): Promise<Actor> {
  const [user] = userId
    ? await db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, userId))
    : [];
  const actor =
    user?.status === 'active' ? { id: user.id, roles: await loadRoles(db, user.id) } : null;
  if (!actor || !can(actor, 'ops:jobs:run'))
    throw new ForbiddenError(
      'The person who switched this job on can no longer run jobs. Switch it on again.',
    );
  return actor;
}

/** Run every switched-on job whose current slot nobody has claimed yet; returns the jobs started. */
export async function runDueJobs(
  db: Database,
  now = new Date(),
  limitMs = JOB_TIME_LIMIT_MS,
): Promise<OpsJob[]> {
  const started: OpsJob[] = [];
  for (const { job, setting, userId } of await jobSettingRows(db)) {
    const { enabled, everyMinutes } = setting.value;
    if (!enabled) continue;
    const slot = jobSlot(now, everyMinutes);
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({
        scope: `job:${job}`,
        key: slot.toISOString(),
        userId: null,
        requestHash: 'scheduled',
        expiresAt: new Date(slot.getTime() + everyMinutes * 60_000),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (!claimed) continue;
    started.push(job);
    await runJob(
      db,
      job,
      `job:${job}:${slot.toISOString()}`,
      () => switchedOnBy(db, userId),
      limitMs,
    ).catch((error: unknown) => log.warn('background job failed', { job, error }));
  }
  return started;
}

const RUNNER = Symbol.for('elevate.ops.job-runner');

/** Tick about once a minute (with jitter) for the life of the process; a second call does nothing. */
export function startJobRunner() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[RUNNER]) return;
  g[RUNNER] = true;
  const tick = async () => {
    // Next tick first, so neither a throw nor a hang here can stop the runner.
    setTimeout(tick, 60_000 + Math.random() * 10_000).unref();
    try {
      await runDueJobs(getDb());
    } catch (error) {
      log.error('background jobs tick failed', { error });
    }
  };
  setTimeout(tick, 60_000).unref();
}
