/** Brief §10, acceptance tests 7, 8 and 9: roster from placements + demo attendees, explicit marks, audited corrections. */
import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicAttendance, academicBatchPlacements, academicClassSessions, auditEvents, academicEnrolments, students as coreStudents } from '@elevate/database';
import { opsDemoSessionsForDayV1Schema } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as getAttendanceRoute, PUT as putAttendanceRoute } from '../../src/app/api/v1/sessions/[id]/attendance/route';
import { POST as markRemainingRoute } from '../../src/app/api/v1/sessions/[id]/attendance/mark-remaining/route';
import { DELETE as removeDemoRoute } from '../../src/app/api/v1/demo-attendees/[id]/route';
import { GET as demoFeedRoute } from '../../src/app/api/internal/v1/demo-attendance/route';
import { addDemoAttendee, assignSubstitute, createSessions, createStudent, demoCandidates, enrolManually, markDelivered, type DemoLoader } from '../../src/server';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
const ids: Record<string, string> = {};

type Roster = { roster: { studentId: string; onPlacement: boolean; mark: { status: string } | null }[]; demoAttendees: { id: string; status: string; demoDayNumber: number }[]; counts: Record<string, number>; history: { action: string; reason: string | null }[] };
const roster = (user: Users['teacher'], id: string) => callRoute<Roster>(getAttendanceRoute, authedRequest(user, `/academic/api/v1/sessions/${id}/attendance`), { id });
const put = (user: Users['teacher'], id: string, json: Record<string, unknown>) => callRoute<{ recorded: number; changed: number }>(putAttendanceRoute, authedRequest(user, `/academic/api/v1/sessions/${id}/attendance`, { method: 'PUT', json }), { id });
const opsDay = (items: ({ startsAt: string } & Record<string, unknown>)[]): DemoLoader => async (date) => ({ status: 'available', fetchedAt: new Date().toISOString(), data: opsDemoSessionsForDayV1Schema.parse({ items: items.filter((i) => i.startsAt.startsWith(date)) }) });
const opsDown: DemoLoader = async () => ({ status: 'unavailable', reason: 'Could not reach the source', fetchedAt: new Date().toISOString() });

describe('roster (test 7): placements on the session date + demo attendees; the roster used is kept', () => {
  it('excludes students outside their placement dates and keeps a marked student after the placement ends', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    for (const [key, name, start] of [['asha', 'Asha Sample Student', '2026-09-01'], ['bilal', 'Bilal Sample Student', '2026-09-01'], ['chitra', 'Chitra Sample Student', '2026-09-20']] as const) {
      const s = await createStudent(ctx.db, coord, { fullName: name });
      await enrolManually(ctx.db, coord, { studentId: s.id, batchId: w.batch.id, startDate: start, reason: 'Test (fictional)' });
      ids[key] = s.id;
    }
    const { sessions } = await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-25', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, subjectId: w.verbal.id, teacherStaffId: w.teacher2Staff, sessionType: 'teaching', date: '2026-09-08', startTime: '09:00', durationMinutes: 75 },
    ]);
    const [first, second, third] = sessions.map((s) => s.id);
    Object.assign(ids, { early: first, later: second, verbal: third });
    const early = await roster(u.teacher, ids.early!);
    expect(early.data!.roster.map((r) => r.studentId).sort()).toEqual([ids.asha, ids.bilal].sort());
    expect((await roster(u.teacher, ids.later!)).data!.roster).toHaveLength(3);

    expect((await put(u.teacher, ids.later!, { marks: [{ studentId: ids.bilal, status: 'present' }] })).status).toBe(200);
    // Bilal's placement ends before the later class: he stays on its roster (marked), flagged as no longer placed.
    const [enrolment] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.studentId, ids.bilal as never));
    await ctx.db.update(academicBatchPlacements).set({ endDate: '2026-09-21', endedByUserId: u.coordinator.id, endedReason: 'Transfer (fictional)' }).where(eq(academicBatchPlacements.enrolmentId, enrolment!.id));
    const later = (await roster(u.teacher, ids.later!)).data!;
    expect(later.roster.find((r) => r.studentId === ids.bilal)).toMatchObject({ onPlacement: false, mark: { status: 'present' } });
    expect(later.roster.find((r) => r.studentId === ids.chitra)).toMatchObject({ onPlacement: true, mark: null });
    expect((await put(u.teacher, ids.later!, { marks: [{ studentId: ids.chitra, status: 'present' }] })).status).toBe(200);
  });

  it('demo attendees come from Business Ops for the class date with their day number; Ops down = 409, never an empty list', async () => {
    const [core] = await ctx.db.insert(coreStudents).values({ fullName: 'Dev Sample Demo Student', isSample: true }).returning();
    const items = [
      { demoSessionId: crypto.randomUUID(), coreStudentId: core!.id, displayName: 'Dev Sample Demo Student', dayNumber: 1, subject: 'Quant', startsAt: '2026-09-07T03:30:00.000Z', isSample: true },
      { demoSessionId: crypto.randomUUID(), coreStudentId: core!.id, displayName: 'Dev Sample Demo Student', dayNumber: 2, subject: 'Verbal', startsAt: '2026-09-08T03:30:00.000Z', isSample: true },
    ];
    ids.day1 = items[0]!.demoSessionId;
    ids.day2 = items[1]!.demoSessionId;
    const ops = opsDay(items);
    await expect(addDemoAttendee(ctx.db, actor(u.teacher), { sessionId: ids.early!, opsDemoSessionId: ids.day1 }, opsDown)).rejects.toMatchObject({ status: 409 });
    expect(await demoCandidates(ctx.db, actor(u.teacher), ids.early!, opsDown)).toMatchObject({ status: 'unavailable' });
    await expect(addDemoAttendee(ctx.db, actor(u.teacher), { sessionId: ids.early!, opsDemoSessionId: ids.day2 }, ops)).rejects.toMatchObject({ status: 400 }); // other date
    await expect(addDemoAttendee(ctx.db, actor(u.teacher2), { sessionId: ids.early!, opsDemoSessionId: ids.day1 }, ops)).rejects.toMatchObject({ status: 404 }); // not their class
    const added = await addDemoAttendee(ctx.db, actor(u.teacher), { sessionId: ids.early!, opsDemoSessionId: ids.day1 }, ops);
    expect(added).toMatchObject({ demoDayNumber: 1, status: 'not_recorded', coreStudentId: core!.id, isSample: true });
    await expect(addDemoAttendee(ctx.db, actor(u.teacher), { sessionId: ids.early!, opsDemoSessionId: ids.day1 }, ops)).rejects.toMatchObject({ status: 409 });
    expect((await demoCandidates(ctx.db, actor(u.teacher), ids.early!, ops)) as { data: { items: unknown[] } }).toMatchObject({ data: { items: [] } });
    const day2 = await addDemoAttendee(ctx.db, actor(u.coordinator), { sessionId: ids.verbal!, opsDemoSessionId: ids.day2 }, ops);
    ids.attendee1 = added.id;
    ids.attendee2 = day2.id;
    expect((await roster(u.teacher, ids.early!)).data!.demoAttendees).toEqual([expect.objectContaining({ id: added.id, demoDayNumber: 1 })]);
  });
});

describe('attendance (test 9): explicit marks, audited corrections, unknown is never present or zero', () => {
  it('counts keep "not recorded" separate and recording does not mark the class delivered (R12)', async () => {
    const before = (await roster(u.teacher, ids.early!)).data!;
    expect(before.counts).toEqual({ present: 0, late: 0, partial: 0, absent: 0, excused: 0, notRecorded: 2 });
    expect((await put(u.teacher, ids.early!, { marks: [] })).status).toBe(400);
    expect((await put(u.teacher, ids.early!, { marks: [{ studentId: ids.asha, status: 'absent' }] })).status).toBe(200);
    const after = (await roster(u.teacher, ids.early!)).data!;
    expect(after.counts).toMatchObject({ absent: 1, present: 0, notRecorded: 1 });
    const [session] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, ids.early as never));
    expect(session).toMatchObject({ status: 'scheduled', deliveredAt: null });
  });

  it('"Mark all remaining present" fills only unrecorded rows (students and demo attendees)', async () => {
    const url = `/academic/api/v1/sessions/${ids.early}/attendance/mark-remaining`;
    expect((await callRoute(markRemainingRoute, buildRequest(url, { method: 'POST' }), { id: ids.early! })).status).toBe(401);
    expect((await callRoute(markRemainingRoute, authedRequest(u.teacher2, url, { method: 'POST' }), { id: ids.early! })).status).toBe(404);
    const res = await callRoute<{ marked: number }>(markRemainingRoute, authedRequest(u.teacher, url, { method: 'POST' }), { id: ids.early! });
    expect(res.data!.marked).toBe(2);
    const data = (await roster(u.teacher, ids.early!)).data!;
    expect(data.roster.find((r) => r.studentId === ids.asha)!.mark!.status).toBe('absent');
    expect(data.counts).toMatchObject({ absent: 1, present: 1, notRecorded: 0 });
    expect(data.demoAttendees[0]!.status).toBe('present');
    expect((await callRoute<{ marked: number }>(markRemainingRoute, authedRequest(u.teacher, url, { method: 'POST' }), { id: ids.early! })).data!.marked).toBe(0);
  });

  it('changing a mark (student or demo) needs a reason; the history lists who, what and why', async () => {
    const change = { marks: [{ studentId: ids.asha, status: 'late' }], demoMarks: [{ attendeeId: ids.attendee1, status: 'late' }] };
    expect((await put(u.teacher, ids.early!, change)).status).toBe(400);
    expect((await put(u.teacher2, ids.early!, { ...change, reason: 'x' })).status).toBe(404);
    const ok = await put(u.coordinator, ids.early!, { ...change, reason: 'Arrived at 09:20 (fictional)' });
    expect(ok.data).toMatchObject({ changed: 2 });
    const data = (await roster(u.teacher, ids.early!)).data!;
    expect(data.history[0]).toMatchObject({ action: 'attendance.corrected', reason: 'Arrived at 09:20 (fictional)' });
    expect(data.history.map((h) => h.action)).toEqual(expect.arrayContaining(['attendance.recorded', 'attendance.bulk_present']));
    expect((await put(u.teacher, ids.early!, { demoMarks: [{ attendeeId: crypto.randomUUID(), status: 'present' }] })).status).toBe(400);
    expect((await put(u.teacher, ids.early!, { demoMarks: [{ attendeeId: ids.attendee1, status: 'late' }, { attendeeId: ids.attendee1, status: 'present' }], reason: 'x' })).status).toBe(400); // duplicate
    // A note on an unchanged status is saved and audited without a reason.
    expect((await put(u.teacher, ids.early!, { marks: [{ studentId: ids.asha, status: 'late', note: 'Bus delay (fictional)' }] })).data).toMatchObject({ changed: 1 });
    const [mark] = await ctx.db.select().from(academicAttendance).where(and(eq(academicAttendance.sessionId, ids.early as never), eq(academicAttendance.studentId, ids.asha as never)));
    expect(mark).toMatchObject({ status: 'late', note: 'Bus delay (fictional)' });
    expect((await roster(u.teacher, ids.early!)).data!.history[0]).toMatchObject({ action: 'attendance.corrected', reason: null });
    // Leaving the note out keeps the saved note; the audit shows the note on both sides.
    expect((await put(u.teacher, ids.early!, { marks: [{ studentId: ids.asha, status: 'present' }], reason: 'Was on time (fictional)' })).status).toBe(200);
    const [kept] = await ctx.db.select().from(academicAttendance).where(and(eq(academicAttendance.sessionId, ids.early as never), eq(academicAttendance.studentId, ids.asha as never)));
    expect(kept).toMatchObject({ status: 'present', note: 'Bus delay (fictional)' });
    const [last] = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, ids.early!), eq(auditEvents.action, 'attendance.corrected'))).orderBy(desc(auditEvents.at)).limit(1);
    expect(last!.before).toEqual([expect.objectContaining({ studentId: ids.asha, status: 'late', note: 'Bus delay (fictional)' })]);
    expect(last!.after).toEqual([expect.objectContaining({ studentId: ids.asha, status: 'present', note: 'Bus delay (fictional)' })]);
  });

  it('a demo attendee with a recorded mark cannot be removed; an unmarked one can (with a reason)', async () => {
    const del = (id: string, reason = 'Added by mistake (fictional)') => callRoute(removeDemoRoute, authedRequest(u.coordinator, `/academic/api/v1/demo-attendees/${id}`, { method: 'DELETE', json: { reason } }), { id });
    expect((await del(ids.attendee1!)).status).toBe(409);
    expect((await del(ids.attendee2!, '')).status).toBe(400);
    expect((await del(ids.attendee2!)).status).toBe(200);
  });
});

describe('demo attendance feed for Ops (test 8): status, day and actual teachers incl. a substitute', () => {
  it('serves Ops only, and names the actual teachers once a class is delivered', async () => {
    const ops = opsDay([{ demoSessionId: ids.day2!, coreStudentId: (await ctx.db.select().from(coreStudents).where(eq(coreStudents.fullName, 'Dev Sample Demo Student')))[0]!.id, displayName: 'Dev Sample Demo Student', dayNumber: 2, subject: 'Verbal', startsAt: '2026-09-08T03:30:00.000Z', isSample: true }]);
    await addDemoAttendee(ctx.db, actor(u.coordinator), { sessionId: ids.verbal!, opsDemoSessionId: ids.day2! }, ops);
    await assignSubstitute(ctx.db, actor(u.coordinator), ids.verbal!, { staffId: w.teacherStaff, reason: 'Teacher away (fictional)' });
    await markDelivered(ctx.db, actor(u.teacher), ids.early!, {});
    await markDelivered(ctx.db, actor(u.teacher), ids.verbal!, {}); // the substitute marks it
    const feed = (query: string, caller = 'ops') =>
      callRoute<{ items: { opsDemoSessionId: string; status: string; teacherStaffIds: string[]; teacherNames: string[] }[] }>(
        demoFeedRoute,
        buildRequest(`/academic/api/internal/v1/demo-attendance${query}`, { headers: { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': caller } }),
      );
    expect((await feed(`?ids=${ids.day1}`, 'marketing')).status).toBe(403);
    expect((await feed('?ids=not-a-uuid')).status).toBe(400);
    const res = (await feed(`?ids=${ids.day1},${ids.day2}`)).data!.items;
    expect(res.find((i) => i.opsDemoSessionId === ids.day1)).toMatchObject({ status: 'late', teacherStaffIds: [w.teacherStaff], teacherNames: ['Tina Teacher (fictional)'] });
    expect(res.find((i) => i.opsDemoSessionId === ids.day2)).toMatchObject({ status: 'not_recorded', teacherStaffIds: [w.teacherStaff] });
    const [row] = await ctx.db.select().from(academicClassSessions).where(and(eq(academicClassSessions.id, ids.verbal as never)));
    expect(row!.teacherStaffId).toBe(w.teacher2Staff); // the planned teacher stays on record
  });
});
