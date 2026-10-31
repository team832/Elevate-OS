/**
 * Consumer `academic.enrolment-exit` (IR-OPS-EXIT-1): an exit recorded in Business Ops ends that one
 * enrolment here. The student leaves rosters from the day after the exit; history stays readable.
 * Fictional data only.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  academicAssessmentRoster as R,
  academicAttendance,
  academicBatchPlacements,
  academicCatchupTasks,
  academicEnrolments,
  auditEvents,
  eventDeliveries,
  integrationEvents,
  students as coreStudents,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys, type EventPayload } from '@elevate/shared-contracts';
import { fmtDay } from '@elevate/shared-types';
import { buildRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as createTest } from '../../src/app/api/internal/v1/assessments/route';
import { POST as snapshot } from '../../src/app/api/internal/v1/assessments/[id]/roster/route';
import { POST as scoresRoute } from '../../src/app/api/internal/v1/assessments/[id]/scores/route';
import { POST as runExitsRoute } from '../../src/app/api/internal/v1/enrolment-exits/run/route';
import {
  createBatch,
  createSessions,
  getBatch,
  getIntakeQueue,
  getSessionAttendance,
  getStudentProgress,
  getStudentRecord,
  listBatchPlacements,
  listStudents,
  runEnrolmentExits,
  runEnrolmentIntake,
  seatsTaken,
  transferPlacement,
} from '../../src/server';
import { attend, markHeld } from './a4-helpers';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let ops: TestUser;

type Closed = EventPayload<'ops.enrolment.closed', 1>;
type Admitted = { admissionId: string; coreStudentId: string; enrolmentId: string; studentId: string; eventId: string };

/** What Business Ops publishes for a confirmed admission, taken through the real intake. */
async function admit(over: Record<string, unknown> = {}): Promise<Admitted> {
  const [core] = await ctx.db.insert(coreStudents).values({ fullName: 'Sample Leaver (fictional)', isSample: true }).returning();
  const admissionId = crypto.randomUUID();
  const payload = {
    admissionId,
    leadId: crypto.randomUUID(),
    attempt: 1,
    programmeCode: w.programmeCode,
    intendedCourseId: w.course.id,
    intendedBatchId: w.batch.id,
    intendedStartDate: '2026-09-01',
    student: { fullName: `Sample Leaver ${uniq('N')} (fictional)`, currentStage: 'gap_year', email: 'leaver@example.test' },
    counsellorStaffId: w.teacherStaff,
    requestedByUserId: u.counsellor.id,
    coreStudentId: core!.id,
    ...over,
  } as unknown as EventPayload<'ops.admission.enrolment_requested', 1>;
  const event = await withTransaction(ctx.db, (tx) =>
    publishEvent(tx, { type: 'ops.admission.enrolment_requested', version: 1, idempotencyKey: enrolmentKeys.request(payload.admissionId, payload.attempt), payload }),
  );
  await runEnrolmentIntake(ctx.db);
  const [reply] = (await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.correlationId, event.id))).filter((e) => e.type === 'academic.enrolment.confirmed');
  const { enrolmentId, studentId } = reply!.payload as { enrolmentId: string; studentId: string };
  return { admissionId: payload.admissionId, coreStudentId: payload.coreStudentId!, enrolmentId, studentId, eventId: event.id };
}

const close = (a: Pick<Admitted, 'admissionId' | 'enrolmentId'>, over: object = {}, exitRecordId: string = crypto.randomUUID()) =>
  withTransaction(ctx.db, (tx) =>
    publishEvent(tx, {
      type: 'ops.enrolment.closed',
      version: 1,
      idempotencyKey: enrolmentKeys.closed(exitRecordId),
      payload: {
        admissionId: a.admissionId,
        academicEnrolmentId: a.enrolmentId,
        outcome: 'withdrawn',
        exitDate: '2026-10-10',
        reason: 'Family moved (fictional)',
        closedAt: '2026-10-11T04:00:00.000Z',
        closedByUserId: ops.id,
        ...over,
      } as Closed,
    }),
  );

const enrolment = async (id: string) => (await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, id as never)))[0]!;
const placements = (enrolmentId: string) => ctx.db.select().from(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, enrolmentId as never));
const auditOf = async (entityId: string, action: string) => ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
const internal = (acting: string | null = ops.id, caller = 'ops') => ({
  authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`,
  'x-elevate-caller': caller,
  ...(acting ? { 'x-elevate-acting-user': acting } : {}),
});
const session = async (batchId: string, date: string) => {
  const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date, startTime: '09:00', durationMinutes: 75 }]);
  return sessions[0]!.id;
};
/** A scheduled test on `date`, with its roster snapshot, through the routes Business Ops calls. */
async function test(date: string, batchId: string = w.batch.id) {
  const created = await callRoute<{ assessment: { id: string } }>(
    createTest,
    buildRequest('/academic/api/internal/v1/assessments', { headers: internal(), json: { code: uniq('T-'), kind: 'full_mock', title: 'Mock (fictional)', academicYear: '2026-27', batchIds: [batchId], scheduledDate: date, sections: [{ code: 'QA', name: 'Quant', questionCount: 10, marksPerCorrect: '4', marksPerWrong: '0', marksUnattempted: '0' }] } }),
  );
  const id = created.data!.assessment.id;
  const snap = await callRoute<{ roster: { studentId: string; removed?: boolean; removedAt?: string | null; removedReason?: string | null; version: number }[] }>(
    snapshot,
    buildRequest(`/academic/api/internal/v1/assessments/${id}/roster`, { headers: internal(), json: {} }),
    { id },
  );
  return { id, roster: snap.data!.roster };
}
const rosterRow = async (assessmentId: string, studentId: string) => {
  return (await ctx.db.select().from(R).where(and(eq(R.assessmentId, assessmentId as never), eq(R.studentId, studentId as never))))[0];
};

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
});

describe('closing the enrolment', () => {
  it.each([
    ['withdrawn', 'withdrawn'],
    ['completed', 'completed'],
    ['transferred', 'withdrawn'],
    ['other_inactive', 'withdrawn'],
  ] as const)('outcome %s ends it as %s, keeps the outcome in the audit, ends the placement on the exit date', async (outcome, status) => {
    const a = await admit();
    await close(a, { outcome });
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    expect(await enrolment(a.enrolmentId)).toMatchObject({ status });
    const [placement] = await placements(a.enrolmentId);
    expect(placement).toMatchObject({ endDate: '2026-10-10', endedByUserId: ops.id, endedReason: 'Family moved (fictional)' });
    const [row] = await auditOf(a.enrolmentId, 'enrolment.ended');
    expect(row!.metadata).toMatchObject({ outcome, exitDate: '2026-10-10', admissionId: a.admissionId, closedByUserId: ops.id });
  });

  it('a student with two enrolments keeps the other one', async () => {
    const other = await world(ctx.db, u);
    const first = await admit();
    const second = await admit({ coreStudentId: first.coreStudentId, programmeCode: other.programmeCode, intendedCourseId: other.course.id, intendedBatchId: other.batch.id });
    expect(second.studentId).toBe(first.studentId);
    await close(first);
    await runEnrolmentExits(ctx.db);
    expect(await enrolment(first.enrolmentId)).toMatchObject({ status: 'withdrawn' });
    expect(await enrolment(second.enrolmentId)).toMatchObject({ status: 'active' });
    expect((await placements(second.enrolmentId))[0]).toMatchObject({ endDate: null });
    expect((await listStudents(ctx.db, actor(u.coordinator), { state: 'left' })).map((s) => s.id)).not.toContain(first.studentId);
  });
});

describe('rosters and history', () => {
  it('attendance: on the roster up to the exit date, off it after, marking refused; existing marks stay', async () => {
    const a = await admit();
    const stay = await admit();
    const [before, exitDay, after] = [await session(w.batch.id, '2026-10-05'), await session(w.batch.id, '2026-10-10'), await session(w.batch.id, '2026-10-12')];
    await attend(ctx.db, actor(u.teacher), before, [{ studentId: a.studentId, status: 'present' }]);
    await close(a);
    await runEnrolmentExits(ctx.db);
    const names = async (id: string) => (await getSessionAttendance(ctx.db, actor(u.coordinator), id)).roster.map((r) => r.studentId);
    expect(await names(before)).toContain(a.studentId);
    expect(await names(exitDay)).toContain(a.studentId);
    expect(await names(after)).not.toContain(a.studentId);
    expect(await names(after)).toContain(stay.studentId);
    await expect(attend(ctx.db, actor(u.teacher), after, [{ studentId: a.studentId, status: 'present' }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await ctx.db.select().from(academicAttendance).where(and(eq(academicAttendance.studentId, a.studentId as never), eq(academicAttendance.sessionId, before as never)))).toHaveLength(1);
  });

  it('a mark made after the backdated exit date is kept, flagged as no longer placed', async () => {
    const a = await admit();
    const marked = await session(w.batch.id, '2026-10-14');
    await attend(ctx.db, actor(u.teacher), marked, [{ studentId: a.studentId, status: 'present' }]);
    await close(a, { exitDate: '2026-10-13' });
    await runEnrolmentExits(ctx.db);
    const { roster } = await getSessionAttendance(ctx.db, actor(u.coordinator), marked);
    expect(roster.find((r) => r.studentId === a.studentId)).toMatchObject({ onPlacement: false, mark: { status: 'present' } });
  });

  it('tests: a later test drops an untouched row with the reason; a test on the exit date and a row with marks stay; a new roster excludes them', async () => {
    const a = await admit();
    const stay = await admit();
    const [onExitDay, later, withMarks] = [await test('2026-10-10'), await test('2026-11-20'), await test('2026-11-21')];
    const row = withMarks.roster.find((r) => r.studentId === a.studentId)!;
    const scored = await callRoute(
      scoresRoute,
      buildRequest(`/academic/api/internal/v1/assessments/${withMarks.id}/scores`, { headers: internal(), json: { source: 'csv', rows: [{ studentId: a.studentId, version: row.version, attendance: 'present', marksState: 'verified', score: '12' }] } }),
      { id: withMarks.id },
    );
    expect(scored.status).toBe(200);
    await close(a);
    await runEnrolmentExits(ctx.db);
    expect(await rosterRow(later.id, a.studentId)).toMatchObject({ removedReason: `Left on ${fmtDay('2026-10-10')}: Family moved (fictional)`, rank: null });
    expect((await rosterRow(later.id, a.studentId))!.removedAt).not.toBeNull();
    expect(await rosterRow(later.id, stay.studentId)).toMatchObject({ removedAt: null });
    expect((await auditOf(later.id, 'roster.removed')).map((r) => r.metadata)).toEqual([expect.objectContaining({ studentId: a.studentId, reason: `Left on ${fmtDay('2026-10-10')}: Family moved (fictional)` })]);
    expect(await rosterRow(onExitDay.id, a.studentId)).toMatchObject({ removedAt: null });
    expect(await rosterRow(withMarks.id, a.studentId)).toMatchObject({ removedAt: null, marksState: 'verified' });
    expect((await test('2026-11-22')).roster.map((r) => r.studentId)).not.toContain(a.studentId);
  });

  it('open catch-up tasks of that enrolment are cancelled; finished ones stay', async () => {
    const a = await admit();
    const held = await session(w.batch.id, '2026-10-01');
    const insert = (status: 'open' | 'done', sessionId: string) =>
      ctx.db.insert(academicCatchupTasks).values({ studentId: a.studentId as never, enrolmentId: a.enrolmentId as never, batchId: w.batch.id, sessionId: sessionId as never, reason: 'absent', status, createdByUserId: u.coordinator.id });
    await insert('open', held);
    await insert('done', await session(w.batch.id, '2026-10-02'));
    await close(a);
    await runEnrolmentExits(ctx.db);
    const tasks = await ctx.db.select({ status: academicCatchupTasks.status }).from(academicCatchupTasks).where(eq(academicCatchupTasks.enrolmentId, a.enrolmentId as never));
    expect(tasks.map((t) => t.status).sort()).toEqual(['cancelled', 'done']);
  });

  it('the students list hides them by default, a filter shows them, and their progress stays readable', async () => {
    const a = await admit();
    const held = await session(w.batch.id, '2026-10-03');
    await attend(ctx.db, actor(u.teacher), held, [{ studentId: a.studentId, status: 'present' }]);
    await markHeld(ctx.db, [held]);
    await close(a);
    await runEnrolmentExits(ctx.db);
    const ids = async (state?: 'left' | 'all') => (await listStudents(ctx.db, actor(u.coordinator), { state })).map((s) => s.id);
    expect(await ids()).not.toContain(a.studentId);
    expect(await ids('left')).toContain(a.studentId);
    expect(await ids('all')).toContain(a.studentId);
    const progress = await getStudentProgress(ctx.db, actor(u.coordinator), a.studentId);
    expect(progress.batches.map((b) => b.enrolmentId)).toEqual([a.enrolmentId]);
    expect(progress.batches[0]!.attendance).toMatchObject({ present: 1 });
  });
});

describe('edge cases of a real exit', () => {
  it('a replay does nothing: same key one event, second run nothing, another event on a closed enrolment is ignored and audited', async () => {
    const a = await admit();
    const exitRecord = crypto.randomUUID();
    const first = await close(a, {}, exitRecord);
    expect(await close(a, {}, exitRecord)).toEqual({ id: first.id, created: false });
    await runEnrolmentExits(ctx.db);
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 0, failed: 0 });
    await close(a, { exitDate: '2026-10-20', outcome: 'completed' });
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    expect(await enrolment(a.enrolmentId)).toMatchObject({ status: 'withdrawn' });
    expect((await placements(a.enrolmentId))[0]).toMatchObject({ endDate: '2026-10-10' });
    expect(await auditOf(a.enrolmentId, 'enrolment.exit_ignored')).toHaveLength(1);
  });

  it('leaving before the first day removes the placement that never began and frees its seat', async () => {
    const small = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Future batch (fictional)', courseId: w.course.id, startDate: '2026-12-01', status: 'active', capacity: 1 });
    const a = await admit({ intendedBatchId: small.id, intendedStartDate: '2026-12-01' });
    const placement = (await placements(a.enrolmentId))[0]!;
    expect(placement.startDate).toBe('2026-12-01');
    await close(a);
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ failed: 0 });
    expect(await placements(a.enrolmentId)).toHaveLength(0);
    expect(await seatsTaken(ctx.db, small.id, '2026-12-01')).toBe(0);
    expect((await enrolment(a.enrolmentId)).batchId).toBeNull();
    expect((await auditOf(placement.id, 'placement.voided'))[0]!.before).toMatchObject({ startDate: '2026-12-01' });
  });

  it('a transfer that has not happened yet is undone too: the old placement ends on the exit date', async () => {
    const next = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Next batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active' });
    const a = await admit();
    await transferPlacement(ctx.db, actor(u.coordinator), { enrolmentId: a.enrolmentId, toBatchId: next.id, effectiveDate: '2026-12-15', reason: 'Later batch (fictional)' });
    await close(a);
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ failed: 0 });
    const rows = await placements(a.enrolmentId);
    expect(rows.map((p) => [p.batchId, p.endDate])).toEqual([[w.batch.id, '2026-10-10']]);
  });

  it('a batch whose only student left still answers: no seats taken, history kept, empty rosters', async () => {
    const lone = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Lone batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active', capacity: 5 });
    const a = await admit({ intendedBatchId: lone.id });
    const later = await session(lone.id, '2026-10-20');
    await close(a);
    await runEnrolmentExits(ctx.db);
    const batch = await getBatch(ctx.db, actor(u.coordinator), lone.id);
    expect(batch.activeEnrolments).toBe(0);
    expect((await listBatchPlacements(ctx.db, actor(u.coordinator), lone.id)).map((p) => p.studentId)).toEqual([a.studentId]);
    expect((await getSessionAttendance(ctx.db, actor(u.coordinator), later)).roster).toEqual([]);
    expect((await test('2026-11-25', lone.id)).roster).toEqual([]);
  });

  it('an unknown enrolment fails, is not lost, and shows on the intake queue until it goes dead', async () => {
    const event = await close({ admissionId: crypto.randomUUID(), enrolmentId: crypto.randomUUID() });
    expect(await runEnrolmentExits(ctx.db, { maxAttempts: 2 })).toMatchObject({ failed: 1 });
    const problem = () => getIntakeQueue(ctx.db).then((q) => q.problems.find((p) => p.eventId === event.id));
    expect(await problem()).toMatchObject({ status: 'failed', kind: 'exit' });
    await runEnrolmentExits(ctx.db, { maxAttempts: 2 });
    expect(await problem()).toMatchObject({ status: 'dead', kind: 'exit' });
    await ctx.db.delete(eventDeliveries).where(eq(eventDeliveries.eventId, event.id));
    await ctx.db.delete(integrationEvents).where(eq(integrationEvents.id, event.id));
  });

  it('readmission: intake applies a waiting exit first, so the same person gets a new active enrolment and placement', async () => {
    const a = await admit();
    await close(a);
    const queue = await getIntakeQueue(ctx.db);
    expect(queue.waitingExits).toBe(1);
    const back = await admit({ coreStudentId: a.coreStudentId, intendedStartDate: '2026-10-25' });
    expect(back.studentId).toBe(a.studentId);
    expect(back.enrolmentId).not.toBe(a.enrolmentId);
    expect(await enrolment(a.enrolmentId)).toMatchObject({ status: 'withdrawn' });
    expect(await enrolment(back.enrolmentId)).toMatchObject({ status: 'active', batchId: w.batch.id });
    expect((await placements(back.enrolmentId))[0]).toMatchObject({ startDate: '2026-10-25', endDate: null });
    expect((await listStudents(ctx.db, actor(u.coordinator))).map((s) => s.id)).toContain(a.studentId);
    expect((await getIntakeQueue(ctx.db)).waitingExits).toBe(0);
  });
});

describe('what the old teacher still reads (owner question, Proposed: kept as it is)', () => {
  it('after a transfer: still listed, record opens, only their own batch history; after an exit: only under "left", record still opens', async () => {
    const next = await createBatch(ctx.db, actor(u.coordinator), { code: uniq('B-'), name: 'Other batch (fictional)', courseId: w.course.id, startDate: '2026-09-01', status: 'active' });
    const moved = await admit();
    await transferPlacement(ctx.db, actor(u.coordinator), { enrolmentId: moved.enrolmentId, toBatchId: next.id, effectiveDate: '2026-10-15', reason: 'Later batch (fictional)' });
    const teacher = actor(u.teacher);
    expect((await listStudents(ctx.db, teacher)).map((s) => s.id)).toContain(moved.studentId);
    const record = await getStudentRecord(ctx.db, teacher, moved.studentId);
    expect(record.placements.map((p) => p.batchId)).toEqual([w.batch.id]);
    expect(record.enrolments).toEqual([]);
    const left = await admit();
    await close(left);
    await runEnrolmentExits(ctx.db);
    expect((await listStudents(ctx.db, teacher)).map((s) => s.id)).not.toContain(left.studentId);
    expect((await listStudents(ctx.db, teacher, { state: 'left' })).map((s) => s.id)).toContain(left.studentId);
    expect((await getStudentRecord(ctx.db, teacher, left.studentId)).placements).toHaveLength(1);
  });
});

describe('POST /academic/api/internal/v1/enrolment-exits/run', () => {
  const run = (headers: Record<string, string>) =>
    callRoute<{ processed: number; failed: number; skipped: number }>(runExitsRoute, buildRequest('/academic/api/internal/v1/enrolment-exits/run', { headers, json: {} }));
  it.each([
    ['no token', () => ({}), 401],
    ['another module', () => internal(ops.id, 'marketing'), 403],
    ['no acting user', () => internal(null), 400],
  ])('refuses %s', async (_n, headers, status) => {
    expect((await run(headers())).status).toBe(status);
  });
  it('runs the consumer for Business Ops', async () => {
    const a = await admit();
    await close(a);
    expect((await run(internal())).data).toMatchObject({ processed: 1, failed: 0 });
    expect(await enrolment(a.enrolmentId)).toMatchObject({ status: 'withdrawn' });
  });
});
