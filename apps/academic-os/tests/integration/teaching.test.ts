import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicClassRecords, auditEvents } from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as listRecordsRoute, POST as recordRoute } from '../../src/app/api/v1/class-records/route';
import { POST as verifyRoute } from '../../src/app/api/v1/class-records/[id]/verify/route';
import { POST as correctRoute } from '../../src/app/api/v1/class-records/[id]/correct/route';
import { GET as getAttendanceRoute, PUT as putAttendanceRoute } from '../../src/app/api/v1/sessions/[id]/attendance/route';
import { createSessions, createStudent, enrolManually } from '../../src/server';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let mine: string; // teacher's session
let theirs: string; // teacher2's session
let future: string;
let students: string[];

const log = (user: typeof u.teacher, sessionId: string, over: Record<string, unknown> = {}) =>
  callRoute<{ id: string; state: string }>(recordRoute, authedRequest(user, '/academic/api/v1/class-records', { json: { sessionId, chapterId: w.ch1.id, completion: 'completed', actualMinutes: 75, ...over } }));

describe('teaching log (class records)', () => {
  it('a teacher logs only their own past sessions', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    const { sessions } = await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacher2Staff, sessionType: 'teaching', date: '2026-09-07', startTime: '10:15', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2099-01-05', startTime: '09:00', durationMinutes: 75 },
    ]);
    [mine, theirs, future] = sessions.map((s) => s.id as string) as [string, string, string];
    expect((await log(u.teacher, theirs)).status).toBe(404);
    expect((await log(u.auditor, mine)).status).toBe(403);
    expect((await log(u.teacher, future)).status).toBe(400);
    expect((await log(u.teacher, mine, { actualMinutes: 0 })).status).toBe(400);
    const ok = await log(u.teacher, mine);
    expect(ok.status).toBe(201);
    expect(ok.data!.state).toBe('submitted');
    expect((await log(u.teacher, mine)).status).toBe(409); // same chapter twice
    expect((await log(u.teacher, mine, { chapterId: w.ch2.id, actualMinutes: 15, completion: 'partial' })).status).toBe(201); // combined lesson
  });

  it('teachers read only records of their sessions; the coordinator reads all', async () => {
    await log(u.teacher2, theirs, { chapterId: w.ch3.id });
    const t = await callRoute<{ sessionId: string }[]>(listRecordsRoute, authedRequest(u.teacher, '/academic/api/v1/class-records'));
    expect(t.data!.every((r) => r.sessionId === mine)).toBe(true);
    const all = await callRoute<unknown[]>(listRecordsRoute, authedRequest(u.coordinator, '/academic/api/v1/class-records'));
    expect(all.data).toHaveLength(3);
  });

  it('only the coordinator verifies; verification is fixed once set', async () => {
    const [record] = await ctx.db.select().from(academicClassRecords).where(and(eq(academicClassRecords.sessionId, mine as never), eq(academicClassRecords.chapterId, w.ch1.id)));
    const id = record!.id;
    expect((await callRoute(verifyRoute, authedRequest(u.teacher, `/academic/api/v1/class-records/${id}/verify`, { method: 'POST' }), { id })).status).toBe(403);
    const ok = await callRoute<{ state: string; verifiedByUserId: string }>(verifyRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records/${id}/verify`, { method: 'POST' }), { id });
    expect(ok.data).toMatchObject({ state: 'verified', verifiedByUserId: u.coordinator.id });
    expect((await callRoute(verifyRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records/${id}/verify`, { method: 'POST' }), { id })).status).toBe(409);
  });

  it('a correction preserves the original unchanged (superseded) and is audited', async () => {
    const [original] = await ctx.db.select().from(academicClassRecords).where(and(eq(academicClassRecords.sessionId, mine as never), eq(academicClassRecords.chapterId, w.ch1.id)));
    const id = original!.id;
    expect((await callRoute(correctRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records/${id}/correct`, { json: { actualMinutes: 70 } }), { id })).status).toBe(400); // reason required
    expect((await callRoute(correctRoute, authedRequest(u.teacher, `/academic/api/v1/class-records/${id}/correct`, { json: { actualMinutes: 70, reason: 'x' } }), { id })).status).toBe(403);
    const res = await callRoute<{ original: { state: string; actualMinutes: number }; correction: { id: string; actualMinutes: number; correctsRecordId: string; state: string } }>(
      correctRoute,
      authedRequest(u.coordinator, `/academic/api/v1/class-records/${id}/correct`, { json: { actualMinutes: 70, reason: 'Class ended early (fictional)' } }),
      { id },
    );
    expect(res.status).toBe(201);
    expect(res.data!.original).toMatchObject({ state: 'superseded', actualMinutes: 75 });
    expect(res.data!.correction).toMatchObject({ actualMinutes: 70, correctsRecordId: id, state: 'verified' });
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'class_record.corrected')));
    expect(audit).toHaveLength(1);
    expect((audit[0]!.before as { actualMinutes: number }).actualMinutes).toBe(75);
    // the superseded original cannot be corrected again
    expect((await callRoute(correctRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records/${id}/correct`, { json: { actualMinutes: 60, reason: 'again' } }), { id })).status).toBe(409);
  });
});

describe('attendance', () => {
  it('roster = active enrolments started by the session date; teacher records own session only', async () => {
    const coord = actor(u.coordinator);
    const s1 = await createStudent(ctx.db, coord, { fullName: 'Asha Example (fictional)', guardianPhone: '+919000000101' });
    const s2 = await createStudent(ctx.db, coord, { fullName: 'Bilal Example (fictional)' });
    const late = await createStudent(ctx.db, coord, { fullName: 'Chitra Example (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: s1.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: s2.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: late.id, batchId: w.batch.id, startDate: '2026-09-20', reason: 'Late joiner (fictional)' });
    students = [s1.id, s2.id, late.id];
    const roster = await callRoute<{ roster: { studentId: string; mark: unknown }[]; notRecorded: number }>(getAttendanceRoute, authedRequest(u.teacher, `/academic/api/v1/sessions/${mine}/attendance`), { id: mine });
    expect(roster.status).toBe(200);
    expect(roster.data!.roster.map((r) => r.studentId).sort()).toEqual([s1.id, s2.id].sort());
    expect(roster.data!.notRecorded).toBe(2);
    expect((await callRoute(getAttendanceRoute, authedRequest(u.teacher, `/academic/api/v1/sessions/${theirs}/attendance`), { id: theirs })).status).toBe(404);

    const put = (user: typeof u.teacher, sessionId: string, marks: unknown[]) =>
      callRoute<{ recorded: number }>(putAttendanceRoute, authedRequest(user, `/academic/api/v1/sessions/${sessionId}/attendance`, { method: 'PUT', json: { marks } }), { id: sessionId });
    expect((await put(u.teacher, theirs, [{ studentId: s1.id, status: 'present' }])).status).toBe(404);
    expect((await put(u.auditor, mine, [{ studentId: s1.id, status: 'present' }])).status).toBe(403);
    expect((await put(u.teacher, mine, [{ studentId: late.id, status: 'present' }])).status).toBe(400); // not on the roster yet
    expect((await put(u.teacher, mine, [{ studentId: s1.id, status: 'present' }, { studentId: s1.id, status: 'absent' }])).status).toBe(400);
    expect((await put(u.teacher, mine, [{ studentId: s1.id, status: 'present' }, { studentId: s2.id, status: 'absent' }])).data!.recorded).toBe(2);
    const corrected = await put(u.teacher, mine, [{ studentId: s2.id, status: 'excused', note: 'Medical (fictional)' }]);
    expect(corrected.status).toBe(200);
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, mine), eq(auditEvents.action, 'attendance.corrected')));
    expect(audit).toHaveLength(1);
    expect(students).toHaveLength(3);
  });
});
