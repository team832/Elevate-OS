/**
 * Enrolment intake consumer (ACD-019, D-011.1): consumes
 * `ops.admission.enrolment_requested` v1 with consumer `academic.enrolment-intake`.
 *
 * For each request, in ONE transaction (the delivery row, our writes and the reply):
 *   validate programme / course / batch (domain/intake.ts) →
 *   match the student by existingStudentId, then coreStudentId, then source admission id
 *   (one academic student per person; a second programme reuses it) →
 *   create the enrolment (unique per request event) and, with an intended batch, its open
 *   placement (seat-checked on the locked batch row; on a timetable clash the enrolment waits
 *   for a batch and the intake log says why) →
 *   publish `academic.enrolment.confirmed` v1, or `academic.enrolment.rejected` v1 with a reason.
 * Duplicate delivery is a no-op (core.event_deliveries is unique per event and
 * consumer; the intake log is unique per request event as a second guard).
 *
 * There is NO scheduler yet (wave-3 item): the consumer runs when a coordinator
 * presses "Process intake" (POST /academic/api/v1/enrolment-intake/run) or when
 * code calls `runEnrolmentIntake(db)`.
 */
import { and, asc, count, desc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import {
  academicBatches,
  academicCourses,
  academicEnrolmentIntakeLog,
  academicEnrolments,
  academicStudents,
  eventDeliveries,
  integrationEvents,
  programmes,
  students as coreStudents,
  type Database,
} from '@elevate/database';
import { processEvents, publishEvent, type ConsumerContext, type ProcessResult } from '@elevate/server-kit';
import { ACADEMIC_CONSUMERS, enrolmentKeys, type IntegrationEvent } from '@elevate/shared-contracts';
import type { BatchId, CourseId, StudentId, StudentIdentityId, UserId } from '@elevate/shared-types';
import { decideIntake } from '../../domain';
import { audit, todayIst } from '../context';
import { clashMessages, seatsTaken, startPlacement } from './placements';
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
  const activeEnrolments = batch ? await seatsTaken(tx, batch.id, p.intendedStartDate ?? today) : 0;
  const studentWhere = async (where: ReturnType<typeof eq>) => (await tx.select().from(academicStudents).where(where).limit(1))[0];
  const byId = p.existingStudentId ? await studentWhere(eq(academicStudents.id, p.existingStudentId as StudentId)) : undefined;
  const byCore = p.coreStudentId ? await studentWhere(eq(academicStudents.coreStudentId, p.coreStudentId as StudentIdentityId)) : undefined;
  const existingStudent = byId ?? byCore ?? (await studentWhere(eq(academicStudents.sourceAdmissionId, p.admissionId)));
  const identityConflict = Boolean(
    existingStudent && p.coreStudentId && ((existingStudent.coreStudentId && existingStudent.coreStudentId !== p.coreStudentId) || (byCore && byCore.id !== existingStudent.id)),
  );
  // Duplicate = an ACTIVE enrolment for the same admission + programme, or for the same student in
  // the same batch, the same course, or the same programme where either side has no course yet.
  const dupCourseId = batch?.courseId ?? course?.id;
  const e = academicEnrolments;
  const sameStudent = existingStudent ? eq(e.studentId, existingStudent.id) : undefined;
  const dupWhen = [
    programme ? and(eq(e.sourceAdmissionId, p.admissionId), eq(e.programmeId, programme.id)) : undefined,
    sameStudent && batch ? and(sameStudent, eq(e.batchId, batch.id)) : undefined,
    sameStudent && dupCourseId ? and(sameStudent, eq(e.courseId, dupCourseId)) : undefined,
    sameStudent && programme ? and(sameStudent, eq(e.programmeId, programme.id), dupCourseId ? isNull(e.courseId) : undefined) : undefined,
  ].filter(Boolean);
  const [duplicate] = dupWhen.length ? await tx.select({ id: e.id }).from(e).where(and(eq(e.status, 'active'), or(...dupWhen))) : [];
  const notes: string[] = [];
  if (p.existingStudentId && !byId) notes.push('existingStudentId was not found in Academic OS; matched by core student id or admission instead.');

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
      duplicateEnrolment: Boolean(duplicate),
      identityConflict,
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

  // D-036: the event carries no sample flag, so it comes from the canonical person.
  const [core] = p.coreStudentId ? await tx.select({ isSample: coreStudents.isSample }).from(coreStudents).where(eq(coreStudents.id, p.coreStudentId as StudentIdentityId)) : [];
  const isSample = core?.isSample ?? false;
  let student = existingStudent;
  if (student && p.coreStudentId && !student.coreStudentId) {
    [student] = await tx.update(academicStudents).set({ coreStudentId: p.coreStudentId as StudentIdentityId, isSample: student.isSample || isSample }).where(eq(academicStudents.id, student.id)).returning();
    await audit(tx, null, { action: 'student.linked', entityType: 'student', entityId: student!.id, after: { coreStudentId: p.coreStudentId, isSample: student!.isSample }, metadata: { requestEventId: event.id, triggeredBy } });
  }
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
        coreStudentId: (p.coreStudentId as StudentIdentityId | undefined) ?? null,
        isSample,
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
      batchId: null, // set by startPlacement when the student is placed
      startDate: decision.startDate,
      academicYear: p.academicYear ?? null,
      lateJoiner: decision.lateJoiner,
      source: 'admission_event',
      sourceAdmissionId: p.admissionId,
      sourceLeadId: p.leadId,
      requestEventId: event.id,
      createdByUserId: triggeredBy,
    })
    .returning();
  const startDate = decision.startDate ?? today;
  const clashes = batch ? await clashMessages(tx, enrolment!, batch, startDate) : [];
  if (batch && clashes.length) {
    notes.push(`Not placed in ${batch.code} because of a timetable clash (${clashes.join('; ')}). Allocate a batch from Enrolments, Awaiting batch.`);
  } else if (batch) {
    // Who placed: the coordinator who ran the intake, else the Ops user whose confirmed admission asked for this batch.
    await startPlacement(tx, null, { enrolment: enrolment!, batch, startDate, placedByUserId: triggeredBy ?? (p.requestedByUserId as UserId), checkClash: false, action: 'placement.started' });
  }
  const placedBatchId = batch && !clashes.length ? batch.id : null;
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
      ...(placedBatchId ? { batchId: placedBatchId } : {}),
      confirmedAt: now.toISOString(),
      confirmedByUserId: null,
    } as never,
  });
  await tx.insert(academicEnrolmentIntakeLog).values({ ...base, outcome: 'confirmed', reason: notes.join(' ') || null, studentId: student!.id, enrolmentId: enrolment!.id, existingStudent: Boolean(existingStudent), replyEventId: reply.id, processedAt: now });
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
