/**
 * Background jobs (D-133): each job is off until someone who runs jobs switches it on; a switched-on
 * job runs once per slot however many ticks race for it, as the person who switched it on, and every
 * run (button or schedule) is recorded with its outcome. Fictional data only.
 */
import { and, desc, eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEvents, idempotencyKeys, userRoles, users } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { POST as runRoute, PUT as saveRoute } from '../../src/app/api/v1/jobs/[job]/route';
import { PUT as settingRoute } from '../../src/app/api/v1/settings/[key]/route';
import { BackgroundJobs } from '../../src/app/settings/_components/background-jobs';
import { runDueJobs } from '../../src/server/job-runner';
import { listJobs, type JobView } from '../../src/server/jobs';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// Lets one test take ops:jobs:run away from a settings manager (no role has one without the other today).
const noJobsRun = vi.hoisted(() => ({ on: false }));
vi.mock('@elevate/authorization', async (load) => {
  const real = await load<typeof import('@elevate/authorization')>();
  return {
    ...real,
    requirePermission: (...[p, x]: Parameters<typeof real.requirePermission>) => {
      if (noJobsRun.on && x === 'ops:jobs:run') return real.requirePermission(null, x);
      return real.requirePermission(p, x);
    },
  };
});

// Lets one test make housekeeping hang.
const hang = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/server/housekeeping', async (load) => {
  const real = await load<typeof import('../../src/server/housekeeping')>();
  return {
    runHousekeeping: (...args: Parameters<typeof real.runHousekeeping>) =>
      hang.on ? new Promise<never>(() => {}) : real.runHousekeeping(...args),
  };
});

const ctx = setupTestDatabase();
let manager: StaffUser;
const path = (job: string) => `/ops/api/v1/jobs/${job}`;
const save = (user: { token: string }, job: string, value: unknown) =>
  callRoute(saveRoute, authedRequest(user, path(job), { method: 'PUT', json: { value } }), { job });
const runs = (job: string) =>
  ctx.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, 'job.ran'), eq(auditEvents.entityId, job)))
    .orderBy(desc(auditEvents.at));
const slot = (iso: string) => new Date(iso);

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
});
// Academic OS is never reached from these tests.
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('connection refused');
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('job settings (who may switch a job on)', () => {
  it('needs ops:jobs:run: 401 signed out, 403 for a director or teacher', async () => {
    const anon = buildRequest(path('housekeeping'), { method: 'PUT', json: { value: {} } });
    expect((await callRoute(saveRoute, anon, { job: 'housekeeping' })).status).toBe(401);
    for (const role of ['director', 'teacher'] as const) {
      const user = await createTestUser(ctx.db, { roles: [role] });
      expect((await save(user, 'housekeeping', { enabled: true, everyMinutes: 60 })).status).toBe(
        403,
      );
    }
  });

  it('refuses an interval under 5 minutes; saves and audits a valid one, as Proposed', async () => {
    expect((await save(manager, 'task-reminders', { enabled: true, everyMinutes: 1 })).status).toBe(
      400,
    );
    const r = await save(manager, 'task-reminders', { enabled: false, everyMinutes: 30 });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      value: { enabled: false, everyMinutes: 30 },
      decisionState: 'proposed',
    });
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'setting.changed'),
          eq(auditEvents.entityId, 'jobs.task-reminders'),
        ),
      );
    expect(audit?.actorUserId).toBe(manager.id);
  });

  it('the general settings route never switches a job for someone without ops:jobs:run', async () => {
    const put = (enabled: boolean) =>
      callRoute(
        settingRoute,
        authedRequest(manager, '/ops/api/v1/settings/x', {
          method: 'PUT',
          json: { value: { enabled, everyMinutes: 60 } },
        }),
        { key: 'jobs.housekeeping' },
      );
    noJobsRun.on = true;
    try {
      expect((await put(true)).status).toBe(403);
    } finally {
      noJobsRun.on = false;
    }
    expect((await put(false)).status).toBe(200);
  });
});

// Slots are in 2099: housekeeping purges claims that expired by the real clock, so past dates would be re-claimed.
describe('the runner', () => {
  it('a job that is off never runs and claims nothing', async () => {
    expect(await runDueJobs(ctx.db, slot('2099-11-06T04:30:00Z'))).toEqual([]);
    expect(
      await ctx.db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.scope, 'job:housekeeping')),
    ).toEqual([]);
  });

  it('two ticks at once run a switched-on job once per slot, as the person who switched it on', async () => {
    expect((await save(manager, 'housekeeping', { enabled: true, everyMinutes: 60 })).status).toBe(
      200,
    );
    const now = slot('2099-11-06T04:31:00Z');
    const ticks = await Promise.all([runDueJobs(ctx.db, now), runDueJobs(ctx.db, now)]);
    expect(ticks.flat()).toEqual(['housekeeping']);
    expect(await runDueJobs(ctx.db, slot('2099-11-06T04:59:00Z'))).toEqual([]);
    const [run, ...more] = await runs('housekeeping');
    expect(more).toEqual([]);
    expect(run).toMatchObject({ actorUserId: manager.id, after: { outcome: 'done' } });
    expect(await runDueJobs(ctx.db, slot('2099-11-06T05:30:00Z'))).toEqual(['housekeeping']);
  });

  it('a failure is recorded with a plain message and does not throw', async () => {
    await save(manager, 'enrolment-exits', { enabled: true, everyMinutes: 60 });
    expect(await runDueJobs(ctx.db, slot('2099-11-06T04:31:00Z'))).toContain('enrolment-exits');
    const [run] = await runs('enrolment-exits');
    expect(run?.after).toMatchObject({
      outcome: 'failed',
      message: expect.stringMatching(/could not be reached/),
    });
  });

  it('runs nothing as a person who can no longer sign in, and says why', async () => {
    const leaver = await staffUser(ctx.db, ['operations_manager']);
    await save(leaver, 'follow-up-reminders', { enabled: true, everyMinutes: 60 });
    await ctx.db.update(users).set({ status: 'disabled' }).where(eq(users.id, leaver.id));
    await runDueJobs(ctx.db, slot('2099-11-06T04:31:00Z'));
    const [run] = await runs('follow-up-reminders');
    expect(run?.after).toMatchObject({
      outcome: 'failed',
      message: expect.stringMatching(/switched this job on/),
    });
  });

  it('runs nothing as someone whose role was removed, and says why (REV-3 I1)', async () => {
    const moved = await staffUser(ctx.db, ['operations_manager']);
    await save(moved, 'housekeeping', { enabled: true, everyMinutes: 60 });
    await ctx.db.delete(userRoles).where(eq(userRoles.userId, moved.id));
    await runDueJobs(ctx.db, slot('2026-11-07T04:31:00Z'));
    const [run] = await runs('housekeeping');
    expect(run?.after).toMatchObject({
      outcome: 'failed',
      message: 'The person who switched this job on can no longer run jobs. Switch it on again.',
    });
  });

  it('a job that hangs is recorded as timed out, and the tick still finishes (REV-3 M5)', async () => {
    await save(manager, 'housekeeping', { enabled: true, everyMinutes: 60 });
    hang.on = true;
    try {
      expect(await runDueJobs(ctx.db, slot('2026-11-08T04:31:00Z'), 50)).toContain('housekeeping');
    } finally {
      hang.on = false;
    }
    const [run] = await runs('housekeeping');
    expect(run?.after).toMatchObject({
      outcome: 'failed',
      message: expect.stringMatching(/^Timed out/),
    });
  });
});

describe('Run now and the Settings section', () => {
  it('a button run is recorded as the last run', async () => {
    const r = await callRoute(
      runRoute,
      authedRequest(manager, path('task-reminders'), { method: 'POST' }),
      { job: 'task-reminders' },
    );
    expect(r.status).toBe(200);
    const job = (await listJobs(ctx.db, manager)).find((j) => j.job === 'task-reminders')!;
    expect(job).toMatchObject({ enabled: false, everyMinutes: 30, lastRun: { outcome: 'done' } });
  });

  it('listJobs needs ops:settings:read', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    await expect(listJobs(ctx.db, teacher)).rejects.toThrow();
  });

  const view = (over: Partial<JobView>): JobView => ({
    job: 'housekeeping',
    label: 'Clear expired sign-ins',
    description: 'Deletes old sign-ins.',
    enabled: false,
    everyMinutes: 1440,
    runsAs: null,
    lastRun: null,
    ...over,
  });

  it.each([
    ['off, never run', view({}), ['Off', 'Not run yet', 'Every 1440 minutes'], []],
    [
      'on, done',
      view({
        enabled: true,
        runsAs: 'Sample Manager',
        lastRun: { at: '2026-11-06T05:00:00Z', outcome: 'done', result: { sessions: 2 } },
      }),
      ['On', 'Runs as Sample Manager', 'Done', 'Sessions: 2', '6 Nov 2026'],
      ['Not run yet'],
    ],
    [
      'failed',
      view({
        lastRun: {
          at: '2026-11-06T05:00:00Z',
          outcome: 'failed',
          message: 'Academic OS could not be reached.',
        },
      }),
      ['Failed', 'Academic OS could not be reached.'],
      ['Done'],
    ],
  ])('renders %s', (_name, job, shows, hides) => {
    const html = renderToStaticMarkup(<BackgroundJobs jobs={[job]} canRun />);
    for (const s of shows) expect(html).toContain(s);
    for (const s of hides) expect(html).not.toContain(s);
    expect(html).toContain('Run now');
  });

  it('shows no switch or Run now to someone who cannot run jobs', () => {
    const html = renderToStaticMarkup(<BackgroundJobs jobs={[view({})]} canRun={false} />);
    expect(html).not.toContain('<form');
    expect(html).toContain('Off');
  });
});
