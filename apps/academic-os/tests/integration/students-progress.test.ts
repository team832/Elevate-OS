import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvents } from '@elevate/database';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as listStudentsRoute, POST as createStudentRoute } from '../../src/app/api/v1/students/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import { GET as progressRoute } from '../../src/app/api/v1/students/[id]/progress/route';
import { POST as enrolRoute } from '../../src/app/api/v1/enrolments/route';
import { GET as catchupRoute, POST as generateRoute } from '../../src/app/api/v1/batches/[id]/catch-up/route';
import { PATCH as taskRoute } from '../../src/app/api/v1/catch-up-tasks/[id]/route';
import { GET as listInterventionsRoute, POST as createInterventionRoute } from '../../src/app/api/v1/interventions/route';
import { PATCH as updateInterventionRoute } from '../../src/app/api/v1/interventions/[id]/route';
import { PUT as settingRoute } from '../../src/app/api/v1/settings/[key]/route';
import { createAssessment, createSessions, staffIdForUser } from '../../src/server';
import { attend, markHeld } from './a4-helpers';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let other: World;
let asha: { id: string; code: string };
let ravi: { id: string };

const enrol = (studentId: string, batchId: string, startDate: string, reason = 'Test enrolment (fictional)') =>
  callRoute<{ id: string; lateJoiner: boolean }>(enrolRoute, authedRequest(u.coordinator, '/academic/api/v1/enrolments', { json: { studentId, batchId, startDate, reason } }));

describe('students and manual enrolment', () => {
  it('creates students, enrols with a reason, and enforces capacity and duplicates', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u, { capacity: 2 });
    const t3 = await createTestUser(ctx.db, { roles: ['teacher'] });
    const t4 = await createTestUser(ctx.db, { roles: ['teacher'] });
    other = await world(ctx.db, u, { teacher: t3, teacher2: t4 });
    const mk = (fullName: string, extra: Record<string, unknown> = {}) =>
      callRoute<{ id: string; code: string; email: string | null }>(createStudentRoute, authedRequest(u.coordinator, '/academic/api/v1/students', { json: { fullName, ...extra } }));
    expect((await callRoute(createStudentRoute, authedRequest(u.teacher, '/academic/api/v1/students', { json: { fullName: 'X (fictional)' } }))).status).toBe(403);
    const a = await mk('Asha Example (fictional)', { email: 'asha@example.test', guardianPhone: '+919000000301' });
    expect(a.status).toBe(201);
    expect(a.data!.code).toMatch(/^STU-[0-9A-F]{8}$/);
    asha = a.data!;
    ravi = (await mk('Ravi Example (fictional)')).data!;
    const zoya = (await mk('Zoya Example (fictional)')).data!;
    expect((await enrol(asha.id, w.batch.id, '2026-09-01', '')).status).toBe(400);
    expect((await enrol(asha.id, w.batch.id, '2026-09-01')).status).toBe(201);
    expect((await enrol(asha.id, w.batch.id, '2026-09-01')).status).toBe(409); // duplicate active enrolment
    const late = await enrol(ravi.id, w.batch.id, '2026-09-10');
    expect(late.data!.lateJoiner).toBe(true);
    expect((await enrol(zoya.id, w.batch.id, '2026-09-10')).status).toBe(409); // capacity 2
    expect((await enrol(zoya.id, other.batch.id, '2026-09-01')).status).toBe(201);
  });

  it('teachers see only students of their batches, without contact details; counsellors and marketing see none', async () => {
    const t = await callRoute<{ id: string; email: string | null; contactsHidden: boolean }[]>(listStudentsRoute, authedRequest(u.teacher, '/academic/api/v1/students'));
    expect(t.data!.map((s) => s.id).sort()).toEqual([asha.id, ravi.id].sort());
    expect(t.data!.every((s) => s.contactsHidden && s.email === null)).toBe(true);
    const c = await callRoute<{ id: string; email: string | null }[]>(listStudentsRoute, authedRequest(u.coordinator, '/academic/api/v1/students'));
    expect(c.data!).toHaveLength(3);
    expect(c.data!.find((s) => s.id === asha.id)!.email).toBe('asha@example.test');
    for (const user of [u.counsellor, u.marketing]) {
      expect((await callRoute(listStudentsRoute, authedRequest(user, '/academic/api/v1/students'))).status).toBe(403);
    }
    const zoyaId = c.data!.find((s) => ![asha.id, ravi.id].includes(s.id))!.id;
    expect((await callRoute(studentRoute, authedRequest(u.teacher, `/academic/api/v1/students/${zoyaId}`), { id: zoyaId })).status).toBe(404);
    expect((await callRoute(studentRoute, authedRequest(u.auditor, `/academic/api/v1/students/${zoyaId}`), { id: zoyaId })).status).toBe(200);
  });
});

describe('progress, catch-up and interventions', () => {
  it('progress shows missing attendance as missing and insufficient data for the trend', async () => {
    const res = await callRoute<{ batches: { attendance: { ratePercent: number | null }; trend: { status: string } }[] }>(progressRoute, authedRequest(u.teacher, `/academic/api/v1/students/${asha.id}/progress`), { id: asha.id });
    expect(res.status).toBe(200);
    expect(res.data!.batches[0]).toMatchObject({ attendance: { ratePercent: null }, trend: { status: 'insufficient_data' } });
  });

  it('generates catch-up tasks idempotently and ranks them with explained factors', async () => {
    const coord = actor(u.coordinator);
    const { sessions } = await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch2.id, sessionType: 'teaching', date: '2026-09-14', startTime: '09:00', durationMinutes: 75 },
    ]);
    await markHeld(ctx.db, sessions.map((s) => s.id));
    await attend(ctx.db, actor(u.teacher), sessions[0]!.id, [{ studentId: asha.id, status: 'present' }]);
    await attend(ctx.db, actor(u.teacher), sessions[1]!.id, [{ studentId: asha.id, status: 'absent' }, { studentId: ravi.id, status: 'present' }]);
    await createAssessment(ctx.db, coord, { code: uniq('T-'), title: 'Algebra test (fictional)', kind: 'chapter_test', batchId: w.batch.id, chapterIds: [w.ch2.id], scheduledDate: '2099-01-01', sections: [] });
    expect((await callRoute(generateRoute, authedRequest(u.teacher, `/academic/api/v1/batches/${w.batch.id}/catch-up`, { method: 'POST' }), { id: w.batch.id })).status).toBe(403);
    const gen = await callRoute<{ created: number }>(generateRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/catch-up`, { method: 'POST' }), { id: w.batch.id });
    expect(gen.data!.created).toBe(2); // asha absent on 14 Sep; ravi joined 10 Sep after the 7 Sep class
    const again = await callRoute<{ created: number }>(generateRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/catch-up`, { method: 'POST' }), { id: w.batch.id });
    expect(again.data!.created).toBe(0);
    const list = await callRoute<{ ranked: { taskId: string; studentId: string; rank: number; score: number; explanation: string; task: { reason: string } }[] }>(catchupRoute, authedRequest(u.teacher, `/academic/api/v1/batches/${w.batch.id}/catch-up`), { id: w.batch.id });
    expect(list.status).toBe(200);
    expect(list.data!.ranked.map((r) => r.task.reason).sort()).toEqual(['absent', 'late_joiner']);
    expect(list.data!.ranked.every((r) => r.explanation.startsWith(`Score ${r.score}`))).toBe(true);
    expect((await callRoute(catchupRoute, authedRequest(u.teacher, `/academic/api/v1/batches/${other.batch.id}/catch-up`), { id: other.batch.id })).status).toBe(404);
    const taskId = list.data!.ranked[0]!.taskId;
    const done = await callRoute<{ status: string; completedAt: string }>(taskRoute, authedRequest(u.coordinator, `/academic/api/v1/catch-up-tasks/${taskId}`, { method: 'PATCH', json: { status: 'done' } }), { id: taskId });
    expect(done.data!.status).toBe('done');
    const after = await callRoute<{ ranked: unknown[]; closed: number }>(catchupRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/catch-up`), { id: w.batch.id });
    expect(after.data).toMatchObject({ closed: 1 });
    expect(after.data!.ranked).toHaveLength(1);
  });

  it('interventions need a responsible staff member and an outcome to resolve; teachers read their students only', async () => {
    const staff = (await staffIdForUser(ctx.db, u.teacher.id))!;
    const body = { studentId: asha.id, batchId: w.batch.id, trigger: 'repeated_absence', description: 'Missed classes (fictional)', responsibleStaffId: staff, action: 'Call guardian' };
    expect((await callRoute(createInterventionRoute, authedRequest(u.teacher, '/academic/api/v1/interventions', { json: body }))).status).toBe(403);
    expect((await callRoute(createInterventionRoute, authedRequest(u.coordinator, '/academic/api/v1/interventions', { json: { ...body, responsibleStaffId: undefined } }))).status).toBe(400);
    const created = await callRoute<{ id: string; status: string }>(createInterventionRoute, authedRequest(u.coordinator, '/academic/api/v1/interventions', { json: body }));
    expect(created.status).toBe(201);
    const id = created.data!.id;
    expect((await callRoute(updateInterventionRoute, authedRequest(u.coordinator, `/academic/api/v1/interventions/${id}`, { method: 'PATCH', json: { status: 'resolved' } }), { id })).status).toBe(400);
    const resolved = await callRoute<{ status: string; resolvedAt: string }>(updateInterventionRoute, authedRequest(u.coordinator, `/academic/api/v1/interventions/${id}`, { method: 'PATCH', json: { status: 'resolved', outcome: 'Attending again (fictional)', parentContactStatus: 'contacted' } }), { id });
    expect(resolved.data!.status).toBe('resolved');
    const mine = await callRoute<unknown[]>(listInterventionsRoute, authedRequest(u.teacher, '/academic/api/v1/interventions'));
    expect(mine.data).toHaveLength(1);
    const t3 = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect((await callRoute<unknown[]>(listInterventionsRoute, authedRequest(t3, '/academic/api/v1/interventions'))).data).toEqual([]);
  });

  it('settings: only the coordinator changes a rule, values are validated and audited', async () => {
    const path = '/academic/api/v1/settings/assessments.min_gap_days';
    const params = { key: 'assessments.min_gap_days' };
    expect((await callRoute(settingRoute, authedRequest(u.director, path, { method: 'PUT', json: { value: { minDays: 2, enforcement: 'hard' }, status: 'approved' } }), params)).status).toBe(403);
    expect((await callRoute(settingRoute, authedRequest(u.coordinator, path, { method: 'PUT', json: { value: { minDays: -1, enforcement: 'hard' }, status: 'approved' } }), params)).status).toBe(400);
    expect((await callRoute(settingRoute, authedRequest(u.coordinator, path, { method: 'PUT', json: { value: { minDays: 2, enforcement: 'hard' }, status: 'approved' } }), params)).status).toBe(400); // approving needs the owner's decision reference
    const ok = await callRoute<{ status: string }>(settingRoute, authedRequest(u.coordinator, path, { method: 'PUT', json: { value: { minDays: 2, enforcement: 'hard' }, status: 'approved', decisionRef: 'D-900' } }), params);
    expect(ok.data!.status).toBe('approved');
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, 'assessments.min_gap_days'), eq(auditEvents.action, 'setting.updated')));
    expect(audit[0]!.metadata).toMatchObject({ decisionRef: 'D-900' });
    expect((await callRoute(settingRoute, authedRequest(u.coordinator, path, { method: 'PUT', json: { value: { minDays: 2, enforcement: 'hard' }, status: 'approved' } }), params)).status).toBe(200); // re-saving the approved value
    expect((await callRoute(settingRoute, authedRequest(u.coordinator, path, { method: 'PUT', json: { value: { minDays: 3, enforcement: 'hard' }, status: 'approved' } }), params)).status).toBe(400); // a new value needs a new reference
    expect((await callRoute(settingRoute, authedRequest(u.coordinator, '/academic/api/v1/settings/unknown.key', { method: 'PUT', json: { value: 1, status: 'proposed' } }), { key: 'unknown.key' })).status).toBe(404);
  });
});
