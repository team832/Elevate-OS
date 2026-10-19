/**
 * Enrolment intake decision (ACD-019) for one `ops.admission.enrolment_requested`
 * v1 request — pure. The consumer looks the references up and asks this
 * function whether to confirm or reject; the order of checks fixes which
 * reason code wins when several apply.
 *
 *   1 PROGRAMME_NOT_OFFERED  programme unknown, paused or retired
 *   2 COURSE_NOT_FOUND       intended course unknown or under another programme
 *   3 BATCH_NOT_FOUND        intended batch unknown, under another programme/course,
 *                            or not open (completed / cancelled)
 *   4 INVALID_REQUEST        a minor without a guardian contact (PLT-014)
 *   5 DUPLICATE_ENROLMENT    the student already has an active enrolment in the batch
 *   6 BATCH_FULL             the batch's seat limit is reached
 * Otherwise confirm (a batch is optional: without one the enrolment waits for allocation).
 */
import type { ENROLMENT_REJECTION_REASONS } from '@elevate/shared-contracts';

export type RejectionCode = (typeof ENROLMENT_REJECTION_REASONS)[number];

export interface IntakeRequest {
  programmeCode: string;
  intendedCourseId?: string;
  intendedBatchId?: string;
  intendedStartDate?: string;
  student: { dateOfBirth?: string; currentStage?: string };
  guardian?: { email?: string; phone?: string };
}

export interface IntakeRefs {
  programme: { id: string; code: string; status: string } | null;
  course: { id: string; programmeId: string; status: string } | null;
  batch: {
    id: string;
    programmeId: string;
    courseId: string;
    status: string;
    startDate: string | null;
    capacity: number | null;
    activeEnrolments: number;
  } | null;
  /** The student already has an active enrolment in the intended batch. */
  duplicateInBatch: boolean;
}

export type IntakeDecision =
  | {
      decision: 'confirm';
      programmeId: string;
      courseId: string | null;
      batchId: string | null;
      startDate: string | null;
      lateJoiner: boolean;
    }
  | { decision: 'reject'; reasonCode: RejectionCode; reason: string };

const MINOR_STAGES = new Set(['class_9', 'class_10', 'class_11', 'class_12']);

/** Whole years between a date of birth and `today` (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** A minor by date of birth, or (without one) by a school stage. */
export function isMinor(student: IntakeRequest['student'], today: string): boolean {
  if (student.dateOfBirth) return ageOn(student.dateOfBirth, today) < 18;
  return student.currentStage ? MINOR_STAGES.has(student.currentStage) : false;
}

export function decideIntake(request: IntakeRequest, refs: IntakeRefs, today: string): IntakeDecision {
  const reject = (reasonCode: RejectionCode, reason: string): IntakeDecision => ({
    decision: 'reject',
    reasonCode,
    reason,
  });
  const { programme, course, batch } = refs;
  if (!programme) {
    return reject('PROGRAMME_NOT_OFFERED', `Programme ${request.programmeCode} is not in the catalogue.`);
  }
  if (programme.status === 'paused' || programme.status === 'retired') {
    return reject('PROGRAMME_NOT_OFFERED', `Programme ${programme.code} is ${programme.status}.`);
  }
  if (request.intendedCourseId) {
    if (!course) return reject('COURSE_NOT_FOUND', 'The intended course does not exist in Academic OS.');
    if (course.programmeId !== programme.id) {
      return reject('COURSE_NOT_FOUND', `The intended course does not belong to ${programme.code}.`);
    }
  }
  if (request.intendedBatchId) {
    if (!batch) return reject('BATCH_NOT_FOUND', 'The intended batch does not exist in Academic OS.');
    if (batch.programmeId !== programme.id) {
      return reject('BATCH_NOT_FOUND', `The intended batch does not belong to ${programme.code}.`);
    }
    if (request.intendedCourseId && batch.courseId !== request.intendedCourseId) {
      return reject('BATCH_NOT_FOUND', 'The intended batch follows a different course.');
    }
    if (batch.status === 'completed' || batch.status === 'cancelled') {
      return reject('BATCH_NOT_FOUND', `The intended batch is ${batch.status} and not open for enrolment.`);
    }
  }
  if (isMinor(request.student, today) && !(request.guardian?.email || request.guardian?.phone)) {
    return reject('INVALID_REQUEST', 'The student is a minor; a guardian with an email or phone is required.');
  }
  if (batch && refs.duplicateInBatch) {
    return reject('DUPLICATE_ENROLMENT', 'The student already has an active enrolment in this batch.');
  }
  if (batch && batch.capacity !== null && batch.activeEnrolments >= batch.capacity) {
    return reject('BATCH_FULL', `The batch is full (${batch.activeEnrolments}/${batch.capacity}).`);
  }
  const startDate = request.intendedStartDate ?? (batch?.startDate && batch.startDate > today ? batch.startDate : today);
  return {
    decision: 'confirm',
    programmeId: programme.id,
    courseId: batch?.courseId ?? course?.id ?? null,
    batchId: batch?.id ?? null,
    startDate,
    lateJoiner: Boolean(batch?.startDate && startDate > batch.startDate),
  };
}
