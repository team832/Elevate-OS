/**
 * Admissions pipeline (OPS-005, OPS-010, OPS-011): board, detail, user
 * transitions, checklist, fee-arrangement approval, and the read helpers the
 * other admission services share. The enrolment handoff lives in ./enrolment.ts.
 */
import { and, asc, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  approvals,
  eventDeliveries,
  integrationEvents,
  opsAdmissionChecks,
  opsAdmissions,
  opsAdmissionTransitions,
  opsAppointments,
  opsDemos,
  opsDemoSessions,
  opsEnrolmentAttempts,
  opsFeePlans,
  opsFeeRecords,
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
  IntegrationEventId,
  ProgrammeId,
  StaffMemberId,
  UserId,
} from '@elevate/shared-types';
import type { z } from 'zod';
import {
  ADMISSION_CHECK_LABELS,
  allowedUserTargets,
  checkReasonCode,
  checkVerifierSeparation,
  evaluateAdmissionReadiness,
  SYSTEM_CLOSURE_REASONS,
  isOpenStatus,
  READINESS_GAP_LABELS,
  type AdmissionCheckItem,
  type AdmissionStatus,
  type CheckState,
  type FeeApprovalState,
} from '../domain';
import { demoAttendanceStatus, demoDaysAndSubjects } from '../domain/demos';
import { summariseFees, type FeeRecordLike } from '../domain/fees';
import { deriveHandoffView, retryDecision, type HandoffInput } from '../domain/students';
import { feeAgreementPolicy, feeArrangementPolicy } from './approval-policies';
import { academicDemoMarks, withMarks } from './academic-summary';
import {
  accessScope,
  activeStaff,
  assertScope,
  notFound,
  programmeByCode,
  type AccessScope,
  type Actor,
} from './context';
import { opsAudit, rowById } from './ops-common';
import { applyTransition, lockAdmission, type AdmissionRow } from './pipeline';
import type { checkBody, UpdateAdmissionInput } from './schemas';
import { loadSettings } from './settings';

/** Academic's consumer name for the enrolment request (INTEGRATION_CONTRACT.md §6). */
export const ACADEMIC_INTAKE_CONSUMER = 'academic.enrolment-intake';

// --- shared reads --------------------------------------------------------------------------------

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

/** Display names of users by id. */
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

async function checksOf(db: Database, admissionId: string) {
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
      a: opsAdmissions,
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
  return rows.map(({ a, ...r }) => ({
    id: a.id,
    code: a.code,
    leadId: a.leadId,
    leadCode: r.leadCode,
    studentName: r.studentName,
    programmeCode: r.programmeCode,
    counsellorStaffId: a.counsellorStaffId,
    counsellorName: r.counsellorName,
    status: a.status,
    statusReason: a.statusReason,
    statusChangedAt: a.statusChangedAt,
    handoffStatus: a.handoffStatus,
    rejectionReason: a.rejectionReason,
    demoSkipped: a.demoSkipped,
  }));
}

// --- detail --------------------------------------------------------------------------------------

export async function getAdmission(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, id);
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
  const { gaps, checks, fee, settings } = await readinessOf(db, admission);
  const recorderName = await namesOf(
    db,
    checks.map((c) => c.recordedBy),
  );
  const sessions = await db
    .select({ s: opsAppointments, counsellorName: staffMembers.fullName })
    .from(opsAppointments)
    .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
    .where(eq(opsAppointments.admissionId, admission.id))
    .orderBy(desc(opsAppointments.startsAt));
  const demos = await db
    .select()
    .from(opsDemos)
    .where(eq(opsDemos.admissionId, admission.id))
    .orderBy(desc(opsDemos.createdAt));
  const plainSessions = demos.length
    ? await db
        .select({
          id: opsDemoSessions.id,
          demoId: opsDemoSessions.demoId,
          startsAt: opsDemoSessions.startsAt,
          subject: opsDemoSessions.subject,
          attendance: opsDemoSessions.attendance,
          teacherName: staffMembers.fullName,
        })
        .from(opsDemoSessions)
        .leftJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId))
        .where(
          inArray(
            opsDemoSessions.demoId,
            demos.map((d) => d.id),
          ),
        )
        .orderBy(asc(opsDemoSessions.sessionNumber))
    : [];
  // R15: a linked class shows Academic's mark and actual teachers.
  const demoSessions = withMarks(
    plainSessions,
    await academicDemoMarks(
      db,
      plainSessions.map((x) => x.id),
    ),
  ).map((x) => ({ ...x, teacherName: x.academic?.teacherNames.join(', ') || x.teacherName }));
  const [event] = admission.lastRequestEventId
    ? await db
        .select({ id: integrationEvents.id, occurredAt: integrationEvents.occurredAt })
        .from(integrationEvents)
        .where(eq(integrationEvents.id, admission.lastRequestEventId))
    : [];
  const handoff = event
    ? {
        eventId: event.id as string,
        attempt: admission.enrolmentAttempt,
        occurredAt: event.occurredAt,
        academicDelivery: await academicDeliveryOf(db, admission.lastRequestEventId),
      }
    : null;
  const status = admission.status;
  const handoffInput = handoffInputOf(admission, handoff?.academicDelivery ?? null);
  const feeRecords = can(actor, 'ops:fees:read')
    ? await db
        .select({
          kind: opsFeeRecords.kind,
          direction: opsFeeRecords.direction,
          amountPaise: opsFeeRecords.amountPaise,
          status: opsFeeRecords.status,
        })
        .from(opsFeeRecords)
        .where(eq(opsFeeRecords.admissionId, admission.id))
    : null;
  const closure = settings['admissions.closure_reasons'];
  return {
    admission,
    lead: lead ?? null,
    programme: await programmeRef(db, admission.programmeId),
    counsellor: await staffRef(db, admission.counsellorStaffId),
    checks: checks.map((c) => ({
      ...c,
      label: ADMISSION_CHECK_LABELS[c.itemKey as AdmissionCheckItem],
      recordedByName: recorderName.get(c.recordedBy) ?? null,
    })),
    readiness: {
      ready: gaps.length === 0,
      gaps: gaps.map((g) => ({ key: g, label: READINESS_GAP_LABELS[g] })),
    },
    feeApproval: {
      ...fee,
      history: await listApprovalHistory(db, {
        module: 'ops',
        subjectType: 'admission',
        subjectId: admission.id,
      }),
    },
    transitions: await transitionsOf(db, admission.id),
    counselling: sessions.map((s) => ({ ...s.s, counsellorName: s.counsellorName })),
    demos: demos.map((d) => {
      const sessions = demoSessions.filter((x) => x.demoId === d.id);
      return {
        ...d,
        ...demoDaysAndSubjects(sessions),
        status: demoAttendanceStatus(d.outcome, sessions),
        teachers: [...new Set(sessions.flatMap((x) => (x.teacherName ? [x.teacherName] : [])))],
      };
    }),
    followUps: await db
      .select()
      .from(opsFollowUps)
      .where(eq(opsFollowUps.admissionId, admission.id))
      .orderBy(desc(opsFollowUps.dueDate)),
    handoff,
    allowedTargets: allowedUserTargets(status, {
      heldFromStatus: admission.heldFromStatus as AdmissionStatus | null,
      demoSkipAllowed: settings['pipeline.demo_skip'].value.allowed,
    }).filter((t) => t !== 'enrolment_requested'),
    canRequestEnrolment: status === 'admitted',
    handoffView: deriveHandoffView(handoffInput),
    retry: retryDecision(handoffInput),
    attempts: await attemptsOf(db, admission.id),
    /** null = the caller may not read fee records. */
    feeSummary: feeRecords ? summariseFees(feeRecords as FeeRecordLike[]) : null,
    closureReasons: closure.value.codes.filter((c) => !SYSTEM_CLOSURE_REASONS.includes(c.code)),
    closureReasonLabels: Object.fromEntries(closure.value.codes.map((c) => [c.code, c.label])),
    settings: {
      closureReasons: closure,
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
    if (!coded.ok)
      throw new ValidationError(coded.message, {
        details: [{ location: 'body', path: ['reasonCode'], message: coded.message }],
      });
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

// --- checklist -----------------------------------------------------------------------------------

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
