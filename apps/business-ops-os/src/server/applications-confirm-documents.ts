/**
 * After final confirmation (server/applications-confirm.ts): the acknowledgement and ID card
 * PDFs, and the confirmation facts shown on the admission page.
 */
import { eq } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { opsAdmissionApprovals, opsApplications, type Database } from '@elevate/database';
import { InvalidStateTransitionError } from '@elevate/shared-contracts';
import { ADMISSION_STATUS_LABELS, type AdmissionStatus } from '../domain';
import type { ApplicationSnapshot } from '../domain/applications';
import { isExitStatus } from '../domain/student-lifecycle';
import { deriveHandoffView } from '../domain/students';
import {
  academicDeliveryOf,
  admissionRow,
  assertAdmissionAccess,
  handoffInputOf,
  namesOf,
} from './admissions';
import { applicationOfAdmission } from './applications-read';
import { accessScope, type Actor } from './context';
import { admissionRecord } from './application-record';
import { acknowledgementPdf, idCardPdf } from './pdf/admission-documents';
import { pdfResponse } from './pdf/document';

/** "Admission confirmed — academic setup pending" until Academic OS confirms the enrolment. */
export function academicSetupLabel(status: AdmissionStatus, handoffLabel: string) {
  if (status === 'enrolled') return 'Enrolled — Academic OS confirmed the setup';
  if (isExitStatus(status) || status === 'on_hold')
    return `Admission confirmed — now ${ADMISSION_STATUS_LABELS[status]}`;
  return `Admission confirmed — academic setup pending (${handoffLabel})`;
}

/** The approval of an admission case with its accepted snapshot, scope-checked; 409 before confirmation. */
async function confirmedAdmission(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, admissionId);
  await assertAdmissionAccess(db, access, admission);
  const [approval] = await db
    .select()
    .from(opsAdmissionApprovals)
    .where(eq(opsAdmissionApprovals.admissionId, admission.id));
  if (!approval)
    throw new InvalidStateTransitionError(
      'This admission has no final approval of its own (not confirmed yet, or an extra programme case of a bundle: open the primary admission). No acknowledgement or ID card exists for it.',
    );
  const accepted = approval.acceptedSnapshot as {
    application: ApplicationSnapshot;
    signature: { signedOn: string; signers: { role: string; name: string }[] } | null;
  };
  return { admission, approval, accepted };
}

/** GET /admissions/{id}/acknowledgement — final number + the signed version kept on record. */
export async function acknowledgementDocument(db: Database, actor: Actor, admissionId: string) {
  const { admission, approval, accepted } = await confirmedAdmission(db, actor, admissionId);
  const [delivery, [app]] = await Promise.all([
    academicDeliveryOf(db, admission.lastRequestEventId),
    db.select().from(opsApplications).where(eq(opsApplications.id, approval.applicationId)),
  ]);
  const record = await admissionRecord(
    db,
    app!,
    accepted.application,
    approval.applicationVersion,
    new Date(),
  );
  const bytes = await acknowledgementPdf({
    record: { ...record, admission: record.admission! },
    approvedAt: approval.approvedAt,
    signedOn: accepted.signature?.signedOn ?? null,
    // Signer names are KYC: roles only without ops:student_private:read.
    signers:
      accepted.signature?.signers.map((s) =>
        can(actor, 'ops:student_private:read') ? `${s.name} (${s.role})` : s.role,
      ) ?? [],
    academicSetup: academicSetupLabel(
      admission.status,
      deriveHandoffView(handoffInputOf(admission, delivery)).label,
    ),
    showFees: can(actor, 'ops:fees:read'),
  });
  return pdfResponse(bytes, `admission-acknowledgement-${approval.admissionNumber}.pdf`);
}

/** GET /admissions/{id}/id-card — CR80 card: name, number, programme, academic year. */
export async function idCardDocument(db: Database, actor: Actor, admissionId: string) {
  const { approval, accepted } = await confirmedAdmission(db, actor, admissionId);
  const s = accepted.application;
  const bytes = await idCardPdf({
    fullName: s.student.fullName,
    admissionNumber: approval.admissionNumber,
    programmes: s.programmes.map((p) => p.name).join(' + '),
    academicYear: s.academicYear,
  });
  return pdfResponse(bytes, `id-card-${approval.admissionNumber}.pdf`);
}

/** The confirmation facts shown on the admission page. */
export async function admissionConfirmation(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const admission = await admissionRow(db, admissionId);
  await assertAdmissionAccess(db, access, admission);
  const [application, [approval], delivery] = await Promise.all([
    applicationOfAdmission(db, admission),
    db
      .select()
      .from(opsAdmissionApprovals)
      .where(eq(opsAdmissionApprovals.admissionId, admission.id)),
    academicDeliveryOf(db, admission.lastRequestEventId),
  ]);
  const names = await namesOf(db, [approval?.approvedBy ?? null, admission.legacyVerifiedBy]);
  return {
    application: application && {
      id: application.id,
      reference: application.reference,
      status: application.status,
      version: application.currentVersion,
    },
    approval: approval && {
      admissionNumber: approval.admissionNumber,
      approvedAt: approval.approvedAt,
      approvedByName: names.get(approval.approvedBy) ?? null,
      applicationVersion: approval.applicationVersion,
      reauthMethod: approval.reauthMethod,
      reauthVerifiedAt: approval.reauthVerifiedAt,
    },
    academicSetup:
      approval || application?.status === 'admission_confirmed'
        ? academicSetupLabel(
            admission.status,
            deriveHandoffView(handoffInputOf(admission, delivery)).label,
          )
        : null,
    legacy: admission.legacyVerification && {
      state: admission.legacyVerification,
      verifiedByName: names.get(admission.legacyVerifiedBy ?? '') ?? null,
      verifiedAt: admission.legacyVerifiedAt,
    },
    legacyNumber: approval ? null : admission.admissionNumber,
    /** An extra programme case: its bundle's number (on the primary case), once confirmed. */
    bundleNumber:
      !approval && application && application.admissionId !== admission.id
        ? ((
            await db
              .select({ n: opsAdmissionApprovals.admissionNumber })
              .from(opsAdmissionApprovals)
              .where(eq(opsAdmissionApprovals.applicationId, application.id))
          )[0]?.n ?? null)
        : null,
    canReconcile: can(actor, 'ops:admissions:confirm'),
  };
}
