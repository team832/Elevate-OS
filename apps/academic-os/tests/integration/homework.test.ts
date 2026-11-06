/**
 * F4-05 homework (scope, marking states, unmarked ≠ not submitted, completion, cancel, portal read)
 * and the F4-06 absences contract (absent only). Fictional data only.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { academicClassSessions, academicHomework, academicHomeworkMarks, academicStudents, auditEvents, students as coreStudents } from '@elevate/database';
import { academicAbsencesV1Schema } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/homework/route';
import { GET as getRoute } from '../../src/app/api/v1/homework/[id]/route';
import { PUT as marksRoute } from '../../src/app/api/v1/homework/[id]/marks/route';
import { POST as cancelRoute } from '../../src/app/api/v1/homework/[id]/cancel/route';
import { GET as completionRoute } from '../../src/app/api/v1/homework/completion/route';
import { GET as absencesRoute } from '../../src/app/api/internal/v1/absences/route';
import { createSessions, createStudent, enrolManually, homeworkForm, homeworkForStudent, recordClass, todayIst } from '../../src/server';
import type { HomeworkCounts } from '../../src/domain/homework';
import { recordClassBody } from '../../src/server/schemas-teaching';
import { attend, markHeld } from './a4-helpers';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let w2: World;
let outsider: TestUser;
const ids: Record<'asha' | 'bilal' | 'chitra', string> = { asha: '', bilal: '', chitra: '' };

const HW = '/academic/api/v1/homework';
type Detail = { id: string; teacherStaffId: string; students: { studentId: string; status: string | null; remark: string | null }[]; counts: HomeworkCounts };
type Group = { name: string; homework: number; counts: HomeworkCounts };
const create = (user: TestUser, json: Record<string, unknown> = {}) =>
  callRoute<Detail>(createRoute, authedRequest(user, HW, { json: { batchId: w.batch.id, title: 'Exercise 2 (fictional)', setOn: '2026-09-07', dueOn: '2026-09-10', ...json } }));
const get = (user: TestUser, id: string) => callRoute<Detail>(getRoute, authedRequest(user, `${HW}/${id}`), { id });
const mark = (user: TestUser, id: string, marks: Record<string, unknown>[]) => callRoute<{ saved: number }>(marksRoute, authedRequest(user, `${HW}/${id}/marks`, { method: 'PUT', json: { marks } }), { id });
const cancel = (user: TestUser, id: string, reason?: string) => callRoute(cancelRoute, authedRequest(user, `${HW}/${id}/cancel`, { json: reason ? { reason } : {} }), { id });
const completion = (user: TestUser) => callRoute<{ batches: Group[]; teachers: Group[] }>(completionRoute, authedRequest(user, `${HW}/completion?from=2026-10-01&to=2026-10-31`));
const OCTOBER = { setOn: '2026-10-01', dueOn: '2026-10-05' };

beforeAll(async () => {
  u = await users(ctx.db);
  outsider = await createTestUser(ctx.db, { roles: ['teacher'] });
  w = await world(ctx.db, u);
  w2 = await world(ctx.db, u, { teacher: outsider, teacher2: outsider }); // a batch only `outsider` teaches
  for (const [key, name, start] of [['asha', 'Asha Sample Student', '2026-09-01'], ['bilal', 'Bilal Sample Student', '2026-09-01'], ['chitra', 'Chitra Sample Student', '2026-09-20']] as const) {
    const s = await createStudent(ctx.db, actor(u.coordinator), { fullName: name });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: s.id, batchId: w.batch.id, startDate: start, reason: 'Test (fictional)' });
    ids[key] = s.id;
  }
}, 120_000);

describe('setting homework (F4-05): permission and scope', () => {
  it('401 signed out, 403 without classes:record, 400 for bad input, 404 for a batch the teacher does not teach', async () => {
    expect((await callRoute(createRoute, buildRequest(HW, { json: {} }))).status).toBe(401);
    expect((await create(u.auditor)).status).toBe(403);
    expect((await create(u.teacher, { dueOn: '2026-09-06' })).status).toBe(400);
    expect((await create(u.teacher, { chapterId: w2.ch1.id })).status).toBe(400); // another course
    expect((await create(outsider)).status).toBe(404);
    expect((await create(u.coordinator)).status).toBe(400); // a coordinator names the teacher
    expect((await create(u.coordinator, { teacherStaffId: w2.teacherStaff })).status).toBe(400); // who does not teach this batch
  });

  it('a teacher sets it as themselves; a coordinator for the batch teacher; audited', async () => {
    const own = await create(u.teacher, { subjectId: w.quant.id, chapterId: w.ch1.id, teacherStaffId: w.teacher2Staff });
    expect(own.status).toBe(201);
    expect(own.data!.teacherStaffId).toBe(w.teacherStaff);
    const forTeacher = await create(u.coordinator, { teacherStaffId: w.teacher2Staff });
    expect(forTeacher.data!.teacherStaffId).toBe(w.teacher2Staff);
    const [row] = await ctx.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, own.data!.id));
    expect(row).toEqual({ action: 'homework.set' });
  });

  it.each<[string, () => TestUser, number]>([
    ['the batch teacher', () => u.teacher, 200],
    ['a teacher of another batch', () => outsider, 404],
    ['a coordinator', () => u.coordinator, 200],
    ['the director (read only)', () => u.director, 200],
    ['a counsellor', () => u.counsellor, 403],
  ])('reading one homework: %s → %i', async (_, who, status) => {
    const { data } = await create(u.teacher);
    expect((await get(who(), data!.id)).status).toBe(status);
    if (status === 404) expect((await callRoute<{ rows: Detail[] }>(listRoute, authedRequest(who(), HW))).data!.rows.map((h) => h.id)).not.toContain(data!.id);
  });
});

describe('marking (F4-05)', () => {
  it.each(['submitted', 'late', 'not_submitted', 'excused'] as const)('%s is saved with a remark; the other student stays not marked, never "not submitted"', async (status) => {
    const { data } = await create(u.teacher);
    expect((await mark(u.teacher, data!.id, [{ studentId: ids.asha, status, remark: 'Checked (fictional)' }])).data).toEqual({ saved: 1 });
    const d = (await get(u.teacher, data!.id)).data!;
    expect(Object.fromEntries(d.students.map((s) => [s.studentId, s.status]))).toEqual({ [ids.asha]: status, [ids.bilal]: null }); // Chitra joins after the due date
    expect(d.counts).toMatchObject({ students: 2, unmarked: 1, [status]: 1, not_submitted: status === 'not_submitted' ? 1 : 0 });
    const [audit] = await ctx.db.select({ metadata: auditEvents.metadata }).from(auditEvents).where(and(eq(auditEvents.entityId, data!.id), eq(auditEvents.action, 'homework.marked')));
    expect(audit!.metadata).toMatchObject({ changes: [{ studentId: ids.asha, from: null, to: status }] });
  });

  it('the same mark again saves nothing; a student outside the batch window is refused; another batch teacher gets 404', async () => {
    const { data } = await create(u.teacher);
    await mark(u.teacher, data!.id, [{ studentId: ids.asha, status: 'late' }]);
    expect((await mark(u.teacher, data!.id, [{ studentId: ids.asha, status: 'late' }])).data).toEqual({ saved: 0 });
    expect((await mark(u.teacher, data!.id, [{ studentId: ids.chitra, status: 'submitted' }])).status).toBe(400);
    expect((await mark(outsider, data!.id, [{ studentId: ids.asha, status: 'submitted' }])).status).toBe(404);
    expect((await mark(u.auditor, data!.id, [{ studentId: ids.asha, status: 'submitted' }])).status).toBe(403);
  });
});

describe('completion by batch and teacher (F4-05)', () => {
  it('counts handed-in over marked (excused and unmarked left out); a teacher with nothing marked shows no figure, not 0 %', async () => {
    const h1 = (await create(u.teacher, OCTOBER)).data!;
    await create(u.coordinator, { ...OCTOBER, teacherStaffId: w.teacher2Staff });
    await mark(u.teacher, h1.id, [{ studentId: ids.asha, status: 'submitted' }, { studentId: ids.bilal, status: 'not_submitted' }, { studentId: ids.chitra, status: 'excused' }]);
    const r = (await completion(u.coordinator)).data!;
    expect(r.batches).toEqual([expect.objectContaining({ homework: 2, counts: expect.objectContaining({ students: 6, submitted: 1, not_submitted: 1, excused: 1, unmarked: 3, completion: 0.5 }) })]);
    expect(Object.fromEntries(r.teachers.map((t) => [t.name, t.counts.completion]))).toEqual({ 'Tina Teacher (fictional)': 0.5, 'Tom Teacher (fictional)': null });
    expect((await completion(u.teacher)).data!.batches).toHaveLength(1); // their batch, both teachers' homework
    expect((await completion(outsider)).data!).toMatchObject({ batches: [], teachers: [] });
  });
});

describe('cancel (F4-05)', () => {
  it('needs a reason, is audited, freezes marks and leaves completion; never deleted', async () => {
    const { data } = await create(u.teacher, { ...OCTOBER, title: 'Cancelled sheet (fictional)' });
    const id = data!.id;
    expect((await cancel(u.auditor, id, 'No (fictional)')).status).toBe(403);
    expect((await cancel(outsider, id, 'No (fictional)')).status).toBe(404);
    expect((await cancel(u.teacher, id)).status).toBe(400);
    expect((await cancel(u.teacher, id, 'Moved to next week (fictional)')).status).toBe(200);
    expect((await cancel(u.teacher, id, 'Again (fictional)')).status).toBe(409);
    expect((await mark(u.teacher, id, [{ studentId: ids.asha, status: 'submitted' }])).status).toBe(409);
    expect((await get(u.teacher, id)).data).toMatchObject({ cancelReason: 'Moved to next week (fictional)' });
    expect((await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'homework.cancelled')))).length).toBe(1);
    expect((await completion(u.coordinator)).data!.batches[0]!.homework).toBe(2);
  });
});

describe('downloads, prefill and the portal read (F4-05)', () => {
  it('the list, completion and marks download as audited spreadsheets', async () => {
    const { data } = await create(u.teacher);
    for (const [route, path, params] of [
      [listRoute, `${HW}?format=csv`, {}],
      [completionRoute, `${HW}/completion?format=csv&from=2026-10-01&to=2026-10-31`, {}],
      [getRoute, `${HW}/${data!.id}?format=csv`, { id: data!.id }],
    ] as const) {
      const res = await route(authedRequest(u.coordinator, path), { params: Promise.resolve(params) });
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(await res.text()).toMatch(/Not marked yet/);
    }
    expect((await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'homework.exported'))).length).toBe(3);
  });

  it('the form offers the teacher’s own recent teaching-log homework to copy', async () => {
    const day = addDays(todayIst() as IsoDate, -3);
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: day, startTime: '09:00', durationMinutes: 75 }]);
    await ctx.db.update(academicClassSessions).set({ status: 'held', deliveredAt: new Date(), deliveredByUserId: u.coordinator.id }).where(eq(academicClassSessions.id, sessions[0]!.id));
    const log = await recordClass(ctx.db, actor(u.teacher), recordClassBody.parse({ sessionId: sessions[0]!.id, chapterId: w.ch1.id, completion: 'completed', actualMinutes: 70, activity: 'main', homework: 'Exercise 3, questions 1–10 (fictional)', homeworkDueOn: todayIst(), submit: true }));
    const form = await homeworkForm(ctx.db, actor(u.teacher), w.batch.id, log.id);
    expect(form.copied).toMatchObject({ id: log.id, date: day, homework: 'Exercise 3, questions 1–10 (fictional)', chapterId: w.ch1.id, subjectId: w.quant.id });
    expect((await homeworkForm(ctx.db, actor(u.teacher2), w.batch.id, log.id)).copied).toBeNull(); // not their log
    await expect(homeworkForm(ctx.db, actor(outsider), w.batch.id)).rejects.toMatchObject({ status: 404 });
    expect((await create(outsider, { batchId: w2.batch.id, classRecordId: log.id })).status).toBe(400); // log of another batch
  });

  it('homeworkForStudent: by Academic or core id, due in the window, cancelled left out, unmarked = null', async () => {
    const [core] = await ctx.db.insert(coreStudents).values({ fullName: 'Asha Sample Student', isSample: true }).returning();
    await ctx.db.update(academicStudents).set({ coreStudentId: core!.id }).where(eq(academicStudents.id, ids.asha as never));
    const window = { from: '2026-10-01', to: '2026-10-31' };
    const rows = await homeworkForStudent(ctx.db, ids.asha, window);
    expect(rows.map((r) => r.status ?? 'unmarked').sort()).toEqual(['submitted', 'unmarked']);
    expect(rows.every((r) => r.title !== 'Cancelled sheet (fictional)')).toBe(true);
    expect(await homeworkForStudent(ctx.db, core!.id, window)).toEqual(rows);
    expect(await homeworkForStudent(ctx.db, crypto.randomUUID(), window)).toEqual([]);
  });
});

describe('more homework than the list shows (F4-05)', () => {
  it('completion counts every matching homework; the list shows the first 500 of the total; the download has them all', async () => {
    const dev = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Dev Sample Student' });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: dev.id, batchId: w2.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const titles = Array.from({ length: 501 }, (_, i) => `Bulk ${String(i + 1).padStart(3, '0')} (fictional)`);
    const rows = await ctx.db
      .insert(academicHomework)
      .values(titles.map((title) => ({ batchId: w2.batch.id, title, setOn: '2026-12-01', dueOn: '2026-12-15', teacherStaffId: w2.teacherStaff, createdByUserId: outsider.id, isSample: true })))
      .returning({ id: academicHomework.id, title: academicHomework.title });
    const id = (t: string) => rows.find((r) => r.title === t)!.id;
    // The 501st (last in list order) is the only one handed in: a capped count would miss it.
    await ctx.db.insert(academicHomeworkMarks).values([
      { homeworkId: id(titles[500]!), studentId: dev.id, status: 'submitted', markedByUserId: outsider.id },
      { homeworkId: id(titles[0]!), studentId: dev.id, status: 'not_submitted', markedByUserId: outsider.id },
    ]);
    const DEC = 'from=2026-12-01&to=2026-12-31';
    const c = (await callRoute<{ batches: Group[] }>(completionRoute, authedRequest(outsider, `${HW}/completion?${DEC}`))).data!;
    expect(c.batches).toEqual([expect.objectContaining({ homework: 501, counts: expect.objectContaining({ students: 501, submitted: 1, not_submitted: 1, unmarked: 499, completion: 0.5 }) })]);
    const list = (await callRoute<{ rows: { title: string }[]; total: number }>(listRoute, authedRequest(outsider, `${HW}?${DEC}`))).data!;
    expect([list.rows.length, list.total]).toEqual([500, 501]);
    expect(list.rows.map((r) => r.title)).not.toContain(titles[500]);
    const csv = await (await listRoute(authedRequest(outsider, `${HW}?format=csv&${DEC}`), { params: Promise.resolve({}) })).text();
    expect(csv.trim().split('\r\n')).toHaveLength(502); // header + 501
  });
});

describe('absent students contract (F4-06)', () => {
  const internal = (query: string, caller = 'ops') =>
    callRoute<unknown>(absencesRoute, buildRequest(`/academic/api/internal/v1/absences${query}`, { headers: { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': caller } }));

  it('returns only "absent" marks on classes that happened, for linked students; late, excused, present and unmarked are not absences', async () => {
    const [bilalCore] = await ctx.db.insert(coreStudents).values({ fullName: 'Bilal Sample Student', isSample: true }).returning();
    await ctx.db.update(academicStudents).set({ coreStudentId: bilalCore!.id }).where(eq(academicStudents.id, ids.bilal as never));
    const [ashaCore] = await ctx.db.select({ id: academicStudents.coreStudentId }).from(academicStudents).where(eq(academicStudents.id, ids.asha as never));
    const slot = (date: string, subjectId: string, teacherStaffId: string) => ({ batchId: w.batch.id, subjectId, teacherStaffId, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [slot('2026-09-14', w.quant.id, w.teacherStaff), slot('2026-09-15', w.verbal.id, w.teacher2Staff), slot('2026-09-16', w.quant.id, w.teacherStaff), slot('2026-09-25', w.quant.id, w.teacherStaff)]);
    const [quant, verbal, dropped, late] = sessions.map((s) => s.id as string) as [string, string, string, string];
    await markHeld(ctx.db, [quant, verbal, dropped, late]);
    const by = actor(u.coordinator);
    await attend(ctx.db, by, quant, [{ studentId: ids.asha, status: 'absent' }, { studentId: ids.bilal, status: 'late' }]);
    await attend(ctx.db, by, verbal, [{ studentId: ids.asha, status: 'present' }, { studentId: ids.bilal, status: 'absent' }]);
    await attend(ctx.db, by, dropped, [{ studentId: ids.asha, status: 'absent' }]);
    await attend(ctx.db, by, late, [{ studentId: ids.chitra, status: 'absent' }, { studentId: ids.asha, status: 'excused' }]); // Chitra has no canonical identity
    await ctx.db.update(academicClassSessions).set({ status: 'cancelled', statusReason: 'Test (fictional)' }).where(inArray(academicClassSessions.id, [dropped] as never[]));

    const res = await internal('?from=2026-09-14&to=2026-09-30');
    expect(res.status).toBe(200);
    const body = academicAbsencesV1Schema.parse(res.data);
    expect(body.absences.map((a) => [a.coreStudentId, a.sessionId, a.subjectName])).toEqual([
      [ashaCore!.id, quant, 'Quant'],
      [bilalCore!.id, verbal, 'Verbal'],
    ]);
    expect(body.absences[0]).toMatchObject({ batchCode: w.batch.code, date: '2026-09-14', startTime: '09:00' });
  });

  it.each([
    ['another caller', '?from=2026-09-01&to=2026-09-30', 'marketing', 403],
    ['no dates', '', 'ops', 400],
    ['from after to', '?from=2026-09-30&to=2026-09-01', 'ops', 400],
    ['more than 92 days', '?from=2026-06-01&to=2026-09-30', 'ops', 400],
  ])('refuses %s', async (_, query, caller, status) => {
    expect((await internal(query, caller)).status).toBe(status);
  });
});
