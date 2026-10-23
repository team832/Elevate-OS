/**
 * Enrolment handoff (OPS-012, INTEGRATION_CONTRACT.md §6).
 *
 * Producer: `requestEnrolment` moves admitted → enrolment_requested and
 * publishes `ops.admission.enrolment_requested` v1 IN THE SAME TRANSACTION,
 * keyed by `enrolmentKeys.request(admissionId, attempt)`.
 *
 * Consumer `ops.enrolment-replies`: enrolment-replies.ts (re-exported).
 */
import { and, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsApplications,
  opsEnrolmentAttempts,
  opsLeads,
  programmes,
  type Database,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import {
  enrolmentKeys,
  enrolmentRequestedV1Payload,
  InvalidStateTransitionError,
  ValidationError,
  type EventPayload,
} from '@elevate/shared-contracts';
import type { LeadId, StaffMemberId, StudentId } from '@elevate/shared-types';
import type { ResolvedSettings } from '../domain';
import { retryDecision } from '../domain/students';
import { accessScope, type Actor } from './context';
import { opsAudit, rowById } from './ops-common';
import { academicDeliveryOf, handoffInputOf, lockAccessible } from './admissions';
import { applyTransition, type AdmissionRow } from './pipeline';
import { updateAttempt } from './enrolment-replies';
import { loadSettings } from './settings';

export { ENROLMENT_REPLIES_CONSUMER, processEnrolmentReplies } from './enrolment-replies';

type RequestPayload = EventPayload<'ops.admission.enrolment_requested', 1>;

/**
 * The Academic student id Ops already holds for the same person (OPS-076):
 * another admission of this lead — or of a lead merged into it — that Academic
 * confirmed. Sent as the optional `existingStudentId` so Academic can reuse the
 * student instead of creating a second one (IR-OPS-ADM-1: Academic must honour it).
 */
export async function knownStudentIdForPerson(
  tx: Database,
  leadId: LeadId,
  excludeAdmissionId: string,
): Promise<StudentId | null> {
  const merged = await tx
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.mergedIntoLeadId, leadId));
  // The same canonical student (core.students) may also hold admissions of another lead.
  const [self] = await tx
    .select({ identity: opsAdmissions.studentId })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, excludeAdmissionId as never));
  const [row] = await tx
    .select({ studentId: opsAdmissions.academicStudentId })
    .from(opsAdmissions)
    .where(
      and(
        or(
          inArray(opsAdmissions.leadId, [leadId, ...merged.map((m) => m.id)]),
          self?.identity ? eq(opsAdmissions.studentId, self.identity) : undefined,
        ),
        ne(opsAdmissions.id, excludeAdmissionId as never),
        isNotNull(opsAdmissions.academicStudentId),
      ),
    )
    .orderBy(desc(opsAdmissions.enrolledAt))
    .limit(1);
  return row?.studentId ?? null;
}

/** The given fields without empty ones (the v1 payload omits absent optional fields). */
function present<T extends Record<string, string | null | undefined>>(fields: T) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<
    Record<keyof T, string>
  >;
}

/** Build (and validate) the v1 payload from the admission and its lead. */
async function buildPayload(
  tx: Database,
  admission: AdmissionRow,
  attempt: number,
  requestedBy: Actor['id'],
  notes: string | null,
): Promise<RequestPayload> {
  const lead = await rowById(tx, opsLeads, admission.leadId, 'Lead');
  if (!admission.programmeId)
    throw new ValidationError('Choose a programme before requesting enrolment.');
  const [programme] = await tx
    .select({ code: programmes.code })
    .from(programmes)
    .where(eq(programmes.id, admission.programmeId));
  const [application] = await tx
    .select({ academicYear: opsApplications.academicYear })
    .from(opsApplications)
    .where(eq(opsApplications.admissionId, admission.id));
  const counsellorStaffId = (admission.counsellorStaffId ??
    lead.ownerStaffId) as StaffMemberId | null;
  if (!counsellorStaffId)
    throw new ValidationError('Assign a counsellor before requesting enrolment.');
  const payload = {
    admissionId: admission.id,
    leadId: lead.id,
    attempt,
    programmeCode: programme?.code ?? '',
    ...present({
      intendedCourseId: admission.intendedCourseId,
      intendedBatchId: admission.intendedBatchId,
      deliveryMode: admission.deliveryMode,
      intendedStartDate: admission.intendedStartDate,
    }),
    student: {
      fullName: lead.studentName,
      ...present({
        preferredName: lead.preferredName,
        currentStage: lead.currentStage,
        schoolBoard: lead.schoolBoard,
        email: lead.studentEmail,
        phone: lead.studentPhone,
        city: lead.city,
      }),
    },
    ...(lead.guardianName
      ? {
          guardian: {
            fullName: lead.guardianName,
            relationship: lead.guardianRelationship ?? 'guardian',
            ...present({ email: lead.guardianEmail, phone: lead.guardianPhone }),
          },
        }
      : {}),
    counsellorStaffId,
    requestedByUserId: requestedBy,
    ...present({
      notes,
      existingStudentId: await knownStudentIdForPerson(tx, lead.id, admission.id),
      coreStudentId: admission.studentId,
      academicYear: application?.academicYear,
    }),
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

/** Publish the request event of `attempt` (idempotency key = admission + attempt). */
async function publishRequest(
  tx: Database,
  admission: AdmissionRow,
  attempt: number,
  actor: Actor,
  notes: string | null,
) {
  return publishEvent(tx, {
    type: 'ops.admission.enrolment_requested',
    version: 1,
    idempotencyKey: enrolmentKeys.request(admission.id, attempt),
    payload: await buildPayload(tx, admission, attempt, actor.id, notes),
  });
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
  return withTransaction(db, async (tx) =>
    publishEnrolmentRequest(tx, actor, await lockAccessible(tx, access, admissionId), {
      ...options,
      settings,
    }),
  );
}

/**
 * The request itself, in the caller's transaction on a LOCKED admission; the caller has checked
 * permission (`requestEnrolment`, or the final admission confirmation by an approver).
 */
export async function publishEnrolmentRequest(
  tx: Database,
  actor: Actor,
  admission: AdmissionRow,
  options: { notes?: string | null; requestId?: string; settings: ResolvedSettings },
) {
  const attempt = admission.enrolmentAttempt + 1;
  const transition = {
    admission,
    to: 'enrolment_requested' as const,
    actorUserId: actor.id,
    context: { viaEnrolmentHandoff: true },
    settings: options.settings,
  };
  // Check the transition before building the payload (clear 409 on double submit).
  if (admission.status !== 'admitted') await applyTransition(tx, transition);
  const event = await publishRequest(tx, admission, attempt, actor, options.notes ?? null);
  const updated = await applyTransition(tx, {
    ...transition,
    reason: `Enrolment requested from Academic OS (attempt ${attempt})`,
    eventId: event.id,
    requestId: options.requestId,
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
  await tx
    .insert(opsEnrolmentAttempts)
    .values({
      admissionId: admission.id,
      attempt,
      requestEventId: event.id,
      kind: admission.handoffStatus === 'rejected' ? 'after_rejection' : 'initial',
      reason: options.notes?.trim() || null,
      requestedBy: actor.id,
    })
    .onConflictDoNothing();
  return { admission: updated, eventId: event.id, attempt, eventCreated: event.created };
}

/**
 * Explicit, audited "retry handoff" after a failure that needs a person
 * (OPS-075): Academic's delivery of the current request is `dead` — every try
 * rolled back, so no enrolment exists for it and processEvents will never pick
 * it up again. Publishes a NEW request (attempt + 1, new idempotency key) for
 * the SAME admission (same business identity); the old attempt is marked
 * superseded and any late reply to it is ignored and flagged. Refused while
 * Academic is still retrying (`failed`) or has not picked the request up, so
 * two live requests for one admission never exist.
 */
export async function retryEnrolmentHandoff(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: { reason: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const reason = input.reason?.trim();
  if (!reason)
    throw new ValidationError('Give the reason for retrying the handoff.', {
      details: [{ location: 'body', path: ['reason'], message: 'Reason required' }],
    });
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, admissionId);
    const delivery = await academicDeliveryOf(tx, admission.lastRequestEventId);
    const decision = retryDecision(handoffInputOf(admission, delivery));
    if (!decision.allowed) throw new InvalidStateTransitionError(decision.reason);
    if (decision.via !== 'retry')
      throw new InvalidStateTransitionError(
        'Use "Request enrolment": the admission is admitted and has no live request.',
      );
    const previousEventId = admission.lastRequestEventId;
    const attempt = admission.enrolmentAttempt + 1;
    const event = await publishRequest(tx, admission, attempt, actor, reason);
    const now = new Date();
    const [updated] = await tx
      .update(opsAdmissions)
      .set({
        enrolmentAttempt: attempt,
        lastRequestEventId: event.id,
        enrolmentRequestedAt: now,
        handoffStatus: 'pending',
      })
      .where(
        and(
          eq(opsAdmissions.id, admission.id),
          eq(opsAdmissions.status, 'enrolment_requested'),
          eq(opsAdmissions.enrolmentAttempt, admission.enrolmentAttempt),
        ),
      )
      .returning();
    if (!updated) throw new InvalidStateTransitionError('The admission changed meanwhile; reload.');
    if (previousEventId)
      await updateAttempt(tx, previousEventId, {
        outcome: 'superseded',
        outcomeAt: now,
        note: `Academic delivery was dead after ${delivery?.attempts ?? '?'} tries (${delivery?.lastError ?? 'no error recorded'}); superseded by attempt ${attempt}.`,
      });
    await tx.insert(opsEnrolmentAttempts).values({
      admissionId: admission.id,
      attempt,
      requestEventId: event.id,
      kind: 'after_failure',
      reason,
      requestedBy: actor.id,
      requestedAt: now,
    });
    await opsAudit('admission')(
      tx,
      actor,
      admission.id,
      'enrolment.handoff_retried',
      {
        before: { attempt: admission.enrolmentAttempt, requestEventId: previousEventId },
        after: { attempt, requestEventId: event.id, reason },
        metadata: { leadId: admission.leadId, eventId: event.id },
      },
      requestId,
    );
    return { admission: updated, eventId: event.id, attempt, eventCreated: event.created };
  });
}
