/**
 * Application state shared by the application services: the live snapshot of what the form
 * would print, version/staleness checks, the confirmation re-check, and the locked status change.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  opsAdmissions,
  opsApplicationForms,
  opsApplications,
  opsApplicationVersions,
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
import { ConflictError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { AdmissionId } from '@elevate/shared-types';
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
  partLabels,
  type ApplicationAction,
  type ApplicationSnapshot,
  type ApplicationStatus,
} from '../domain/applications';
import { EMPTY_FORM_FIELDS, type ApplicationFormFields } from '../domain/admission-form';
import { leadOwnerOf, lockAccessible, readinessOf } from './admissions';
import type { AccessScope, Actor } from './context';
import { inOrder, opsAudit, rowById } from './ops-common';
import type { AdmissionRow } from './pipeline';

export type ApplicationRow = typeof opsApplications.$inferSelect;
const audit = opsAudit('application');
export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

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
export const hashOf = ({ counsellorName: _shown, ...material }: ApplicationSnapshot) =>
  sha256(canonicalJson(material));

export async function versionRow(tx: Database, app: Pick<ApplicationRow, 'id' | 'currentVersion'>) {
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
  const [[signature], docs, paid, leadOwner, readiness, bundle] = await inOrder([
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
    () => leadOwnerOf(tx, admission),
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
    counsellorAssigned: Boolean(admission.counsellorStaffId ?? leadOwner),
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

export async function setStatus(
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
