/** Brief §9/§11, R12, acceptance tests 4, 6 and 10: delivery, reopening, substitutes, unavailability, cancel/reschedule. */
import { and, eq, ne } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicAttendance, academicClassSessions, academicSessionTeachers, auditEvents, staffMembers } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { POST as deliverRoute } from '../../src/app/api/v1/sessions/[id]/deliver/route';
import { POST as reopenRoute } from '../../src/app/api/v1/sessions/[id]/reopen/route';
import { POST as substituteRoute } from '../../src/app/api/v1/sessions/[id]/substitute/route';
import { GET as listUnavailabilityRoute, POST as unavailabilityRoute } from '../../src/app/api/v1/unavailability/route';
import { DELETE as withdrawUnavailabilityRoute } from '../../src/app/api/v1/unavailability/[id]/route';
import { POST as cancelRoute } from '../../src/app/api/v1/sessions/[id]/cancel/route';
import { POST as rescheduleRoute } from '../../src/app/api/v1/sessions/[id]/reschedule/route';
import { POST as createSessionsRoute } from '../../src/app/api/v1/sessions/route';
import { createSessions, createStudent, enrolManually, listSessions, recordAttendance, sessionHistory, uncoveredSessions } from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
const s: Record<string, string> = {};
const post = <T = unknown>(route: typeof deliverRoute, user: Users['teacher'] | null, path: string, id: string, json: Record<string, unknown> = {}) =>
  callRoute<T>(route, user ? authedRequest(user, path, { json }) : buildRequest(path, { json }), { id });
const deliver = (user: Users['teacher'] | null, id: string, json: Record<string, unknown> = {}) => post<{ session: { status: string; version: number }; actualStaffIds: string[] }>(deliverRoute, user, `/academic/api/v1/sessions/${id}/deliver`, id, json);
const session = (date: string, startTime: string, teacher: 'teacherStaff' | 'teacher2Staff', subject: 'quant' | 'verbal' = 'quant') => ({ batchId: w.batch.id, subjectId: w[subject].id, teacherStaffId: w[teacher], sessionType: 'teaching' as const, date, startTime, durationMinutes: 75 });

describe('mark delivered (R12): explicit, own session or coordinator, never HR', () => {
  it('401/403/404/400/409 and success with the actual teacher; touches no staff or non-academic data (test 10)', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [session('2026-09-14', '09:00', 'teacherStaff'), session('2026-09-14', '10:15', 'teacher2Staff', 'verbal'), session('2099-01-05', '09:00', 'teacherStaff'), session('2099-01-05', '10:15', 'teacher2Staff', 'verbal')]);
    const [past, past2, future, future2] = sessions.map((x) => x.id);
    Object.assign(s, { past, past2, future, future2 });
    const staffBefore = await ctx.db.select().from(staffMembers);
    const foreignAuditBefore = await ctx.db.select().from(auditEvents).where(ne(auditEvents.module, 'academic'));

    expect((await deliver(null, s.past!)).status).toBe(401);
    expect((await deliver(u.auditor, s.past!)).status).toBe(403);
    expect((await deliver(u.teacher2, s.past!)).status).toBe(404);
    expect((await deliver(u.teacher, s.future!)).status).toBe(400);
    expect((await deliver(u.teacher, s.past!, { actualStaffIds: [w.teacher2Staff] })).status).toBe(400); // a teacher cannot declare others taught without them
    expect((await deliver(u.teacher, s.past!, { version: 99 })).status).toBe(409);
    const ok = await deliver(u.teacher, s.past!, { note: 'Covered Q-01 (fictional)', version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ session: { status: 'held', version: 2 }, actualStaffIds: [w.teacherStaff] });
    expect((await deliver(u.teacher, s.past!)).status).toBe(409);
    const actual = await ctx.db.select().from(academicSessionTeachers).where(eq(academicSessionTeachers.sessionId, s.past as never));
    expect(actual).toEqual([expect.objectContaining({ staffId: w.teacherStaff, participation: 'actual', role: 'primary' })]);
    // Coordinator records a co-taught class.
    expect((await deliver(u.coordinator, s.past2!, { actualStaffIds: [w.teacher2Staff, w.teacherStaff] })).data!.actualStaffIds).toHaveLength(2);

    expect(await ctx.db.select().from(staffMembers)).toEqual(staffBefore);
    expect(await ctx.db.select().from(auditEvents).where(ne(auditEvents.module, 'academic'))).toEqual(foreignAuditBefore);
  });

  it('reopening is a coordinator correction with a reason, kept in the history', async () => {
    const path = `/academic/api/v1/sessions/${s.past}/reopen`;
    expect((await post(reopenRoute, u.teacher, path, s.past!, { reason: 'x' })).status).toBe(403);
    expect((await post(reopenRoute, u.coordinator, path, s.past!, {})).status).toBe(400);
    const ok = await post<{ status: string; deliveredAt: null }>(reopenRoute, u.coordinator, path, s.past!, { reason: 'Marked on the wrong class (fictional)' });
    expect(ok.data).toMatchObject({ status: 'scheduled', deliveredAt: null });
    expect((await post(reopenRoute, u.coordinator, path, s.past!, { reason: 'again' })).status).toBe(409);
    const rows = await ctx.db.select().from(academicSessionTeachers).where(eq(academicSessionTeachers.sessionId, s.past as never));
    expect(rows.every((r) => r.removedAt !== null)).toBe(true); // kept, marked removed
    const history = await sessionHistory(ctx.db, s.past!);
    expect(history[0]).toMatchObject({ action: 'class_session.reopened', reason: 'Marked on the wrong class (fictional)' });
    expect(history.map((h) => h.action)).toContain('class_session.delivered');
    expect((await deliver(u.teacher, s.past!)).status).toBe(200);
  });
});

describe('unavailability and substitutes (test 4)', () => {
  it('an availability record flags the uncovered future classes and never assigns a substitute', async () => {
    const body = { staffId: w.teacher2Staff, fromDate: '2099-01-04', toDate: '2099-01-10', reason: 'Exam duty (fictional)' };
    expect((await callRoute(unavailabilityRoute, authedRequest(u.teacher, '/academic/api/v1/unavailability', { json: body }))).status).toBe(403);
    expect((await callRoute(unavailabilityRoute, authedRequest(u.coordinator, '/academic/api/v1/unavailability', { json: { ...body, toDate: '2099-01-01' } }))).status).toBe(400);
    const res = await callRoute<{ record: { id: string; label: string }; affectedSessions: { id: string }[] }>(unavailabilityRoute, authedRequest(u.coordinator, '/academic/api/v1/unavailability', { json: body }));
    expect(res.status).toBe(201);
    expect(res.data!.record.label).toBe('Academic availability record — not HR leave');
    expect(res.data!.affectedSessions.map((x) => x.id)).toEqual([s.future2]);
    expect(await ctx.db.select().from(academicSessionTeachers).where(eq(academicSessionTeachers.sessionId, s.future2 as never))).toEqual([]);
    s.unavailability = res.data!.record.id;
  });

  it('a substitute keeps the original teacher on record, needs a reason and a free teacher, and covers the class', async () => {
    const path = `/academic/api/v1/sessions/${s.future2}/substitute`;
    expect((await post(substituteRoute, u.teacher, path, s.future2!, { staffId: w.teacherStaff, reason: 'x' })).status).toBe(403);
    expect((await post(substituteRoute, u.coordinator, path, s.future2!, { staffId: w.teacherStaff })).status).toBe(400);
    expect((await post(substituteRoute, u.coordinator, path, s.future2!, { staffId: w.teacher2Staff, reason: 'x' })).status).toBe(400); // cannot replace self
    const ok = await post<{ role: string; replacesStaffId: string; authorisedByUserId: string }>(substituteRoute, u.coordinator, path, s.future2!, { staffId: w.teacherStaff, reason: 'Covering exam duty (fictional)' });
    expect(ok.status).toBe(201);
    expect(ok.data).toMatchObject({ role: 'substitute', replacesStaffId: w.teacher2Staff, authorisedByUserId: u.coordinator.id });
    const rows = await ctx.db.select().from(academicSessionTeachers).where(eq(academicSessionTeachers.sessionId, s.future2 as never));
    expect(rows.map((r) => [r.staffId, r.role])).toEqual(expect.arrayContaining([[w.teacher2Staff, 'primary'], [w.teacherStaff, 'substitute']]));
    const [row] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, s.future2 as never));
    expect(row!.teacherStaffId).toBe(w.teacher2Staff);
    expect(await uncoveredSessions(ctx.db, actor(u.coordinator), { from: '2099-01-04', to: '2099-01-10' })).toEqual([]);
    expect((await listSessions(ctx.db, actor(u.teacher), { from: '2099-01-05', to: '2099-01-05' })).map((x) => x.id).sort()).toEqual([s.future, s.future2].sort());

    // The substitute must be free: an unavailable teacher is refused.
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [session('2099-01-12', '10:15', 'teacher2Staff', 'verbal')]);
    await callRoute(unavailabilityRoute, authedRequest(u.coordinator, '/academic/api/v1/unavailability', { json: { staffId: w.teacherStaff, fromDate: '2099-01-12', toDate: '2099-01-12', reason: 'Away (fictional)' } }));
    const busy = await post<unknown>(substituteRoute, u.coordinator, `/academic/api/v1/sessions/${sessions[0]!.id}/substitute`, sessions[0]!.id, { staffId: w.teacherStaff, reason: 'x' });
    expect(busy.status).toBe(409);
    expect(JSON.stringify(busy.error)).toContain('TEACHER_UNAVAILABLE');
  });

  it('a second substitute replaces the first while the original is still unavailable; an unavailable substitute makes the class uncovered again', async () => {
    const third = await staffFor(ctx.db, null, 'Uma Sample Teacher');
    const path = `/academic/api/v1/sessions/${s.future2}/substitute`;
    const ok = await post<{ staffId: string }>(substituteRoute, u.coordinator, path, s.future2!, { staffId: third, reason: 'First substitute moved (fictional)' });
    expect(ok.status).toBe(201);
    const active = (await ctx.db.select().from(academicSessionTeachers).where(eq(academicSessionTeachers.sessionId, s.future2 as never))).filter((r) => !r.removedAt);
    expect(active.map((r) => [r.staffId, r.role]).sort()).toEqual([[w.teacher2Staff, 'primary'], [third, 'substitute']].sort());
    await callRoute(unavailabilityRoute, authedRequest(u.coordinator, '/academic/api/v1/unavailability', { json: { staffId: third, fromDate: '2099-01-05', toDate: '2099-01-05', reason: 'Away (fictional)' } }));
    expect((await uncoveredSessions(ctx.db, actor(u.coordinator), { from: '2099-01-05', to: '2099-01-05' })).map((x) => [x.id, x.unavailableNames])).toEqual([[s.future2, ['Uma Sample Teacher']]]);
  });

  it('withdrawing an availability record needs a reason and keeps the row', async () => {
    const del = (reason: string) => callRoute(withdrawUnavailabilityRoute, authedRequest(u.coordinator, `/academic/api/v1/unavailability/${s.unavailability}`, { method: 'DELETE', json: { reason } }), { id: s.unavailability! });
    expect((await del('')).status).toBe(400);
    expect((await del('Duty cancelled (fictional)')).status).toBe(200);
    expect((await del('again')).status).toBe(409);
    const list = (user: Users['teacher']) => callRoute<{ staffId: string }[]>(listUnavailabilityRoute, authedRequest(user, '/academic/api/v1/unavailability'));
    expect((await list(u.teacher)).data!.every((r) => r.staffId === w.teacherStaff)).toBe(true); // teachers see only their own records
    expect((await list(u.coordinator)).data!.map((r) => r.staffId)).toEqual(expect.arrayContaining([w.teacherStaff, w.teacher2Staff]));
  });
});

describe('cancel and reschedule (test 6): no duplicate sessions or attendance', () => {
  it('a cancelled class frees its slot; a rescheduled original cannot take attendance or be moved twice', async () => {
    const schedule = (sessions: unknown[]) => callRoute<{ sessions: { id: string }[] }>(createSessionsRoute, authedRequest(u.coordinator, '/academic/api/v1/sessions', { json: { sessions } }));
    const first = await schedule([session('2026-09-21', '09:00', 'teacherStaff')]);
    const id = first.data!.sessions[0]!.id;
    expect((await schedule([session('2026-09-21', '09:00', 'teacherStaff')])).status).toBe(409);
    await callRoute(cancelRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/cancel`, { json: { reason: 'Closure (fictional)' } }), { id });
    expect((await schedule([session('2026-09-21', '09:00', 'teacherStaff')])).status).toBe(201);
    expect((await deliver(u.teacher, id)).status).toBe(409); // cancelled

    const moved = (await schedule([session('2026-09-22', '09:00', 'teacherStaff')])).data!.sessions[0]!.id;
    const resched = (json: Record<string, unknown>) => callRoute<{ replacement: { id: string } }>(rescheduleRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${moved}/reschedule`, { json }), { id: moved });
    const ok = await resched({ date: '2026-09-23', startTime: '11:00', reason: 'Room clash (fictional)' });
    expect(ok.status).toBe(201);
    expect((await resched({ date: '2026-09-24', startTime: '11:00', reason: 'again' })).status).toBe(409);
    const student = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Esha Sample Student' });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: student.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await expect(recordAttendance(ctx.db, actor(u.teacher), moved, { marks: [{ studentId: student.id, status: 'present' }] })).rejects.toMatchObject({ status: 409 });
    const replacement = ok.data!.replacement.id;
    await recordAttendance(ctx.db, actor(u.teacher), replacement, { marks: [{ studentId: student.id, status: 'present' }] });
    await recordAttendance(ctx.db, actor(u.teacher), replacement, { marks: [{ studentId: student.id, status: 'absent' }], reason: 'Mistake (fictional)' });
    expect(await ctx.db.select().from(academicAttendance).where(and(eq(academicAttendance.sessionId, replacement as never)))).toHaveLength(1);
  });
});
