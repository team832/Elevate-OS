/**
 * Progress dimensions, support plans, catch-up and Academic reports (owner brief 14, 15, 17).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicAttendance, academicBatchPlacements, academicClassSessions, auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as progressRoute } from '../../src/app/api/v1/students/[id]/progress/route';
import { GET as listInterventionsRoute, POST as createInterventionRoute } from '../../src/app/api/v1/interventions/route';
import { PATCH as updateInterventionRoute } from '../../src/app/api/v1/interventions/[id]/route';
import { POST as generateRoute } from '../../src/app/api/v1/batches/[id]/catch-up/route';
import { PATCH as taskRoute } from '../../src/app/api/v1/catch-up-tasks/[id]/route';
import { GET as reportRoute } from '../../src/app/api/v1/reports/[kind]/route';
import { createAssessment, createSessions, createStudent, enrolManually, listCatchup, staffIdForUser, updateSetting } from '../../src/server';
import { createAssessmentBody } from '../../src/server/schemas';
import { attend, markHeld } from './a4-helpers';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let asha: { id: string; code: string };
let sessionIds: string[];

interface Progress {
  attendanceRule: { definition: string; status: string };
  batches: { attendance: { heldSessions: number; recorded: number; notRecorded: number; ratePercent: number | null }; coverage: { note: string } | null; unpublished: number }[];
  observations: { submittedReviews: number };
  signals: { kind: string; text: string }[];
}
const progress = (user = u.teacher) => callRoute<Progress>(progressRoute, authedRequest(user, `/academic/api/v1/students/${asha.id}/progress`), { id: asha.id });

describe('progress: four separate dimensions with their definitions', () => {
  it('attendance counts delivered sessions within the placement, leaves out future/cancelled, shows unmarked as not recorded', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    asha = await createStudent(ctx.db, coord, { fullName: 'Sample Asha (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: asha.id, batchId: w.batch.id, startDate: '2026-09-03', reason: 'Test (fictional)' });
    const at = (date: string) => ({ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, coord, ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2099-01-05'].map(at));
    sessionIds = sessions.map((s) => s.id);
    const [before, s1, s2, s3, cancelled] = sessionIds as [string, string, string, string, string];
    await markHeld(ctx.db, [before, s1, s2, s3]);
    await ctx.db.update(academicClassSessions).set({ status: 'cancelled', statusReason: 'Holiday (fictional)' }).where(eq(academicClassSessions.id, cancelled as never));
    await attend(ctx.db, actor(u.teacher), s1, [{ studentId: asha.id, status: 'absent' }]);
    await attend(ctx.db, actor(u.teacher), s2, [{ studentId: asha.id, status: 'late' }]);
    expect((await callRoute(progressRoute, buildRequest(`/academic/api/v1/students/${asha.id}/progress`), { id: asha.id })).status).toBe(401);
    expect((await progress(u.counsellor)).status).toBe(403);
    const res = await progress();
    expect(res.status).toBe(200);
    expect(res.data!.batches[0]!.attendance).toMatchObject({ heldSessions: 3, recorded: 2, notRecorded: 1, ratePercent: 50 });
    expect(res.data!.attendanceRule).toMatchObject({ status: 'proposed' });
    expect(res.data!.attendanceRule.definition).toContain('not recorded');
    expect(res.data!.batches[0]!.coverage!.note).toBeTruthy();
    expect(res.data!.observations.submittedReviews).toBe(0);
  });

  it('applies the attendance.denominator setting (late not attended → 0 of 2)', async () => {
    await updateSetting(ctx.db, actor(u.coordinator), 'attendance.denominator', { value: { lateCountsAsAttended: false, excludeExcused: true }, status: 'approved', decisionRef: 'D-900' });
    expect((await progress()).data!.batches[0]!.attendance.ratePercent).toBe(0);
    await updateSetting(ctx.db, actor(u.coordinator), 'attendance.denominator', { value: { lateCountsAsAttended: true, excludeExcused: true }, status: 'proposed' });
  });

  it('support signals are raw facts: the absence streak counts recorded marks only', async () => {
    await attend(ctx.db, actor(u.teacher), sessionIds[3]!, [{ studentId: asha.id, status: 'absent' }]);
    const signals = (await progress()).data!.signals;
    expect(signals).toEqual([expect.objectContaining({ kind: 'absence_streak', text: expect.stringContaining('last 1 recorded class') })]);
  });
});

describe('leave and return (placement gaps)', () => {
  it('sessions between two placements are neither missed nor unrecorded; before the first start = late joiner', async () => {
    const v = await world(ctx.db, u, { teacher: await createTestUser(ctx.db, { roles: ['teacher'] }), teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    const coord = actor(u.coordinator);
    const ria = await createStudent(ctx.db, coord, { fullName: 'Sample Ria (fictional)' });
    const e = await enrolManually(ctx.db, coord, { studentId: ria.id, batchId: v.batch.id, startDate: '2026-09-03', reason: 'Test (fictional)' });
    const at = (date: string) => ({ batchId: v.batch.id, subjectId: v.quant.id, teacherStaffId: v.teacherStaff, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, coord, ['2026-09-02', '2026-09-04', '2026-09-10', '2026-09-17'].map(at));
    await markHeld(ctx.db, sessions.map((s) => s.id));
    const [first] = await ctx.db.select().from(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, e.id));
    await ctx.db.update(academicBatchPlacements).set({ endDate: '2026-09-05', endedReason: 'Leave (fictional)', endedByUserId: u.coordinator.id }).where(eq(academicBatchPlacements.id, first!.id));
    await ctx.db.insert(academicBatchPlacements).values({ enrolmentId: e.id, batchId: v.batch.id, startDate: '2026-09-15', reason: 'Back from leave (fictional)', transferFromPlacementId: first!.id, placedByUserId: u.coordinator.id });
    await attend(ctx.db, actor(u.coordinator), sessions[1]!.id, [{ studentId: ria.id, status: 'present' }]);
    await attend(ctx.db, actor(u.coordinator), sessions[3]!.id, [{ studentId: ria.id, status: 'absent' }]);
    const res = await callRoute<{ batches: { missed: { missed: { date: string; reason: string }[]; unrecorded: number }; attendance: { heldSessions: number } }[] }>(progressRoute, authedRequest(u.coordinator, `/academic/api/v1/students/${ria.id}/progress`), { id: ria.id });
    const b = res.data!.batches[0]!;
    expect(b.missed.missed.map((m) => `${m.date}:${m.reason}`)).toEqual(['2026-09-02:late_joiner', '2026-09-17:absent']);
    expect(b.missed.unrecorded).toBe(0); // 10 Sep fell in the gap
    expect(b.attendance.heldSessions).toBe(2);
  });

  it('an enrolment with no placement history shows attendance as not recorded', async () => {
    const v = await world(ctx.db, u, { teacher: await createTestUser(ctx.db, { roles: ['teacher'] }), teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    const coord = actor(u.coordinator);
    const sam = await createStudent(ctx.db, coord, { fullName: 'Sample Sam (fictional)' });
    const e = await enrolManually(ctx.db, coord, { studentId: sam.id, batchId: v.batch.id, startDate: '2026-09-03', reason: 'Test (fictional)' });
    await ctx.db.delete(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, e.id));
    const res = await callRoute<{ batches: unknown[]; attendanceNotRecorded: { enrolmentId: string; reason: string }[] }>(progressRoute, authedRequest(u.coordinator, `/academic/api/v1/students/${sam.id}/progress`), { id: sam.id });
    expect(res.data!.batches).toEqual([]);
    expect(res.data!.attendanceNotRecorded).toEqual([{ enrolmentId: e.id, batchId: v.batch.id, reason: 'Not recorded — no batch history before 21 Oct 2026' }]);
  });
});

describe('catch-up and support plans', () => {
  it('completing catch-up never changes attendance (brief 15)', async () => {
    const coord = actor(u.coordinator);
    await callRoute(generateRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/catch-up`, { method: 'POST' }), { id: w.batch.id });
    const { ranked } = await listCatchup(ctx.db, coord, w.batch.id);
    expect(ranked.length).toBeGreaterThan(0);
    const before = await ctx.db.select().from(academicAttendance).where(eq(academicAttendance.studentId, asha.id as never));
    for (const r of ranked) {
      const res = await callRoute(taskRoute, authedRequest(u.coordinator, `/academic/api/v1/catch-up-tasks/${r.taskId}`, { method: 'PATCH', json: { status: 'done' } }), { id: r.taskId });
      expect(res.status).toBe(200);
    }
    const after = await ctx.db.select().from(academicAttendance).where(eq(academicAttendance.studentId, asha.id as never));
    expect(after.map((a) => `${a.sessionId}:${a.status}`).sort()).toEqual(before.map((a) => `${a.sessionId}:${a.status}`).sort());
    expect((await progress()).data!.batches[0]!.attendance.ratePercent).toBe(33.3);
  });

  it('a support plan records evidence, goal, action, responsible, due, review and outcome; the teacher sees what to do next', async () => {
    const teacherStaff = (await staffIdForUser(ctx.db, u.teacher.id))!;
    const body = { studentId: asha.id, batchId: w.batch.id, trigger: 'repeated_absence', description: 'Missed classes (fictional)', evidence: 'Absent 4 and 7 Sep (fictional)', goal: 'Attend every class this month', responsibleStaffId: teacherStaff, action: 'Share notes and run a doubt session', dueDate: '2026-10-30', reviewOn: '2026-11-02' };
    expect((await callRoute(createInterventionRoute, authedRequest(u.teacher, '/academic/api/v1/interventions', { json: body }))).status).toBe(403);
    const created = await callRoute<{ id: string; evidence: string; goal: string; reviewOn: string }>(createInterventionRoute, authedRequest(u.coordinator, '/academic/api/v1/interventions', { json: body }));
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ evidence: body.evidence, goal: body.goal, reviewOn: '2026-11-02' });
    const id = created.data!.id;
    const updated = await callRoute<{ reviewOn: string; goal: string }>(updateInterventionRoute, authedRequest(u.coordinator, `/academic/api/v1/interventions/${id}`, { method: 'PATCH', json: { reviewOn: '2026-11-09', goal: 'Attend 3 classes a week' } }), { id });
    expect(updated.data).toMatchObject({ reviewOn: '2026-11-09', goal: 'Attend 3 classes a week' });
    const mine = await callRoute<{ id: string; action: string }[]>(listInterventionsRoute, authedRequest(u.teacher, '/academic/api/v1/interventions?responsible=me'));
    expect(mine.data!.map((i) => i.action)).toEqual(['Share notes and run a doubt session']);
    expect((await callRoute<unknown[]>(listInterventionsRoute, authedRequest(u.teacher2, '/academic/api/v1/interventions?responsible=me'))).data).toEqual([]);
    const audits = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'intervention.updated')));
    expect(audits).toHaveLength(1);
  });
});

describe('reports (print views and CSV, R7)', () => {
  const path = (kind: string, query: string) => `/academic/api/v1/reports/${kind}?${query}`;
  const report = <T = { title: string; columns: string[]; rows: unknown[][]; notes: string[]; definition: string }>(kind: string, query: string, user = u.coordinator) =>
    callRoute<T>(reportRoute, authedRequest(user, path(kind, query)), { kind });

  it('batch attendance report shows its definition; the CSV download matches and is audited', async () => {
    const q = `batchId=${w.batch.id}&from=2026-09-01&to=2026-09-30`;
    const res = await report('attendance', q);
    expect(res.status).toBe(200);
    expect(res.data!.definition).toContain('not recorded');
    expect(res.data!.rows).toEqual([[asha.code, 'Sample Asha (fictional)', '2026-09-03 to open', 3, 0, 1, 0, 2, 0, 0, 33.3]]);
    const csv = await reportRoute(authedRequest(u.teacher, path('attendance', `${q}&format=csv`)), { params: Promise.resolve({ kind: 'attendance' }) });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain(`${asha.code},Sample Asha (fictional),2026-09-03 to open,3,0,1,0,2,0,0,33.3`);
    const audits = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'report.exported'));
    expect(audits).toHaveLength(1);
  });

  it.each([
    ['attendance', 'from=2026-09-01', 400],
    ['attendance', 'batchId=BATCH&from=2026-09-30&to=2026-09-01', 400],
    ['coverage', 'batchId=BATCH', 200],
    ['teacher-week', 'from=2026-09-02', 200],
  ])('%s?%s → %i', async (kind, query, status) => {
    expect((await report(kind, query.replace('BATCH', w.batch.id), u.teacher)).status).toBe(status);
  });

  it('teacher weekly summary is operational only; teachers see only their own week; others are refused', async () => {
    const res = await report('teacher-week', 'from=2026-09-09', u.teacher); // week of Mon 7 Sep
    expect(res.data!.title).toContain('Tina Teacher');
    expect(res.data!.definition).toContain('not HR attendance');
    expect(res.data!.notes[0]).toBe('Planned 2; delivered 1; cancelled 1; logs pending 1.');
    expect((await report('teacher-week', `staffId=${w.teacher2Staff}`, u.teacher)).status).toBe(404);
    expect((await report('teacher-week', `staffId=${w.teacherStaff}&from=2026-09-02`)).status).toBe(200);
    expect((await report('attendance', `batchId=${w.batch.id}`, u.counsellor)).status).toBe(403);
    expect((await callRoute(reportRoute, buildRequest(path('attendance', `batchId=${w.batch.id}`)), { kind: 'attendance' })).status).toBe(401);
  });

  it('a teacher of another batch gets 404 on attendance and assessment reports, JSON and CSV', async () => {
    const other = await world(ctx.db, u, { teacher: await createTestUser(ctx.db, { roles: ['teacher'] }), teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    const a = await createAssessment(ctx.db, actor(u.coordinator), createAssessmentBody.parse({ code: 'OT-1', title: 'Other test (fictional)', kind: 'chapter_test', batchId: other.batch.id, sections: [] }));
    for (const [kind, q] of [['attendance', `batchId=${other.batch.id}`], ['assessment', `assessmentId=${a.id}`]]) {
      expect((await report(kind!, q!, u.teacher)).status).toBe(404);
      const csv = await reportRoute(authedRequest(u.teacher, path(kind!, `${q}&format=csv`)), { params: Promise.resolve({ kind: kind! }) });
      expect(csv.status).toBe(404);
    }
  });
});
