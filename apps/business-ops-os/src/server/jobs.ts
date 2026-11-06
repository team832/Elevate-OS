/**
 * The Ops jobs (D-117; fee reminders F4-04), shared by the "Run now" route and the background
 * runner (D-133). Every job is idempotent. `ops:jobs:run` is checked by the route for the person pressing, and by the
 * runner for the person a job runs as. Each run is recorded in the audit trail as `job.ran` with
 * its start, finish and outcome: that is the "last run".
 */
import { and, desc, eq, like } from 'drizzle-orm';
import { auditEvents, opsSettings, users, type Database } from '@elevate/database';
import { InternalError } from '@elevate/shared-contracts';
import { recordAudit, toAppError } from '@elevate/server-kit';
import { resolveSettings, type SettingKey } from '../domain';
import { accessScope, type Actor } from './context';
import { syncDemosFromAcademic } from './demos';
import { runFeeReminders } from './fee-defaulters';
import { processEnrolmentReplies } from './enrolment';
import { runFollowUpReminders } from './follow-ups';
import { runHousekeeping } from './housekeeping';
import { OPS_JOBS } from './schemas';
import { sendEnrolmentExits } from './student-lifecycle';
import { runTaskReminders } from './task-reminders';

export type OpsJob = (typeof OPS_JOBS)[number];
type Run = (db: Database, actor: Actor, requestId: string) => Promise<unknown>;

const JOB_RUNS: Record<OpsJob, Run> = {
  'follow-up-reminders': (db, actor, requestId) => runFollowUpReminders(db, { actor, requestId }),
  'enrolment-replies': (db, actor) => processEnrolmentReplies(db, { actor }),
  'demo-academic-marks': (db, actor, requestId) => syncDemosFromAcademic(db, actor, requestId),
  'task-reminders': (db, actor, requestId) => runTaskReminders(db, { actor, requestId }),
  'enrolment-exits': (_db, actor) => sendEnrolmentExits(actor),
  housekeeping: (db, actor, requestId) => runHousekeeping(db, actor, requestId),
  'fee-reminders': (db, actor, requestId) => runFeeReminders(db, { actor, requestId }),
};

export const jobKey = (job: OpsJob) => `jobs.${job}` satisfies SettingKey;

/** A job still running after this is recorded as failed (it may still finish), so one hang cannot block the runner. */
export const JOB_TIME_LIMIT_MS = 10 * 60_000;

/** Run a job as whoever `actorOf` names and record how it went; a failure is recorded, then rethrown. */
export async function runJob(
  db: Database,
  job: OpsJob,
  requestId: string,
  actorOf: () => Promise<Actor>,
  limitMs = JOB_TIME_LIMIT_MS,
) {
  const startedAt = new Date();
  let actor: Actor | undefined;
  const record = (after: object) =>
    recordAudit(db, {
      actorUserId: actor?.id ?? null,
      module: 'ops',
      action: 'job.ran',
      entityType: 'job',
      entityId: job,
      requestId,
      after: { startedAt, finishedAt: new Date(), ...after },
    });
  const run = async () => {
    actor = await actorOf();
    return JOB_RUNS[job](db, actor, requestId);
  };
  let result: unknown;
  let timer: NodeJS.Timeout | undefined;
  try {
    result = await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new InternalError(
                'Timed out. It may still finish: check its results before running it again.',
              ),
            ),
          limitMs,
        ).unref();
      }),
    ]);
  } catch (error) {
    await record({ outcome: 'failed', message: toAppError(error).message });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  await record({ outcome: 'done', result });
  return result;
}

/** The job settings as stored, with who saved each (a switched-on job runs as that person). */
export async function jobSettingRows(db: Database) {
  const rows = await db
    .select({ row: opsSettings, by: users.displayName })
    .from(opsSettings)
    .leftJoin(users, eq(users.id, opsSettings.updatedBy))
    .where(like(opsSettings.key, 'jobs.%'));
  const settings = resolveSettings(rows.map((r) => r.row));
  return OPS_JOBS.map((job) => {
    const stored = rows.find((r) => r.row.key === jobKey(job));
    return {
      job,
      setting: settings[jobKey(job)],
      userId: stored?.row.updatedBy ?? null,
      by: stored?.by ?? null,
    };
  });
}

export interface JobView {
  job: OpsJob;
  label: string;
  description: string;
  enabled: boolean;
  everyMinutes: number;
  runsAs: string | null;
  lastRun: {
    at: Date | string;
    outcome: 'done' | 'failed';
    message?: string;
    result?: unknown;
  } | null;
}

/** Each job's switch, interval, account and last run, for Settings → Background jobs. */
export async function listJobs(db: Database, actor: Actor): Promise<JobView[]> {
  await accessScope(db, actor, 'ops:settings:read');
  const runs = await db
    .selectDistinctOn([auditEvents.entityId], {
      job: auditEvents.entityId,
      at: auditEvents.at,
      after: auditEvents.after,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, 'job'), eq(auditEvents.action, 'job.ran')))
    .orderBy(auditEvents.entityId, desc(auditEvents.at));
  return (await jobSettingRows(db)).map(({ job, setting, by }) => {
    const run = runs.find((r) => r.job === job);
    return {
      job,
      label: setting.label,
      description: setting.description,
      ...setting.value,
      runsAs: setting.value.enabled ? by : null,
      lastRun: run
        ? { at: run.at, ...(run.after as Omit<NonNullable<JobView['lastRun']>, 'at'>) }
        : null,
    };
  });
}
