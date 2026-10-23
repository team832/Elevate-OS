/**
 * Consumer `ops.enrolment-replies` (INTEGRATION_CONTRACT.md §6): `processEnrolmentReplies` handles
 * `academic.enrolment.confirmed` (→ enrolled) and `academic.enrolment.rejected`
 * (→ back to admitted, flagged with the reason). Replies for an older attempt
 * or an admission that already moved on are ignored and audited, so a reply
 * processed twice yields one transition. Re-exported by enrolment.ts.
 */
import { eq } from 'drizzle-orm';
import { opsEnrolmentAttempts, type Database } from '@elevate/database';
import { notify } from '@elevate/notifications';
import {
  processEvents,
  recordAudit,
  type ConsumerContext,
  type ProcessResult,
} from '@elevate/server-kit';
import { OPS_ENROLMENT_REPLIES_CONSUMER, type IntegrationEvent } from '@elevate/shared-contracts';
import type { IntegrationEventId } from '@elevate/shared-types';
import { accessScope, userIdsForStaff, userIdsWithRole, type Actor } from './context';
import { leadOwnerOf } from './admissions';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

export const ENROLMENT_REPLIES_CONSUMER = OPS_ENROLMENT_REPLIES_CONSUMER;

type Reply = IntegrationEvent<'academic.enrolment.confirmed' | 'academic.enrolment.rejected'>;

/** Update the attempt row of a request event (no-op for requests made before attempts were tracked). */
export async function updateAttempt(
  tx: Database,
  requestEventId: string,
  patch: Partial<typeof opsEnrolmentAttempts.$inferInsert>,
) {
  await tx
    .update(opsEnrolmentAttempts)
    .set(patch)
    .where(eq(opsEnrolmentAttempts.requestEventId, requestEventId as IntegrationEventId));
}

async function notifyCounsellor(
  tx: Database,
  admission: AdmissionRow,
  kind: string,
  title: string,
  body: string,
) {
  await notify(tx, {
    userIds: await userIdsForStaff(tx, [
      admission.counsellorStaffId,
      await leadOwnerOf(tx, admission),
    ]),
    module: 'ops',
    kind,
    title,
    body,
    link: `/ops/admissions/${admission.id}`,
    entityType: 'admission',
    entityId: admission.id,
  });
}

async function ignoreReply(tx: Database, event: Reply, reason: string) {
  await recordAudit(tx, {
    actorType: 'system',
    module: 'ops',
    action: 'enrolment.reply_ignored',
    entityType: 'admission',
    entityId: event.payload.admissionId,
    after: { eventId: event.id, type: event.type, reason },
    metadata: { leadId: event.payload.leadId, eventId: event.id },
  });
  const confirmed = event.type === 'academic.enrolment.confirmed';
  await updateAttempt(tx, event.payload.requestEventId, {
    replyEventId: event.id,
    note: confirmed
      ? `Late CONFIRMATION ignored (${reason}). Check Academic OS for a duplicate enrolment of this admission.`
      : `Late rejection ignored (${reason}).`,
  });
  // A confirmation Ops cannot apply may mean Academic enrolled twice: a person must check (IR-OPS-ADM-2).
  if (confirmed && reason !== 'Already enrolled') {
    await notify(tx, {
      userIds: await userIdsWithRole(tx, 'operations_manager'),
      module: 'ops',
      kind: 'enrolment.duplicate_risk',
      title: 'Academic OS confirmed a superseded enrolment request',
      body: `${reason}. Check Academic OS for a second enrolment of this admission.`,
      link: `/ops/students/${event.payload.admissionId}`,
      entityType: 'admission',
      entityId: event.payload.admissionId,
    });
  }
}

/**
 * The admission a reply applies to, locked; null after ignoring (and auditing)
 * a reply to an older request or to an admission no longer awaiting Academic.
 */
async function replyTarget(tx: Database, event: Reply): Promise<AdmissionRow | null> {
  const p = event.payload;
  const admission = await lockAdmission(tx, p.admissionId);
  // Unknown admission: retrying cannot help, but losing a reply silently is worse → fail (dead after retries).
  if (!admission) throw new Error(`Enrolment reply for unknown admission ${p.admissionId}`);
  const ignored =
    admission.lastRequestEventId !== p.requestEventId
      ? 'Reply to an older or unknown enrolment request'
      : event.type === 'academic.enrolment.confirmed' && admission.status === 'enrolled'
        ? 'Already enrolled'
        : admission.status !== 'enrolment_requested'
          ? `Admission is ${admission.status}, not awaiting Academic OS`
          : null;
  if (!ignored) return admission;
  await ignoreReply(tx, event, ignored);
  return null;
}

/** academic.enrolment.confirmed → enrolled (idempotent). */
async function applyEnrolmentConfirmed(
  event: IntegrationEvent<'academic.enrolment.confirmed'>,
  { db: tx }: ConsumerContext,
): Promise<void> {
  const p = event.payload;
  const admission = await replyTarget(tx, event);
  if (!admission) return;
  const updated = await applyTransition(tx, {
    admission,
    to: 'enrolled',
    actorUserId: null,
    reason: 'Academic OS confirmed the enrolment',
    eventId: event.id,
    context: { viaEnrolmentReply: true },
    settings: await loadSettings(tx),
    patch: {
      handoffStatus: 'enrolled',
      enrolmentId: p.enrolmentId,
      academicStudentId: p.studentId,
      enrolledAt: new Date(p.confirmedAt),
      academicExistingStudent: p.existingStudent,
      enrolledCourseId: p.courseId ?? null,
      enrolledBatchId: p.batchId ?? null,
    },
  });
  await updateAttempt(tx, p.requestEventId, {
    outcome: 'confirmed',
    outcomeAt: new Date(p.confirmedAt),
    replyEventId: event.id,
  });
  await notifyCounsellor(
    tx,
    updated,
    'enrolment.confirmed',
    `Enrolled: ${updated.code}`,
    'Academic OS confirmed the enrolment.',
  );
}

/** academic.enrolment.rejected → back to admitted with the reason (re-request = attempt + 1). */
async function applyEnrolmentRejected(
  event: IntegrationEvent<'academic.enrolment.rejected'>,
  { db: tx }: ConsumerContext,
): Promise<void> {
  const p = event.payload;
  const admission = await replyTarget(tx, event);
  if (!admission) return;
  const updated = await applyTransition(tx, {
    admission,
    to: 'admitted',
    actorUserId: null,
    reason: `Academic OS rejected the enrolment (${p.reasonCode}): ${p.reason}`,
    eventId: event.id,
    context: { viaEnrolmentReply: true },
    settings: await loadSettings(tx),
    patch: {
      handoffStatus: 'rejected',
      rejectionCode: p.reasonCode,
      rejectionReason: p.reason,
      rejectedAt: new Date(p.rejectedAt),
    },
  });
  await updateAttempt(tx, p.requestEventId, {
    outcome: 'rejected',
    outcomeAt: new Date(p.rejectedAt),
    replyEventId: event.id,
    rejectionCode: p.reasonCode,
    rejectionReason: p.reason,
  });
  await notifyCounsellor(
    tx,
    updated,
    'enrolment.rejected',
    `Enrolment rejected: ${updated.code}`,
    `${p.reasonCode}: ${p.reason}. Correct the admission and request enrolment again.`,
  );
}

/** Run the `ops.enrolment-replies` consumer once (route, job or test). */
export async function processEnrolmentReplies(
  db: Database,
  options: { actor?: Actor; maxAttempts?: number } = {},
): Promise<ProcessResult> {
  if (options.actor) await accessScope(db, options.actor, 'ops:jobs:run');
  return processEvents(db, {
    consumer: ENROLMENT_REPLIES_CONSUMER,
    maxAttempts: options.maxAttempts ?? 5,
    handlers: {
      'academic.enrolment.confirmed': applyEnrolmentConfirmed,
      'academic.enrolment.rejected': applyEnrolmentRejected,
    },
  });
}
