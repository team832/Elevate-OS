/**
 * Internal pipeline primitives used by the lead, admission, schedule and
 * enrolment services. Every status change goes through `applyTransition`, which
 * re-checks the domain state machine, writes the transition row and the audit
 * event in the caller's transaction.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  opsLeads,
  students,
  opsAdmissions,
  opsAdmissionTransitions,
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
  StudentIdentityId,
  UserId,
} from '@elevate/shared-types';
import {
  checkTransition,
  istToday,
  type AdmissionStatus,
  type ResolvedSettings,
  type TransitionContext,
} from '../domain';
import { nextCode } from './context';

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
    /** Opening status and reason (the conversion opens extra programme cases at `admission_pending`). */
    initial?: { status: AdmissionStatus; reason: string };
    patch?: Partial<typeof opsAdmissions.$inferInsert>;
  },
): Promise<AdmissionRow> {
  const code = await nextCode(tx, 'admission', 'ops.admissions');
  const status = input.initial?.status ?? 'new';
  const [row] = await tx
    .insert(opsAdmissions)
    .values({
      code,
      leadId: input.leadId,
      programmeId: input.programmeId,
      counsellorStaffId: input.counsellorStaffId,
      status,
      createdBy: input.createdBy,
      ...input.patch,
    })
    .returning();
  if (!row) throw new Error('admission insert returned no row');
  await tx.insert(opsAdmissionTransitions).values({
    admissionId: row.id,
    fromStatus: null,
    toStatus: status,
    actorType: 'user',
    actorUserId: input.createdBy,
    reason: input.initial?.reason ?? 'Admission case opened',
  });
  await recordAudit(tx, {
    actorUserId: input.createdBy,
    module: 'ops',
    requestId: input.requestId,
    action: 'admission.created',
    entityType: 'admission',
    entityId: row.id,
    after: row,
    metadata: { leadId: input.leadId },
  });
  return row;
}

export interface ApplyTransitionInput {
  admission: AdmissionRow;
  to: AdmissionStatus;
  /** The person making the change; null = a system change (an Academic OS reply). */
  actorUserId: UserId | null;
  reason?: string | null;
  /** Validated closure code (checkReasonCode); stored on the case and the transition row. */
  reasonCode?: string | null;
  eventId?: IntegrationEventId | null;
  context?: Omit<TransitionContext, 'actor' | 'reason' | 'heldFromStatus'>;
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
  const from = admission.status;
  const actorType = input.actorUserId ? 'user' : 'system';
  const check = checkTransition(from, to, {
    ...input.context,
    actor: actorType,
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
  const reason = input.reason?.trim() || null;
  const reasonCode = input.reasonCode ?? null;
  const values: Partial<typeof opsAdmissions.$inferInsert> = {
    status: to,
    statusReason: reason,
    statusChangedAt: now,
    heldFromStatus: to === 'on_hold' ? from : null,
    statusReasonCode: reasonCode,
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
  const eventId = input.eventId ?? null;
  await tx.insert(opsAdmissionTransitions).values({
    admissionId: admission.id,
    fromStatus: from,
    toStatus: to,
    reason,
    reasonCode,
    actorType,
    actorUserId: input.actorUserId,
    eventId,
    at: now,
  });
  await recordAudit(tx, {
    actorType,
    actorUserId: input.actorUserId,
    module: 'ops',
    action: 'admission.transitioned',
    entityType: 'admission',
    entityId: admission.id,
    before: { status: from },
    after: { status: to, reason: input.reason ?? null, reasonCode },
    requestId: input.requestId,
    metadata: { leadId: admission.leadId, rule: check.rule.meaning, eventId },
  });
  await applySideEffects(tx, admission.id, to, input);
  return updated;
}

/**
 * Side effects of closing states (documented in ALGORITHMS.md A-03):
 * - lost: open follow-ups of this admission are cancelled;
 * - admitted: the case gets its canonical student.
 * The demo fee is never a status flag here: it lives in the ledger (charge category `demo`).
 */
async function applySideEffects(
  tx: Database,
  admissionId: AdmissionId,
  to: AdmissionStatus,
  input: ApplyTransitionInput,
): Promise<void> {
  if (to === 'lost') {
    await tx
      .update(opsFollowUps)
      .set({ status: 'cancelled', outcome: `Case closed as lost: ${input.reason ?? ''}`.trim() })
      .where(and(eq(opsFollowUps.admissionId, admissionId), eq(opsFollowUps.status, 'open')));
  }
  if (to === 'admitted') await ensureStudentIdentity(tx, admissionId);
}

/**
 * The canonical student (core.students) already held by this lead or a lead
 * merged into it: the same person, so it is linked without review.
 */
export async function sameLeadIdentity(
  tx: Database,
  leadId: LeadId,
): Promise<StudentIdentityId | null> {
  const merged = await tx
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.mergedIntoLeadId, leadId));
  const [row] = await tx
    .select({ id: opsAdmissions.studentId })
    .from(opsAdmissions)
    .where(
      and(
        inArray(opsAdmissions.leadId, [leadId, ...merged.map((m) => m.id)]),
        isNotNull(opsAdmissions.studentId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Serialises identity decisions for one lead until commit. An advisory lock, not the lead row:
 * callers of ensureStudentIdentity hold the case, while lead-first paths (merge, assignment,
 * activity) lock lead → case, so a lead row lock there could deadlock with them.
 */
export const lockLeadIdentity = (tx: Database, leadId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.lead-identity:${leadId}`}))`);

/**
 * Every admitted case — and every demo from booking (brief §3) — has a canonical student
 * (A-STU-6): the case's own, else the lead's (or a lead merged into it), else a new one (sample
 * follows the lead). Never merges by contact: matches stay duplicate flags for review.
 * Idempotent; call inside the transaction that holds the case.
 */
export async function ensureStudentIdentity(tx: Database, admissionId: AdmissionId) {
  const [a] = await tx
    .select({ id: opsAdmissions.studentId, leadId: opsAdmissions.leadId })
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, admissionId));
  if (a!.id) return { studentId: a!.id, identity: 'existing' as const };
  // One identity per lead even when two of its cases are booked or admitted at the same time.
  await lockLeadIdentity(tx, a!.leadId);
  const sameLead = await sameLeadIdentity(tx, a!.leadId);
  let studentId = sameLead;
  if (!studentId) {
    const [lead] = await tx
      .select({ fullName: opsLeads.studentName, isSample: opsLeads.isSample })
      .from(opsLeads)
      .where(eq(opsLeads.id, a!.leadId));
    const [created] = await tx.insert(students).values(lead!).returning({ id: students.id });
    studentId = created!.id;
  }
  await tx.update(opsAdmissions).set({ studentId }).where(eq(opsAdmissions.id, admissionId));
  return { studentId, identity: sameLead ? ('same_lead' as const) : ('created' as const) };
}
