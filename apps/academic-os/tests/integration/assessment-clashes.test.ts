/**
 * C2 review fixes (6 Nov 2026): a class and a test cannot overlap in either direction, by batch or by a
 * student placed in both batches (C2-1, C2-2; holidays and the minimum gap stay warnings); the schedule
 * check covers every eligible batch (C2-3); marking pending follows the awaiting-marking rule (C2-7);
 * a student in two eligible batches sits with the first by batch code (C2-9); a substitute's weekly
 * workload counts the whole week (C2-6). Fictional people only.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { academicAssessmentRoster, academicAssessments, academicBatchPlacements, academicClassSessions, academicTeacherUnavailability } from '@elevate/database';
import { createAssessmentInternalBody } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import {
  assignSubstitute,
  checkAssessmentScheduleFor,
  coordinatorOverview,
  createAssessment,
  createBatch,
  createExclusion,
  createSessions,
  createStudent,
  enrolManually,
  rescheduleSession,
  teacherActivity,
  updateSetting,
} from '../../src/server';
import { createAssessmentBody, createExclusionBody } from '../../src/server/schemas';
import { createAssessmentInternal, snapshotRosterInternal, updateAssessmentInternal } from '../../src/server/services/assessment-ops';
import { actor, staffFor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let bA: string; // code "A-…": listed before bZ
let bZ: string;
let shared: string; // placed in bA and bZ
const ids = () => ({ main: w.batch.id, bA, bZ });
type Key = keyof ReturnType<typeof ids>;

const coord = () => actor(u.coordinator);
const test = (batchIds: string[], scheduledDate: string, startTime?: string, durationMinutes = 120, code = uniq('T-')) =>
  createAssessmentInternal(
    ctx.db,
    coord(),
    createAssessmentInternalBody.parse({ code, kind: 'full_mock', title: 'Mock (fictional)', academicYear: '2026-27', batchIds, scheduledDate, ...(startTime ? { startTime, durationMinutes } : {}) }),
  );
const klass = (batchId: string, date: string, startTime: string, teacherStaffId = w.teacherStaff) =>
  createSessions(ctx.db, coord(), [{ batchId, teacherStaffId, subjectId: w.quant.id, sessionType: 'teaching', date, startTime, durationMinutes: 75 }]);
const refusedWith = (code: string) => ({ status: 409, details: { hard: [expect.objectContaining({ code })] } });

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  const batch = async (prefix: string) => (await createBatch(ctx.db, coord(), { code: uniq(prefix), name: 'Batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active' })).id;
  bZ = await batch('Z-');
  bA = await batch('A-');
  const enrol = async (fullName: string, batchId: string) => {
    const st = await createStudent(ctx.db, coord(), { fullName });
    return { st, e: await enrolManually(ctx.db, coord(), { studentId: st.id, batchId, startDate: '2026-09-01', reason: 'Test (fictional)' }) };
  };
  await enrol('Sample Main Student (fictional)', w.batch.id);
  const two = await enrol('Sample Shared Student (fictional)', bZ);
  shared = two.st.id;
  // one open placement per enrolment: the second batch is a dated placement of the same enrolment
  await ctx.db.insert(academicBatchPlacements).values({ enrolmentId: two.e.id, batchId: bA as never, startDate: '2026-09-01', endDate: '2099-12-31', reason: 'Second batch (fictional)' });
});

describe('C2-1: a class cannot be booked during a test of its batch or of a student’s other batch', () => {
  beforeAll(async () => {
    await test([w.batch.id, bZ], '2099-03-06', '10:00');
  });
  it.each<[string, Key, string]>([
    ['the primary batch', 'main', 'BATCH_OVERLAP'],
    ['a secondary batch', 'bZ', 'BATCH_OVERLAP'],
    ['a batch sharing a student', 'bA', 'STUDENT_OVERLAP'],
  ])('a class of %s during the test is refused (409), naming the test', async (_n, key, code) => {
    await expect(klass(ids()[key], '2099-03-06', '10:30')).rejects.toMatchObject({
      details: { hard: [expect.objectContaining({ code, message: expect.stringMatching(/clashes with the test Mock \(fictional\) \(T-.+\) on .*2099 10:00/) })] },
    });
  });
  // REV-4 I-2: a test-type class holds the room and invigilator for its own batch's test, in either order.
  const testClass = async (date: string) =>
    (await createSessions(ctx.db, coord(), [{ batchId: w.batch.id, teacherStaffId: w.teacher2Staff, subjectId: w.quant.id, sessionType: 'test', date, startTime: '10:00', durationMinutes: 120 }])).sessions[0]!.id;
  it.each<[string, () => Promise<unknown>]>([
    ['the test first, then the test-type class', () => testClass('2099-03-06')],
    ['the test-type class first, then the test', async () => (await testClass('2099-10-06'), test([w.batch.id], '2099-10-06', '10:00'))],
    ['moving the test onto the test-type class', async () => (await testClass('2099-10-07'), updateAssessmentInternal(ctx.db, coord(), await test([w.batch.id], '2099-10-08', '10:00'), { scheduledDate: '2099-10-07' as IsoDate }))],
    ['moving the test-type class onto the test', async () => (await test([w.batch.id], '2099-10-09', '10:00'), rescheduleSession(ctx.db, coord(), await testClass('2099-10-10'), { date: '2099-10-09', startTime: '10:00', reason: 'Exam room (fictional)' }))],
  ])('REV-4 P3: %s is saved', async (_n, run) => {
    await run();
  });
  it('REV-4 P4: a substitute is not refused for a clash that is not about the substitute', async () => {
    const [legacy] = await ctx.db.insert(academicClassSessions).values({ batchId: w.batch.id as never, teacherStaffId: w.teacherStaff, subjectId: w.quant.id, sessionType: 'teaching', date: '2099-03-06', startTime: '10:30', durationMinutes: 75 }).returning();
    const sub = await staffFor(ctx.db, null, 'Sample Substitute (fictional)');
    await expect(assignSubstitute(ctx.db, coord(), legacy!.id, { staffId: sub, reason: 'Cover (fictional)' })).resolves.toBeTruthy();
  });
  it('a class right after the test, or during a cancelled or untimed test, is saved', async () => {
    await expect(klass(w.batch.id, '2099-03-06', '12:00')).resolves.toBeTruthy();
    const cancelled = await test([w.batch.id], '2099-03-13', '10:00');
    await updateAssessmentInternal(ctx.db, coord(), cancelled, { status: 'cancelled', reason: 'Moved (fictional)' });
    await test([w.batch.id], '2099-03-13');
    await expect(klass(w.batch.id, '2099-03-13', '10:30')).resolves.toBeTruthy();
  });
});

describe('C2-2: scheduling or moving a test refuses a clash with a class or another test', () => {
  beforeAll(async () => {
    await klass(w.batch.id, '2099-04-03', '10:00');
    await klass(bZ, '2099-04-10', '10:00');
    await test([w.batch.id], '2099-04-17', '10:00', 60);
  });
  it.each<[string, Key, string, string]>([
    ['a class of its batch', 'main', '2099-04-03', 'CLASS_CLASH'],
    ['a class of a batch sharing a student', 'bA', '2099-04-10', 'CLASS_CLASH'],
    ['another test of its batch', 'main', '2099-04-17', 'ASSESSMENT_CLASH'],
  ])('a test over %s is refused (409) and nothing is saved', async (_n, key, date, code) => {
    const c = uniq('T-');
    await expect(test([ids()[key]], date, '10:30', 60, c)).rejects.toMatchObject(refusedWith(code));
    expect(await ctx.db.select().from(academicAssessments).where(eq(academicAssessments.code, c))).toEqual([]);
  });
  it('the Academic form refuses the same clash', async () => {
    const body = createAssessmentBody.parse({ code: uniq('T-'), title: 'Practice (fictional)', kind: 'practice', batchId: w.batch.id, scheduledDate: '2099-04-03', startTime: '10:30', durationMinutes: 30 });
    await expect(createAssessment(ctx.db, coord(), body)).rejects.toMatchObject(refusedWith('CLASS_CLASH'));
  });
  it('moving a test onto a class is refused and the test stays where it was', async () => {
    const id = await test([w.batch.id], '2099-04-24', '10:00', 60);
    await expect(updateAssessmentInternal(ctx.db, coord(), id, { scheduledDate: '2099-04-03' as IsoDate })).rejects.toMatchObject(refusedWith('CLASS_CLASH'));
    const [row] = await ctx.db.select().from(academicAssessments).where(eq(academicAssessments.id, id as never));
    expect(row!.scheduledDate).toBe('2099-04-24');
  });
  it('a test on a holiday, or right after a class, is saved (those stay warnings)', async () => {
    await createExclusion(ctx.db, coord(), createExclusionBody.parse({ kind: 'holiday', label: 'Holiday (fictional)', date: '2099-05-01', status: 'confirmed' }));
    await expect(test([w.batch.id], '2099-05-01', '10:00')).resolves.toBeTruthy();
    await expect(test([w.batch.id], '2099-04-03', '11:15', 60)).resolves.toBeTruthy();
  });
});

describe('C2-3: the schedule check covers every eligible batch of a test', () => {
  let id: string;
  beforeAll(async () => {
    id = await test([w.batch.id, bZ], '2099-06-05', '10:00');
    // saved before tests were checked: a class of the secondary batch during the test
    await ctx.db.insert(academicClassSessions).values({ batchId: bZ as never, teacherStaffId: w.teacher2Staff, subjectId: w.verbal.id, sessionType: 'teaching', date: '2099-06-05', startTime: '10:30', durationMinutes: 75 });
  });
  it.each<[string, Key]>([
    ['primary', 'main'],
    ['secondary', 'bZ'],
  ])('checked from its %s batch, the test clashes with the class of the secondary batch', async (_n, key) => {
    const r = await checkAssessmentScheduleFor(ctx.db, coord(), { batchId: ids()[key] });
    expect(r.hard.filter((c) => c.candidateId === id).map((c) => c.code)).toEqual(['CLASS_CLASH']);
  });
});

describe('C2-7: marking pending follows the awaiting-marking rule', () => {
  const now = new Date('2026-11-06T06:00:00Z');
  beforeAll(async () => {
    const id = await createAssessmentInternal(
      ctx.db,
      coord(),
      createAssessmentInternalBody.parse({ code: uniq('Q-'), kind: 'chapter_test', title: 'Quant test (fictional)', academicYear: '2026-27', batchIds: [w.batch.id], subjectId: w.quant.id, scheduledDate: '2026-10-20', evaluatorStaffId: w.teacherStaff }),
    );
    await snapshotRosterInternal(ctx.db, coord(), id, { admissionNumbers: [] });
  });
  it('a held test with marks still to enter counts for its evaluator, as Awaiting marking does', async () => {
    const a = await teacherActivity(ctx.db, w.teacherStaff, { from: '2026-10-01', to: '2026-11-06' }, now);
    expect(a.markingPending).toMatchObject({ status: 'ok', value: 1 });
    expect(a.assessments?.awaitingMarking).toMatchObject({ status: 'ok', value: 1 });
    expect((await teacherActivity(ctx.db, w.teacher2Staff, { from: '2026-10-01', to: '2026-11-06' }, now)).markingPending).toMatchObject({ status: 'ok', value: 0 });
  });
  it('the coordinator’s My day counts tests in progress (held or due), not only conducted ones', async () => {
    expect((await coordinatorOverview(ctx.db, coord(), now)).pendingMarking).toBe(1);
  });
  it('REV-4 M5: a test later today counts only once it has started (IST)', async () => {
    await test([w.batch.id], '2026-11-06', '15:00', 60);
    expect((await coordinatorOverview(ctx.db, coord(), now)).pendingMarking).toBe(1); // 11:30 IST
    expect((await coordinatorOverview(ctx.db, coord(), new Date('2026-11-06T09:31:00Z'))).pendingMarking).toBe(2); // 15:01 IST
  });
});

describe('C2-9: a student in two eligible batches sits with the first by batch code', () => {
  it('takes the A- batch over the Z- batch, whatever order they were sent in', async () => {
    const id = await test([w.batch.id, bZ, bA], '2099-08-03');
    await snapshotRosterInternal(ctx.db, coord(), id, { admissionNumbers: [] });
    const R = academicAssessmentRoster;
    const [row] = await ctx.db.select().from(R).where(and(eq(R.assessmentId, id as never), eq(R.studentId, shared as never)));
    expect(row!.batchId).toBe(bA);
  });
});

describe('a class over a teacher’s approved HR leave says so (coordinator request, D-134)', () => {
  it('refuses with the HR-leave wording', async () => {
    await ctx.db.insert(academicTeacherUnavailability).values({ staffId: w.teacherStaff, fromDate: '2099-09-07', toDate: '2099-09-07', reason: 'Approved HR leave', enteredByUserId: u.coordinator.id, source: 'hr_leave', opsLeaveRecordId: crypto.randomUUID() });
    await expect(klass(w.batch.id, '2099-09-07', '09:00')).rejects.toMatchObject({ details: { hard: [expect.objectContaining({ code: 'TEACHER_UNAVAILABLE', message: expect.stringContaining('approved HR leave') })] } });
  });
});

// Last: the workload cap it sets would refuse later classes.
describe('C2-6: a substitute’s weekly workload counts the whole week', () => {
  it('refuses a substitute whose classes on other days of the week pass the weekly cap', async () => {
    await updateSetting(ctx.db, actor(u.director), 'timetable.teacher_workload_cap', { value: { maxMinutesPerDay: null, maxMinutesPerWeek: 100, enforcement: 'hard' }, status: 'proposed' });
    await klass(w.batch.id, '2099-02-02', '09:00'); // Monday, 75 min
    const { sessions } = await createSessions(ctx.db, coord(), [{ batchId: w.batch.id, teacherStaffId: w.teacher2Staff, subjectId: w.verbal.id, sessionType: 'teaching', date: '2099-02-04', startTime: '09:00', durationMinutes: 75 }]);
    await expect(assignSubstitute(ctx.db, coord(), sessions[0]!.id, { staffId: w.teacherStaff, reason: 'Covering (fictional)' })).rejects.toMatchObject(refusedWith('TEACHER_WORKLOAD'));
  });
});
