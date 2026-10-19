/**
 * Enrolment handoff (OPS-012, INTEGRATION_CONTRACT.md §6).
 *
 * Producer: `requestEnrolment` moves admitted → enrolment_requested and
 * publishes `ops.admission.enrolment_requested` v1 IN THE SAME TRANSACTION,
 * keyed by `enrolmentKeys.request(admissionId, attempt)`.
 *
 * Consumer `ops.enrolment-replies`: `processEnrolmentReplies` handles
 * `academic.enrolment.confirmed` (→ enrolled) and `academic.enrolment.rejected`
 * (→ back to admitted, flagged with the reason). Replies for an older attempt
 * or an admission that already moved on are ignored and audited, so a reply
 * processed twice yields one transition.
 */
import { eq } from 'drizzle-orm';
import { opsLeads, programmes, type Database } from '@elevate/database';
import { notify } from '@elevate/notifications';
import {
  processEvents,
  publishEvent,
  recordAudit,
  withTransaction,
  type ConsumerContext,
  type ProcessResult,
} from '@elevate/server-kit';
import {
  enrolmentKeys,
  enrolmentRequestedV1Payload,
  OPS_ENROLMENT_REPLIES_CONSUMER,
  ValidationError,
  type EventPayload,
  type IntegrationEvent,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import { accessScope, notFound, userIdsForStaff, type Actor } from './context';
import { assertAdmissionAccess } from './admissions';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

export const ENROLMENT_REPLIES_CONSUMER = OPS_ENROLMENT_REPLIES_CONSUMER;

type RequestPayload = EventPayload<'ops.admission.enrolment_requested', 1>;

/** Build (and validate) the v1 payload from the admission and its lead. */
async function buildPayload(
  tx: Database,
  admission: AdmissionRow,
  attempt: number,
  requestedBy: Actor['id'],
  notes: string | null,
): Promise<RequestPayload> {
  const [lead] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
  if (!lead) notFound('Lead');
  if (!admission.programmeId)
    throw new ValidationError('Choose a programme before requesting enrolment.');
  const [programme] = await tx
    .select({ code: programmes.code })
    .from(programmes)
    .where(eq(programmes.id, admission.programmeId));
  const counsellorStaffId = (admission.counsellorStaffId ??
    lead.ownerStaffId) as StaffMemberId | null;
  if (!counsellorStaffId)
    throw new ValidationError('Assign a counsellor before requesting enrolment.');
  const payload = {
    admissionId: admission.id,
    leadId: lead.id,
    attempt,
    programmeCode: programme?.code ?? '',
    ...(admission.intendedCourseId ? { intendedCourseId: admission.intendedCourseId } : {}),
    ...(admission.intendedBatchId ? { intendedBatchId: admission.intendedBatchId } : {}),
    ...(admission.deliveryMode ? { deliveryMode: admission.deliveryMode } : {}),
    ...(admission.intendedStartDate ? { intendedStartDate: admission.intendedStartDate } : {}),
    student: {
      fullName: lead.studentName,
      ...(lead.preferredName ? { preferredName: lead.preferredName } : {}),
      ...(lead.currentStage ? { currentStage: lead.currentStage } : {}),
      ...(lead.schoolBoard ? { schoolBoard: lead.schoolBoard } : {}),
      ...(lead.studentEmail ? { email: lead.studentEmail } : {}),
      ...(lead.studentPhone ? { phone: lead.studentPhone } : {}),
      ...(lead.city ? { city: lead.city } : {}),
    },
    ...(lead.guardianName
      ? {
          guardian: {
            fullName: lead.guardianName,
            relationship: (lead.guardianRelationship ?? 'guardian') as
              'mother' | 'father' | 'guardian' | 'other',
            ...(lead.guardianEmail ? { email: lead.guardianEmail } : {}),
            ...(lead.guardianPhone ? { phone: lead.guardianPhone } : {}),
          },
        }
      : {}),
    counsellorStaffId,
    requestedByUserId: requestedBy,
    ...(notes ? { notes } : {}),
  };
  const parsed = enrolmentRequestedV1Payload.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('The admission is missing details Academic OS needs.', {
      details: parsed.error.issues.map((i) => ({
        location: 'body',
        path: i.path.map(String),
        message: i.message,
      })),
    });
  }
  return payload as RequestPayload;
}

/**
 * admitted → enrolment_requested + outbox event, atomically. A second call
 * (double submit) finds the admission already `enrolment_requested` and fails
 * with INVALID_STATE_TRANSITION, so exactly one event exists per attempt.
 */
export async function requestEnrolment(
  db: Database,
  actor: Actor,
  admissionId: string,
  options: { notes?: string | null; requestId?: string } = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const admission = await lockAdmission(tx, admissionId);
    if (!admission) notFound('Admission');
    await assertAdmissionAccess(tx, access, admission);
    const attempt = admission.enrolmentAttempt + 1;
    // Check the transition before building the payload (clear 409 on double submit).
    if (admission.status !== 'admitted') {
      await applyTransition(tx, {
        admission,
        to: 'enrolment_requested',
        actorType: 'user',
        actorUserId: actor.id,
        context: { viaEnrolmentHandoff: true },
        settings,
      });
    }
    const payload = await buildPayload(tx, admission, attempt, actor.id, options.notes ?? null);
    const event = await publishEvent(tx, {
      type: 'ops.admission.enrolment_requested',
      version: 1,
      idempotencyKey: enrolmentKeys.request(admission.id, attempt),
      payload,
    });
    const updated = await applyTransition(tx, {
      admission,
      to: 'enrolment_requested',
      actorType: 'user',
      actorUserId: actor.id,
      reason: `Enrolment requested from Academic OS (attempt ${attempt})`,
      eventId: event.id,
      context: { viaEnrolmentHandoff: true },
      requestId: options.requestId,
      settings,
      patch: {
        enrolmentAttempt: attempt,
        handoffStatus: 'pending',
        lastRequestEventId: event.id,
        enrolmentRequestedAt: new Date(),
        rejectionCode: null,
        rejectionReason: null,
        rejectedAt: null,
      },
    });
    return { admission: updated, eventId: event.id, attempt, eventCreated: event.created };
  });
}

async function notifyCounsellor(
  tx: Database,
  admission: AdmissionRow,
  kind: string,
  title: string,
  body: string,
) {
  const [lead] = await tx
    .select({ ownerStaffId: opsLeads.ownerStaffId })
    .from(opsLeads)
    .where(eq(opsLeads.id, admission.leadId));
  const userIds = await userIdsForStaff(tx, [admission.counsellorStaffId, lead?.ownerStaffId]);
  await notify(tx, {
    userIds,
    module: 'ops',
    kind,
    title,
    body,
    link: `/ops/admissions/${admission.id}`,
    entityType: 'admission',
    entityId: admission.id,
  });
}

async function ignoreReply(
  tx: Database,
  event: IntegrationEvent<'academic.enrolment.confirmed' | 'academic.enrolment.rejected'>,
  reason: string,
) {
  await recordAudit(tx, {
    actorType: 'system',
    module: 'ops',
    action: 'enrolment.reply_ignored',
    entityType: 'admission',
    entityId: event.payload.admissionId,
    after: { eventId: event.id, type: event.type, reason },
    metadata: { leadId: event.payload.leadId, eventId: event.id },
  });
}

/** academic.enrolment.confirmed → enrolled (idempotent). */
export async function applyEnrolmentConfirmed(
  event: IntegrationEvent<'academic.enrolment.confirmed'>,
  { db: tx }: ConsumerContext,
): Promise<void> {
  const p = event.payload;
  const admission = await lockAdmission(tx, p.admissionId);
  // Unknown admission: retrying cannot help, but losing a reply silently is worse → fail (dead after retries).
  if (!admission) throw new Error(`Enrolment reply for unknown admission ${p.admissionId}`);
  if (admission.lastRequestEventId !== p.requestEventId)
    return ignoreReply(tx, event, 'Reply to an older or unknown enrolment request');
  if (admission.status === 'enrolled') return ignoreReply(tx, event, 'Already enrolled');
  if (admission.status !== 'enrolment_requested')
    return ignoreReply(tx, event, `Admission is ${admission.status}, not awaiting Academic OS`);
  const settings = await loadSettings(tx);
  const updated = await applyTransition(tx, {
    admission,
    to: 'enrolled',
    actorType: 'system',
    actorUserId: null,
    reason: 'Academic OS confirmed the enrolment',
    eventId: event.id,
    context: { viaEnrolmentReply: true },
    settings,
    patch: {
      handoffStatus: 'enrolled',
      enrolmentId: p.enrolmentId,
      studentId: p.studentId,
      enrolledAt: new Date(p.confirmedAt),
    },
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
export async function applyEnrolmentRejected(
  event: IntegrationEvent<'academic.enrolment.rejected'>,
  { db: tx }: ConsumerContext,
): Promise<void> {
  const p = event.payload;
  const admission = await lockAdmission(tx, p.admissionId);
  if (!admission) throw new Error(`Enrolment reply for unknown admission ${p.admissionId}`);
  if (admission.lastRequestEventId !== p.requestEventId)
    return ignoreReply(tx, event, 'Reply to an older or unknown enrolment request');
  if (admission.status !== 'enrolment_requested')
    return ignoreReply(tx, event, `Admission is ${admission.status}, not awaiting Academic OS`);
  const settings = await loadSettings(tx);
  const updated = await applyTransition(tx, {
    admission,
    to: 'admitted',
    actorType: 'system',
    actorUserId: null,
    reason: `Academic OS rejected the enrolment (${p.reasonCode}): ${p.reason}`,
    eventId: event.id,
    context: { viaEnrolmentReply: true },
    settings,
    patch: {
      handoffStatus: 'rejected',
      rejectionCode: p.reasonCode,
      rejectionReason: p.reason,
      rejectedAt: new Date(p.rejectedAt),
    },
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
