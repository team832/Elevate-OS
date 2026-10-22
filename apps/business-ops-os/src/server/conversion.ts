/**
 * Convert a demo to an admission application (owner brief 21 Oct 2026 §6), plus the admission
 * number helpers used by the final confirmation (D-037, D-040).
 *
 * Conversion, one transaction: lock the demo (outcome must be open) and its admission; find or
 * link the canonical student (contact matches → review, never an automatic merge); set the
 * programmes (an allowed combination — extra programmes open their own admission case in the
 * same bundle); advance the case to `admission_pending`; mark the demo `converted` (its history
 * stays); create the application DRAFT with version 1; optionally ask the fee-arrangement
 * approval; audit. NO admission number and NO admission: both come only from the
 * password-confirmed final approval (server/applications-confirm.ts).
 */
import { and, asc, eq, inArray, isNotNull, ne, or, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissionNumberChanges,
  opsAdmissionNumberCounters,
  opsAdmissions,
  opsDemos,
  opsGuardians,
  opsLeads,
  programmes,
  students,
  type Database,
} from '@elevate/database';
import { findPendingApproval, requestApproval, withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { AdmissionId, BatchId, LeadId, StudentIdentityId } from '@elevate/shared-types';
import { istToday, type AdmissionStatus } from '../domain';
import {
  checkManualNumber,
  counterScopeKey,
  formatAdmissionNumber,
  type AdmissionNumberFormat,
} from '../domain/admission-numbers';
import { ALLOWED_PROGRAMME_COMBINATIONS, isAllowedCombination } from '../domain/catalog';
import { demoWithChecklist, marksForDemo } from './demos';
import { decideIdentity, maskPhone } from '../domain/student-lifecycle';
import { feeArrangementPolicy } from './approval-policies';
import { admissionRow, assertAdmissionAccess, lockAccessible } from './admissions';
import { createApplication } from './applications';
import { accessScope, type Actor } from './context';
import { fieldError, inOrder, opsAudit, rowById } from './ops-common';
import {
  applyTransition,
  createAdmissionRecord,
  ensureStudentIdentity,
  sameLeadIdentity,
  type AdmissionRow,
} from './pipeline';
import { loadSettings } from './settings';
import type { ConvertInput } from './students-schemas';

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
};

// --- admission numbers ---------------------------------------------------------------------------

async function numberTaken(tx: Database, value: string, exceptId?: AdmissionId) {
  const [row] = await tx
    .select({ id: opsAdmissions.id })
    .from(opsAdmissions)
    .where(
      and(
        eq(opsAdmissions.admissionNumber, value),
        exceptId ? ne(opsAdmissions.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

const yearNow = () => Number(istToday(new Date()).slice(0, 4));

/** Take the next free automatic number: the counter row is locked FOR UPDATE until commit. */
async function takeAutoNumber(tx: Database, format: AdmissionNumberFormat): Promise<string> {
  const year = yearNow();
  const scopeKey = counterScopeKey(format, year);
  await tx.insert(opsAdmissionNumberCounters).values({ scopeKey }).onConflictDoNothing();
  const [counter] = await tx
    .select()
    .from(opsAdmissionNumberCounters)
    .where(eq(opsAdmissionNumberCounters.scopeKey, scopeKey))
    .for('update');
  let next = counter!.nextValue;
  // A legacy or hand-entered number may already use a value: skip it, never reuse.
  while (await numberTaken(tx, formatAdmissionNumber(format, next, year))) next += 1;
  await tx
    .update(opsAdmissionNumberCounters)
    .set({ nextValue: next + 1 })
    .where(eq(opsAdmissionNumberCounters.scopeKey, scopeKey));
  return formatAdmissionNumber(format, next, year);
}

/** The final confirmation's number (D-040): from the locked counter, on an admission that has none. */
export async function assignAdmissionNumber(
  tx: Database,
  actor: Actor,
  admission: Pick<AdmissionRow, 'id' | 'admissionNumber'>,
  format: AdmissionNumberFormat,
  requestId?: string,
): Promise<string> {
  if (admission.admissionNumber)
    throw new ConflictError(
      `This admission already has number ${admission.admissionNumber}; it is never changed.`,
    );
  const value = await takeAutoNumber(tx, format);
  await setAdmissionNumber(tx, actor, admission, value, 'auto', null, requestId);
  return value;
}

/** Write the number on the admission and its change row; a taken number → 409, nothing kept. */
async function setAdmissionNumber(
  tx: Database,
  actor: Actor,
  admission: Pick<AdmissionRow, 'id' | 'admissionNumber'>,
  value: string,
  kind: 'auto' | 'manual',
  reason: string | null,
  requestId?: string,
) {
  const conflict = () =>
    new ConflictError(`Admission number ${value} is already used by another admission.`, {
      details: { field: 'admissionNumber', admissionNumber: value },
    });
  if (await numberTaken(tx, value, admission.id)) throw conflict();
  try {
    await tx
      .update(opsAdmissions)
      .set({ admissionNumber: value })
      .where(eq(opsAdmissions.id, admission.id));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict();
    throw e;
  }
  await tx.insert(opsAdmissionNumberChanges).values({
    admissionId: admission.id,
    previousNumber: admission.admissionNumber,
    newNumber: value,
    kind,
    reason,
    actorUserId: actor.id,
  });
  await opsAudit('admission')(
    tx,
    actor,
    admission.id,
    kind === 'auto' ? 'admission.number_assigned' : 'admission.number_overridden',
    {
      before: { admissionNumber: admission.admissionNumber },
      after: { admissionNumber: value },
      metadata: { kind, reason },
    },
    requestId,
  );
}

function manualOrThrow(
  actor: Actor,
  number: string | null | undefined,
  reason: string | null | undefined,
) {
  const check = checkManualNumber({
    number,
    reason,
    hasPermission: can(actor, 'ops:admission_number:override'),
  });
  if (check.ok) return check;
  if (check.field === 'permission') throw new ForbiddenError(check.message);
  throw fieldError(
    check.field === 'reason' ? 'admissionNumberReason' : 'admissionNumber',
    check.message,
  );
}

/** POST /admissions/{id}/admission-number — a legacy admission without a number (permission, reason ≥ 10, logged). */
export async function overrideAdmissionNumber(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: { admissionNumber: string; reason: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admission_number:override');
  const check = manualOrThrow(actor, input.admissionNumber, input.reason);
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, admissionId);
    // D-040: a number, once given, never changes (legacy numbers included). A legacy admission
    // without one may get one by hand during reconciliation; everyone else gets it at confirmation.
    if (admission.admissionNumber)
      throw new ConflictError(
        `Admission number ${admission.admissionNumber} is fixed and cannot be changed.`,
      );
    if (admission.legacyVerification !== 'required')
      throw new InvalidStateTransitionError(
        'Admission numbers are given at final confirmation. Only a legacy admission without a number can be given one by hand.',
      );
    await setAdmissionNumber(tx, actor, admission, check.number, 'manual', check.reason, requestId);
    return { id: admission.id, admissionNumber: check.number };
  });
}

// --- identity ----------------------------------------------------------------------------------------

/** Canonical students whose contacts (lead or guardian rows) match this lead's — never merged automatically. */
async function contactCandidates(tx: Database, lead: typeof opsLeads.$inferSelect) {
  const phones = [lead.studentPhone, lead.guardianPhone].filter((v): v is string => Boolean(v));
  const emails = [lead.studentEmail, lead.guardianEmail].filter((v): v is string => Boolean(v));
  const anyIn = (cols: Parameters<typeof inArray>[0][], values: string[]) =>
    values.length ? cols.map((c) => inArray(c, values)) : [];
  const leadMatch = [
    ...anyIn([opsLeads.studentPhone, opsLeads.guardianPhone], phones),
    ...anyIn([opsLeads.studentEmail, opsLeads.guardianEmail], emails),
  ];
  const guardianMatch = [
    ...anyIn([opsGuardians.phone], phones),
    ...anyIn([opsGuardians.email], emails),
  ];
  if (!leadMatch.length) return [];
  const [viaLeads, viaGuardians] = await inOrder([
    tx
      .selectDistinct({ id: opsAdmissions.studentId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(
        and(isNotNull(opsAdmissions.studentId), ne(opsLeads.id, lead.id), or(...leadMatch) as SQL),
      ),
    tx
      .selectDistinct({ id: opsGuardians.studentId })
      .from(opsGuardians)
      .where(or(...guardianMatch) as SQL),
  ]);
  return [...new Set([...viaLeads, ...viaGuardians].map((r) => r.id as StudentIdentityId))];
}

async function identityNames(db: Database, ids: readonly string[]) {
  if (!ids.length) return [];
  return db
    .select({ id: students.id, fullName: students.fullName })
    .from(students)
    .where(inArray(students.id, ids as StudentIdentityId[]));
}

/**
 * The canonical student for a lead (conversion and direct admission): the same enquiry's student
 * is reused; a contact match needs a person's decision (409 IDENTITY_REVIEW); else a new one.
 */
export async function resolveStudent(
  tx: Database,
  admissionId: AdmissionId,
  lead: typeof opsLeads.$inferSelect,
  input: { existingStudentIdentityId?: string | null; createNewStudent?: boolean },
) {
  const sameLead = await sameLeadIdentity(tx, lead.id);
  const decision = decideIdentity({
    sameLeadIdentityId: sameLead,
    contactCandidateIds: sameLead ? [] : await contactCandidates(tx, lead),
    chosenId: input.existingStudentIdentityId,
    createNew: input.createNewStudent,
  });
  if (decision.kind === 'invalid') throw fieldError('existingStudentIdentityId', decision.message);
  if (decision.kind === 'review')
    throw new ConflictError(
      'Possible existing student found with the same phone or email. Choose the matching student or confirm this is a new student; records are never merged automatically.',
      {
        details: {
          code: 'IDENTITY_REVIEW',
          candidates: await identityNames(tx, decision.candidateIds),
        },
      },
    );
  if (decision.kind === 'link')
    return { studentId: decision.studentId as StudentIdentityId, identity: decision.why };
  // One identity path (pipeline.ensureStudentIdentity): never linked by contact.
  const created = await ensureStudentIdentity(tx, admissionId);
  return { studentId: created.studentId, identity: created.identity };
}

const CONVERTIBLE: readonly AdmissionStatus[] = [
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
];

/** GET /demos/{id}/convert — everything the wizard shows before converting (nothing is written). */
export async function previewConversion(db: Database, actor: Actor, demoId: string) {
  const access = await accessScope(db, actor, 'ops:admissions:convert');
  const found = await rowById(db, opsDemos, demoId, 'Demo');
  const admission = await admissionRow(db, found.admissionId);
  await assertAdmissionAccess(db, access, admission); // before Academic is asked
  const { demo, checklist } = await demoWithChecklist(db, demoId);
  const [[lead], sameLead, settings, programmeRows] = await Promise.all([
    db.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId)),
    sameLeadIdentity(db, admission.leadId),
    loadSettings(db),
    db
      .select({
        id: programmes.id,
        code: programmes.code,
        name: programmes.name,
        status: programmes.status,
      })
      .from(programmes)
      .where(ne(programmes.status, 'retired'))
      .orderBy(asc(programmes.code)),
  ]);
  const [sameLeadNames, candidates] = await Promise.all([
    identityNames(db, sameLead ? [sameLead] : []),
    sameLead ? [] : contactCandidates(db, lead!).then((ids) => identityNames(db, ids)),
  ]);
  const privateVisible = can(actor, 'ops:student_private:read');
  const contact = (v: string | null, phone: boolean) =>
    !v ? null : privateVisible ? v : phone ? maskPhone(v) : 'Restricted';
  return {
    demo: {
      id: demo.id,
      outcome: demo.outcome,
      isSample: lead!.isSample,
      programmeId: demo.programmeId,
      convertedAdmissionId: demo.convertedAdmissionId,
    },
    admission: {
      id: admission.id,
      code: admission.code,
      status: admission.status,
      convertible: demo.outcome === 'open' && CONVERTIBLE.includes(admission.status),
    },
    student: {
      leadId: lead!.id,
      fullName: lead!.studentName,
      studentPhone: contact(lead!.studentPhone, true),
      studentEmail: contact(lead!.studentEmail, false),
      guardianName: privateVisible ? lead!.guardianName : lead!.guardianName ? 'Restricted' : null,
      guardianPhone: contact(lead!.guardianPhone, true),
    },
    identity: { sameLead: sameLeadNames[0] ?? null, candidates },
    checklist,
    checklistRequired: settings['admissions.demo.checklist_required'],
    programmes: programmeRows,
    allowedCombinations: ALLOWED_PROGRAMME_COMBINATIONS,
  };
}

// --- conversion ------------------------------------------------------------------------------------------

/** POST /demos/{id}/convert → the application draft (version 1); no number, nobody admitted. */
export async function convertDemo(
  db: Database,
  actor: Actor,
  demoId: string,
  input: ConvertInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:convert');
  if (!isAllowedCombination(input.programmeCodes))
    throw fieldError(
      'programmeCodes',
      'This programme combination is not offered. Choose Class 11 or Class 12 alone, an entrance programme alone (CLAT), or one class with one entrance programme.',
    );
  if (input.admissionNumber)
    throw fieldError(
      'admissionNumber',
      'Admission numbers are given only at final confirmation, never at conversion.',
    );
  if (input.requestEnrolment)
    throw fieldError(
      'requestEnrolment',
      'Enrolment is requested when the admission is confirmed, not at conversion.',
    );
  const settings = await loadSettings(db);
  const found = await rowById(db, opsDemos, demoId, 'Demo');
  await assertAdmissionAccess(db, access, await admissionRow(db, found.admissionId));
  // Academic's marks are read before the transaction: no network call while rows are locked.
  const marks = await marksForDemo(db, demoId);
  return withTransaction(db, async (tx) => {
    const { demo, checklist } = await demoWithChecklist(tx, demoId, true, marks);
    let admission = await lockAccessible(tx, access, demo.admissionId);
    if (demo.outcome !== 'open')
      throw new ConflictError(
        demo.outcome === 'converted'
          ? `This demo was already converted (admission ${admission.code}).`
          : `This demo is closed (${demo.outcome}) and cannot be converted.`,
        { details: { outcome: demo.outcome, admissionId: demo.convertedAdmissionId } },
      );
    if (!CONVERTIBLE.includes(admission.status))
      throw new InvalidStateTransitionError(
        `An admission that is "${admission.status}" cannot be converted from a demo.`,
      );
    if (
      settings['admissions.demo.checklist_required'].value.requiredBeforeConversion &&
      checklist.done < checklist.total
    )
      throw new ValidationError(
        `The demo checklist must be resolved before conversion (${checklist.label}).`,
      );

    // 1. Canonical student — linked at demo booking (reused as is); otherwise the same lead
    //    links and contact matches need a person's decision.
    const [lead] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
    const { studentId, identity } = admission.studentId
      ? { studentId: admission.studentId, identity: 'linked_at_booking' }
      : await resolveStudent(tx, admission.id, lead!, input);

    // 2. Programmes: the demo's programme leads when chosen; extra ones open their own case.
    const chosen = await tx
      .select({ id: programmes.id, code: programmes.code, status: programmes.status })
      .from(programmes)
      .where(inArray(programmes.code, input.programmeCodes));
    if (chosen.length !== input.programmeCodes.length || chosen.some((p) => p.status === 'retired'))
      throw fieldError('programmeCodes', 'Unknown or retired programme.');
    const primary =
      chosen.find((p) => p.id === (demo.programmeId ?? admission.programmeId)) ?? chosen[0]!;
    const casePatch = {
      deliveryMode: input.deliveryMode,
      intendedStartDate: input.effectiveDate,
      studentId,
    } as const;
    await tx
      .update(opsAdmissions)
      .set({
        ...casePatch,
        programmeId: primary.id,
        intendedBatchId: (input.intendedBatchId ?? null) as BatchId | null,
      })
      .where(eq(opsAdmissions.id, admission.id));
    admission = { ...admission, ...casePatch, programmeId: primary.id };

    // 3. Pipeline: → admission_pending (via demo_attended when needed).
    const step = async (to: AdmissionStatus, reason: string) => {
      admission = await applyTransition(tx, {
        admission,
        to,
        actorUserId: actor.id,
        reason,
        requestId,
        settings,
      });
    };
    if (admission.status === 'demo_scheduled')
      await step('demo_attended', 'Demo attended (conversion)');
    if (admission.status === 'demo_attended')
      await step('admission_pending', 'Converted after the demo');
    const extraAdmissionIds: AdmissionId[] = [];
    for (const p of chosen.filter((c) => c.id !== primary.id)) {
      const extra = await createAdmissionRecord(tx, {
        leadId: lead!.id as LeadId,
        programmeId: p.id,
        counsellorStaffId: admission.counsellorStaffId,
        createdBy: actor.id,
        requestId,
        initial: {
          status: 'admission_pending',
          reason: `Opened by the conversion of demo ${demo.id} together with ${admission.code}`,
        },
        patch: casePatch,
      }).catch((e: unknown) => {
        throw isUniqueViolation(e)
          ? fieldError(
              'programmeCodes',
              'An open admission for one of these programmes already exists.',
            )
          : e;
      });
      extraAdmissionIds.push(extra.id);
    }

    // 4. Discount / exception → core approval (no self-approval).
    let approvalRequested = false;
    if (
      input.discountRequest &&
      !(await findPendingApproval(tx, feeArrangementPolicy, admission.id))
    ) {
      await requestApproval(tx, {
        policy: feeArrangementPolicy,
        subjectId: admission.id,
        requestedBy: actor,
        comment: `Discount / exception requested at conversion: ${input.discountRequest}`,
        requestId,
      });
      approvalRequested = true;
    }

    // 5. Demo outcome, preserved and linked.
    await tx
      .update(opsDemos)
      .set({
        outcome: 'converted',
        outcomeAt: new Date(),
        outcomeBy: actor.id,
        convertedAdmissionId: admission.id,
      })
      .where(and(eq(opsDemos.id, demo.id), eq(opsDemos.outcome, 'open')));

    // 6. The application draft, version 1 (the bundle's extra cases point at it).
    const application = await createApplication(tx, actor, {
      admission,
      studentId,
      origin: 'demo',
      demoId: demo.id,
      bundleAdmissionIds: extraAdmissionIds,
      requestId,
    });

    await opsAudit('admission')(
      tx,
      actor,
      admission.id,
      'admission.converted',
      {
        after: { status: admission.status, studentId, applicationId: application.id },
        metadata: {
          demoId: demo.id,
          identity,
          programmeCodes: input.programmeCodes,
          extraAdmissionIds,
          intendedBatch: input.intendedBatchId ?? 'to_be_assigned',
          feePlanReference: input.feePlanReference ?? null,
          guardianConfirmation: input.guardianConfirmation,
          checklist: checklist.label,
          approvalRequested,
        },
      },
      requestId,
    );
    return {
      id: application.id,
      reference: application.reference,
      admissionId: admission.id,
      status: admission.status,
      studentId,
      demoId: demo.id,
      extraAdmissionIds,
      approvalRequested,
    };
  });
}
