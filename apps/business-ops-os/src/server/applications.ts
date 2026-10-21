/**
 * Admission applications (owner brief 21 Oct 2026 §6): draft → ready for review → form generated →
 * signatures confirmed → (admission confirmed, server/applications-confirm.ts). Every save that
 * changes what the form prints (KYC, guardians, programmes, fee agreement, declarations) adds an
 * `application_versions` row, sends the application back to draft and invalidates the live
 * signature confirmation. The content is read from its sources (lead KYC, guardians, the bundle's
 * admission cases, the active fee plan, settings) — never typed twice.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsApplicationForms,
  opsApplications,
  opsApplicationVersions,
  opsDemos,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsGuardians,
  opsKycDocuments,
  opsLeads,
  opsSignatureConfirmations,
  programmes,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { AdmissionId, BatchId, StudentIdentityId } from '@elevate/shared-types';
import {
  ADMISSION_STATUS_LABELS,
  EXIT_STATUSES,
  istToday,
  READINESS_GAP_LABELS,
  type AdmissionStatus,
  type ResolvedSettings,
} from '../domain';
import {
  applicationActionBlocked,
  canonicalJson,
  changedParts,
  confirmationGaps,
  informationGaps,
  partLabels,
  requiredSigners,
  statusAfter,
  type ApplicationAction,
  type ApplicationSnapshot,
  type ApplicationStatus,
} from '../domain/applications';
import { EMPTY_FORM_FIELDS, type ApplicationFormFields } from '../domain/admission-form';
import { normalisePhone } from '../domain/contacts';
import { lockAccessible, readinessOf } from './admissions';
import type { SaveApplicationInput } from './applications-schemas';
import { accessScope, type AccessScope, type Actor } from './context';
import { resolveStudent } from './conversion';
import { fieldError, inOrder, opsAudit, rowById } from './ops-common';
import { admissionRecord } from './application-record';
import { admissionFormPdf, FORM_TEMPLATE_VERSION } from './pdf/admission-documents';
import type { AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

type ApplicationRow = typeof opsApplications.$inferSelect;
const audit = opsAudit('application');
export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

// --- content ---------------------------------------------------------------------------------------

/** Closed extra cases (lost, exited) leave the bundle: a material change, so the form is re-signed. */
const CLOSED: AdmissionStatus[] = ['lost', ...EXIT_STATUSES];

/** The bundle: the application's own case first, then its open extra programme cases. */
async function bundleOf(tx: Database, app: Pick<ApplicationRow, 'id' | 'admissionId'>) {
  const rows = await tx
    .select({ a: opsAdmissions, code: programmes.code, name: programmes.name })
    .from(opsAdmissions)
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(
      or(
        eq(opsAdmissions.id, app.admissionId),
        and(eq(opsAdmissions.applicationId, app.id), notInArray(opsAdmissions.status, CLOSED)),
      ),
    )
    .orderBy(asc(opsAdmissions.createdAt));
  return rows.sort(
    (x, y) => Number(y.a.id === app.admissionId) - Number(x.a.id === app.admissionId),
  );
}

/** What the form would print now, from the live sources. */
export async function liveSnapshot(
  tx: Database,
  app: Pick<ApplicationRow, 'id' | 'admissionId' | 'studentId' | 'academicYear'>,
  settings: ResolvedSettings,
  form: ApplicationFormFields = EMPTY_FORM_FIELDS,
): Promise<ApplicationSnapshot> {
  const bundle = await bundleOf(tx, app);
  const primary = bundle[0]!.a;
  const [[lead], [student], guardians, [plan]] = await inOrder([
    tx.select().from(opsLeads).where(eq(opsLeads.id, primary.leadId)),
    tx.select({ fullName: students.fullName }).from(students).where(eq(students.id, app.studentId)),
    tx
      .select()
      .from(opsGuardians)
      .where(and(eq(opsGuardians.studentId, app.studentId), isNull(opsGuardians.archivedAt)))
      .orderBy(desc(opsGuardians.isPrimary), asc(opsGuardians.createdAt)),
    tx
      .select()
      .from(opsFeePlans)
      .where(and(eq(opsFeePlans.admissionId, primary.id), eq(opsFeePlans.status, 'active'))),
  ]);
  const instalments = plan
    ? await tx
        .select()
        .from(opsFeeInstalments)
        .where(eq(opsFeeInstalments.planId, plan.id))
        .orderBy(asc(opsFeeInstalments.sequence))
    : [];
  const l = lead!;
  const counsellorId = primary.counsellorStaffId ?? l.ownerStaffId;
  const [counsellor] = counsellorId
    ? await tx
        .select({ fullName: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, counsellorId))
    : [];
  const declarations = settings['admissions.declarations'];
  return {
    student: {
      fullName: student?.fullName ?? l.studentName,
      preferredName: l.preferredName,
      phone: l.studentPhone,
      email: l.studentEmail,
      dateOfBirth: l.dateOfBirth,
      currentStage: l.currentStage,
      schoolBoard: l.schoolBoard,
      previousSchool: l.previousSchool,
      city: l.city,
      address: l.address,
      emergencyContactName: l.emergencyContactName,
      emergencyContactPhone: l.emergencyContactPhone,
    },
    guardians: guardians.length
      ? guardians.map((g) => ({
          id: g.id,
          fullName: g.fullName,
          relationship: g.relationship,
          phone: g.phone,
          email: g.email,
          address: g.address,
          isPrimary: g.isPrimary,
          isEmergency: g.isEmergency,
        }))
      : l.guardianName
        ? [
            {
              id: null,
              fullName: l.guardianName,
              relationship: l.guardianRelationship,
              phone: l.guardianPhone,
              email: l.guardianEmail,
              address: null,
              isPrimary: true,
              isEmergency: false,
            },
          ]
        : [],
    programmes: bundle.flatMap((b) =>
      b.code ? [{ admissionId: b.a.id, code: b.code, name: b.name ?? b.code }] : [],
    ),
    intendedBatchId: primary.intendedBatchId,
    deliveryMode: primary.deliveryMode,
    startDate: primary.intendedStartDate,
    academicYear: app.academicYear,
    feeAgreement: plan
      ? {
          planId: plan.id,
          version: plan.version,
          label: plan.label,
          totalPaise: plan.totalPaise,
          academicYear: plan.academicYear,
          instalments: instalments.map((i) => ({
            sequence: i.sequence,
            dueDate: i.dueDate,
            amountPaise: i.amountPaise,
          })),
        }
      : null,
    registrationFeePaise: settings['fees.registration'].value.amountPaise,
    // Only owner-approved text counts (brief §6); entered text stays "proposed" until approved.
    declarations:
      declarations.value.text &&
      declarations.value.version &&
      declarations.decisionState === 'approved'
        ? { text: declarations.value.text, version: declarations.value.version }
        : null,
    form,
    counsellorName: counsellor?.fullName ?? null,
  };
}

/** The counsellor is shown, not signed for: reassigning one never makes a signed form stale. */
const hashOf = ({ counsellorName: _shown, ...material }: ApplicationSnapshot) =>
  sha256(canonicalJson(material));

async function versionRow(tx: Database, app: Pick<ApplicationRow, 'id' | 'currentVersion'>) {
  const [row] = await tx
    .select()
    .from(opsApplicationVersions)
    .where(
      and(
        eq(opsApplicationVersions.applicationId, app.id),
        eq(opsApplicationVersions.version, app.currentVersion),
      ),
    );
  return row!;
}

/** The current version and whether the live content still matches it. */
export async function currentState(
  tx: Database,
  app: ApplicationRow,
  settings: ResolvedSettings,
  /** The application's own answers to compare with: the saved ones unless a save changes them. */
  form?: ApplicationFormFields,
) {
  const current = await versionRow(tx, app);
  const saved = current.snapshot as unknown as ApplicationSnapshot;
  const live = await liveSnapshot(tx, app, settings, form ?? saved.form ?? EMPTY_FORM_FIELDS);
  return {
    live,
    saved,
    current,
    stale: hashOf(live) !== current.contentHash,
    changed: changedParts(saved, live),
  };
}

/** Gap settings in the shape the domain takes. */
export const gapSettings = (s: ResolvedSettings) => ({
  studentFields: s['admissions.kyc.required_fields'].value.student,
  guardianFields: s['admissions.kyc.required_fields'].value.guardian,
  signerRule: s['admissions.signatures.required_signers'].value,
  mandatoryDocuments: s['admissions.kyc.id_document_types'].value.mandatory,
  paymentRule: s['admission.payment_gate'].value.rule,
});

/** Money received (not voided, net of refunds) per charge category for the bundle's primary case. */
async function paidOf(tx: Database, admissionId: AdmissionId) {
  const rows = await tx
    .select({
      category: opsFeeRecords.chargeCategory,
      net: sql<string>`coalesce(sum(case ${opsFeeRecords.kind} when 'received' then ${opsFeeRecords.amountPaise} when 'refund' then -${opsFeeRecords.amountPaise} else 0 end), 0)`,
    })
    .from(opsFeeRecords)
    .where(
      and(eq(opsFeeRecords.admissionId, admissionId), sql`${opsFeeRecords.status} <> 'voided'`),
    )
    .groupBy(opsFeeRecords.chargeCategory);
  const net = (c: string) => Number(rows.find((r) => r.category === c)?.net ?? 0);
  return { registrationPaise: net('registration'), tuitionPaise: net('tuition') };
}

/** Everything final confirmation re-checks, except the password (shared by the preview and confirm). */
export async function confirmationCheck(
  tx: Database,
  app: ApplicationRow,
  admission: AdmissionRow,
  settings: ResolvedSettings,
) {
  const state = await currentState(tx, app, settings);
  const [[signature], docs, paid, [lead], readiness, bundle] = await inOrder([
    tx
      .select({ s: opsSignatureConfirmations, formVersion: opsApplicationForms.version })
      .from(opsSignatureConfirmations)
      .innerJoin(opsApplicationForms, eq(opsApplicationForms.id, opsSignatureConfirmations.formId))
      .where(
        and(
          eq(opsSignatureConfirmations.applicationId, app.id),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      ),
    tx
      .select({ type: opsKycDocuments.documentType })
      .from(opsKycDocuments)
      .where(
        and(
          eq(opsKycDocuments.studentId, app.studentId),
          eq(opsKycDocuments.subjectType, 'student'),
          eq(opsKycDocuments.verificationStatus, 'verified'),
          isNull(opsKycDocuments.supersededAt),
        ),
      ),
    () => paidOf(tx, admission.id),
    tx
      .select({ owner: opsLeads.ownerStaffId })
      .from(opsLeads)
      .where(eq(opsLeads.id, admission.leadId)),
    () => readinessOf(tx, admission),
    () => bundleOf(tx, app),
  ]);
  const declarations = settings['admissions.declarations'];
  const gaps = confirmationGaps({
    snapshot: state.live,
    settings: gapSettings(settings),
    declarationsProposed:
      Boolean(declarations.value.text) && declarations.decisionState !== 'approved',
    currentVersion: app.currentVersion,
    signature: signature
      ? { ...signature.s, formVersion: signature.formVersion, signers: signature.s.signers }
      : null,
    verifiedDocuments: docs.map((d) => d.type),
    paid,
    counsellorAssigned: Boolean(admission.counsellorStaffId ?? lead?.owner),
    today: istToday(new Date()),
  });
  // BR-OPS-7 (approved): two fee verifications by different people; BR-OPS-6: documents item.
  // The approval itself is already required by the active fee plan.
  for (const g of readiness.gaps)
    if (g !== 'final_confirmation' && g !== 'fee_arrangement_approval')
      gaps.push({
        task:
          g === 'documents_verified'
            ? 'documents'
            : g === 'programme_missing'
              ? 'details'
              : 'fee_agreement',
        message: READINESS_GAP_LABELS[g],
      });
  for (const b of bundle)
    if (b.a.status !== 'admission_pending')
      gaps.push({
        task: 'details',
        message: `Programme case ${b.a.code} (${b.code ?? 'no programme'}) is "${ADMISSION_STATUS_LABELS[b.a.status]}": only pending cases can be admitted. Resume it, or close it and save the application.`,
      });
  if (state.stale)
    gaps.unshift({
      task: 'details',
      message: `Details changed since version ${app.currentVersion} (${partLabels(state.changed)}). Save to create a new version, then generate and sign the new form.`,
    });
  return { ...state, gaps, signature: signature?.s ?? null, paid };
}

// --- create ------------------------------------------------------------------------------------------

/**
 * A new application with version 1 (conversion, direct admission, readmission). Runs in the
 * caller's transaction on a locked admission case; `bundleAdmissionIds` = the extra programme
 * cases opened with it. Reference APP-nnnnnn mirrors the case code (one application per case).
 */
export async function createApplication(
  tx: Database,
  actor: Actor,
  input: {
    admission: AdmissionRow;
    studentId: StudentIdentityId;
    origin: 'demo' | 'direct' | 'readmission';
    demoId?: string | null;
    previousAdmissionId?: string | null;
    academicYear?: string | null;
    bundleAdmissionIds?: readonly AdmissionId[];
    requestId?: string;
  },
) {
  const [app] = await tx
    .insert(opsApplications)
    .values({
      reference: `APP-${input.admission.code.slice(4)}`,
      studentId: input.studentId,
      admissionId: input.admission.id,
      origin: input.origin,
      demoId: (input.demoId ?? null) as never,
      previousAdmissionId: (input.previousAdmissionId ?? null) as AdmissionId | null,
      academicYear: input.academicYear ?? null,
      createdBy: actor.id,
    })
    .returning()
    .catch((e: unknown) => {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err?.code === '23505' || err?.cause?.code === '23505')
        throw new ConflictError('This admission case already has an application.');
      throw e;
    });
  // Every case of the application (its own and the bundle's) points at it.
  await tx
    .update(opsAdmissions)
    .set({ applicationId: app!.id })
    .where(inArray(opsAdmissions.id, [input.admission.id, ...(input.bundleAdmissionIds ?? [])]));
  const snapshot = await liveSnapshot(tx, app!, await loadSettings(tx));
  await tx.insert(opsApplicationVersions).values({
    applicationId: app!.id,
    version: 1,
    snapshot: snapshot as never,
    contentHash: hashOf(snapshot),
    createdBy: actor.id,
  });
  await audit(
    tx,
    actor,
    app!.id,
    'application.created',
    {
      after: { reference: app!.reference, status: app!.status, version: 1 },
      metadata: {
        admissionId: input.admission.id,
        origin: input.origin,
        demoId: input.demoId ?? null,
      },
    },
    input.requestId,
  );
  return app!;
}

/** POST /applications — "New direct admission": the same application and confirmation gate as a demo. */
export async function startDirectApplication(
  db: Database,
  actor: Actor,
  input: {
    admissionId: string;
    academicYear?: string | null;
    existingStudentIdentityId?: string | null;
    createNewStudent?: boolean;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, input.admissionId);
    if (admission.status !== 'admission_pending')
      throw new InvalidStateTransitionError(
        'Move the case to "Admission pending" first (with a reason when the demo is skipped).',
      );
    if (
      await tx.$count(
        opsDemos,
        and(eq(opsDemos.admissionId, admission.id), eq(opsDemos.outcome, 'open')),
      )
    )
      throw new ConflictError(
        'This case has an open demo: use "Convert to admission" on the demo.',
      );
    if (admission.applicationId)
      throw new ConflictError('This case is part of another application’s programme bundle.');
    const [lead] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
    const { studentId } = admission.studentId
      ? { studentId: admission.studentId }
      : await resolveStudent(tx, admission.id, lead!, input);
    if (!admission.studentId)
      await tx.update(opsAdmissions).set({ studentId }).where(eq(opsAdmissions.id, admission.id));
    return createApplication(tx, actor, {
      admission: { ...admission, studentId },
      studentId,
      origin: 'direct',
      academicYear: input.academicYear,
      requestId,
    });
  });
}

// --- write helpers -------------------------------------------------------------------------------

/** Lock the application and its case (scope checked), refuse when `action` is not allowed now. */
export async function lockApplication(
  tx: Database,
  access: AccessScope,
  id: string,
  action: ApplicationAction,
  expectedVersion?: number,
) {
  const app = await rowById(tx, opsApplications, id, 'Application', true);
  const admission = await lockAccessible(tx, access, app.admissionId);
  const blocked = applicationActionBlocked(app.status, action);
  if (blocked) throw new InvalidStateTransitionError(blocked);
  if (expectedVersion !== undefined && expectedVersion !== app.currentVersion)
    throw new ConflictError(
      `The application is now at version ${app.currentVersion} (you had version ${expectedVersion}). Reload and review it again.`,
      { details: { code: 'STALE_VERSION', currentVersion: app.currentVersion } },
    );
  return { app, admission };
}

async function setStatus(
  tx: Database,
  actor: Actor,
  app: ApplicationRow,
  status: ApplicationStatus,
  action: string,
  metadata: Record<string, unknown>,
  requestId?: string,
) {
  const [after] = await tx
    .update(opsApplications)
    .set({ status, updatedAt: new Date() })
    .where(eq(opsApplications.id, app.id))
    .returning();
  await audit(
    tx,
    actor,
    app.id,
    action,
    {
      before: { status: app.status },
      after: { status },
      metadata: { version: app.currentVersion, ...metadata },
    },
    requestId,
  );
  return after!;
}

const STUDENT_COLUMNS = {
  preferredName: opsLeads.preferredName,
  dateOfBirth: opsLeads.dateOfBirth,
  currentStage: opsLeads.currentStage,
  schoolBoard: opsLeads.schoolBoard,
  previousSchool: opsLeads.previousSchool,
  city: opsLeads.city,
  address: opsLeads.address,
  emergencyContactName: opsLeads.emergencyContactName,
  emergencyContactPhone: opsLeads.emergencyContactPhone,
} as const;

/**
 * PATCH /applications/{id} — save the fields the application owns (student KYC on the lead,
 * start date, mode, batch, academic year) and re-read the rest. A material change → version + 1,
 * back to draft, live signature confirmation invalidated. No change → nothing written.
 */
export async function saveApplication(
  db: Database,
  actor: Actor,
  id: string,
  input: SaveApplicationInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  if (
    !can(actor, 'ops:student_private:read') &&
    (input.student || input.form || input.resultPublicityConsent !== undefined)
  )
    throw new ForbiddenError(
      'Editing student KYC, paper-form answers or consent needs permission ops:student_private:read.',
    );
  const settings = await loadSettings(db);
  const student = { ...input.student };
  const paper = { ...input.form };
  for (const [target, path] of [
    [student, 'student.emergencyContactPhone'],
    [paper, 'form.whatsapp'],
    [paper, 'form.guardianAlternateContact'],
  ] as const) {
    const key = path.split('.')[1] as keyof typeof target;
    const raw = target[key] as string | null | undefined;
    if (!raw) continue;
    const phone = normalisePhone(raw);
    if (!phone.ok) throw fieldError(path, 'Enter a valid phone number.');
    (target as Record<string, unknown>)[key] = phone.e164;
  }
  return withTransaction(db, async (tx) => {
    const { app, admission } = await lockApplication(tx, access, id, 'save', input.version);
    const leadPatch = Object.fromEntries(
      Object.entries(student)
        .filter(([k, v]) => v !== undefined && k in STUDENT_COLUMNS)
        .map(([k, v]) => [k, v || null]),
    );
    if (Object.keys(leadPatch).length) {
      const [before] = await tx.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
      await tx.update(opsLeads).set(leadPatch).where(eq(opsLeads.id, admission.leadId));
      await opsAudit('lead')(
        tx,
        actor,
        admission.leadId,
        'lead.kyc_updated',
        {
          before: Object.fromEntries(
            Object.keys(leadPatch).map((k) => [k, before?.[k as keyof typeof before] ?? null]),
          ),
          after: leadPatch,
          metadata: { applicationId: app.id },
        },
        requestId,
      );
    }
    const casePatch: Partial<typeof opsAdmissions.$inferInsert> = {};
    if (input.intendedStartDate !== undefined)
      casePatch.intendedStartDate = input.intendedStartDate;
    if (input.deliveryMode !== undefined) casePatch.deliveryMode = input.deliveryMode;
    if (input.intendedBatchId !== undefined)
      casePatch.intendedBatchId = (input.intendedBatchId ?? null) as BatchId | null;
    if (Object.keys(casePatch).length)
      await tx.update(opsAdmissions).set(casePatch).where(eq(opsAdmissions.id, admission.id));
    let row = app;
    if (input.academicYear !== undefined)
      [row] = (await tx
        .update(opsApplications)
        .set({ academicYear: input.academicYear ?? null })
        .where(eq(opsApplications.id, app.id))
        .returning()) as [ApplicationRow];
    const saved = (await versionRow(tx, row)).snapshot as unknown as ApplicationSnapshot;
    const form = { ...EMPTY_FORM_FIELDS, ...saved.form, ...paper };
    const consent = form.resultPublicityConsent;
    if (
      input.resultPublicityConsent !== undefined &&
      input.resultPublicityConsent !== (consent?.given ?? false)
    )
      form.resultPublicityConsent = {
        given: input.resultPublicityConsent,
        recordedBy: actor.id,
        recordedAt: new Date().toISOString(),
      };
    const { live, stale, changed } = await currentState(tx, row, settings, form);
    if (!stale) return { id: app.id, version: app.currentVersion, status: app.status, changed: [] };
    const version = app.currentVersion + 1;
    await tx.insert(opsApplicationVersions).values({
      applicationId: app.id,
      version,
      snapshot: live as never,
      contentHash: hashOf(live),
      createdBy: actor.id,
    });
    const status = statusAfter(app.status, 'save');
    await tx
      .update(opsApplications)
      .set({ currentVersion: version, status, updatedAt: new Date() })
      .where(eq(opsApplications.id, app.id));
    const invalidated = await tx
      .update(opsSignatureConfirmations)
      .set({
        invalidatedAt: new Date(),
        invalidatedBy: actor.id,
        invalidatedReason: `Material change in version ${version}: ${changed.join(', ')}`,
      })
      .where(
        and(
          eq(opsSignatureConfirmations.applicationId, app.id),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      )
      .returning({ id: opsSignatureConfirmations.id });
    await audit(
      tx,
      actor,
      app.id,
      'application.version_created',
      {
        before: { version: app.currentVersion, status: app.status },
        after: { version, status },
        metadata: { changed, signaturesInvalidated: invalidated.length },
      },
      requestId,
    );
    return { id: app.id, version, status, changed };
  });
}

/** POST /applications/{id}/ready — the reviewed version is complete (declarations come at confirmation). */
export async function markReady(
  db: Database,
  actor: Actor,
  id: string,
  input: { version: number },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app, admission } = await lockApplication(tx, access, id, 'mark_ready', input.version);
    const { live, stale, changed } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        `Details changed since version ${app.currentVersion} (${changed.join(', ')}). Save the application, then review the new version.`,
      );
    const [lead] = await tx
      .select({ owner: opsLeads.ownerStaffId })
      .from(opsLeads)
      .where(eq(opsLeads.id, admission.leadId));
    const gaps = informationGaps(live, gapSettings(settings), {
      counsellorAssigned: Boolean(admission.counsellorStaffId ?? lead?.owner),
      today: istToday(new Date()),
    }).map((g) => g.message);
    if (gaps.length)
      throw new InvalidStateTransitionError('The application is not complete yet.', {
        details: { missing: gaps },
      });
    return setStatus(tx, actor, app, 'ready_for_review', 'application.ready', {}, requestId);
  });
}

/**
 * POST /applications/{id}/form — generate the admission-form PDF of the current version, store
 * its record (version, template version, SHA-256) and return the PDF. Before signatures are
 * confirmed it is marked "Application — admission pending"; it carries the application
 * reference, never an admission number. The form shows KYC, so it needs ops:student_private:read.
 */
export async function generateForm(db: Database, actor: Actor, id: string, requestId?: string) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  await accessScope(db, actor, 'ops:student_private:read');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'generate_form');
    const { saved, stale, changed } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        `Details changed since version ${app.currentVersion} (${changed.join(', ')}). Save the application before printing the form.`,
      );
    const generatedAt = new Date();
    const bytes = await admissionFormPdf(
      await admissionRecord(tx, app, saved, app.currentVersion, generatedAt),
    );
    const [form] = await tx
      .insert(opsApplicationForms)
      .values({
        applicationId: app.id,
        version: app.currentVersion,
        templateVersion: FORM_TEMPLATE_VERSION,
        pdfSha256: sha256(bytes),
        generatedBy: actor.id,
        generatedAt,
      })
      .returning();
    await setStatus(
      tx,
      actor,
      app,
      statusAfter(app.status, 'generate_form'),
      'application.form_generated',
      { formId: form!.id, pdfSha256: form!.pdfSha256, templateVersion: FORM_TEMPLATE_VERSION },
      requestId,
    );
    return { bytes, filename: `admission-form-${app.reference}-v${app.currentVersion}.pdf` };
  });
}

/**
 * POST /applications/{id}/signatures — a staff member confirms that the required people signed
 * the printed form of the CURRENT version (signers per setting, by age on the signing day).
 */
export async function confirmSignatures(
  db: Database,
  actor: Actor,
  id: string,
  input: {
    version: number;
    formId: string;
    signedOn: string;
    studentSigned: boolean;
    guardianSigned: boolean;
  },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  const settings = await loadSettings(db);
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'confirm_signatures', input.version);
    const [form] = await tx
      .select()
      .from(opsApplicationForms)
      .where(
        and(
          eq(opsApplicationForms.id, input.formId as never),
          eq(opsApplicationForms.applicationId, app.id),
        ),
      );
    if (!form) throw fieldError('formId', 'Unknown form for this application.');
    if (form.version !== app.currentVersion)
      throw fieldError(
        'formId',
        `That form shows version ${form.version}; print and sign version ${app.currentVersion}.`,
      );
    const today = istToday(new Date());
    if (input.signedOn > today)
      throw fieldError('signedOn', 'The signing day cannot be in the future.');
    if (input.signedOn < istToday(form.generatedAt))
      throw fieldError('signedOn', 'The form was printed after that day.');
    const { saved, stale } = await currentState(tx, app, settings);
    if (stale)
      throw new ConflictError(
        'Details changed since this form was printed. Save the application and print the new version.',
      );
    const need = requiredSigners(
      settings['admissions.signatures.required_signers'].value,
      saved.student.dateOfBirth,
      input.signedOn as never,
    );
    const guardian = saved.guardians.find((g) => g.isPrimary) ?? saved.guardians[0];
    if (need.student && !input.studentSigned)
      throw fieldError('studentSigned', 'The student must sign the form.');
    if (need.guardian && !input.guardianSigned)
      throw fieldError(
        'guardianSigned',
        'A guardian must sign the form (student under 18 or date of birth not recorded).',
      );
    if (input.guardianSigned && !guardian)
      throw fieldError('guardianSigned', 'No guardian is recorded on this version.');
    const signers = [
      ...(input.studentSigned ? [{ role: 'student' as const, name: saved.student.fullName }] : []),
      ...(input.guardianSigned && guardian
        ? [
            {
              role: 'guardian' as const,
              name: guardian.fullName,
              ...(guardian.id ? { guardianId: guardian.id } : {}),
            },
          ]
        : []),
    ];
    if (!signers.length) throw fieldError('studentSigned', 'Record who signed the form.');
    const [row] = await tx
      .insert(opsSignatureConfirmations)
      .values({
        applicationId: app.id,
        version: app.currentVersion,
        formId: form.id,
        signers,
        signedOn: input.signedOn,
        confirmedBy: actor.id,
      })
      .returning();
    await setStatus(
      tx,
      actor,
      app,
      'signatures_confirmed',
      'application.signatures_confirmed',
      { formId: form.id, signers: signers.map((s) => s.role), signedOn: input.signedOn },
      requestId,
    );
    return row!;
  });
}

/** POST /applications/{id}/withdraw — the family does not go ahead (history kept). */
export async function withdrawApplication(
  db: Database,
  actor: Actor,
  id: string,
  input: { reason: string },
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:admissions:write');
  return withTransaction(db, async (tx) => {
    const { app } = await lockApplication(tx, access, id, 'withdraw');
    return setStatus(
      tx,
      actor,
      app,
      'withdrawn',
      'application.withdrawn',
      { reason: input.reason },
      requestId,
    );
  });
}
