/**
 * Enrolment intake consumer (ACD-019, D-011.1): consumes
 * `ops.admission.enrolment_requested` v1 with consumer `academic.enrolment-intake`.
 *
 * For each request, in ONE transaction (the delivery row, our writes and the reply):
 *   validate programme / course / batch (domain/intake.ts) →
 *   create or reuse the student (idempotent by source admission id) →
 *   create the enrolment (unique per request event) →
 *   publish `academic.enrolment.confirmed` v1, or `academic.enrolment.rejected` v1 with a reason.
 * Duplicate delivery is a no-op (core.event_deliveries is unique per event and
 * consumer; the intake log is unique per request event as a second guard).
 *
 * There is NO scheduler yet (wave-3 item): the consumer runs when a coordinator
 * presses "Process intake" (POST /academic/api/v1/enrolment-intake/run) or when
 * code calls `runEnrolmentIntake(db)`.
 */
import { and, asc, count, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import {
  academicBatches,
  academicCourses,
  academicEnrolmentIntakeLog,
  academicEnrolments,
  academicStudents,
  eventDeliveries,
  integrationEvents,
  programmes,
  type Database,
} from '@elevate/database';
import { processEvents, publishEvent, type ConsumerContext, type ProcessResult } from '@elevate/server-kit';
import { ACADEMIC_CONSUMERS, enrolmentKeys, type IntegrationEvent } from '@elevate/shared-contracts';
import type { BatchId, CourseId, UserId } from '@elevate/shared-types';
import { decideIntake } from '../../domain';
import { audit, todayIst } from '../context';
import { newStudentCode } from './students';

export const INTAKE_CONSUMER = ACADEMIC_CONSUMERS.enrolmentIntake;
const REQUEST_TYPE = 'ops.admission.enrolment_requested';

type RequestEvent = IntegrationEvent<'ops.admission.enrolment_requested', 1>;

async function handleRequest(event: RequestEvent, { db: tx }: ConsumerContext, now: Date, triggeredBy: UserId | null) {
  const p = event.payload;
  const [already] = await tx.select({ id: academicEnrolmentIntakeLog.id }).from(academicEnrolmentIntakeLog).where(eq(academicEnrolmentIntakeLog.requestEventId, event.id));
  if (already) return;
  const today = todayIst(now);

  const [programme] = await tx.select().from(programmes).where(eq(programmes.code, p.programmeCode));
  const [course] = p.intendedCourseId ? await tx.select().from(academicCourses).where(eq(academicCourses.id, p.intendedCourseId as CourseId)) : [];
  const [batch] = p.intendedBatchId ? await tx.select().from(academicBatches).where(eq(academicBatches.id, p.intendedBatchId as BatchId)).for('update') : [];
  let activeEnrolments = 0;
  if (batch) {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(academicEnrolments).where(and(eq(academicEnrolments.batchId, batch.id), eq(academicEnrolments.status, 'active')));
    activeEnrolments = Number(n);
  }
  const [existingStudent] = await tx.select().from(academicStudents).where(eq(academicStudents.sourceAdmissionId, p.admissionId));
  let duplicateInBatch = false;
  if (existingStudent && batch) {
    const [dup] = await tx.select({ id: academicEnrolments.id }).from(academicEnrolments).where(and(eq(academicEnrolments.studentId, existingStudent.id), eq(academicEnrolments.batchId, batch.id), eq(academicEnrolments.status, 'active')));
    duplicateInBatch = Boolean(dup);
  }

  const decision = decideIntake(
    {
      programmeCode: p.programmeCode,
      intendedCourseId: p.intendedCourseId,
      intendedBatchId: p.intendedBatchId,
      intendedStartDate: p.intendedStartDate,
      student: { dateOfBirth: p.student.dateOfBirth, currentStage: p.student.currentStage },
      guardian: p.guardian ? { email: p.guardian.email, phone: p.guardian.phone } : undefined,
    },
    {
      programme: programme ? { id: programme.id, code: programme.code, status: programme.status } : null,
      course: course ? { id: course.id, programmeId: course.programmeId, status: course.status } : null,
      batch: batch ? { id: batch.id, programmeId: batch.programmeId, courseId: batch.courseId, status: batch.status, startDate: batch.startDate, capacity: batch.capacity, activeEnrolments } : null,
      duplicateInBatch,
    },
    today,
  );
  const base = { requestEventId: event.id, admissionId: p.admissionId, leadId: p.leadId, attempt: p.attempt, programmeCode: p.programmeCode, studentName: p.student.fullName };
  const replyMeta = { idempotencyKey: enrolmentKeys.reply(event.id), correlationId: event.id, causationId: event.id };

  if (decision.decision === 'reject') {
    const reply = await publishEvent(tx, {
      type: 'academic.enrolment.rejected',
      version: 1,
      ...replyMeta,
      payload: { requestEventId: event.id, admissionId: p.admissionId, leadId: p.leadId, reasonCode: decision.reasonCode, reason: decision.reason, rejectedAt: now.toISOString(), rejectedByUserId: null } as never,
    });
    await tx.insert(academicEnrolmentIntakeLog).values({ ...base, outcome: 'rejected', reasonCode: decision.reasonCode, reason: decision.reason, replyEventId: reply.id, processedAt: now });
    await audit(tx, null, { action: 'enrolment_request.rejected', entityType: 'enrolment_request', entityId: event.id, after: { reasonCode: decision.reasonCode, reason: decision.reason }, metadata: { admissionId: p.admissionId, triggeredBy } });
    return;
  }

  let student = existingStudent;
  if (!student) {
    [student] = await tx
      .insert(academicStudents)
      .values({
        code: newStudentCode(),
        fullName: p.student.fullName,
        preferredName: p.student.preferredName ?? null,
        dateOfBirth: p.student.dateOfBirth ?? null,
        currentStage: p.student.currentStage ?? null,
        schoolBoard: p.student.schoolBoard ?? null,
        email: p.student.email ?? null,
        phone: p.student.phone ?? null,
        city: p.student.city ?? null,
        guardianName: p.guardian?.fullName ?? null,
        guardianRelationship: p.guardian?.relationship ?? null,
        guardianEmail: p.guardian?.email ?? null,
        guardianPhone: p.guardian?.phone ?? null,
        sourceAdmissionId: p.admissionId,
        sourceLeadId: p.leadId,
      })
      .returning();
    await audit(tx, null, { action: 'student.created', entityType: 'student', entityId: student!.id, after: { id: student!.id, code: student!.code, source: 'admission_event' }, metadata: { requestEventId: event.id, triggeredBy } });
  }
  const [enrolment] = await tx
    .insert(academicEnrolments)
    .values({
      studentId: student!.id,
      programmeId: decision.programmeId as never,
      courseId: (decision.courseId as CourseId | null) ?? null,
      batchId: (decision.batchId as BatchId | null) ?? null,
      startDate: decision.startDate,
      lateJoiner: decision.lateJoiner,
      source: 'admission_event',
      sourceAdmissionId: p.admissionId,
      sourceLeadId: p.leadId,
      requestEventId: event.id,
      createdByUserId: triggeredBy,
    })
    .returning();
  const reply = await publishEvent(tx, {
    type: 'academic.enrolment.confirmed',
    version: 1,
    ...replyMeta,
    payload: {
      requestEventId: event.id,
      admissionId: p.admissionId,
      leadId: p.leadId,
      enrolmentId: enrolment!.id,
      studentId: student!.id,
      existingStudent: Boolean(existingStudent),
      programmeCode: p.programmeCode,
      ...(decision.courseId ? { courseId: decision.courseId } : {}),
      ...(decision.batchId ? { batchId: decision.batchId } : {}),
      confirmedAt: now.toISOString(),
      confirmedByUserId: null,
    } as never,
  });
  await tx.insert(academicEnrolmentIntakeLog).values({ ...base, outcome: 'confirmed', studentId: student!.id, enrolmentId: enrolment!.id, existingStudent: Boolean(existingStudent), replyEventId: reply.id, processedAt: now });
  await audit(tx, null, { action: 'enrolment.created', entityType: 'enrolment', entityId: enrolment!.id, after: enrolment, metadata: { source: 'admission_event', requestEventId: event.id, triggeredBy } });
}

/** Run the intake consumer once (a batch of up to 50 pending requests). */
export async function runEnrolmentIntake(db: Database, options: { triggeredByUserId?: UserId | null; now?: () => Date; maxAttempts?: number } = {}): Promise<ProcessResult> {
  return processEvents(db, {
    consumer: INTAKE_CONSUMER,
    maxAttempts: options.maxAttempts ?? 5,
    handlers: {
      [REQUEST_TYPE]: (event: RequestEvent, ctx: ConsumerContext) => handleRequest(event, ctx, options.now?.() ?? new Date(), options.triggeredByUserId ?? null),
    },
  });
}

/** The intake queue: processed outcomes, failed/dead deliveries, and how many requests are waiting. */
export async function getIntakeQueue(db: Database) {
  const processed = await db.select().from(academicEnrolmentIntakeLog).orderBy(desc(academicEnrolmentIntakeLog.processedAt)).limit(200);
  const problems = await db
    .select({ eventId: integrationEvents.id, occurredAt: integrationEvents.occurredAt, payload: integrationEvents.payload, status: eventDeliveries.status, attempts: eventDeliveries.attempts, lastError: eventDeliveries.lastError })
    .from(eventDeliveries)
    .innerJoin(integrationEvents, eq(integrationEvents.id, eventDeliveries.eventId))
    .where(and(eq(eventDeliveries.consumer, INTAKE_CONSUMER), inArray(eventDeliveries.status, ['failed', 'dead'])))
    .orderBy(asc(integrationEvents.occurredAt));
  const [{ waiting } = { waiting: 0 }] = await db
    .select({ waiting: count() })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.type, REQUEST_TYPE),
        notExists(db.select({ one: sql`1` }).from(eventDeliveries).where(and(eq(eventDeliveries.eventId, integrationEvents.id), eq(eventDeliveries.consumer, INTAKE_CONSUMER)))),
      ),
    );
  return {
    waiting: Number(waiting),
    processed,
    problems: problems.map((p) => {
      const payload = p.payload as { admissionId?: string; programmeCode?: string; student?: { fullName?: string } };
      return { eventId: p.eventId, occurredAt: p.occurredAt, status: p.status, attempts: p.attempts, lastError: p.lastError, admissionId: payload.admissionId ?? null, programmeCode: payload.programmeCode ?? null, studentName: payload.student?.fullName ?? null };
    }),
    scheduler: 'none — run manually (wave-3 integration adds a scheduler)',
  };
}
