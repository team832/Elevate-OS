/**
 * F4-07 bulk batch transfer: several students of one batch move to another from one date, in ONE
 * transaction, through the same transfer core as a single transfer. Any refusal saves nothing and
 * names each student. Fictional data only.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { academicAssessmentRoster as R, academicAssessments, academicBatchPlacements as pl, academicBatches, academicEnrolments, auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import MoveStudentsPage from '../../src/app/batches/[id]/move/page';
import { POST as bulkRoute } from '../../src/app/api/v1/placements/bulk-transfer/route';
import { POST as transferRoute } from '../../src/app/api/v1/placements/transfer/route';
import { POST as createTest } from '../../src/app/api/internal/v1/assessments/route';
import { POST as snapshot } from '../../src/app/api/internal/v1/assessments/[id]/roster/route';
import { createBatch, createSessions, createStudent, enrolManually } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const as = vi.hoisted(() => ({ user: null as TestUser | null, db: null as unknown }));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({ ...(await original<object>()), getDb: () => as.db }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {}, replace() {} }), usePathname: () => '/' }));

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let w2: World;
let ops: TestUser;

type Res = { moved: { enrolmentId: string; studentName: string; keptOff: string[]; placement: { batchId: string; startDate: string } }[]; catchUp: { status: string } };
const post = (route: typeof bulkRoute, path: string, user: TestUser | null, json: unknown) =>
  callRoute<Res>(route, user ? authedRequest(user, `/academic/api/v1/${path}`, { json }) : buildRequest(`/academic/api/v1/${path}`, { method: 'POST', json }));
const move = (json: Record<string, unknown>, user: TestUser | null = u.coordinator) => post(bulkRoute, 'placements/bulk-transfer', user, json);

const batch = (over: Record<string, unknown> = {}) =>
  createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Target batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active', ...over });
/** A student enrolled by hand in `batchId` from 1 Sep 2026; returns ids and name. */
async function student(batchId: string = w.batch.id) {
  const fullName = `Sample Mover ${uniq('N')} (fictional)`;
  const s = await createStudent(ctx.db, actor(u.coordinator), { fullName });
  const e = await enrolManually(ctx.db, actor(u.coordinator), { studentId: s.id, batchId, startDate: '2026-09-01', reason: 'Register (fictional)' });
  return { studentId: s.id, enrolmentId: e.id, fullName };
}
const placementsOf = (enrolmentId: string) => ctx.db.select().from(pl).where(eq(pl.enrolmentId, enrolmentId as never)).orderBy(asc(pl.startDate));
const audits = (ids: string[], action: string) => ctx.db.select().from(auditEvents).where(and(inArray(auditEvents.entityId, ids), eq(auditEvents.action, action)));
const body = (enrolmentIds: string[], toBatchId: string, over: Record<string, unknown> = {}) => ({ fromBatchId: w.batch.id, enrolmentIds, toBatchId, effectiveDate: '2026-12-01', reason: 'New timing (fictional)', ...over });

const internal = () => ({ authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': 'ops', 'x-elevate-acting-user': ops.id });
/** A scheduled test with its roster snapshot, through the routes Business Ops calls. */
async function test(date: string, batchIds: string[], time: { startTime?: string; durationMinutes?: number } = {}) {
  const created = await callRoute<{ assessment: { id: string } }>(
    createTest,
    buildRequest('/academic/api/internal/v1/assessments', { headers: internal(), json: { code: uniq('T-'), kind: 'full_mock', title: 'Mock (fictional)', academicYear: '2026-27', batchIds, scheduledDate: date, ...time } }),
  );
  const id = created.data!.assessment.id;
  await callRoute(snapshot, buildRequest(`/academic/api/internal/v1/assessments/${id}/roster`, { headers: internal(), json: {} }), { id });
  return id;
}
const rosterRow = async (assessmentId: string, studentId: string) =>
  (await ctx.db.select().from(R).where(and(eq(R.assessmentId, assessmentId as never), eq(R.studentId, studentId as never))))[0];

beforeAll(async () => {
  as.db = ctx.db;
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  w2 = await world(ctx.db, u);
  ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
});

describe('moving students (F4-07)', () => {
  it.each([1, 3])('moves %i student(s): old placements end the day before, new ones link back, history and audit per student', async (n) => {
    const target = await batch();
    const movers = [];
    for (let i = 0; i < n; i++) movers.push(await student());
    const res = await move(body(movers.map((m) => m.enrolmentId), target.id));
    expect(res.status).toBe(200);
    expect(res.data!.moved.map((m) => m.studentName).sort()).toEqual(movers.map((m) => m.fullName).sort());
    expect(res.data!.catchUp).toMatchObject({ status: 'proposed' });
    for (const m of movers) {
      const [old, next] = await placementsOf(m.enrolmentId);
      expect(old).toMatchObject({ batchId: w.batch.id, endDate: '2026-11-30', endedReason: 'New timing (fictional)', endedByUserId: u.coordinator.id });
      expect(next).toMatchObject({ batchId: target.id, startDate: '2026-12-01', endDate: null, transferFromPlacementId: old!.id });
      const [e] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, m.enrolmentId as never));
      expect(e!.batchId).toBe(target.id);
      expect(await audits([old!.id], 'placement.ended')).toHaveLength(1);
      expect(await audits([next!.id], 'placement.transferred')).toHaveLength(1);
    }
  });

  it('works for next year’s batch (planning, later start)', async () => {
    const next = await batch({ status: 'planning', startDate: '2027-04-01' });
    const m = await student();
    const res = await move(body([m.enrolmentId], next.id, { effectiveDate: '2027-04-01' }));
    expect(res.status).toBe(200);
    expect((await placementsOf(m.enrolmentId)).map((p) => [p.batchId, p.endDate])).toEqual([[w.batch.id, '2027-03-31'], [next.id, null]]);
  });

  it.each([
    ['a class', '2026-12-10', (target: string, date: string) => createSessions(ctx.db, actor(u.coordinator), [{ batchId: target, subjectId: w.quant.id, sessionType: 'teaching', date, startTime: '17:30', durationMinutes: 75 }]), /: B-.* at 5:30 pm overlaps B-.* at 5:00 pm/],
    ['a test', '2026-12-11', (target: string, date: string) => test(date, [target], { startTime: '17:30', durationMinutes: 60 }), /: test T-.* at 5:30 pm overlaps B-.* at 5:00 pm/],
  ])('one student whose other programme clashes with %s of the target: nobody moves and that student is named', async (_n, date, clashWith, why) => {
    const target = await batch();
    const ok = await student();
    const busy = await student();
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: busy.studentId, batchId: w2.batch.id, startDate: '2026-09-01', reason: 'Second programme (fictional)' });
    await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w2.batch.id, subjectId: w2.quant.id, sessionType: 'teaching', date, startTime: '17:00', durationMinutes: 75 }]);
    await clashWith(target.id, date);
    const res = await move(body([ok.enrolmentId, busy.enrolmentId], target.id));
    expect(res.status).toBe(409);
    expect(res.error!.message).toMatch(/Nothing was saved: 1 of 2/);
    const details = res.error!.details as { enrolmentId: string; message: string }[];
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ enrolmentId: busy.enrolmentId });
    expect(details[0]!.message).toContain(busy.fullName);
    expect(details[0]!.message).toMatch(why);
    for (const m of [ok, busy]) expect((await placementsOf(m.enrolmentId)).filter((p) => p.batchId === w.batch.id)).toMatchObject([{ endDate: null }]);
  });

  it.each(['completed', 'cancelled'] as const)('a %s target batch is refused and nothing moves', async (status) => {
    const target = await batch();
    await ctx.db.update(academicBatches).set({ status }).where(eq(academicBatches.id, target.id));
    const m = await student();
    const res = await move(body([m.enrolmentId], target.id));
    expect(res.status).toBe(400);
    expect(res.error!.message).toMatch(new RegExp(`is ${status}`));
    expect(await placementsOf(m.enrolmentId)).toMatchObject([{ batchId: w.batch.id, endDate: null }]);
  });

  it.each([
    ['a past date after the current start is accepted, as by a single transfer', '2026-10-01', 200, 200],
    ['a date on the current start is refused, as by a single transfer', '2026-09-01', 400, 409],
  ])('%s', async (_n, effectiveDate, singleStatus, bulkStatus) => {
    const target = await batch();
    const [a, b] = [await student(), await student()];
    const single = await post(transferRoute, 'placements/transfer', u.coordinator, { enrolmentId: a.enrolmentId, toBatchId: target.id, effectiveDate, reason: 'Same rule (fictional)' });
    const bulk = await move(body([b.enrolmentId], target.id, { effectiveDate }));
    expect([single.status, bulk.status]).toEqual([singleStatus, bulkStatus]);
    if (bulkStatus !== 200) expect((bulk.error!.details as { message: string }[])[0]!.message).toContain(single.error!.message);
  });

  it('a student who already left this batch is refused by name', async () => {
    const target = await batch();
    const m = await student(w2.batch.id);
    const res = await move(body([m.enrolmentId], target.id));
    expect(res.status).toBe(409);
    expect((res.error!.details as { message: string }[])[0]!.message).toMatch(new RegExp(`${m.fullName.replace(/[()]/g, '\\$&')}: .*no longer in this batch`));
  });

  it('future test rosters follow the move; rows with attendance and earlier tests stay', async () => {
    const target = await batch();
    const m = await student();
    const shared = await test('2026-12-20', [w.batch.id, target.id]);
    const oldOnly = await test('2026-12-21', [w.batch.id]);
    const newOnly = await test('2026-12-22', [target.id]);
    const marked = await test('2026-12-23', [w.batch.id]);
    const earlier = await test('2026-11-25', [w.batch.id]);
    await ctx.db.update(R).set({ attendance: 'absent' }).where(and(eq(R.assessmentId, marked as never), eq(R.studentId, m.studentId as never)));
    expect((await move(body([m.enrolmentId], target.id))).status).toBe(200);
    expect(await rosterRow(shared, m.studentId)).toMatchObject({ batchId: target.id, removedAt: null });
    expect(await rosterRow(oldOnly, m.studentId)).toMatchObject({ batchId: w.batch.id, removedReason: expect.stringMatching(/^Moved to B-.* on 1 Dec 2026: New timing/) });
    expect(await rosterRow(newOnly, m.studentId)).toMatchObject({ batchId: target.id, removedAt: null, addedReason: expect.stringMatching(/^Moved to/) });
    expect(await rosterRow(marked, m.studentId)).toMatchObject({ batchId: w.batch.id, removedAt: null, attendance: 'absent' });
    expect(await rosterRow(earlier, m.studentId)).toMatchObject({ batchId: w.batch.id, removedAt: null });
    expect((await audits([shared, oldOnly, newOnly], 'roster.moved')).map((a) => a.entityId)).toEqual([shared]);
    expect((await audits([shared, oldOnly, newOnly], 'roster.removed')).map((a) => a.entityId)).toEqual([oldOnly]);
    expect((await audits([shared, oldOnly, newOnly], 'roster.added')).map((a) => a.entityId)).toEqual([newOnly]);
  });

  it('a student moved back gets the removed row on a future test of that batch restored, not skipped', async () => {
    const target = await batch();
    const m = await student();
    const later = await test('2026-12-20', [w.batch.id]);
    expect((await move(body([m.enrolmentId], target.id))).status).toBe(200);
    expect((await rosterRow(later, m.studentId))!.removedAt).not.toBeNull();
    expect((await move({ ...body([m.enrolmentId], w.batch.id, { effectiveDate: '2026-12-05', reason: 'Back again (fictional)' }), fromBatchId: target.id })).status).toBe(200);
    expect(await rosterRow(later, m.studentId)).toMatchObject({ batchId: w.batch.id, removedAt: null, removedReason: null, addedReason: expect.stringMatching(/^Moved to B-.* on 5 Dec 2026: Back again/) });
    expect(await audits([later], 'roster.restored')).toHaveLength(1);
  });

  it('a row a coordinator removed by hand stays removed, nothing is added, and the result says so', async () => {
    const target = await batch();
    const m = await student();
    const both = await test('2026-12-20', [w.batch.id, target.id]);
    await ctx.db.update(R).set({ removedAt: new Date(), removedReason: 'Exempt from this mock (fictional)' }).where(and(eq(R.assessmentId, both as never), eq(R.studentId, m.studentId as never)));
    const res = await move(body([m.enrolmentId], target.id));
    expect(res.status).toBe(200);
    const [{ code }] = (await ctx.db.select({ code: academicAssessments.code }).from(academicAssessments).where(eq(academicAssessments.id, both as never))) as [{ code: string }];
    expect(res.data!.moved[0]!.keptOff).toEqual([code]);
    expect(await rosterRow(both, m.studentId)).toMatchObject({ batchId: w.batch.id, removedReason: 'Exempt from this mock (fictional)' });
    expect(await audits([both], 'roster.restored')).toHaveLength(0);
  });
});

describe('the Move students page', () => {
  const page = async (user: TestUser, id: string) => {
    as.user = user;
    const html = await new Response((await prerender(await MoveStudentsPage({ params: Promise.resolve({ id }) }))).prelude).text();
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  };
  it('a coordinator sees the current students, select all and only open batches of the course; a teacher sees none of it', async () => {
    const next = await batch({ status: 'planning', name: 'Next year (fictional)' });
    const closed = await batch();
    await ctx.db.update(academicBatches).set({ status: 'completed' }).where(eq(academicBatches.id, closed.id));
    const m = await student();
    const html = await page(u.coordinator, w.batch.id);
    expect(html).toContain(m.fullName);
    expect(html).toMatch(/Select all \d+ students/);
    expect(html).toContain(`${next.code} — Next year (fictional) (planning)`);
    expect(html).not.toContain(closed.code);
    expect(html).not.toContain(w2.batch.code);
    expect(await page(u.teacher, w.batch.id)).not.toContain(m.fullName);
  });
});

describe('POST /academic/api/v1/placements/bulk-transfer', () => {
  it.each([
    ['signed out', () => null, () => ({}), 401],
    ['a teacher', () => u.teacher, () => ({}), 403],
    ['the auditor', () => u.auditor, () => ({}), 403],
    ['no students chosen', () => u.coordinator, () => body([], w.batch.id), 400],
    ['no reason', () => u.coordinator, () => ({ ...body([crypto.randomUUID()], w.batch.id), reason: '' }), 400],
  ])('refuses %s', async (_n, user, json, status) => {
    expect((await move(json(), user())).status).toBe(status);
  });
});
