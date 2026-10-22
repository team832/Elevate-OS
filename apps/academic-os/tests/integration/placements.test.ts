/**
 * Admission → ONE academic enrolment → batch placement (ACD-019, owner brief §8;
 * acceptance tests 1, 2, 19, 20) and teacher scope by assignment dates. Fictional data only.
 */
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  academicAttendance,
  academicBatchPlacements,
  academicClassRecords,
  academicEnrolmentIntakeLog,
  academicEnrolments,
  academicStudents,
  auditEvents,
  eventDeliveries,
  integrationEvents,
  students as coreStudents,
  type Database,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys, type EventPayload } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as viewsRoute, POST as allocateRoute } from '../../src/app/api/v1/placements/route';
import { POST as transferRoute } from '../../src/app/api/v1/placements/transfer/route';
import { POST as endRoute } from '../../src/app/api/v1/placements/end/route';
import { POST as assignRoute } from '../../src/app/api/v1/assignments/route';
import { POST as endAssignmentRoute } from '../../src/app/api/v1/assignments/[id]/end/route';
import { GET as batchRoute, PATCH as patchBatchRoute } from '../../src/app/api/v1/batches/[id]/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import {
  INTAKE_CONSUMER,
  allocatePlacement,
  createBatch,
  createSessions,
  createStudent,
  enrolManually,
  listAssignments,
  listBatchPlacements,
  listBatches,
  listStudents,
  resolveScope,
  runEnrolmentIntake,
  studentIdsInScope,
} from '../../src/server';
import { actor, staffFor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let w2: World;

async function coreStudent(db: Database) {
  const [row] = await db.insert(coreStudents).values({ fullName: 'Sample Person (fictional)', isSample: true }).returning();
  return row!.id;
}

/** What Business Ops publishes for a CONFIRMED admission (fictional data). */
async function request(db: Database, over: Record<string, unknown> = {}) {
  const admissionId = (over.admissionId as string | undefined) ?? crypto.randomUUID();
  const attempt = (over.attempt as number | undefined) ?? 1;
  const payload = {
    admissionId,
    leadId: crypto.randomUUID(),
    attempt,
    programmeCode: w.programmeCode,
    intendedCourseId: w.course.id,
    intendedBatchId: w.batch.id,
    intendedStartDate: '2026-10-01',
    academicYear: '2026-27',
    student: { fullName: 'Sample Student (fictional)', currentStage: 'gap_year', email: 'student@example.test' },
    counsellorStaffId: w.teacherStaff,
    requestedByUserId: u.counsellor.id,
    ...over,
  } as unknown as EventPayload<'ops.admission.enrolment_requested', 1>;
  return withTransaction(db, (tx) =>
    publishEvent(tx, { type: 'ops.admission.enrolment_requested', version: 1, idempotencyKey: enrolmentKeys.request(admissionId, attempt), payload }),
  );
}
const reply = async (requestEventId: string) =>
  (await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.correlationId, requestEventId))).find((e) => e.type.startsWith('academic.enrolment.'))!;
const enrolmentsOf = (studentId: string) => ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.studentId, studentId as never)).orderBy(asc(academicEnrolments.createdAt));
const placementsOf = (enrolmentId: string) =>
  ctx.db.select().from(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, enrolmentId as never)).orderBy(asc(academicBatchPlacements.startDate));
const post = (route: typeof allocateRoute, path: string, user: Parameters<typeof authedRequest>[0] | null, json: unknown) =>
  callRoute<Record<string, unknown>>(route, user ? authedRequest(user, `/academic/api/v1/${path}`, { json }) : buildRequest(`/academic/api/v1/${path}`, { method: 'POST', json }));
const audited = async (entityId: string, action: string) =>
  (await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)))).length;

let core1: string;
let s1: string; // the person with two programmes
let p1Enrolment: string; // programme 1, batch w.batch
let p2Enrolment: string; // programme 2, batch w2.batch

describe('confirmed admission → one enrolment → placement (acceptance 1, 2)', () => {
  it('creates ONE enrolment and ONE open placement in the same transaction, idempotently', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u, { capacity: 5 });
    w2 = await world(ctx.db, u);
    core1 = await coreStudent(ctx.db);
    const admissionId = crypto.randomUUID();
    const ev = await request(ctx.db, { admissionId, coreStudentId: core1 });
    expect(await request(ctx.db, { admissionId, coreStudentId: core1 })).toEqual({ id: ev.id, created: false });
    await runEnrolmentIntake(ctx.db);
    expect((await runEnrolmentIntake(ctx.db)).processed).toBe(0);
    const [student, ...more] = await ctx.db.select().from(academicStudents).where(eq(academicStudents.coreStudentId, core1 as never));
    expect(more).toHaveLength(0);
    s1 = student!.id;
    const [enrolment, ...others] = await enrolmentsOf(s1);
    expect(others).toHaveLength(0);
    expect(enrolment).toMatchObject({ academicYear: '2026-27', batchId: w.batch.id, source: 'admission_event', status: 'active' });
    p1Enrolment = enrolment!.id;
    const placements = await placementsOf(p1Enrolment);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ batchId: w.batch.id, startDate: '2026-10-01', endDate: null, placedByUserId: u.counsellor.id });
    expect(await audited(placements[0]!.id, 'placement.started')).toBe(1);
  });

  it('only ops.admission.enrolment_requested events reach the intake consumer', async () => {
    const delivered = await ctx.db
      .select({ type: integrationEvents.type })
      .from(eventDeliveries)
      .innerJoin(integrationEvents, eq(integrationEvents.id, eventDeliveries.eventId))
      .where(eq(eventDeliveries.consumer, INTAKE_CONSUMER));
    expect(delivered.length).toBeGreaterThan(0);
    expect(new Set(delivered.map((d) => d.type))).toEqual(new Set(['ops.admission.enrolment_requested']));
    expect((await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.type, 'academic.enrolment.confirmed'))).length).toBeGreaterThan(0);
  });

  it('a second programme for the same person reuses the student by coreStudentId, then existingStudentId', async () => {
    const ev = await request(ctx.db, { programmeCode: w2.programmeCode, intendedCourseId: w2.course.id, intendedBatchId: w2.batch.id, coreStudentId: core1 });
    await runEnrolmentIntake(ctx.db);
    expect((await reply(ev.id)).payload).toMatchObject({ existingStudent: true, studentId: s1 });
    const enrolments = await enrolmentsOf(s1);
    expect(enrolments.map((e) => e.programmeId)).toEqual([w.programme.id, w2.programme.id]);
    p2Enrolment = enrolments[1]!.id;
    expect(await placementsOf(p2Enrolment)).toHaveLength(1);

    // Person 2: first admission without a core id, second one names the Academic student and links the person.
    const first = await request(ctx.db, { student: { fullName: 'Sample Second (fictional)', currentStage: 'gap_year', email: 'second@example.test' } });
    await runEnrolmentIntake(ctx.db);
    const s2 = ((await reply(first.id)).payload as { studentId: string }).studentId;
    const core2 = await coreStudent(ctx.db);
    const second = await request(ctx.db, { programmeCode: w2.programmeCode, intendedCourseId: w2.course.id, intendedBatchId: w2.batch.id, existingStudentId: s2, coreStudentId: core2 });
    await runEnrolmentIntake(ctx.db);
    expect((await reply(second.id)).payload).toMatchObject({ existingStudent: true, studentId: s2 });
    const [linked] = await ctx.db.select().from(academicStudents).where(eq(academicStudents.id, s2 as never));
    expect(linked!.coreStudentId).toBe(core2);
    expect(await audited(s2, 'student.linked')).toBe(1);

    // A request that names student 2 but carries person 1 is rejected, never merged.
    const wrong = await request(ctx.db, { existingStudentId: s2, coreStudentId: core1, intendedBatchId: undefined, intendedCourseId: undefined });
    await runEnrolmentIntake(ctx.db);
    expect((await reply(wrong.id)).payload).toMatchObject({ reasonCode: 'INVALID_REQUEST' });
    // The same course again is a duplicate enrolment (rejected with a reason, no crash).
    const dup = await request(ctx.db, { coreStudentId: core1 });
    await runEnrolmentIntake(ctx.db);
    expect((await reply(dup.id)).payload).toMatchObject({ reasonCode: 'DUPLICATE_ENROLMENT' });
  });

  it('without an intended batch the enrolment waits for allocation, visibly', async () => {
    const ev = await request(ctx.db, { intendedBatchId: undefined, intendedCourseId: undefined, student: { fullName: 'Sample Awaiting (fictional)', currentStage: 'gap_year', email: 'awaiting@example.test' } });
    await runEnrolmentIntake(ctx.db);
    const { enrolmentId } = (await reply(ev.id)).payload as { enrolmentId: string };
    expect(await placementsOf(enrolmentId)).toHaveLength(0);
    const res = await callRoute<{ counts: Record<string, number>; rows: { enrolmentId: string }[] }>(viewsRoute, authedRequest(u.auditor, '/academic/api/v1/placements?view=awaiting'));
    expect(res.status).toBe(200);
    expect(res.data!.rows.map((r) => r.enrolmentId)).toContain(enrolmentId);
    expect(res.data!.counts.awaiting).toBe(res.data!.rows.length);
  });
});

const awaitingRequest = (tag: string, over: Record<string, unknown> = {}) =>
  request(ctx.db, { intendedBatchId: undefined, intendedCourseId: undefined, student: { fullName: `Sample ${tag} (fictional)`, currentStage: 'gap_year', email: `${tag}@example.test` }, ...over });

describe('intake duplicates and notes', () => {
  it.each([
    ['a repeat attempt of the same admission without a batch', 'same-admission'],
    ['the same person and programme without a course', 'same-person'],
  ] as const)('duplicate: %s is rejected, never a second active enrolment', async (_label, kind) => {
    const admissionId = crypto.randomUUID();
    const core = await coreStudent(ctx.db);
    const first = { admissionId, ...(kind === 'same-person' ? { coreStudentId: core } : {}) };
    await awaitingRequest(`dup-${kind}`, first);
    await runEnrolmentIntake(ctx.db);
    const again = await awaitingRequest(`dup-${kind}`, kind === 'same-admission' ? { ...first, attempt: 2 } : { coreStudentId: core });
    await runEnrolmentIntake(ctx.db);
    expect((await reply(again.id)).payload).toMatchObject({ reasonCode: 'DUPLICATE_ENROLMENT' });
  });

  it('never places into a clash (enrolment waits for a batch) and notes an unknown existingStudentId', async () => {
    const coord = actor(u.coordinator);
    const core = await coreStudent(ctx.db);
    await request(ctx.db, { coreStudentId: core, student: { fullName: 'Sample Clash (fictional)', currentStage: 'gap_year', email: 'clash@example.test' } });
    await runEnrolmentIntake(ctx.db);
    const clashBatch = await createBatch(ctx.db, coord, { code: uniq('B-'), name: 'Clash batch (fictional)', courseId: w2.course.id, startDate: '2026-09-01', status: 'active' });
    await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, subjectId: w.quant.id, sessionType: 'teaching', date: '2026-12-07', startTime: '08:00', durationMinutes: 75 },
      { batchId: clashBatch.id, subjectId: w2.quant.id, sessionType: 'teaching', date: '2026-12-07', startTime: '08:30', durationMinutes: 75 },
    ]);
    const ev = await request(ctx.db, { programmeCode: w2.programmeCode, intendedCourseId: w2.course.id, intendedBatchId: clashBatch.id, coreStudentId: core, existingStudentId: crypto.randomUUID() });
    await runEnrolmentIntake(ctx.db);
    const payload = (await reply(ev.id)).payload as { enrolmentId: string; existingStudent: boolean; batchId?: string };
    expect(payload).toMatchObject({ existingStudent: true });
    expect(payload.batchId).toBeUndefined();
    expect(await placementsOf(payload.enrolmentId)).toHaveLength(0);
    const [log] = await ctx.db.select().from(academicEnrolmentIntakeLog).where(eq(academicEnrolmentIntakeLog.requestEventId, ev.id));
    expect(log!.reason).toMatch(/clash/i);
    expect(log!.reason).toMatch(/existingStudentId/);
  });
});

let awaiting: string;

describe('placements: allocate, capacity, clash, transfer, end (acceptance 19, 20)', () => {
  it('checks 401, 403 and 400 before acting', async () => {
    expect((await post(allocateRoute, 'placements', null, {})).status).toBe(401);
    for (const user of [u.teacher, u.director, u.auditor, u.counsellor]) expect((await post(allocateRoute, 'placements', user, { enrolmentId: p1Enrolment, batchId: w.batch.id })).status).toBe(403);
    expect((await callRoute(viewsRoute, authedRequest(u.counsellor, '/academic/api/v1/placements?view=placed'))).status).toBe(403);
    expect((await callRoute(viewsRoute, authedRequest(u.auditor, '/academic/api/v1/placements?view=nope'))).status).toBe(400);
    expect((await post(transferRoute, 'placements/transfer', u.teacher, { enrolmentId: p1Enrolment, toBatchId: w2.batch.id, effectiveDate: '2026-11-01', reason: 'x' })).status).toBe(403);
    expect((await post(endRoute, 'placements/end', u.teacher, { enrolmentId: p1Enrolment, outcome: 'completed', endDate: '2026-10-20', reason: 'x', confirm: true })).status).toBe(403);
    expect((await post(allocateRoute, 'placements', u.coordinator, { enrolmentId: 'x' })).status).toBe(400);
    expect((await post(transferRoute, 'placements/transfer', u.coordinator, { enrolmentId: p1Enrolment, toBatchId: w.batch.id, effectiveDate: '2026-11-01' })).status).toBe(400); // no reason
    expect((await post(endRoute, 'placements/end', u.coordinator, { enrolmentId: p1Enrolment, outcome: 'completed', endDate: '2026-12-31', reason: 'Finished (fictional)', confirm: false })).status).toBe(400);
  });

  it('allocates an awaiting enrolment once (audited; enrolments.batch_id follows); a full batch refuses', async () => {
    const coord = actor(u.coordinator);
    const small = await createBatch(ctx.db, coord, { code: uniq('B-'), name: 'Small batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active', capacity: 1 });
    const views = await callRoute<{ rows: { enrolmentId: string; programmeCode: string }[] }>(viewsRoute, authedRequest(u.coordinator, '/academic/api/v1/placements?view=awaiting'));
    awaiting = views.data!.rows.find((r) => r.programmeCode === w.programmeCode)!.enrolmentId;
    const ok = await post(allocateRoute, 'placements', u.coordinator, { enrolmentId: awaiting, batchId: small.id, startDate: '2026-10-15' });
    expect(ok.status).toBe(201);
    expect(await audited(ok.data!.id as string, 'placement.allocated')).toBe(1);
    const [e] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, awaiting as never));
    expect(e).toMatchObject({ batchId: small.id, courseId: w.course.id });
    expect((await post(allocateRoute, 'placements', u.coordinator, { enrolmentId: awaiting, batchId: w.batch.id })).status).toBe(409); // already placed
    // The one seat is taken: a manual enrolment into the small batch is refused.
    const extra = await createStudent(ctx.db, coord, { fullName: 'Sample Extra (fictional)' });
    await expect(enrolManually(ctx.db, coord, { studentId: extra.id, batchId: small.id, reason: 'Test (fictional)' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('two allocations racing for the last seat: one wins, the other gets 409', async () => {
    const coord = actor(u.coordinator);
    const one = await createBatch(ctx.db, coord, { code: uniq('B-'), name: 'One seat (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active', capacity: 1 });
    const ids: string[] = [];
    for (const tag of ['race-a', 'race-b']) {
      const ev = await awaitingRequest(tag);
      await runEnrolmentIntake(ctx.db);
      ids.push(((await reply(ev.id)).payload as { enrolmentId: string }).enrolmentId);
    }
    const results = await Promise.allSettled(ids.map((enrolmentId) => allocatePlacement(ctx.db, coord, { enrolmentId, batchId: one.id, startDate: '2026-10-15' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
  });

  it('manual enrolment is labelled manual, audited and placed', async () => {
    const coord = actor(u.coordinator);
    const m = await createStudent(ctx.db, coord, { fullName: 'Sample Manual (fictional)' });
    const row = await enrolManually(ctx.db, coord, { studentId: m.id, batchId: w.batch.id, startDate: '2026-10-01', reason: 'Legacy register (fictional)' });
    expect(row).toMatchObject({ source: 'manual', manualReason: 'Legacy register (fictional)' });
    expect(await audited(row.id, 'enrolment.created')).toBe(1);
    expect(await placementsOf(row.id)).toMatchObject([{ batchId: w.batch.id, startDate: '2026-10-01', endDate: null }]);
  });

  it('transfer keeps history and attendance, refuses clashes, and proposes catch-up chapters (acceptance 19)', async () => {
    const coord = actor(u.coordinator);
    const target = await createBatch(ctx.db, coord, { code: uniq('B-'), name: 'Target batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active' });
    const { sessions } = await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-10-05', startTime: '09:00', durationMinutes: 75 },
      { batchId: target.id, subjectId: w.quant.id, sessionType: 'teaching', date: '2026-10-06', startTime: '09:00', durationMinutes: 75 },
      { batchId: w2.batch.id, subjectId: w2.quant.id, sessionType: 'teaching', date: '2026-11-10', startTime: '17:00', durationMinutes: 75 },
      { batchId: target.id, subjectId: w.quant.id, sessionType: 'teaching', date: '2026-11-10', startTime: '17:30', durationMinutes: 75 },
    ]);
    const [oldSession, targetSession] = sessions;
    await ctx.db.insert(academicAttendance).values({ sessionId: oldSession!.id, studentId: s1 as never, status: 'present', recordedByUserId: u.teacher.id });
    // The target batch has taught Q-02 (first teaching, verified); the old batch has not.
    await ctx.db.insert(academicClassRecords).values({ sessionId: targetSession!.id, batchId: target.id, chapterId: w.ch2.id, teacherStaffId: w.teacherStaff, activity: 'main', completion: 'completed', actualMinutes: 75, state: 'verified', recordedByUserId: u.teacher.id });

    const body = { enrolmentId: p1Enrolment, toBatchId: target.id, effectiveDate: '2026-11-01', reason: 'Timing change (fictional)' };
    // Programme 2's batch (w2) has a 17:00 class on 10 Nov; the target's 17:30 class overlaps it.
    const clash = await post(transferRoute, 'placements/transfer', u.coordinator, body);
    expect(clash.status).toBe(409);
    expect(clash.error!.message).toMatch(/same time/);
    await withTransaction(ctx.db, (tx) => tx.update(academicBatchPlacements).set({ endDate: '2026-10-31' }).where(eq(academicBatchPlacements.enrolmentId, p2Enrolment as never)));
    expect((await post(transferRoute, 'placements/transfer', u.coordinator, { ...body, toBatchId: w.batch.id })).status).toBe(400); // same batch
    expect((await post(transferRoute, 'placements/transfer', u.coordinator, { ...body, effectiveDate: '2026-10-01' })).status).toBe(400); // not after the start
    const res = await post(transferRoute, 'placements/transfer', u.coordinator, body);
    expect(res.status).toBe(200);
    expect(res.data!.catchUp).toMatchObject({ status: 'proposed', chapters: [{ chapterId: w.ch2.id, code: 'Q-02' }] });
    const [old, next] = await placementsOf(p1Enrolment);
    expect(old).toMatchObject({ batchId: w.batch.id, endDate: '2026-10-31', endedReason: body.reason, endedByUserId: u.coordinator.id });
    expect(next).toMatchObject({ batchId: target.id, startDate: '2026-11-01', endDate: null, transferFromPlacementId: old!.id, reason: body.reason });
    expect((await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, p1Enrolment as never)))[0]!.batchId).toBe(target.id);
    expect(await ctx.db.select().from(academicAttendance).where(eq(academicAttendance.studentId, s1 as never))).toHaveLength(1);
    expect(await audited(next!.id, 'placement.transferred')).toBe(1);
    expect(await audited(old!.id, 'placement.ended')).toBe(1);
  });

  it('completing one programme never closes another (acceptance 20)', async () => {
    await withTransaction(ctx.db, (tx) => tx.update(academicBatchPlacements).set({ endDate: null }).where(eq(academicBatchPlacements.enrolmentId, p2Enrolment as never)));
    const end = (endDate: string) => post(endRoute, 'placements/end', u.coordinator, { enrolmentId: p2Enrolment, outcome: 'completed', endDate, reason: 'Programme finished (fictional)', confirm: true });
    expect((await end('2099-01-01')).status).toBe(400); // future end dates are refused for now
    expect((await end('2026-09-01')).status).toBe(400); // before the enrolment start
    const res = await end('2026-10-20');
    expect(res.status).toBe(200);
    const [p2] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, p2Enrolment as never));
    const [p1] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, p1Enrolment as never));
    expect(p2!.status).toBe('completed');
    expect((await placementsOf(p2Enrolment))[0]).toMatchObject({ endDate: '2026-10-20', endedReason: 'Programme finished (fictional)' });
    expect(p1!.status).toBe('active');
    expect((await placementsOf(p1Enrolment)).at(-1)!.endDate).toBeNull();
    expect(await audited(p2Enrolment, 'enrolment.ended')).toBe(1);
    expect((await post(endRoute, 'placements/end', u.coordinator, { enrolmentId: p2Enrolment, outcome: 'withdrawn', endDate: '2026-10-20', reason: 'Again (fictional)', confirm: true })).status).toBe(409);
  });

  it('lists placed, transfers and ended with counts from the same query', async () => {
    const view = async (v: string) => (await callRoute<{ counts: Record<string, number>; rows: { enrolmentId: string }[] }>(viewsRoute, authedRequest(u.coordinator, `/academic/api/v1/placements?view=${v}`))).data!;
    expect((await view('placed')).rows.map((r) => r.enrolmentId)).toContain(p1Enrolment);
    expect((await view('transfers')).rows.map((r) => r.enrolmentId)).toEqual([p1Enrolment]);
    const ended = await view('ended');
    expect(ended.rows.map((r) => r.enrolmentId)).toEqual([p2Enrolment]);
    expect(ended.counts).toMatchObject({ ended: 1, transfers: 1 });
  });
});

describe('teacher scope follows assignment dates', () => {
  it('a teacher sees students only while an assignment window is open on the day; reasons stay with coordinators', async () => {
    const coord = actor(u.coordinator);
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    const staff = await staffFor(ctx.db, teacher, 'Sample Window Teacher (fictional)');
    const batch = await createBatch(ctx.db, coord, { code: uniq('B-'), name: 'Window batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active' });
    const past = await post(assignRoute, 'assignments', u.coordinator, { batchId: batch.id, subjectId: w.quant.id, staffMemberId: staff, role: 'co_teacher', startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(past.status).toBe(201);
    const future = await post(assignRoute, 'assignments', u.coordinator, { batchId: batch.id, subjectId: w.verbal.id, staffMemberId: staff, startDate: '2099-01-01' });
    expect(future.status).toBe(201);
    const during = await createStudent(ctx.db, coord, { fullName: 'Sample During (fictional)' });
    const later = await createStudent(ctx.db, coord, { fullName: 'Sample Later (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: during.id, batchId: batch.id, startDate: '2026-09-10', reason: 'Test (fictional)' });
    await enrolManually(ctx.db, coord, { studentId: later.id, batchId: batch.id, startDate: '2026-10-10', reason: 'Test (fictional)' });
    const on = async (day: string) => studentIdsInScope(ctx.db, await resolveScope(ctx.db, actor(teacher), 'academic:students:read', day), day);
    expect(await on('2026-09-15')).toEqual([during.id]);
    expect(await listStudents(ctx.db, actor(teacher))).toEqual([]); // the September window is closed today
    expect(await listBatches(ctx.db, actor(teacher))).toEqual([]);
    expect((await callRoute(studentRoute, authedRequest(teacher, `/academic/api/v1/students/${during.id}`), { id: during.id })).status).toBe(404);
    await expect(listBatchPlacements(ctx.db, actor(teacher), batch.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listBatchPlacements(ctx.db, actor(u.teacher), batch.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const note = (rows: Awaited<ReturnType<typeof listBatchPlacements>>) => rows.find((r) => r.reason === 'Legacy register (fictional)');
    expect(note(await listBatchPlacements(ctx.db, actor(u.coordinator), w.batch.id))).toBeDefined();
    const teacherRows = await listBatchPlacements(ctx.db, actor(u.teacher), w.batch.id);
    expect(teacherRows.length).toBeGreaterThan(0);
    expect(teacherRows.every((r) => r.reason === null && r.endedReason === null)).toBe(true);
    // A planned future end date keeps the window open today.
    const planner = await createTestUser(ctx.db, { roles: ['teacher'] });
    const plannerStaff = await staffFor(ctx.db, planner, 'Sample Planned Teacher (fictional)');
    expect((await post(assignRoute, 'assignments', u.coordinator, { batchId: batch.id, subjectId: w.quant.id, staffMemberId: plannerStaff, startDate: '2026-10-01', endDate: '2099-12-31' })).status).toBe(201);
    expect((await callRoute(studentRoute, authedRequest(planner, `/academic/api/v1/students/${later.id}`), { id: later.id })).status).toBe(200);
  });
});

describe('teacher assignments and batch fields', () => {
  it('assigns with a role and dates, ends an assignment keeping history (401/403/400)', async () => {
    const staff = await staffFor(ctx.db, null, 'Sample Assigned Teacher (fictional)');
    const bad = await post(assignRoute, 'assignments', u.coordinator, { batchId: w2.batch.id, subjectId: w2.quant.id, staffMemberId: staff, startDate: '2026-10-10', endDate: '2026-10-01' });
    expect(bad.status).toBe(400);
    const made = await post(assignRoute, 'assignments', u.coordinator, { batchId: w2.batch.id, subjectId: w2.quant.id, staffMemberId: staff, role: 'substitute', startDate: '2026-10-01' });
    expect(made.status).toBe(201);
    const id = made.data!.id as string;
    const path = `assignments/${id}/end`;
    const call = (user: Parameters<typeof authedRequest>[0] | null, json: unknown) =>
      callRoute<Record<string, unknown>>(endAssignmentRoute, user ? authedRequest(user, `/academic/api/v1/${path}`, { json }) : buildRequest(`/academic/api/v1/${path}`, { method: 'POST', json }), { id });
    expect((await call(null, { endDate: '2026-10-20' })).status).toBe(401);
    expect((await call(u.teacher, { endDate: '2026-10-20' })).status).toBe(403);
    expect((await call(u.coordinator, { endDate: '2026-09-01' })).status).toBe(400); // before the start
    const ended = await call(u.coordinator, { endDate: '2026-10-20' });
    expect(ended.status).toBe(200);
    expect(ended.data).toMatchObject({ status: 'ended', endDate: '2026-10-20', role: 'substitute' });
    expect(await audited(id, 'assignment.ended')).toBe(1);
    expect((await call(u.coordinator, { endDate: '2026-10-21' })).status).toBe(409);
    // A stored end date always means `ended`; a planned future end stays current by date and never blocks a later assignment.
    const planned = await post(assignRoute, 'assignments', u.coordinator, { batchId: w2.batch.id, subjectId: w2.verbal.id, staffMemberId: staff, startDate: '2026-10-01', endDate: '2099-12-31' });
    expect(planned.data).toMatchObject({ status: 'ended', endDate: '2099-12-31' });
    expect((await post(assignRoute, 'assignments', u.coordinator, { batchId: w2.batch.id, subjectId: w2.verbal.id, staffMemberId: staff, startDate: '2100-01-01' })).status).toBe(201);
    const current = (await listAssignments(ctx.db, actor(u.coordinator))).map((a) => a.id);
    expect(current).toContain(planned.data!.id);
    expect(current).not.toContain(id);
    // Overlapping dates for the same teacher, batch and subject are refused.
    expect((await post(assignRoute, 'assignments', u.coordinator, { batchId: w2.batch.id, subjectId: w2.verbal.id, staffMemberId: staff, startDate: '2099-06-01' })).status).toBe(409);
    // A planned end can be changed (shortened or extended) while it is today or later; never into an overlap or before the start.
    const plannedId = planned.data!.id as string;
    const change = (endDate: string) =>
      callRoute<Record<string, unknown>>(endAssignmentRoute, authedRequest(u.coordinator, `/academic/api/v1/assignments/${plannedId}/end`, { json: { endDate } }), { id: plannedId });
    expect((await change('2026-09-01')).status).toBe(400);
    expect((await change('2100-06-30')).status).toBe(409); // would overlap the assignment from 1 Jan 2100
    expect((await change('2099-06-30')).data).toMatchObject({ status: 'ended', endDate: '2099-06-30' });
    expect(await audited(plannedId, 'assignment.ended')).toBe(1);
    const batch = await callRoute<{ assignments: { id: string; status: string }[] }>(batchRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w2.batch.id}`), { id: w2.batch.id });
    expect(batch.data!.assignments.find((a) => a.id === id)).toMatchObject({ status: 'ended' });
  });

  it('campus, mode and coordinator are editable and audited', async () => {
    const coordinatorStaff = await staffFor(ctx.db, u.coordinator, 'Sample Coordinator (fictional)');
    const req = (user: Parameters<typeof authedRequest>[0], json: unknown) =>
      callRoute<Record<string, unknown>>(patchBatchRoute, authedRequest(user, `/academic/api/v1/batches/${w2.batch.id}`, { method: 'PATCH', json }), { id: w2.batch.id });
    expect((await req(u.teacher, { campus: 'Sample campus' })).status).toBe(403);
    expect((await req(u.coordinator, { coordinatorStaffId: crypto.randomUUID() })).status).toBe(400);
    const res = await req(u.coordinator, { campus: 'Sample campus', mode: 'hybrid', coordinatorStaffId: coordinatorStaff });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ campus: 'Sample campus', mode: 'hybrid', coordinatorStaffId: coordinatorStaff });
    expect(await audited(w2.batch.id, 'batch.updated')).toBeGreaterThan(0);
  });
});
