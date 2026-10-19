/**
 * Admissions pipeline (OPS-005, OPS-010, OPS-011): board, detail, user
 * transitions, checklist, fee-arrangement approval. The enrolment handoff lives
 * in ./enrolment.ts.
 */
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import {
  approvals,
  eventDeliveries,
  integrationEvents,
  opsAdmissionChecks,
  opsAdmissions,
  opsAdmissionTransitions,
  opsCounsellingSessions,
  opsDemos,
  opsDemoTeachers,
  opsFollowUps,
  opsLeads,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  decideApproval,
  findPendingApproval,
  listApprovalHistory,
  recordAudit,
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
import type {
  AdmissionId,
  ApprovalId,
  BatchId,
  CourseId,
  StaffMemberId,
} from '@elevate/shared-types';
import {
  ADMISSION_CHECK_LABELS,
  allowedUserTargets,
  checkVerifierSeparation,
  evaluateAdmissionReadiness,
  isOpenStatus,
  READINESS_GAP_LABELS,
  type AdmissionCheckItem,
  type AdmissionStatus,
  type CheckState,
  type FeeApprovalState,
} from '../domain';
import { feeArrangementPolicy } from './approval-policies';
import {
  accessScope,
  activeStaff,
  notFound,
  programmeByCode,
  type AccessScope,
  type Actor,
} from './context';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import type { UpdateAdmissionInput } from './schemas';
import { loadSettings } from './settings';

/** Academic's consumer name for the enrolment request (INTEGRATION_CONTRACT.md §6). */
export const ACADEMIC_INTAKE_CONSUMER = 'academic.enrolment-intake';

async function leadOwnerOf(db: Database, admission: Pick<AdmissionRow, 'leadId'>) {
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
  const owner = await leadOwnerOf(db, admission);
  if (
    !access.staffId ||
    (admission.counsellorStaffId !== access.staffId && owner !== access.staffId)
  ) {
    throw new ForbiddenError('You can only work on admissions assigned to you.');
  }
}

async function getAdmissionRow(db: Database, id: string): Promise<AdmissionRow> {
  const [row] = await db
    .select()
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, id as AdmissionId))
    .limit(1);
  if (!row) notFound('Admission');
  return row;
}

export async function feeApprovalState(
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

async function checksOf(db: Database, admissionId: string) {
  return db
    .select()
    .from(opsAdmissionChecks)
    .where(eq(opsAdmissionChecks.admissionId, admissionId as AdmissionId));
}

export async function readinessOf(db: Database, admission: AdmissionRow) {
  const settings = await loadSettings(db);
  const checks = await checksOf(db, admission.id);
  const fee = await feeApprovalState(db, admission.id);
  const gaps = evaluateAdmissionReadiness({
    checks: checks.map((c) => ({
      itemKey: c.itemKey as AdmissionCheckItem,
      status: c.status,
      recordedBy: c.recordedBy,
    })),
    feeApproval: fee.state,
    hasProgramme: Boolean(admission.programmeId),
    config: settings['admission.confirmation'].value,
  });
  return { gaps, checks, fee, settings };
}

// --- board / list --------------------------------------------------------------------------------

export async function listAdmissions(
  db: Database,
  actor: Actor,
  filters: { status?: AdmissionStatus; handoff?: string } = {},
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const conditions: SQL[] = [];
  if (access.scope === 'own') {
    if (!access.staffId) return [];
    conditions.push(eq(opsAdmissions.counsellorStaffId, access.staffId));
  }
  if (filters.status) conditions.push(eq(opsAdmissions.status, filters.status));
  if (filters.handoff) conditions.push(eq(opsAdmissions.handoffStatus, filters.handoff));
  const rows = await db
    .select({
      admission: opsAdmissions,
      leadCode: opsLeads.code,
      studentName: opsLeads.studentName,
      programmeCode: programmes.code,
      counsellorName: staffMembers.fullName,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .leftJoin(staffMembers, eq(staffMembers.id, opsAdmissions.counsellorStaffId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(opsAdmissions.statusChangedAt))
    .limit(1000);
  return rows.map((r) => ({
    id: r.admission.id,
    code: r.admission.code,
    leadId: r.admission.leadId,
    leadCode: r.leadCode,
    studentName: r.studentName,
    programmeCode: r.programmeCode,
    counsellorStaffId: r.admission.counsellorStaffId,
    counsellorName: r.counsellorName,
    status: r.admission.status as AdmissionStatus,
    statusReason: r.admission.statusReason,
    statusChangedAt: r.admission.statusChangedAt,
    handoffStatus: r.admission.handoffStatus,
    rejectionReason: r.admission.rejectionReason,
    demoSkipped: r.admission.demoSkipped,
  }));
}

// --- detail --------------------------------------------------------------------------------------

export async function getAdmission(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await getAdmissionRow(db, id);
  await assertAdmissionAccess(db, access, admission);
  const [lead] = await db
    .select({
      id: opsLeads.id,
      code: opsLeads.code,
      studentName: opsLeads.studentName,
      ownerStaffId: opsLeads.ownerStaffId,
      firstSuccessfulContactAt: opsLeads.firstSuccessfulContactAt,
    })
    .from(opsLeads)
    .where(eq(opsLeads.id, admission.leadId));
  const [programme] = admission.programmeId
    ? await db
        .select({ code: programmes.code, name: programmes.name })
        .from(programmes)
        .where(eq(programmes.id, admission.programmeId))
    : [];
  const [counsellor] = admission.counsellorStaffId
    ? await db
        .select({ id: staffMembers.id, fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, admission.counsellorStaffId))
    : [];
  const { gaps, checks, fee, settings } = await readinessOf(db, admission);
  const recorderIds = [...new Set(checks.map((c) => c.recordedBy))];
  const recorders = recorderIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, recorderIds))
    : [];
  const recorderName = new Map(recorders.map((r) => [r.id as string, r.displayName]));
  const transitions = await db
    .select({ t: opsAdmissionTransitions, actorName: users.displayName })
    .from(opsAdmissionTransitions)
    .leftJoin(users, eq(users.id, opsAdmissionTransitions.actorUserId))
    .where(eq(opsAdmissionTransitions.admissionId, admission.id))
    .orderBy(asc(opsAdmissionTransitions.at), asc(opsAdmissionTransitions.id));
  const sessions = await db
    .select({ s: opsCounsellingSessions, counsellorName: staffMembers.fullName })
    .from(opsCounsellingSessions)
    .innerJoin(staffMembers, eq(staffMembers.id, opsCounsellingSessions.counsellorStaffId))
    .where(eq(opsCounsellingSessions.admissionId, admission.id))
    .orderBy(desc(opsCounsellingSessions.scheduledAt));
  const demos = await db
    .select()
    .from(opsDemos)
    .where(eq(opsDemos.admissionId, admission.id))
    .orderBy(desc(opsDemos.createdAt));
  const demoTeachers = demos.length
    ? await db
        .select({
          demoId: opsDemoTeachers.demoId,
          staffId: opsDemoTeachers.staffId,
          fullName: staffMembers.fullName,
          notifiedAt: opsDemoTeachers.notifiedAt,
        })
        .from(opsDemoTeachers)
        .innerJoin(staffMembers, eq(staffMembers.id, opsDemoTeachers.staffId))
        .where(
          inArray(
            opsDemoTeachers.demoId,
            demos.map((d) => d.id),
          ),
        )
    : [];
  const followUps = await db
    .select()
    .from(opsFollowUps)
    .where(eq(opsFollowUps.admissionId, admission.id))
    .orderBy(desc(opsFollowUps.dueDate));
  const feeHistory = await listApprovalHistory(db, {
    module: 'ops',
    subjectType: 'admission',
    subjectId: admission.id,
  });
  let handoff: {
    eventId: string;
    attempt: number;
    occurredAt: Date;
    academicDelivery: { status: string; attempts: number; lastError: string | null } | null;
  } | null = null;
  if (admission.lastRequestEventId) {
    const [event] = await db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.id, admission.lastRequestEventId));
    const [delivery] = await db
      .select({
        status: eventDeliveries.status,
        attempts: eventDeliveries.attempts,
        lastError: eventDeliveries.lastError,
      })
      .from(eventDeliveries)
      .where(
        and(
          eq(eventDeliveries.eventId, admission.lastRequestEventId),
          eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
        ),
      );
    if (event)
      handoff = {
        eventId: event.id,
        attempt: admission.enrolmentAttempt,
        occurredAt: event.occurredAt,
        academicDelivery: delivery ?? null,
      };
  }
  const status = admission.status as AdmissionStatus;
  return {
    admission,
    lead: lead ?? null,
    programme: programme ?? null,
    counsellor: counsellor ?? null,
    checks: checks.map((c) => ({
      ...c,
      label: ADMISSION_CHECK_LABELS[c.itemKey as AdmissionCheckItem],
      recordedByName: recorderName.get(c.recordedBy) ?? null,
    })),
    readiness: {
      ready: gaps.length === 0,
      gaps: gaps.map((g) => ({ key: g, label: READINESS_GAP_LABELS[g] })),
    },
    feeApproval: { ...fee, history: feeHistory },
    transitions: transitions.map((t) => ({ ...t.t, actorName: t.actorName })),
    counselling: sessions.map((s) => ({ ...s.s, counsellorName: s.counsellorName })),
    demos: demos.map((d) => ({ ...d, teachers: demoTeachers.filter((t) => t.demoId === d.id) })),
    followUps,
    handoff,
    allowedTargets: allowedUserTargets(status, {
      heldFromStatus: admission.heldFromStatus as AdmissionStatus | null,
      demoSkipAllowed: settings['pipeline.demo_skip'].value.allowed,
    }).filter((t) => t !== 'enrolment_requested'),
    canRequestEnrolment: status === 'admitted',
    settings: {
      demoSkip: settings['pipeline.demo_skip'],
      confirmation: settings['admission.confirmation'],
    },
  };
}

// --- user transitions --------------------------------------------------------------------------

export async function transitionAdmission(
  db: Database,
  actor: Actor,
  id: string,
  input: { to: AdmissionStatus; reason?: string | null },
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
    const admission = await lockAdmission(tx, id);
    if (!admission) notFound('Admission');
    await assertAdmissionAccess(tx, access, admission);
    const [lead] = await tx
      .select({ firstSuccessfulContactAt: opsLeads.firstSuccessfulContactAt })
      .from(opsLeads)
      .where(eq(opsLeads.id, admission.leadId));
    const readinessMissing =
      input.to === 'admitted'
        ? (await readinessOf(tx, admission)).gaps.map((g) => READINESS_GAP_LABELS[g])
        : [];
    return applyTransition(tx, {
      admission,
      to: input.to,
      actorType: 'user',
      actorUserId: actor.id,
      reason: input.reason,
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
  if ('deliveryMode' in input) patch.deliveryMode = input.deliveryMode ?? null;
  if ('intendedStartDate' in input) patch.intendedStartDate = input.intendedStartDate ?? null;
  if ('intendedCourseId' in input)
    patch.intendedCourseId = (input.intendedCourseId as CourseId | null) ?? null;
  if ('intendedBatchId' in input)
    patch.intendedBatchId = (input.intendedBatchId as BatchId | null) ?? null;
  return withTransaction(db, async (tx) => {
    const before = await lockAdmission(tx, id);
    if (!before) notFound('Admission');
    await assertAdmissionAccess(tx, access, before);
    if (!isOpenStatus(before.status as AdmissionStatus) || before.status === 'enrolment_requested')
      throw new ConflictError(`An admission that is ${before.status} cannot be edited.`);
    if (
      'programmeId' in patch &&
      patch.programmeId !== before.programmeId &&
      ['admitted'].includes(before.status)
    )
      throw new ConflictError('Change the programme before confirming the admission.');
    const [after] = await tx
      .update(opsAdmissions)
      .set(patch)
      .where(eq(opsAdmissions.id, before.id))
      .returning();
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'admission.updated',
      entityType: 'admission',
      entityId: before.id,
      before,
      after,
      requestId,
      metadata: { leadId: before.leadId },
    });
    return after as AdmissionRow;
  });
}

// --- checklist -----------------------------------------------------------------------------------

export async function recordAdmissionCheck(
  db: Database,
  actor: Actor,
  id: string,
  input: {
    itemKey: AdmissionCheckItem;
    status: 'done' | 'not_done' | 'not_applicable';
    reference?: string | null;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const admission = await lockAdmission(tx, id);
    if (!admission) notFound('Admission');
    await assertAdmissionAccess(tx, access, admission);
    if (['lost', 'enrolled'].includes(admission.status))
      throw new ConflictError(`The checklist of a ${admission.status} admission cannot change.`);
    const existing = await checksOf(tx, admission.id);
    const states: CheckState[] = existing.map((c) => ({
      itemKey: c.itemKey as AdmissionCheckItem,
      status: c.status,
      recordedBy: c.recordedBy,
    }));
    if (input.status === 'done') {
      const separation = checkVerifierSeparation(input.itemKey, actor.id, states);
      if (!separation.ok) throw new ConflictError(separation.message);
    }
    if (input.status === 'not_applicable' && input.itemKey.startsWith('fee_verification'))
      throw new ValidationError('Fee verifications cannot be marked not applicable (BR-OPS-7).');
    const before = existing.find((c) => c.itemKey === input.itemKey) ?? null;
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
    await recordAudit(tx, {
      actorUserId: actor.id,
      module: 'ops',
      action: 'admission.check_recorded',
      entityType: 'admission',
      entityId: admission.id,
      before,
      after,
      requestId,
      metadata: { leadId: admission.leadId, itemKey: input.itemKey },
    });
    return after;
  });
}

// --- fee arrangement approval (BR-OPS-7) ------------------------------------------------------------

export async function feeApprovalAction(
  db: Database,
  actor: Actor,
  id: string,
  input: { action: 'request' | 'approve' | 'reject' | 'withdraw'; comment?: string | null },
  requestId?: string,
) {
  const permission =
    input.action === 'approve' || input.action === 'reject'
      ? 'ops:admissions:approve'
      : 'ops:admissions:write';
  const access = await accessScope(db, actor, permission);
  return withTransaction(db, async (tx) => {
    const admission = await lockAdmission(tx, id);
    if (!admission) notFound('Admission');
    if (permission === 'ops:admissions:write') await assertAdmissionAccess(tx, access, admission);
    if (
      !['counselled', 'demo_scheduled', 'demo_attended', 'admission_pending'].includes(
        admission.status,
      )
    )
      throw new InvalidStateTransitionError(
        'A fee arrangement is approved while the admission is pending (before "admitted").',
      );
    if (input.action === 'request') {
      const states = (await checksOf(tx, admission.id))
        .filter((c) => c.status === 'done')
        .map((c) => c.itemKey);
      if (!states.includes('fee_verification_1') || !states.includes('fee_verification_2'))
        throw new ValidationError(
          'Record both fee verifications before asking for approval (BR-OPS-7).',
        );
      return requestApproval(tx, {
        policy: feeArrangementPolicy,
        subjectId: admission.id,
        requestedBy: actor,
        comment: input.comment ?? null,
        requestId,
      });
    }
    const pending = await findPendingApproval(tx, feeArrangementPolicy, admission.id);
    if (!pending)
      throw new InvalidStateTransitionError(
        'There is no pending fee-arrangement approval request.',
      );
    if (input.action === 'withdraw')
      return withdrawApproval(tx, {
        policy: feeArrangementPolicy,
        approvalId: pending.id,
        actor,
        requestId,
      });
    return decideApproval(tx, {
      policy: feeArrangementPolicy,
      approvalId: pending.id,
      decider: actor,
      decision: input.action === 'approve' ? 'approved' : 'rejected',
      comment: input.comment ?? null,
      requestId,
    });
  });
}

/** Staff options for counsellor pickers. */
export async function counsellorOptions(db: Database) {
  return db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName })
    .from(staffMembers)
    .where(eq(staffMembers.status, 'active'))
    .orderBy(asc(staffMembers.fullName));
}

export type { StaffMemberId };
