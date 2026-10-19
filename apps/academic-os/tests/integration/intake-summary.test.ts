import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicEnrolments, academicStudents, integrationEvents, type Database } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys, type EventPayload } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { POST as runRoute } from '../../src/app/api/v1/enrolment-intake/run/route';
import { GET as queueRoute } from '../../src/app/api/v1/enrolment-intake/route';
import { GET as summaryRoute } from '../../src/app/api/internal/v1/summary/route';
import { runEnrolmentIntake } from '../../src/server';
import { users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;

/** What Business Ops would publish (fictional data). */
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
    student: { fullName: 'Ira Example (fictional)', currentStage: 'class_12', email: 'ira@example.test' },
    guardian: { fullName: 'Guardian of Ira (fictional)', relationship: 'mother', phone: '+919000000201' },
    counsellorStaffId: w.teacherStaff,
    requestedByUserId: u.counsellor.id,
    ...over,
  } as unknown as EventPayload<'ops.admission.enrolment_requested', 1>;
  return withTransaction(db, (tx) =>
    publishEvent(tx, { type: 'ops.admission.enrolment_requested', version: 1, idempotencyKey: enrolmentKeys.request(admissionId, attempt), payload }),
  );
}
const replies = async (requestEventId: string) =>
  (await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.correlationId, requestEventId))).filter((e) => e.type.startsWith('academic.enrolment.'));

describe('academic.enrolment-intake consumer', () => {
  it('only coordinators can run it (401/403)', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u, { capacity: 3 });
    expect((await callRoute(runRoute, buildRequest('/academic/api/v1/enrolment-intake/run', { method: 'POST' }))).status).toBe(401);
    for (const user of [u.counsellor, u.teacher, u.director, u.auditor]) {
      expect((await callRoute(runRoute, authedRequest(user, '/academic/api/v1/enrolment-intake/run', { method: 'POST' }))).status).toBe(403);
    }
  });

  it('confirms a valid request: creates the student and enrolment and publishes confirmed in the same transaction', async () => {
    const ev = await request(ctx.db);
    const res = await callRoute<{ processed: number; failed: number }>(runRoute, authedRequest(u.coordinator, '/academic/api/v1/enrolment-intake/run', { method: 'POST' }));
    expect(res.data).toMatchObject({ processed: 1, failed: 0 });
    const out = await replies(ev.id);
    expect(out.map((e) => e.type)).toEqual(['academic.enrolment.confirmed']);
    expect(out[0]!.idempotencyKey).toBe(enrolmentKeys.reply(ev.id));
    const payload = out[0]!.payload as { studentId: string; enrolmentId: string; existingStudent: boolean; batchId: string; confirmedByUserId: null };
    expect(payload).toMatchObject({ existingStudent: false, batchId: w.batch.id, confirmedByUserId: null });
    const [enrolment] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, payload.enrolmentId as never));
    expect(enrolment).toMatchObject({ source: 'admission_event', requestEventId: ev.id, status: 'active', lateJoiner: true });
  });

  it('duplicate delivery and duplicate publication give ONE student and ONE enrolment', async () => {
    const admissionId = crypto.randomUUID();
    const first = await request(ctx.db, { admissionId });
    const again = await request(ctx.db, { admissionId }); // same idempotency key → same event
    expect(again).toEqual({ id: first.id, created: false });
    await runEnrolmentIntake(ctx.db);
    const second = await runEnrolmentIntake(ctx.db); // re-run: already delivered
    expect(second.processed).toBe(0);
    const students = await ctx.db.select().from(academicStudents).where(eq(academicStudents.sourceAdmissionId, admissionId));
    expect(students).toHaveLength(1);
    const enrolments = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.sourceAdmissionId, admissionId));
    expect(enrolments).toHaveLength(1);
    expect(await replies(first.id)).toHaveLength(1);
  });

  it('an invalid batch is rejected with an event and a reason; nothing is created', async () => {
    const admissionId = crypto.randomUUID();
    const ev = await request(ctx.db, { admissionId, intendedBatchId: crypto.randomUUID() as never });
    await runEnrolmentIntake(ctx.db);
    const out = await replies(ev.id);
    expect(out.map((e) => e.type)).toEqual(['academic.enrolment.rejected']);
    expect(out[0]!.payload).toMatchObject({ reasonCode: 'BATCH_NOT_FOUND', rejectedByUserId: null });
    expect(await ctx.db.select().from(academicStudents).where(eq(academicStudents.sourceAdmissionId, admissionId))).toHaveLength(0);
    // Ops corrects and re-requests (attempt 2): the request is confirmed and the student created once.
    const retry = await request(ctx.db, { admissionId, attempt: 2 });
    await runEnrolmentIntake(ctx.db);
    expect((await replies(retry.id)).map((e) => e.type)).toEqual(['academic.enrolment.confirmed']);
    // A third request for the same admission and batch is a duplicate enrolment.
    const dup = await request(ctx.db, { admissionId, attempt: 3 });
    await runEnrolmentIntake(ctx.db);
    expect((await replies(dup.id))[0]!.payload).toMatchObject({ reasonCode: 'DUPLICATE_ENROLMENT' });
  });

  it('rejects a full batch, an unknown programme and a minor without a guardian', async () => {
    const full = await request(ctx.db); // capacity 3 is now reached (3 active enrolments)
    const unknown = await request(ctx.db, { programmeCode: 'NOPE_PROGRAMME' });
    const minor = await request(ctx.db, { guardian: undefined, student: { fullName: 'Kid Example (fictional)', currentStage: 'class_11', email: 'kid@example.test' } });
    await runEnrolmentIntake(ctx.db);
    const code = async (id: string) => ((await replies(id))[0]!.payload as { reasonCode: string }).reasonCode;
    expect(await code(full.id)).toBe('BATCH_FULL');
    expect(await code(unknown.id)).toBe('PROGRAMME_NOT_OFFERED');
    expect(await code(minor.id)).toBe('INVALID_REQUEST');
  });

  it('the intake queue shows processed outcomes and nothing waiting', async () => {
    const res = await callRoute<{ waiting: number; processed: { outcome: string }[]; problems: unknown[] }>(queueRoute, authedRequest(u.auditor, '/academic/api/v1/enrolment-intake'));
    expect(res.status).toBe(200);
    expect(res.data!.waiting).toBe(0);
    expect(res.data!.processed.filter((p) => p.outcome === 'confirmed')).toHaveLength(3);
    expect(res.data!.processed.filter((p) => p.outcome === 'rejected')).toHaveLength(5);
    expect((await callRoute(queueRoute, authedRequest(u.counsellor, '/academic/api/v1/enrolment-intake'))).status).toBe(403);
  });
});

describe('GET /academic/api/internal/v1/summary', () => {
  const internal = (query = '', caller = 'ops', token = process.env.INTERNAL_SERVICE_TOKEN!) =>
    buildRequest(`/academic/api/internal/v1/summary${query}`, { headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': caller } });

  it('needs the service token and an allowed caller', async () => {
    expect((await callRoute(summaryRoute, buildRequest('/academic/api/internal/v1/summary'))).status).toBe(401);
    expect((await callRoute(summaryRoute, internal('', 'ops', 'test-only-wrong-token-000000000000000'))).status).toBe(401);
    expect((await callRoute(summaryRoute, internal('', 'marketing'))).status).toBe(403);
    expect((await callRoute(summaryRoute, internal('?from=2026-10-10&to=2026-10-01'))).status).toBe(400);
  });

  it('returns AcademicDeliverySummaryV1 where missing data is missing, never zero', async () => {
    const res = await callRoute<{ contract: string; metrics: Record<string, { status: string; value: number | null }>; programmes: { programmeCode: string }[]; extensions: { overall: { hoursPlanned: number | null } } }>(
      summaryRoute,
      internal('?from=2026-09-01&to=2026-10-31'),
    );
    expect(res.status).toBe(200);
    expect(res.data!.contract).toBe('academic.delivery_summary');
    const m = res.data!.metrics;
    expect(m.activeStudents).toMatchObject({ status: 'ok', value: 3 });
    expect(m.classesPlanned!.status).toBe('missing'); // nothing timetabled in this file
    expect(m.attendanceRate).toMatchObject({ status: 'missing', value: null });
    expect(m.assessmentsConducted!.status).toBe('missing');
    expect(m.studentsAtRisk!.status).toBe('missing');
    expect(m.syllabusCompletionRate!.status).toBe('missing');
    expect(res.data!.extensions.overall.hoursPlanned).toBeNull();
    expect(res.data!.programmes.some((p) => p.programmeCode === w.programmeCode)).toBe(true);
  });
});
