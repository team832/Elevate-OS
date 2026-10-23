/**
 * Brief 23 Oct 2026 §4 and §7 (R9): structured teaching assignments — pending ones grant nothing,
 * activation needs a batch, ending stops access, every change audited — and the teacher workspace
 * scenarios 1 and 2 with fictional people.
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicTeacherAssignments, auditEvents, branches, programmes, staffMembers, type Database } from '@elevate/database';
import { teachingAssignmentsV1Schema } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as internalRoute } from '../../src/app/api/internal/v1/teaching-assignments/route';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/assignments/route';
import { DELETE as withdrawRoute, PATCH as patchRoute } from '../../src/app/api/v1/assignments/[id]/route';
import { POST as endRoute } from '../../src/app/api/v1/assignments/[id]/end/route';
import { GET as batchRoute } from '../../src/app/api/v1/batches/[id]/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import { GET as attendanceRoute } from '../../src/app/api/v1/sessions/[id]/attendance/route';
import {
  assignedBatchIds,
  createBatch,
  createCourse,
  createSessions,
  createStudent,
  createSubject,
  enrolManually,
  listBatches,
  listSessions,
  listStudents,
  teacherDay,
  todayIst,
} from '../../src/server';
import { actor, staffFor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
const today = todayIst();

/** A course (own programme) with one MATH subject, e.g. "Class 11 Maths" — no batch. */
async function mathsCourse(db: Database, u: Users, label: string) {
  const programmeCode = uniq('P');
  await db.insert(programmes).values({ code: programmeCode, name: label, status: 'active' });
  const course = await createCourse(db, actor(u.coordinator), { programmeCode, code: uniq('C-'), familyCode: uniq('F-'), version: 1, name: `${label} (fictional)`, classMinutesStatus: 'unknown', status: 'draft' });
  const subject = await createSubject(db, actor(u.coordinator), course.id, { code: 'MATH', name: 'Mathematics', sortOrder: 0 });
  return { course, subject };
}

const post = (user: TestUser, json: Record<string, unknown>) => callRoute<{ id: string; status: string; batchId: string | null }>(createRoute, authedRequest(user, '/academic/api/v1/assignments', { method: 'POST', json }));
const patch = (user: TestUser, id: string, json: Record<string, unknown>) => callRoute<{ status: string; batchId: string | null }>(patchRoute, authedRequest(user, `/academic/api/v1/assignments/${id}`, { method: 'PATCH', json }), { id });
const audited = async (id: string) => (await ctx.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, id))).map((r) => r.action);

describe('teaching assignments (R9)', () => {
  let u: Users;
  let w: World;
  let teacher: TestUser;
  let staffId: string;
  let studentId: string;
  let pendingId: string;

  it('records a pending assignment (no batch) that grants nothing; a duplicate pending row is refused', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    staffId = await staffFor(ctx.db, teacher, 'Pia Pending Teacher (fictional)');
    const s = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Ira Sample Student' });
    studentId = s.id;
    await enrolManually(ctx.db, actor(u.coordinator), { studentId, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const [branch] = await ctx.db.insert(branches).values({ code: uniq('BR').toUpperCase().replace(/[^A-Z0-9]/g, ''), name: 'Sample branch (fictional)' }).returning();

    expect((await post(teacher, { subjectId: w.quant.id, staffMemberId: staffId })).status).toBe(403);
    expect((await post(u.coordinator, { subjectId: w.quant.id, staffMemberId: staffId, academicYear: '2026-28' })).status).toBe(400);
    const res = await post(u.coordinator, { subjectId: w.quant.id, staffMemberId: staffId, academicYear: '2026-27', branchId: branch!.id, endDate: addDays(today as IsoDate, 300) });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ status: 'pending', batchId: null });
    pendingId = res.data!.id;
    expect(await audited(pendingId)).toEqual(['assignment.pending_recorded']);
    expect((await post(u.coordinator, { subjectId: w.quant.id, staffMemberId: staffId })).status).toBe(409);

    // Subject capability alone opens nothing: no batch, no student, 404 on both by id.
    expect(await assignedBatchIds(ctx.db, staffId as never)).toEqual([]);
    expect(await listStudents(ctx.db, actor(teacher))).toEqual([]);
    expect((await callRoute(batchRoute, authedRequest(teacher, `/academic/api/v1/batches/${w.batch.id}`), { id: w.batch.id })).status).toBe(404);
    expect((await callRoute(studentRoute, authedRequest(teacher, `/academic/api/v1/students/${studentId}`), { id: studentId })).status).toBe(404);
    // The teacher sees the pending row, read-only.
    const mine = await callRoute<{ id: string; status: string; branchName: string | null }[]>(listRoute, authedRequest(teacher, '/academic/api/v1/assignments'));
    expect(mine.data!.map((a) => [a.id, a.status, a.branchName])).toEqual([[pendingId, 'pending', 'Sample branch (fictional)']]);
  });

  it('activating needs a batch of the same course; then the batch and its students open', async () => {
    const other = await mathsCourse(ctx.db, u, 'Other course');
    const otherBatch = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Other batch (fictional)', courseId: other.course.id, status: 'active' });
    expect((await patch(u.coordinator, pendingId, { batchId: otherBatch.id })).status).toBe(400);
    expect((await patch(teacher, pendingId, { batchId: w.batch.id })).status).toBe(403);
    const res = await patch(u.coordinator, pendingId, { batchId: w.batch.id });
    expect(res.data).toMatchObject({ batchId: w.batch.id });
    expect(await audited(pendingId)).toContain('assignment.activated');
    expect((await listStudents(ctx.db, actor(teacher))).map((s) => s.id)).toEqual([studentId]);
    expect((await callRoute(batchRoute, authedRequest(teacher, `/academic/api/v1/batches/${w.batch.id}`), { id: w.batch.id })).status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ended' }); // a stored end date means `ended` (D-065), current until that day
    // Moving an active teacher is end + create, never a batch edit.
    expect((await patch(u.coordinator, pendingId, { batchId: w.batch.id })).status).toBe(400);
    expect((await callRoute(withdrawRoute, authedRequest(u.coordinator, `/academic/api/v1/assignments/${pendingId}`, { method: 'DELETE', json: { reason: 'Test' } }), { id: pendingId })).status).toBe(409);
  });

  it('an ended assignment stops access', async () => {
    const yesterday = addDays(today as IsoDate, -1);
    const res = await callRoute(endRoute, authedRequest(u.coordinator, `/academic/api/v1/assignments/${pendingId}/end`, { method: 'POST', json: { endDate: yesterday } }), { id: pendingId });
    expect(res.status).toBe(200);
    expect(await listStudents(ctx.db, actor(teacher))).toEqual([]);
    expect((await callRoute(batchRoute, authedRequest(teacher, `/academic/api/v1/batches/${w.batch.id}`), { id: w.batch.id })).status).toBe(404);
  });

  it('withdraws a pending assignment with a reason (audited); ending a pending one is refused', async () => {
    const { id } = (await post(u.coordinator, { subjectId: w.verbal.id, staffMemberId: staffId })).data!;
    expect((await callRoute(endRoute, authedRequest(u.coordinator, `/academic/api/v1/assignments/${id}/end`, { method: 'POST', json: { endDate: today } }), { id })).status).toBe(409);
    expect((await callRoute(withdrawRoute, authedRequest(u.coordinator, `/academic/api/v1/assignments/${id}`, { method: 'DELETE', json: { reason: 'Recorded by mistake (test)' } }), { id })).status).toBe(200);
    const [row] = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'assignment.withdrawn')));
    expect(row!.metadata).toMatchObject({ reason: 'Recorded by mistake (test)' });
  });

  it('history is not rewritten: an ended assignment is not edited; a started one keeps its role and start date', async () => {
    expect((await patch(u.coordinator, pendingId, { role: 'substitute' })).status).toBe(409); // ended yesterday
    const [started] = await ctx.db.select().from(academicTeacherAssignments).where(and(eq(academicTeacherAssignments.batchId, w.batch.id), eq(academicTeacherAssignments.subjectId, w.quant.id), eq(academicTeacherAssignments.staffMemberId, w.teacherStaff)));
    expect((await patch(u.coordinator, started!.id, { role: 'substitute' })).status).toBe(409);
    expect((await patch(u.coordinator, started!.id, { startDate: '2025-06-01' })).status).toBe(409);
    // Same values (what the edit form re-sends) and year/branch are fine; null clears them.
    expect((await patch(u.coordinator, started!.id, { role: 'primary', academicYear: '2026-27' })).status).toBe(200);
    expect((await patch(u.coordinator, started!.id, { academicYear: null, branchId: null })).data).toMatchObject({ academicYear: null, branchId: null });
  });

  it('activation and creation refuse an inactive teacher and a completed or cancelled batch', async () => {
    const leaver = await staffFor(ctx.db, null, 'Lee Leaving Teacher (fictional)');
    const { id } = (await post(u.coordinator, { subjectId: w.quant.id, staffMemberId: leaver })).data!;
    await ctx.db.update(staffMembers).set({ status: 'inactive' }).where(eq(staffMembers.id, leaver as never));
    expect((await patch(u.coordinator, id, { batchId: w.batch.id })).status).toBe(400);
    const closed = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Closed batch (fictional)', courseId: w.course.id, status: 'cancelled' });
    expect((await post(u.coordinator, { subjectId: w.verbal.id, staffMemberId: staffId, batchId: closed.id })).status).toBe(400);
    const { id: pending } = (await post(u.coordinator, { subjectId: w.verbal.id, staffMemberId: staffId })).data!;
    expect((await patch(u.coordinator, pending, { batchId: closed.id })).status).toBe(400);
  });

  it('serves academic.teaching_assignments v1 to Ops only: paginated, pending rows included, filters by teacher and text', async () => {
    const call = (caller: string | null, q: string) =>
      callRoute(internalRoute, buildRequest(`/academic/api/internal/v1/teaching-assignments${q}`, { headers: caller ? { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': caller } : {} }));
    expect((await call(null, '')).status).toBe(401);
    expect((await call('marketing', '')).status).toBe(403);
    expect((await call('ops', '?pageSize=500')).status).toBe(400);
    const mine = teachingAssignmentsV1Schema.parse((await call('ops', `?staffId=${staffId}`)).data);
    expect(mine.items.every((a) => a.staffId === staffId)).toBe(true);
    expect(mine.items.find((a) => a.status === 'pending')).toMatchObject({ batchCode: null, batchId: null, subjectId: w.verbal.id, subjectName: 'Verbal', courseName: 'Test course (fictional)' });
    expect(mine.items.find((a) => a.status !== 'pending')).toMatchObject({ batchId: w.batch.id, subjectId: w.quant.id });
    const page = teachingAssignmentsV1Schema.parse((await call('ops', `?staffId=${staffId}&pageSize=1&page=2`)).data);
    expect(page).toMatchObject({ total: mine.total, page: 2, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    const byText = teachingAssignmentsV1Schema.parse((await call('ops', '?q=Pia%20Pending')).data);
    expect(byText.total).toBe(mine.total);
    expect(teachingAssignmentsV1Schema.parse((await call('ops', '?q=no-such-teacher')).data)).toMatchObject({ total: 0, items: [] });
  });
});

describe('teacher workspace scenarios', () => {
  let u: Users;
  let w: World;
  let satish: TestUser;
  let staffId: string;
  const ids: Record<string, string> = {};

  it('scenario 1: a teacher with 1 active and 2 pending assignments sees exactly that on My day, timetable, batches and students', async () => {
    u = await users(ctx.db);
    satish = await createTestUser(ctx.db, { roles: ['teacher'] });
    w = await world(ctx.db, u, { teacher: satish }); // satish: QUANT in w.batch; teacher2: VERBAL in the same batch
    staffId = w.teacherStaff;
    const c11 = await mathsCourse(ctx.db, u, 'Class 11 (fictional)');
    const c12 = await mathsCourse(ctx.db, u, 'Class 12 (fictional)');
    for (const c of [c11, c12]) expect((await post(u.coordinator, { subjectId: c.subject.id, staffMemberId: staffId, academicYear: '2026-27' })).status).toBe(201);
    const otherWorld = await world(ctx.db, u); // another teacher's batch with its own student
    const mine = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Asha Sample Student' });
    const theirs = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Bilal Sample Student' });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: mine.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: theirs.id, batchId: otherWorld.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [
      { batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: staffId, sessionType: 'teaching', date: today, startTime: '13:00', durationMinutes: 75 },
      { batchId: w.batch.id, subjectId: w.verbal.id, teacherStaffId: w.teacher2Staff, sessionType: 'teaching', date: today, startTime: '15:00', durationMinutes: 75 },
    ]);
    Object.assign(ids, { own: sessions[0]!.id, theirs: sessions[1]!.id, theirStudent: theirs.id, theirBatch: otherWorld.batch.id, mine: mine.id });

    const day = await teacherDay(ctx.db, actor(satish), new Date(`${today}T06:30:00Z`)); // 12:00 IST
    if (day.kind !== 'teacher') throw new Error('expected a teacher view');
    expect(day.assignments.map((a) => [a.programmeName, a.subjectName, a.batchId, a.status]).sort()).toEqual(
      [
        ['Class 11 (fictional)', 'Mathematics', null, 'pending'],
        ['Class 12 (fictional)', 'Mathematics', null, 'pending'],
        [w.programme.name, 'Quant', w.batch.id, 'active'],
      ].sort(),
    );
    expect(day.batches.map((b) => b.id)).toEqual([w.batch.id]);
    expect([day.next?.id, ...day.todays.map((s) => s.id)].filter(Boolean)).toEqual([ids.own]);
    expect((await listSessions(ctx.db, actor(satish), { from: today, to: today })).map((s) => s.id)).toEqual([ids.own]);
    expect((await listBatches(ctx.db, actor(satish))).map((b) => b.id)).toEqual([w.batch.id]);
    expect((await listStudents(ctx.db, actor(satish))).map((s) => s.id)).toEqual([mine.id]);
  });

  it('scenario 2: another teacher’s student, batch or class id in the URL is not found (404)', async () => {
    const get = (route: typeof batchRoute, path: string, id: string) => callRoute(route, authedRequest(satish, path), { id });
    expect((await get(studentRoute, `/academic/api/v1/students/${ids.theirStudent}`, ids.theirStudent!)).status).toBe(404);
    expect((await get(batchRoute, `/academic/api/v1/batches/${ids.theirBatch}`, ids.theirBatch!)).status).toBe(404);
    expect((await get(attendanceRoute, `/academic/api/v1/sessions/${ids.theirs}/attendance`, ids.theirs!)).status).toBe(404);
    // Own records still open.
    expect((await get(studentRoute, `/academic/api/v1/students/${ids.mine}`, ids.mine!)).status).toBe(200);
    expect((await get(attendanceRoute, `/academic/api/v1/sessions/${ids.own}/attendance`, ids.own!)).status).toBe(200);
  });
});
