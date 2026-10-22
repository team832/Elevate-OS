/** Brief §4 and §6: teacher My day, coordinator exceptions, teacher directory/profile, `academic.teacher_activity` v1. */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicBatchPlacements, academicInterventions, students as coreStudents } from '@elevate/database';
import { academicTeacherActivityV1Schema, opsDemoSessionsForDayV1Schema } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as teachersRoute } from '../../src/app/api/v1/teachers/route';
import { GET as teacherRoute } from '../../src/app/api/v1/teachers/[staffId]/route';
import { GET as activityRoute } from '../../src/app/api/internal/v1/teachers/[staffId]/activity/route';
import { addDemoAttendee, attendanceWorklist, coordinatorOverview, createReview, createSessions, createStudent, enrolManually, markDelivered, recordAttendance, teacherDay } from '../../src/server';
import { createReviewBody } from '../../src/server/schemas-teaching';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
const now = new Date('2026-09-16T04:30:00Z'); // Wednesday 10:00 IST
const ids: Record<string, string> = {};

describe('teacher My day', () => {
  it('puts the next class first, then attendance, logs, demo feedback and support follow-ups, each with its range', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    const asha = await createStudent(ctx.db, coord, { fullName: 'Asha Sample Student' });
    await enrolManually(ctx.db, coord, { studentId: asha.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const bilal = await createStudent(ctx.db, coord, { fullName: 'Bilal Sample Student' });
    const left = await enrolManually(ctx.db, coord, { studentId: bilal.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await ctx.db.update(academicBatchPlacements).set({ endDate: '2026-09-02', endedByUserId: u.coordinator.id, endedReason: 'Left the batch (fictional)' }).where(eq(academicBatchPlacements.enrolmentId, left.id));
    const at = (date: string, startTime: string) => ({ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching' as const, date, startTime, durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, coord, [at('2026-09-14', '09:00'), at('2026-09-16', '09:00'), at('2026-09-16', '11:00'), at('2026-09-15', '09:00')]);
    const [monday, current, later, tuesday] = sessions.map((s) => s.id);
    Object.assign(ids, { monday, now: current, later, tuesday });
    await recordAttendance(ctx.db, actor(u.teacher), ids.tuesday!, { marks: [{ studentId: asha.id, status: 'present' }] }, now);
    await markDelivered(ctx.db, actor(u.teacher), ids.tuesday!, {}, now);
    const [core] = await ctx.db.insert(coreStudents).values({ fullName: 'Dev Sample Demo Student', isSample: true }).returning();
    const demo = { demoSessionId: crypto.randomUUID(), coreStudentId: core!.id, displayName: 'Dev Sample Demo Student', dayNumber: 1, subject: 'Quant', startsAt: '2026-09-15T03:30:00.000Z', isSample: true };
    const attendee = await addDemoAttendee(ctx.db, actor(u.teacher), { sessionId: ids.tuesday!, opsDemoSessionId: demo.demoSessionId }, async () => ({ status: 'available', fetchedAt: now.toISOString(), data: opsDemoSessionsForDayV1Schema.parse({ items: [demo] }) }));
    await recordAttendance(ctx.db, actor(u.teacher), ids.tuesday!, { demoMarks: [{ attendeeId: attendee.id, status: 'present' }] }, now);
    await ctx.db.insert(academicInterventions).values({ studentId: asha.id, trigger: 'other', description: 'Missed practice (fictional)', responsibleStaffId: w.teacherStaff, action: 'Call after class', dueDate: '2026-09-15', createdByUserId: u.coordinator.id });

    const day = await teacherDay(ctx.db, actor(u.teacher), now);
    if (day.kind !== 'teacher') throw new Error('expected a teacher view');
    expect(day.window).toEqual({ from: '2026-09-03', to: '2026-09-16' });
    expect(day.next!.id).toBe(ids.now); // 09:00–10:15 is still running at 10:00
    expect(day.todays.map((s) => s.id)).toEqual([ids.later]);
    expect(day.attendanceMissing.map((s) => [s.id, s.missing])).toEqual([[ids.monday, 1]]); // Bilal's placement had ended
    expect(day.logsMissing.map((s) => s.id).sort()).toEqual([ids.monday, ids.tuesday].sort());
    expect(day.demoAwaitingFeedback.map((d) => d.displayName)).toEqual(['Dev Sample Demo Student']);
    expect(day.support).toEqual([expect.objectContaining({ studentName: 'Asha Sample Student', due: true })]);
    expect(day.hrAttendance).toBe('HR attendance unavailable');
    expect(day.batches.map((b) => b.id)).toEqual([w.batch.id]);
    expect(day.draftReviews).toBe(0);
    expect(await teacherDay(ctx.db, actor(u.coordinator), now)).toMatchObject({ kind: 'no_staff' });

    await createReview(ctx.db, actor(u.teacher), createReviewBody.parse({ reviewType: 'periodic_progress', academicStudentId: asha.id }), now);
    expect(await teacherDay(ctx.db, actor(u.teacher), now)).toMatchObject({ draftReviews: 1 });
  });

  it('student attendance worklist: own classes newest first, unmarked placed students counted only for ended classes', async () => {
    const list = await attendanceWorklist(ctx.db, actor(u.teacher), now);
    expect(list.window).toEqual({ from: '2026-09-03', to: '2026-09-16' });
    expect(list.rows.map((s) => [s.id, s.ended, s.unmarked])).toEqual([[ids.later, false, 1], [ids.now, false, 1], [ids.tuesday, true, 0], [ids.monday, true, 1]]);
    expect((await attendanceWorklist(ctx.db, actor(u.teacher2), now)).rows).toEqual([]); // not their classes
    expect((await attendanceWorklist(ctx.db, actor(u.coordinator), now)).rows).toHaveLength(4);
    await expect(attendanceWorklist(ctx.db, actor(u.counsellor), now)).rejects.toMatchObject({ status: 403 });
  });

  it('coordinator: planned vs delivered vs not recorded per range, missing attendance/logs, awaiting batch', async () => {
    const o = await coordinatorOverview(ctx.db, actor(u.coordinator), now);
    expect(o.todayFigures).toEqual({ range: { from: '2026-09-16', to: '2026-09-16' }, planned: 2, delivered: 0, cancelled: 0, notRecorded: 0 });
    expect(o.weekFigures).toMatchObject({ range: { from: '2026-09-14', to: '2026-09-20' }, planned: 4, delivered: 1, notRecorded: 1 });
    expect(o.attendanceMissing).toEqual({ range: { from: '2026-09-14', to: '2026-09-16' }, count: 1 });
    expect(o.logsMissing.count).toBe(1); // delivered without a submitted log: Tuesday only (Monday was never marked delivered)
    expect(o.awaitingBatch).toBe(1); // Bilal: active enrolment, no current placement
    expect(o.uncovered.sessions).toEqual([]);
    expect(o.coverage).toEqual([expect.objectContaining({ batchId: w.batch.id, hasPlan: false })]);
    expect(o.openSupport).toBe(1);
    await expect(coordinatorOverview(ctx.db, actor(u.counsellor), now)).rejects.toMatchObject({ status: 403 });
  });
});

describe('teachers directory and profile', () => {
  it('lists assigned teachers (a teacher sees only themselves); profile hours are separate figures; no ratings', async () => {
    expect((await callRoute(teachersRoute, authedRequest(u.counsellor, '/academic/api/v1/teachers'))).status).toBe(403);
    const all = await callRoute<{ staffId: string; subjects: string[] }[]>(teachersRoute, authedRequest(u.coordinator, '/academic/api/v1/teachers'));
    expect(all.data!.find((t) => t.staffId === w.teacherStaff)!.subjects).toEqual(['Quant']);
    const mine = await callRoute<{ staffId: string }[]>(teachersRoute, authedRequest(u.teacher, '/academic/api/v1/teachers'));
    expect(mine.data!.map((t) => t.staffId)).toEqual([w.teacherStaff]);
    const path = (id: string, q = '?from=2026-09-01&to=2026-09-30') => `/academic/api/v1/teachers/${id}${q}`;
    expect((await callRoute(teacherRoute, authedRequest(u.teacher, path(w.teacher2Staff)), { staffId: w.teacher2Staff })).status).toBe(404);
    const profile = await callRoute<{ hours: Record<string, number>; hrAttendance: string }>(teacherRoute, authedRequest(u.teacher, path(w.teacherStaff)), { staffId: w.teacherStaff });
    expect(profile.data!.hours).toEqual({ plannedMinutes: 225, deliveredMinutes: 75, cancelledMinutes: 0, substitutedMinutes: 0 });
    expect(profile.data!.hrAttendance).toBe('HR attendance unavailable');
    expect(JSON.stringify(profile.data)).not.toMatch(/rating|rank/i);
  });

  it('serves academic.teacher_activity v1 to Ops only', async () => {
    const call = (caller?: string, q = '?from=2026-09-01&to=2026-09-30') =>
      callRoute(activityRoute, buildRequest(`/academic/api/internal/v1/teachers/${w.teacherStaff}/activity${q}`, { headers: caller ? { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': caller } : {} }), { staffId: w.teacherStaff });
    expect((await call()).status).toBe(401);
    expect((await call('marketing')).status).toBe(403);
    expect((await call('ops', '?from=2026-09-30&to=2026-09-01')).status).toBe(400);
    const res = await call('ops');
    const data = academicTeacherActivityV1Schema.parse(res.data);
    expect(data.sessions.delivered).toMatchObject({ status: 'ok', value: 1 });
    expect(data.sessions.planned).toMatchObject({ value: 3 });
    expect(data.logsPending).toMatchObject({ value: 4 }); // all four September classes are past by the real clock; none has a submitted log
  });
});
