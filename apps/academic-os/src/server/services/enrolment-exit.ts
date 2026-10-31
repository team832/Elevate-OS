/**
 * Consumer `academic.enrolment-exit` (IR-OPS-EXIT-1): consumes `ops.enrolment.closed` v1. In one
 * transaction with the delivery row it ends that one enrolment (other enrolments of the student
 * are not touched): placements stop on the exit date, so attendance rosters and new test rosters
 * no longer hold the student after it; marks, attendance and results already recorded stay.
 *
 * Academic's enrolment status has no `transferred` or `other_inactive`: both end as `withdrawn` and
 * the audit row keeps the outcome Ops recorded. An enrolment already ended (by a coordinator, or an
 * earlier exit) is left as it is and the event is audited as ignored.
 *
 * The same consumer takes `ops.student.renamed` v1, so one button sends both: it updates Academic's
 * copy of the name. A student Academic does not have yet takes the current name at intake.
 */
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  academicAssessmentRoster as R,
  academicAssessments,
  academicBatchPlacements as pl,
  academicCatchupTasks,
  academicEnrolments as e,
  academicStudents,
  type Database,
} from '@elevate/database';
import { processEvents, type ConsumerContext, type ProcessResult } from '@elevate/server-kit';
import { ACADEMIC_CONSUMERS, type IntegrationEvent } from '@elevate/shared-contracts';
import { fmtDay, type EnrolmentId, type StudentIdentityId, type UserId } from '@elevate/shared-types';
import { audit } from '../context';

export const EXIT_CONSUMER = ACADEMIC_CONSUMERS.enrolmentExit;
export const EXIT_EVENT = 'ops.enrolment.closed';
const RENAME_EVENT = 'ops.student.renamed';

async function handleRenamed(event: IntegrationEvent<typeof RENAME_EVENT, 1>, { db: tx }: ConsumerContext) {
  const p = event.payload;
  const before = await tx.select().from(academicStudents).where(eq(academicStudents.coreStudentId, p.coreStudentId as StudentIdentityId));
  for (const s of before) {
    const [after] = await tx.update(academicStudents).set({ fullName: p.fullName }).where(eq(academicStudents.id, s.id)).returning();
    await audit(tx, null, { action: 'student.renamed', entityType: 'student', entityId: s.id, before: s, after, metadata: { eventId: event.id, renamedByUserId: p.renamedByUserId } });
  }
}

async function handleClosed(event: IntegrationEvent<typeof EXIT_EVENT, 1>, { db: tx }: ConsumerContext) {
  const p = event.payload;
  const [enrolment] = await tx.select().from(e).where(eq(e.id, p.academicEnrolmentId as EnrolmentId)).for('update');
  // Retrying cannot help, but losing an exit silently is worse: it goes dead and shows on the intake queue.
  if (!enrolment) throw new Error(`Exit for unknown enrolment ${p.academicEnrolmentId}`);
  const metadata = { eventId: event.id, outcome: p.outcome, exitDate: p.exitDate, reason: p.reason, admissionId: p.admissionId, closedByUserId: p.closedByUserId };
  const entity = { entityType: 'enrolment', entityId: enrolment.id };
  if (enrolment.status !== 'active' && enrolment.status !== 'paused') {
    await audit(tx, null, { action: 'enrolment.exit_ignored', ...entity, after: { status: enrolment.status }, metadata });
    return;
  }
  // Newest first: a placement that never began may point back at the one before it.
  const placements = await tx.select().from(pl).where(eq(pl.enrolmentId, enrolment.id)).orderBy(desc(pl.startDate));
  for (const placement of placements) {
    const metaFor = { enrolmentId: enrolment.id, eventId: event.id };
    if (placement.startDate > p.exitDate) {
      // Left before it began: no attendance or marks can hang on it, and it must not hold a seat.
      await tx.delete(pl).where(eq(pl.id, placement.id));
      await audit(tx, null, { action: 'placement.voided', entityType: 'batch_placement', entityId: placement.id, before: placement, metadata: metaFor });
    } else if (placement.endDate === null || placement.endDate > p.exitDate) {
      const [ended] = await tx.update(pl).set({ endDate: p.exitDate, endedByUserId: p.closedByUserId as UserId, endedReason: p.reason }).where(eq(pl.id, placement.id)).returning();
      await audit(tx, null, { action: 'placement.ended', entityType: 'batch_placement', entityId: placement.id, before: placement, after: ended, metadata: metaFor });
    }
  }
  const [row] = await tx
    .update(e)
    .set({ status: p.outcome === 'completed' ? 'completed' : 'withdrawn', batchId: placements.find((x) => x.startDate <= p.exitDate)?.batchId ?? null })
    .where(eq(e.id, enrolment.id))
    .returning();
  await audit(tx, null, { action: 'enrolment.ended', ...entity, before: enrolment, after: row, metadata });
  await tx
    .update(academicCatchupTasks)
    .set({ status: 'cancelled' })
    .where(and(eq(academicCatchupTasks.enrolmentId, enrolment.id), inArray(academicCatchupTasks.status, ['open', 'in_progress'])));
  // Rows with an attendance or a mark are history; an untouched row on a later test would block its publication.
  const removed = await tx
    .update(R)
    .set({ removedAt: new Date(), removedReason: `Left on ${fmtDay(p.exitDate)}: ${p.reason}`, rank: null, version: sql`${R.version} + 1` })
    .where(
      and(
        eq(R.studentId, enrolment.studentId),
        inArray(R.batchId, placements.map((x) => x.batchId)),
        isNull(R.removedAt),
        eq(R.attendance, 'unmarked'),
        eq(R.marksState, 'not_entered'),
        inArray(R.assessmentId, tx.select({ id: academicAssessments.id }).from(academicAssessments).where(and(gt(academicAssessments.scheduledDate, p.exitDate), ne(academicAssessments.status, 'cancelled')))),
      ),
    )
    .returning();
  for (const r of removed) await audit(tx, null, { action: 'roster.removed', entityType: 'assessment', entityId: r.assessmentId, after: r, metadata: { studentId: r.studentId, reason: r.removedReason, eventId: event.id } });
}

/** Run the consumer once (a batch of up to 50 waiting exits and name corrections, oldest first). */
export function runEnrolmentExits(db: Database, options: { maxAttempts?: number } = {}): Promise<ProcessResult> {
  return processEvents(db, { consumer: EXIT_CONSUMER, maxAttempts: options.maxAttempts ?? 5, handlers: { [EXIT_EVENT]: handleClosed, [RENAME_EVENT]: handleRenamed } });
}
