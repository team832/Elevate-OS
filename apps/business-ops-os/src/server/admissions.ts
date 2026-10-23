/**
 * Admissions pipeline (OPS-005, OPS-010, OPS-011): board, detail, user
 * transitions, checklist, fee-arrangement approval, and the read helpers the
 * other admission services share. The enrolment handoff lives in ./enrolment.ts.
 */
import { eq } from 'drizzle-orm';
import { opsAdmissionChecks, opsAdmissions, opsLeads, type Database } from '@elevate/database';
import {
  decideApproval,
  findPendingApproval,
  requestApproval,
  withdrawApproval,
  withTransaction,
} from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { z } from 'zod';
import {
  checkReasonCode,
  checkVerifierSeparation,
  isOpenStatus,
  READINESS_GAP_LABELS,
  type AdmissionStatus,
  type CheckState,
} from '../domain';
import { assertAdmissionAccess, checksOf, lockAccessible, readinessOf } from './admissions-lookups';
import { feeArrangementPolicy } from './approval-policies';
import { accessScope, activeStaff, notFound, programmeByCode, type Actor } from './context';
import { fieldError, opsAudit } from './ops-common';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import type { checkBody, UpdateAdmissionInput } from './schemas';
import { loadSettings } from './settings';

export {
  ACADEMIC_INTAKE_CONSUMER,
  academicDeliveryOf,
  admissionRow,
  assertAdmissionAccess,
  attemptsOf,
  handoffInputOf,
  leadOwnerOf,
  lockAccessible,
  namesOf,
  ownAdmissionFilter,
  programmeRef,
  readinessOf,
  staffRef,
  transitionsOf,
} from './admissions-lookups';
export { getAdmission, listAdmissions } from './admissions-read';

export async function transitionAdmission(
  db: Database,
  actor: Actor,
  id: string,
  input: { to: AdmissionStatus; reason?: string | null; reasonCode?: string | null },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  if (input.to === 'enrolment_requested')
    throw new InvalidStateTransitionError(
      'Use "Request enrolment" so the request to Academic OS is published with the change.',
    );
  if (input.to === 'enrolled')
    throw new InvalidStateTransitionError(
      'Only an Academic OS confirmation can mark an admission enrolled.',
    );
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, id);
    const [lead] = await tx
      .select({ firstSuccessfulContactAt: opsLeads.firstSuccessfulContactAt })
      .from(opsLeads)
      .where(eq(opsLeads.id, admission.leadId));
    const closure = settings['admissions.closure_reasons'].value;
    const coded = checkReasonCode({
      from: admission.status,
      to: input.to,
      code: input.reasonCode,
      heldFromStatus: admission.heldFromStatus as AdmissionStatus | null,
      allowed: closure.codes.map((c) => c.code),
      requireCode: closure.requireCode,
      actor: 'user',
    });
    if (!coded.ok) throw fieldError('reasonCode', coded.message);
    const readinessMissing =
      input.to === 'admitted'
        ? (await readinessOf(tx, admission)).gaps.map((g) => READINESS_GAP_LABELS[g])
        : [];
    return applyTransition(tx, {
      admission,
      to: input.to,
      actorUserId: actor.id,
      reason: input.reason,
      reasonCode: coded.code,
      context: {
        hasSuccessfulContact: Boolean(lead?.firstSuccessfulContactAt),
        demoSkipAllowed: settings['pipeline.demo_skip'].value.allowed,
        readinessMissing,
      },
      requestId,
      settings,
    });
  });
}

/** Admission fields copied as given (null clears them). */
const PLAIN_FIELDS = [
  'deliveryMode',
  'intendedStartDate',
  'intendedCourseId',
  'intendedBatchId',
] as const;

export async function updateAdmission(
  db: Database,
  actor: Actor,
  id: string,
  input: UpdateAdmissionInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const patch: Partial<typeof opsAdmissions.$inferInsert> = {};
  if ('programmeCode' in input)
    patch.programmeId = input.programmeCode
      ? (await programmeByCode(db, input.programmeCode)).id
      : null;
  if ('counsellorStaffId' in input) {
    if (access.scope === 'own')
      throw new ForbiddenError('Only an operations manager can reassign the counsellor.');
    patch.counsellorStaffId = input.counsellorStaffId
      ? (await activeStaff(db, input.counsellorStaffId, 'counsellorStaffId')).id
      : null;
  }
  for (const k of PLAIN_FIELDS)
    if (k in input) (patch as Record<string, unknown>)[k] = input[k] ?? null;
  return withTransaction(db, async (tx) => {
    const before = await lockAccessible(tx, access, id);
    if (!isOpenStatus(before.status) || before.status === 'enrolment_requested')
      throw new ConflictError(`An admission that is ${before.status} cannot be edited.`);
    if (
      'programmeId' in patch &&
      patch.programmeId !== before.programmeId &&
      before.status === 'admitted'
    )
      throw new ConflictError('Change the programme before confirming the admission.');
    const [after] = await tx
      .update(opsAdmissions)
      .set(patch)
      .where(eq(opsAdmissions.id, before.id))
      .returning();
    await opsAudit('admission')(
      tx,
      actor,
      before.id,
      'admission.updated',
      { before, after, metadata: { leadId: before.leadId } },
      requestId,
    );
    return after as AdmissionRow;
  });
}

export async function recordAdmissionCheck(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof checkBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, id);
    if (['lost', 'enrolled'].includes(admission.status))
      throw new ConflictError(`The checklist of a ${admission.status} admission cannot change.`);
    const existing = await checksOf(tx, admission.id);
    if (input.status === 'done') {
      const separation = checkVerifierSeparation(input.itemKey, actor.id, existing as CheckState[]);
      if (!separation.ok) throw new ConflictError(separation.message);
    }
    if (input.status === 'not_applicable' && input.itemKey.startsWith('fee_verification'))
      throw new ValidationError('Fee verifications cannot be marked not applicable.');
    const values = {
      admissionId: admission.id,
      itemKey: input.itemKey,
      status: input.status,
      reference: input.reference?.trim() || null,
      recordedBy: actor.id,
      recordedAt: new Date(),
    };
    const [after] = await tx
      .insert(opsAdmissionChecks)
      .values(values)
      .onConflictDoUpdate({
        target: [opsAdmissionChecks.admissionId, opsAdmissionChecks.itemKey],
        set: values,
      })
      .returning();
    await opsAudit('admission')(
      tx,
      actor,
      admission.id,
      'admission.check_recorded',
      {
        before: existing.find((c) => c.itemKey === input.itemKey) ?? null,
        after,
        metadata: { leadId: admission.leadId, itemKey: input.itemKey },
      },
      requestId,
    );
    return after;
  });
}

// --- fee arrangement approval (BR-OPS-7) ------------------------------------------------------------

/** A fee arrangement is approved while the admission is pending (before "admitted"). */
const FEE_APPROVAL_STATUSES = [
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
];

export async function feeApprovalAction(
  db: Database,
  actor: Actor,
  id: string,
  input: { action: 'request' | 'approve' | 'reject' | 'withdraw'; comment?: string | null },
  requestId?: string,
) {
  const deciding = input.action === 'approve' || input.action === 'reject';
  const access = await accessScope(
    db,
    actor,
    deciding ? 'ops:admissions:approve' : 'ops:admissions:write',
  );
  const policy = feeArrangementPolicy;
  const comment = input.comment ?? null;
  return withTransaction(db, async (tx) => {
    const admission = await lockAdmission(tx, id);
    if (!admission) notFound('Admission');
    if (!deciding) await assertAdmissionAccess(tx, access, admission);
    if (!FEE_APPROVAL_STATUSES.includes(admission.status))
      throw new InvalidStateTransitionError(
        'A fee arrangement is approved while the admission is pending (before "admitted").',
      );
    if (input.action === 'request') {
      const done = (await checksOf(tx, admission.id))
        .filter((c) => c.status === 'done')
        .map((c) => c.itemKey);
      if (!done.includes('fee_verification_1') || !done.includes('fee_verification_2'))
        throw new ValidationError('Record both fee verifications before asking for approval.');
      return requestApproval(tx, {
        policy,
        subjectId: admission.id,
        requestedBy: actor,
        comment,
        requestId,
      });
    }
    const pending = await findPendingApproval(tx, policy, admission.id);
    if (!pending)
      throw new InvalidStateTransitionError(
        'There is no pending fee-arrangement approval request.',
      );
    if (input.action === 'withdraw')
      return withdrawApproval(tx, { policy, approvalId: pending.id, actor, requestId });
    return decideApproval(tx, {
      policy,
      approvalId: pending.id,
      decider: actor,
      decision: input.action === 'approve' ? 'approved' : 'rejected',
      comment,
      requestId,
    });
  });
}
