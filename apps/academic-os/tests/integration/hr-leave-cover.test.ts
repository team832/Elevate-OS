/**
 * D-134: a teacher's approved HR leave, sent by Business Ops, flags their classes in those dates as
 * needing cover; cancelling the leave withdraws that. One record per Ops leave record, so a retried
 * or late call changes nothing. Nothing is reassigned. Fictional data only.
 */
import { eq } from 'drizzle-orm';
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@elevate/authentication';
import { academicTeacherUnavailability as T, auditEvents, type Database } from '@elevate/database';
import { academicHrLeaveV1Schema, type AcademicHrLeaveV1 } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as hrLeaveRoute } from '../../src/app/api/internal/v1/teacher-unavailability/hr-leave/route';
import { DELETE as withdrawRoute } from '../../src/app/api/v1/unavailability/[id]/route';
import TeacherPage from '../../src/app/teachers/[staffId]/page';
import { cancelUnavailability, createSessions, createUnavailability, HR_LEAVE_LABEL, listUnavailability, uncoveredSessions, UNAVAILABILITY_LABEL } from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

// The teacher page renders as the signed-in coordinator.
const as = vi.hoisted(() => ({ user: null as AuthenticatedUser | null, db: null as unknown }));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({ ...(await original<object>()), getDb: () => as.db as Database }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {}, replace() {} }), usePathname: () => '/', redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let hr: TestUser;
const PATH = '/academic/api/internal/v1/teacher-unavailability/hr-leave';
const headers = (acting: string | null = hr.id, caller = 'ops') => ({
  authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`,
  'x-elevate-caller': caller,
  ...(acting ? { 'x-elevate-acting-user': acting } : {}),
});
const send = (json: unknown, h = headers()) => callRoute<AcademicHrLeaveV1>(hrLeaveRoute, buildRequest(PATH, { headers: h, json }));
const leave = (over: Record<string, unknown> = {}) => ({
  opsLeaveRecordId: crypto.randomUUID(),
  staffId: w.teacherStaff,
  fromDate: '2099-03-02',
  toDate: '2099-03-03',
  status: 'approved',
  ...over,
});
const needCover = async () => (await uncoveredSessions(ctx.db, actor(u.coordinator), { from: '2099-03-01', to: '2099-03-10' })).map((s) => s.date);
const rows = (ref: string) => ctx.db.select().from(T).where(eq(T.opsLeaveRecordId, ref));

beforeAll(async () => {
  as.db = ctx.db;
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  hr = await createTestUser(ctx.db, { roles: ['hr_manager'] });
  await createSessions(
    ctx.db,
    actor(u.coordinator),
    ['2099-03-02', '2099-03-03', '2099-03-05'].map((date) => ({ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 })),
  );
});

describe('POST /academic/api/internal/v1/teacher-unavailability/hr-leave', () => {
  it.each([
    ['no token', () => send(leave(), {} as never), 401],
    ['another module', () => send(leave(), headers(hr.id, 'marketing')), 403],
    ['no acting user', () => send(leave(), headers(null)), 400],
    ['the leave reason (it never leaves Ops)', () => send(leave({ reason: 'Private' })), 400],
    ['the last day before the first', () => send(leave({ toDate: '2099-03-01' })), 400],
  ])('refuses %s', async (_label, call, status) => {
    expect((await call()).status).toBe(status);
  });

  it('approved leave flags the classes in its dates as needing cover; a retry adds nothing', async () => {
    const body = leave();
    const first = await send(body);
    expect(first.status).toBe(200);
    expect(academicHrLeaveV1Schema.parse(first.data)).toMatchObject({ active: true, classes: 2 });
    expect(await needCover()).toEqual(['2099-03-02', '2099-03-03']);
    const [row] = await rows(body.opsLeaveRecordId);
    expect(row).toMatchObject({ id: first.data!.recordId, source: 'hr_leave', staffId: w.teacherStaff, reason: 'Approved HR leave', enteredByUserId: hr.id, cancelledAt: null });
    expect((await send(body)).data).toEqual(first.data);
    expect(await rows(body.opsLeaveRecordId)).toHaveLength(1);
    const listed = (await listUnavailability(ctx.db, actor(u.coordinator), { staffId: w.teacherStaff })).find((r) => r.id === row!.id);
    expect(listed!.label).not.toBe(UNAVAILABILITY_LABEL);
    expect(listed!.label).toMatch(/HR leave/);
    const [audit] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, row!.id));
    expect(audit).toMatchObject({ action: 'teacher_unavailability.recorded', actorUserId: hr.id });

    // Cancelled: the classes are back with the teacher; a retry, or a late approval, changes nothing.
    const cancel = { ...body, status: 'cancelled' };
    expect((await send(cancel)).data).toEqual({ recordId: row!.id, active: false, classes: 2 });
    expect(await needCover()).toEqual([]);
    expect((await send(cancel)).data).toEqual({ recordId: row!.id, active: false, classes: 0 });
    expect((await send(body)).data).toEqual({ recordId: row!.id, active: false, classes: 0 });
    expect(await needCover()).toEqual([]);
    expect(await rows(body.opsLeaveRecordId)).toHaveLength(1);
  });

  it('a cancel counts only the classes no other active record still flags (REV-4 M3)', async () => {
    const own = await createUnavailability(ctx.db, actor(u.coordinator), { staffId: w.teacherStaff, fromDate: '2099-03-03', toDate: '2099-03-03', reason: 'Exam duty (fictional)' });
    const body = leave();
    expect((await send(body)).data).toMatchObject({ active: true, classes: 2 });
    expect((await send({ ...body, status: 'cancelled' })).data).toMatchObject({ active: false, classes: 1 });
    expect(await needCover()).toEqual(['2099-03-03']);
    await cancelUnavailability(ctx.db, actor(u.coordinator), own.record.id, 'Duty moved (fictional)');
  });

  it('a cancel that arrives before the approval is kept, so the late approval stays cancelled (REV-4 P2)', async () => {
    const body = leave({ fromDate: '2099-03-02', toDate: '2099-03-02' });
    const first = await send({ ...body, status: 'cancelled' });
    expect(first.data).toMatchObject({ active: false, classes: 0 });
    expect(first.data!.recordId).toBeTruthy();
    expect((await send(body)).data).toEqual(first.data);
    expect(await needCover()).toEqual([]);
    expect((await rows(body.opsLeaveRecordId)).map((r) => Boolean(r.cancelledAt))).toEqual([true]);
  });

  it('someone with no classes or assignments in Academic: nothing is stored, either way (REV-4 M2)', async () => {
    const office = await staffFor(ctx.db, null, 'Sample Office Staff (fictional)');
    const body = leave({ staffId: office });
    for (const status of ['approved', 'cancelled'])
      expect((await send({ ...body, status })).data).toEqual({ recordId: null, active: false, classes: 0 });
    expect(await rows(body.opsLeaveRecordId)).toEqual([]);
  });

  it('a coordinator cannot withdraw a record made from HR leave: HR cancels the leave', async () => {
    const made = await send(leave({ fromDate: '2099-03-05', toDate: '2099-03-05' }));
    const id = made.data!.recordId!;
    const r = await callRoute(withdrawRoute, authedRequest(u.coordinator, `/academic/api/v1/unavailability/${id}`, { method: 'DELETE', json: { reason: 'Cover arranged' } }), { id });
    expect(r.status).toBe(409);
    expect(await needCover()).toEqual(['2099-03-05']);
  });

  it("the teacher's page names each record's kind; only a coordinator's own record can be withdrawn there", async () => {
    await send(leave({ fromDate: '2099-04-01', toDate: '2099-04-01' }));
    await createUnavailability(ctx.db, actor(u.coordinator), { staffId: w.teacherStaff, fromDate: '2099-04-03', toDate: '2099-04-03', reason: 'Exam invigilation (fictional)' });
    as.user = u.coordinator as never;
    const page = TeacherPage({ params: Promise.resolve({ staffId: w.teacherStaff }), searchParams: Promise.resolve({}) } as never);
    const html = (await new Response((await prerender(await page)).prelude).text()).replace(/<[^>]+>/g, ' ');
    for (const words of [HR_LEAVE_LABEL, UNAVAILABILITY_LABEL, 'Kept by HR', 'HR cancels this leave in Business Ops', 'Exam invigilation (fictional)']) expect(html).toContain(words);
    expect(html.match(/Withdraw record/g)).toHaveLength(1);
  });
});
