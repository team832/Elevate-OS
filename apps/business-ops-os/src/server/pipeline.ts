/**
 * Internal pipeline primitives used by the lead, admission, schedule and
 * enrolment services. Every status change goes through `applyTransition`, which
 * re-checks the domain state machine, writes the transition row and the audit
 * event in the caller's transaction.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAdmissionTransitions,
  opsDemos,
  opsFollowUps,
  type Database,
} from '@elevate/database';
import { recordAudit } from '@elevate/server-kit';
import { InvalidStateTransitionError, ValidationError } from '@elevate/shared-contracts';
import type {
  AdmissionId,
  IntegrationEventId,
  LeadId,
  ProgrammeId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';
import { checkTransition, istToday, type AdmissionStatus, type TransitionContext } from '../domain';
import { nextCode } from './context';
import type { ResolvedSettings } from '../domain';

export type AdmissionRow = typeof opsAdmissions.$inferSelect;

export async function lockAdmission(tx: Database, id: string): Promise<AdmissionRow | undefined> {
  const [row] = await tx
    .select()
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, id as AdmissionId))
    .for('update')
    .limit(1);
  return row;
}

export async function createAdmissionRecord(
  tx: Database,
  input: {
    leadId: LeadId;
    programmeId: ProgrammeId | null;
    counsellorStaffId: StaffMemberId | null;
    createdBy: UserId;
    requestId?: string;
  },
): Promise<AdmissionRow> {
  const code = await nextCode(tx, 'admission', 'ops.admissions');
  const [row] = await tx
    .insert(opsAdmissions)
    .values({
      code,
      leadId: input.leadId,
      programmeId: input.programmeId,
      counsellorStaffId: input.counsellorStaffId,
      status: 'new',
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('admission insert returned no row');
  await tx.insert(opsAdmissionTransitions).values({
    admissionId: row.id,
    fromStatus: null,
    toStatus: 'new',
    actorType: 'user',
    actorUserId: input.createdBy,
    reason: 'Admission case opened',
  });
  await recordAudit(tx, {
    actorUserId: input.createdBy,
    module: 'ops',
    action: 'admission.created',
    entityType: 'admission',
    entityId: row.id,
    after: row,
    requestId: input.requestId,
    metadata: { leadId: input.leadId },
  });
  return row;
}

export interface ApplyTransitionInput {
  admission: AdmissionRow;
  to: AdmissionStatus;
  actorType: 'user' | 'system';
  actorUserId: UserId | null;
  reason?: string | null;
  /** Validated closure code (checkReasonCode); stored on the case and the transition row. */
  reasonCode?: string | null;
  eventId?: IntegrationEventId | null;
  context: Omit<TransitionContext, 'actor' | 'reason' | 'heldFromStatus'>;
  requestId?: string;
  /** Extra columns to set with the status (e.g. enrolment ids). */
  patch?: Partial<typeof opsAdmissions.$inferInsert>;
  settings?: ResolvedSettings;
}

/** Apply a legal transition or throw INVALID_STATE_TRANSITION (409) / VALIDATION_FAILED (400). */
export async function applyTransition(
  tx: Database,
  input: ApplyTransitionInput,
): Promise<AdmissionRow> {
  const { admission, to } = input;
  const from = admission.status as AdmissionStatus;
  const check = checkTransition(from, to, {
    ...input.context,
    actor: input.actorType,
    reason: input.reason,
    heldFromStatus: (admission.heldFromStatus as AdmissionStatus | null) ?? null,
  });
  if (!check.ok) {
    if (check.code === 'REASON_REQUIRED')
      throw new ValidationError(check.message, {
        details: [{ location: 'body', path: ['reason'], message: check.message }],
      });
    throw new InvalidStateTransitionError(check.message, {
      details: { from, to, code: check.code, missing: check.missing ?? [] },
    });
  }
  const now = new Date();
  const values: Partial<typeof opsAdmissions.$inferInsert> = {
    status: to,
    statusReason: input.reason?.trim() || null,
    statusChangedAt: now,
    heldFromStatus: to === 'on_hold' ? from : null,
    statusReasonCode: input.reasonCode ?? null,
    ...input.patch,
  };
  if (from === 'counselled' && to === 'admission_pending') values.demoSkipped = true;
  if (to === 'admitted' && !admission.admittedAt) values.admittedAt = now;
  if (to === 'admitted' && !admission.admissionDate) values.admissionDate = istToday(now);
  const [updated] = await tx
    .update(opsAdmissions)
    .set(values)
    .where(and(eq(opsAdmissions.id, admission.id), eq(opsAdmissions.status, from)))
    .returning();
  if (!updated)
    throw new InvalidStateTransitionError(
      'The admission changed while you were working on it; reload.',
    );
  await tx.insert(opsAdmissionTransitions).values({
    admissionId: admission.id,
    fromStatus: from,
    toStatus: to,
    reason: input.reason?.trim() || null,
    reasonCode: input.reasonCode ?? null,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    eventId: input.eventId ?? null,
    at: now,
  });
  await recordAudit(tx, {
    actorType: input.actorType === 'system' ? 'system' : 'user',
    actorUserId: input.actorUserId,
    module: 'ops',
    action: 'admission.transitioned',
    entityType: 'admission',
    entityId: admission.id,
    before: { status: from },
    after: { status: to, reason: input.reason ?? null, reasonCode: input.reasonCode ?? null },
    requestId: input.requestId,
    metadata: {
      leadId: admission.leadId,
      rule: check.rule.meaning,
      eventId: input.eventId ?? null,
    },
  });
  await applySideEffects(tx, updated, from, to, input);
  return updated;
}

/**
 * Side effects of closing states (documented in ALGORITHMS.md A-03):
 * - lost: open follow-ups of this admission are cancelled; a verified demo fee
 *   is marked retained (non-refundable) when the demo terms say so;
 * - admitted: a verified demo fee is marked "adjusted against fees" when the
 *   demo terms say so.
 */
async function applySideEffects(
  tx: Database,
  admission: AdmissionRow,
  _from: AdmissionStatus,
  to: AdmissionStatus,
  input: ApplyTransitionInput,
): Promise<void> {
  const terms = input.settings?.['demo.terms'].value;
  if (to === 'lost') {
    await tx
      .update(opsFollowUps)
      .set({ status: 'cancelled', outcome: `Case closed as lost: ${input.reason ?? ''}`.trim() })
      .where(and(eq(opsFollowUps.admissionId, admission.id), eq(opsFollowUps.status, 'open')));
    if (terms && terms.refundableIfNotJoining === false) {
      await tx
        .update(opsDemos)
        .set({ feeStatus: 'retained_non_refundable' })
        .where(
          and(
            eq(opsDemos.admissionId, admission.id),
            inArray(opsDemos.feeStatus, ['paid_verified']),
          ),
        );
    }
  }
  if (to === 'admitted' && terms?.adjustedAgainstFeesOnJoining) {
    await tx
      .update(opsDemos)
      .set({ feeStatus: 'adjusted_against_fees' })
      .where(and(eq(opsDemos.admissionId, admission.id), eq(opsDemos.feeStatus, 'paid_verified')));
  }
}
