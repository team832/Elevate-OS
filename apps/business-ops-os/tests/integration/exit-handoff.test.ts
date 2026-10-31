/**
 * The way out, Ops side (IR-OPS-EXIT-1, CHK-012, CHK-016, F-11): an exit publishes
 * `ops.enrolment.closed` in its own transaction, the profile says what Academic did with it and
 * stays open during a readmission, and every background job can be run from one table.
 * Fictional data only.
 */
import { and, eq, sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  auditEvents,
  eventDeliveries,
  idempotencyKeys,
  integrationEvents,
  opsExitRecords,
  sessions,
} from '@elevate/database';
import { ACADEMIC_CONSUMERS, enrolmentKeys } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { POST as lifecycle } from '../../src/app/api/v1/admissions/[id]/lifecycle/route';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import { JobsPanel } from '../../src/app/_components/jobs-panel';
import { istToday } from '../../src/domain/dates';
import { deriveHandoffView } from '../../src/domain/students';
import { runHousekeeping } from '../../src/server/housekeeping';
import { OPS_JOBS } from '../../src/server/schemas';
import { get, post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ctx = setupTestDatabase();
let manager: StaffUser;
const today = istToday(new Date());
const exit = { action: 'exit', exitStatus: 'withdrawn', exitDate: today, reason: 'Family moved (test)' };

const act = (user: { token: string }, admissionId: string, body: unknown) =>
  callRoute<Record<string, unknown>>(lifecycle, post(user, body), { id: admissionId });
const closedEvents = (admissionId: string) =>
  ctx.db
    .select()
    .from(integrationEvents)
    .where(and(eq(integrationEvents.type, 'ops.enrolment.closed'), sql`${integrationEvents.payload}->>'admissionId' = ${admissionId}`));
type Profile = {
  admission: { id: string; status: string };
  otherAdmissions: { id: string; status: string }[];
  exitRecords: { academicClosure: string }[];
};
const profile = (id: string) => callRoute<Profile>(studentRoute, get(manager, `/ops/api/v1/students/${id}`), { id });

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
});

afterEach(() => vi.unstubAllGlobals());

describe('an exit publishes ops.enrolment.closed (IR-OPS-EXIT-1)', () => {
  it.each(['withdrawn', 'completed', 'transferred', 'other_inactive'] as const)('%s: one event, keyed by the exit record, naming the enrolment', async (exitStatus) => {
    const s = await identity(ctx.db, 'Sample Leaver');
    const a = await caseOf(ctx.db, manager.id, s, 'enrolled');
    expect((await act(manager, a.id, { ...exit, exitStatus })).status).toBe(200);
    const [record] = await ctx.db.select().from(opsExitRecords).where(eq(opsExitRecords.admissionId, a.id));
    const events = await closedEvents(a.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ version: 1, producer: 'ops', idempotencyKey: enrolmentKeys.closed(record!.id) });
    expect(events[0]!.payload).toMatchObject({ admissionId: a.id, academicEnrolmentId: a.enrolmentId, coreStudentId: s, outcome: exitStatus, exitDate: today, reason: exit.reason, closedByUserId: manager.id });
  });

  it('a student on hold from enrolled publishes too', async () => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, 'Sample Held Leaver'), 'on_hold', { heldFromStatus: 'enrolled' });
    expect((await act(manager, a.id, exit)).status).toBe(200);
    expect(await closedEvents(a.id)).toHaveLength(1);
  });

  it.each([
    ['cancelled before enrolment', 'admitted', { exitStatus: 'cancelled_before_enrolment' }, 200],
    ['a refused exit (rolled back)', 'enrolled', { reasonCode: 'made_up_code' }, 400],
  ] as const)('%s publishes nothing', async (_name, status, over, expected) => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, 'Sample No Event'), status);
    expect((await act(manager, a.id, { ...exit, ...over })).status).toBe(expected);
    expect(await closedEvents(a.id)).toHaveLength(0);
  });

  it('a second exit on a closed case is refused, so the event stays single', async () => {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, 'Sample Twice'), 'enrolled');
    expect((await act(manager, a.id, exit)).status).toBe(200);
    expect((await act(manager, a.id, exit)).status).toBe(409);
    expect(await closedEvents(a.id)).toHaveLength(1);
  });

  it.each([
    ['waiting', () => null],
    ['processed', (eventId: string) => ({ eventId, consumer: ACADEMIC_CONSUMERS.enrolmentExit, status: 'processed' as const, attempts: 1 })],
    ['dead', (eventId: string) => ({ eventId, consumer: ACADEMIC_CONSUMERS.enrolmentExit, status: 'dead' as const, attempts: 5 })],
  ])('the profile reports the closure as %s', async (state, delivery) => {
    const s = await identity(ctx.db, 'Sample Closure');
    const a = await caseOf(ctx.db, manager.id, s, 'enrolled');
    await act(manager, a.id, exit);
    const row = delivery((await closedEvents(a.id))[0]!.id as string);
    if (row) await ctx.db.insert(eventDeliveries).values(row as never);
    expect((await profile(s)).data!.exitRecords[0]!.academicClosure).toBe(state);
  });

  it('cancelled before enrolment: the profile says nothing was sent', async () => {
    const s = await identity(ctx.db, 'Sample Unlinked');
    const a = await caseOf(ctx.db, manager.id, s, 'admitted');
    await act(manager, a.id, { ...exit, exitStatus: 'cancelled_before_enrolment' });
    expect((await profile(s)).data!.exitRecords[0]!.academicClosure).toBe('not_sent');
  });
});

describe('readmission keeps the profile open (CHK-012)', () => {
  it('by identity, old case or new case: the former case leads, the pending one is listed, history stays', async () => {
    const s = await identity(ctx.db, 'Sample Back Again');
    const old = await caseOf(ctx.db, manager.id, s, 'enrolled');
    await act(manager, old.id, exit);
    const readmit = await act(manager, old.id, { action: 'readmit', reason: 'Family returned (test)' });
    expect(readmit.status).toBe(200);
    const fresh = readmit.data!.admissionId as string;
    for (const id of [s, old.id, fresh]) {
      const r = await profile(id);
      expect(r.status).toBe(200);
      expect(r.data!.admission).toMatchObject({ id: old.id, status: 'withdrawn' });
      expect(r.data!.otherAdmissions).toEqual([expect.objectContaining({ id: fresh, status: 'admission_pending' })]);
      expect(r.data!.exitRecords).toHaveLength(1);
    }
  });

  it('a case with no student record at all still answers Not found', async () => {
    const s = await identity(ctx.db, 'Sample Only Pending');
    const a = await caseOf(ctx.db, manager.id, s, 'contacted');
    await ctx.db.execute(sql`UPDATE ops.admissions SET admitted_at = NULL, admission_number = NULL WHERE id = ${a.id}`);
    expect((await profile(s)).status).toBe(404);
  });
});

describe('background jobs (CHK-016)', () => {
  const run = (user: { token: string }, job: string) => callRoute<Record<string, number>>(runJob, authedRequest(user, `/ops/api/v1/jobs/${job}`, { method: 'POST' }), { job });

  it.each(OPS_JOBS)('%s needs ops:jobs:run (401/403)', async (job) => {
    expect((await callRoute(runJob, buildRequest(`/ops/api/v1/jobs/${job}`, { method: 'POST' }), { job })).status).toBe(401);
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await run(teacher, job)).status).toBe(403);
  });

  it('the panel lists every job for a holder and nothing for anyone else', async () => {
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect(JobsPanel({ user: teacher as never })).toBeNull();
    const html = renderToStaticMarkup(JobsPanel({ user: manager as never })!);
    for (const label of ['Apply Academic replies', 'Send exits to Academic', 'Send follow-up reminders', 'Send task reminders', 'Read demo attendance from Academic', 'Clear expired sign-ins']) expect(html).toContain(label);
    expect(html).toContain('Nothing here runs by itself');
  });

  it('"Send exits to Academic" calls Academic as the signed-in person and shows its counts', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { processed: 2, failed: 0, skipped: 0 } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await run(manager, 'enrolment-exits');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ processed: 2, failed: 0, skipped: 0 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain('/academic/api/internal/v1/enrolment-exits/run');
    expect(init.headers['x-elevate-acting-user']).toBe(manager.id);
    expect(init.headers['x-elevate-caller']).toBe('ops');
  });

  it('"Send exits to Academic" with Academic down says so, and changes nothing here', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused'); }));
    const r = await run(manager, 'enrolment-exits');
    expect(r.status).toBe(500);
    expect(r.error?.message).toMatch(/could not be reached/);
  });

  it('the handoff wording names who runs it and no scheduler', () => {
    const view = deriveHandoffView({ status: 'enrolment_requested', handoffStatus: 'pending', enrolmentAttempt: 1, rejectionCode: null, rejectionReason: null, academicDelivery: { status: 'processed', attempts: 1, lastError: null } } as never);
    expect(view.detail).toMatch(/operations manager/i);
    expect(view.detail).toMatch(/Apply Academic replies/);
    expect(view.detail).not.toMatch(/scheduler/i);
  });
});

describe('housekeeping job (F-11)', () => {
  const day = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(Date.now() - days * day);

  it('purges sessions ended over 30 days ago and expired keys; live ones, audit and outbox stay', async () => {
    const user = await createTestUser(ctx.db, { roles: ['teacher'] });
    const session = (expiresAt: Date, revokedAt: Date | null = null) =>
      ctx.db.insert(sessions).values({ userId: user.id, tokenHash: crypto.randomUUID(), createdAt: ago(60), expiresAt, revokedAt }).returning().then((r) => r[0]!);
    const old = await session(ago(31));
    const recent = await session(ago(5));
    const revoked = await session(new Date(Date.now() + day), ago(40));
    const live = await session(new Date(Date.now() + day));
    const key = (name: string, expiresAt: Date) => ctx.db.insert(idempotencyKeys).values({ scope: 'test', key: name, userId: user.id, requestHash: 'x', expiresAt }).returning().then((r) => r[0]!);
    const expired = await key('expired', ago(1));
    const fresh = await key('fresh', new Date(Date.now() + day));
    const [auditBefore, outboxBefore] = [await ctx.db.$count(auditEvents), await ctx.db.$count(integrationEvents)];

    expect(await runHousekeeping(ctx.db, manager, 'test-request')).toEqual({ sessions: 2, idempotencyKeys: 1 });

    const left = (await ctx.db.select({ id: sessions.id }).from(sessions)).map((s) => s.id);
    expect(left).toEqual(expect.arrayContaining([recent.id, live.id]));
    expect(left).not.toContain(old.id);
    expect(left).not.toContain(revoked.id);
    const keys = (await ctx.db.select({ id: idempotencyKeys.id }).from(idempotencyKeys)).map((k) => k.id);
    expect(keys).toContain(fresh.id);
    expect(keys).not.toContain(expired.id);
    expect(await ctx.db.$count(integrationEvents)).toBe(outboxBefore);
    expect(await ctx.db.$count(auditEvents)).toBe(auditBefore + 1);
    const [row] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'housekeeping.run'));
    expect(row).toMatchObject({ actorUserId: manager.id, after: { sessions: 2, idempotencyKeys: 1 } });
  });
});
