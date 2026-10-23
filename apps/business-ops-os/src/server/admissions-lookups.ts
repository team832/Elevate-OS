/**
 * Admission read helpers the admission services share (server/admissions.ts): own-scope access,
 * names and references, the Academic handoff facts, history, and readiness for "admitted".
 */
import { and, asc, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import {
  approvals,
  eventDeliveries,
  opsAdmissionChecks,
  opsAdmissions,
  opsAdmissionTransitions,
  opsEnrolmentAttempts,
  opsFeePlans,
  opsLeads,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type {
  AdmissionId,
  ApprovalId,
  IntegrationEventId,
  ProgrammeId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';
import { evaluateAdmissionReadiness, type CheckState, type FeeApprovalState } from '../domain';
import type { HandoffInput } from '../domain/students';
import { feeAgreementPolicy, feeArrangementPolicy } from './approval-policies';
import { assertScope, notFound, type AccessScope } from './context';
import { rowById } from './ops-common';
import { lockAdmission, type AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

/** Academic's consumer name for the enrolment request (INTEGRATION_CONTRACT.md §6). */
export const ACADEMIC_INTAKE_CONSUMER = 'academic.enrolment-intake';

export async function leadOwnerOf(db: Database, admission: Pick<AdmissionRow, 'leadId'>) {
  const [lead] = await db
    .select({ ownerStaffId: opsLeads.ownerStaffId })
    .from(opsLeads)
    .where(eq(opsLeads.id, admission.leadId));
  return lead?.ownerStaffId ?? null;
}

/** Own scope: the counsellor of the admission or the owner of its lead. */
export async function assertAdmissionAccess(
  db: Database,
  access: AccessScope,
  admission: AdmissionRow,
) {
  if (access.scope === 'all') return;
  assertScope(
    access,
    [admission.counsellorStaffId, await leadOwnerOf(db, admission)],
    'admissions',
  );
}

/** Lock an admission the caller may work on (404 when missing, 403 outside own scope). */
export async function lockAccessible(tx: Database, access: AccessScope, id: string) {
  const admission = await lockAdmission(tx, id);
  if (!admission) notFound('Admission');
  await assertAdmissionAccess(tx, access, admission);
  return admission;
}

/** SQL for own scope over admissions joined with their lead (counsellor or lead owner). */
export function ownAdmissionFilter(access: AccessScope): SQL | undefined {
  if (access.scope === 'all') return undefined;
  if (!access.staffId) return eq(opsAdmissions.id, '00000000-0000-0000-0000-000000000000' as never);
  return or(
    eq(opsAdmissions.counsellorStaffId, access.staffId),
    eq(opsLeads.ownerStaffId, access.staffId),
  ) as SQL;
}

export const admissionRow = (db: Database, id: string) =>
  rowById(db, opsAdmissions, id, 'Admission');

export async function namesOf(db: Database, ids: readonly (string | null)[]) {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))] as UserId[];
  if (!unique.length) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id as string, r.displayName]));
}

export async function programmeRef(db: Database, id: ProgrammeId | null) {
  if (!id) return null;
  const [row] = await db
    .select({ code: programmes.code, name: programmes.name })
    .from(programmes)
    .where(eq(programmes.id, id));
  return row ?? null;
}

export async function staffRef(db: Database, id: StaffMemberId | null) {
  if (!id) return null;
  const [row] = await db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.id, id));
  return row ?? null;
}

/** Academic's delivery state of a request event (consumer academic.enrolment-intake). */
export async function academicDeliveryOf(db: Database, eventId: IntegrationEventId | null) {
  if (!eventId) return null;
  const [d] = await db
    .select({
      status: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
      lastError: eventDeliveries.lastError,
    })
    .from(eventDeliveries)
    .where(
      and(
        eq(eventDeliveries.eventId, eventId),
        eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
      ),
    );
  return d ?? null;
}

/** The handoff facts of an admission for deriveHandoffView / retryDecision. */
export function handoffInputOf(
  a: AdmissionRow,
  academicDelivery: HandoffInput['academicDelivery'],
): HandoffInput {
  return {
    status: a.status,
    handoffStatus: a.handoffStatus,
    enrolmentAttempt: a.enrolmentAttempt,
    academicDelivery,
    rejectionCode: a.rejectionCode,
    rejectionReason: a.rejectionReason,
  };
}

/** Status history with the acting user's name, oldest first. */
export async function transitionsOf(db: Database, admissionId: AdmissionId) {
  const rows = await db
    .select({ t: opsAdmissionTransitions, actorName: users.displayName })
    .from(opsAdmissionTransitions)
    .leftJoin(users, eq(users.id, opsAdmissionTransitions.actorUserId))
    .where(eq(opsAdmissionTransitions.admissionId, admissionId))
    .orderBy(asc(opsAdmissionTransitions.at), asc(opsAdmissionTransitions.id));
  return rows.map((r) => ({ ...r.t, actorName: r.actorName }));
}

/** Enrolment request attempts with the requester's name, in attempt order. */
export async function attemptsOf(db: Database, admissionId: AdmissionId) {
  const rows = await db
    .select({ a: opsEnrolmentAttempts, requestedByName: users.displayName })
    .from(opsEnrolmentAttempts)
    .leftJoin(users, eq(users.id, opsEnrolmentAttempts.requestedBy))
    .where(eq(opsEnrolmentAttempts.admissionId, admissionId))
    .orderBy(asc(opsEnrolmentAttempts.attempt));
  return rows.map((r) => ({ ...r.a, requestedByName: r.requestedByName }));
}

async function feeApprovalState(
  db: Database,
  admissionId: string,
): Promise<{ state: FeeApprovalState; approvalId: ApprovalId | null }> {
  const [latest] = await db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(
      and(eq(approvals.policy, feeArrangementPolicy.key), eq(approvals.subjectId, admissionId)),
    )
    .orderBy(desc(approvals.requestedAt), desc(approvals.id))
    .limit(1);
  return {
    state: (latest?.status as FeeApprovalState | undefined) ?? 'none',
    approvalId: latest?.id ?? null,
  };
}

export async function checksOf(db: Database, admissionId: string) {
  return db
    .select()
    .from(opsAdmissionChecks)
    .where(eq(opsAdmissionChecks.admissionId, admissionId as AdmissionId));
}

/**
 * D-039: the fee approval is met when the admission's bundle (it, or its application's cases) has
 * an ACTIVE agreement activated by that agreement's own approval. Admission-level fee-arrangement
 * approvals (`fee`) stay readable but no longer count.
 */
async function agreementApproved(db: Database, admission: AdmissionRow) {
  const [row] = await db
    .select({ id: opsFeePlans.id })
    .from(opsFeePlans)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
    .innerJoin(
      approvals,
      and(
        eq(approvals.id, opsFeePlans.approvalId),
        eq(approvals.subjectId, opsFeePlans.id),
        eq(approvals.policy, feeAgreementPolicy.key),
        eq(approvals.status, 'approved'),
      ),
    )
    .where(
      and(
        eq(opsFeePlans.status, 'active'),
        admission.applicationId
          ? or(
              eq(opsAdmissions.id, admission.id),
              eq(opsAdmissions.applicationId, admission.applicationId),
            )
          : eq(opsAdmissions.id, admission.id),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function readinessOf(db: Database, admission: AdmissionRow) {
  const settings = await loadSettings(db);
  const checks = await checksOf(db, admission.id);
  const fee = await feeApprovalState(db, admission.id);
  const gaps = evaluateAdmissionReadiness({
    checks: checks as CheckState[],
    feeApproval: (await agreementApproved(db, admission)) ? 'approved' : 'none',
    hasProgramme: Boolean(admission.programmeId),
    config: settings['admission.confirmation'].value,
  });
  return { gaps, checks, fee, settings };
}
