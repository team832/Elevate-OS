/**
 * Admission applications — reads (owner brief §4, §6): the list, one application with its history
 * and what still blocks confirmation, and the application of an admission case. KYC is served
 * only with ops:student_private:read, the fee agreement only with ops:fees:read (acceptance 21).
 */
import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplicationForms,
  opsApplications,
  opsApplicationVersions,
  opsKycDocuments,
  opsLeads,
  opsSignatureConfirmations,
  programmes,
  students,
  type Database,
  type OpsApplicationId,
} from '@elevate/database';
import type { z } from 'zod';
import { documentChecklist } from '../domain/admission-form';
import {
  APPLICATION_STATUS_LABELS,
  changedParts,
  confirmationTasks,
  type ApplicationSnapshot,
  type ApplicationStatus,
} from '../domain/applications';
import { admissionRow, assertAdmissionAccess, namesOf, ownAdmissionFilter } from './admissions';
import { confirmationCheck } from './applications';
import type { applicationListQuery } from './applications-schemas';
import { accessScope, type Actor } from './context';
import { rowById } from './ops-common';
import type { AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

const PAGE_SIZE = 25;
const SORTS = {
  updated: [desc(opsApplications.updatedAt)],
  oldest: [asc(opsApplications.createdAt)],
  name: [asc(students.fullName)],
} as const;

/** GET /applications — search (name or reference), status, sort, 25 per page; own scope via the case. */
export async function listApplications(
  db: Database,
  actor: Actor,
  query: z.output<typeof applicationListQuery>,
) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const q = query.q?.trim();
  // Programme of the application's own case (as the Admissions overview counts it).
  const scope = and(
    ownAdmissionFilter(access),
    query.programme ? eq(programmes.code, query.programme) : undefined,
  );
  const where = and(
    scope,
    query.status ? eq(opsApplications.status, query.status) : undefined,
    q
      ? or(ilike(students.fullName, `%${q}%`), ilike(opsApplications.reference, `%${q}%`))
      : undefined,
  );
  const base = () =>
    db
      .select({
        id: opsApplications.id,
        reference: opsApplications.reference,
        status: opsApplications.status,
        origin: opsApplications.origin,
        version: opsApplications.currentVersion,
        academicYear: opsApplications.academicYear,
        updatedAt: opsApplications.updatedAt,
        studentName: students.fullName,
        isSample: students.isSample,
        admissionId: opsAdmissions.id,
        admissionNumber: opsAdmissions.admissionNumber,
        programmeCode: programmes.code,
      })
      .from(opsApplications)
      .innerJoin(students, eq(students.id, opsApplications.studentId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId));
  const [rows, [total], counts] = await Promise.all([
    base()
      .where(where)
      .orderBy(...SORTS[query.sort], asc(opsApplications.id))
      .limit(PAGE_SIZE)
      .offset((query.page - 1) * PAGE_SIZE),
    db
      .select({ n: count() })
      .from(opsApplications)
      .innerJoin(students, eq(students.id, opsApplications.studentId))
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .where(where),
    db
      .select({ status: opsApplications.status, n: count() })
      .from(opsApplications)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
      .where(scope)
      .groupBy(opsApplications.status),
  ]);
  return {
    items: rows.map((r) => ({ ...r, statusLabel: APPLICATION_STATUS_LABELS[r.status] })),
    total: total?.n ?? 0,
    page: query.page,
    pageSize: PAGE_SIZE,
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<
      Record<ApplicationStatus, number>
    >,
  };
}

/** Restricted parts of a snapshot: KYC needs ops:student_private:read, the fee agreement ops:fees:read. */
export function visibleSnapshot(actor: Actor, s: ApplicationSnapshot) {
  const kyc = can(actor, 'ops:student_private:read');
  return {
    ...s,
    student: (kyc ? s.student : { fullName: s.student.fullName }) as Partial<
      ApplicationSnapshot['student']
    > & { fullName: string },
    guardians: kyc ? s.guardians : null,
    // The paper-form answers (WhatsApp, occupation, grades, consent …) are private too.
    form: kyc ? s.form : null,
    feeAgreement: can(actor, 'ops:fees:read') ? s.feeAgreement : undefined,
    kycRestricted: !kyc,
  };
}

/** GET /applications/{id} — versions, forms, signatures, approval, and what still blocks confirmation. */
export async function getApplication(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:admissions:read');
  const app = await rowById(db, opsApplications, id as OpsApplicationId, 'Application');
  const admission = await admissionRow(db, app.admissionId);
  await assertAdmissionAccess(db, access, admission);
  const settings = await loadSettings(db);
  const kyc = can(actor, 'ops:student_private:read');
  const [check, versions, forms, signatures, [approval], docs] = await Promise.all([
    confirmationCheck(db, app, admission, settings),
    db
      .select()
      .from(opsApplicationVersions)
      .where(eq(opsApplicationVersions.applicationId, app.id))
      .orderBy(asc(opsApplicationVersions.version)),
    db
      .select()
      .from(opsApplicationForms)
      .where(eq(opsApplicationForms.applicationId, app.id))
      .orderBy(desc(opsApplicationForms.generatedAt)),
    db
      .select()
      .from(opsSignatureConfirmations)
      .where(eq(opsSignatureConfirmations.applicationId, app.id))
      .orderBy(desc(opsSignatureConfirmations.confirmedAt)),
    db.select().from(opsAdmissionApprovals).where(eq(opsAdmissionApprovals.applicationId, app.id)),
    db
      .select({
        documentType: opsKycDocuments.documentType,
        verificationStatus: opsKycDocuments.verificationStatus,
      })
      .from(opsKycDocuments)
      .where(
        and(
          eq(opsKycDocuments.studentId, app.studentId),
          eq(opsKycDocuments.subjectType, 'student'),
          isNull(opsKycDocuments.supersededAt),
        ),
      ),
  ]);
  const names = await namesOf(db, [
    ...versions.map((v) => v.createdBy),
    ...forms.map((f) => f.generatedBy),
    ...signatures.map((s) => s.confirmedBy),
    approval?.approvedBy ?? null,
  ]);
  const snaps = versions.map((v) => v.snapshot as unknown as ApplicationSnapshot);
  const [student] = await db
    .select({ isSample: students.isSample })
    .from(students)
    .where(eq(students.id, app.studentId));
  return {
    application: {
      ...app,
      statusLabel: APPLICATION_STATUS_LABELS[app.status],
      isSample: student?.isSample ?? false,
    },
    admission: {
      id: admission.id,
      leadId: admission.leadId,
      code: admission.code,
      status: admission.status,
      admissionNumber: admission.admissionNumber,
      handoffStatus: admission.handoffStatus,
    },
    snapshot: visibleSnapshot(actor, check.saved),
    stale: check.stale,
    changedSinceSaved: check.changed,
    versions: versions.map((v, i) => ({
      version: v.version,
      createdAt: v.createdAt,
      createdByName: names.get(v.createdBy) ?? null,
      changed: i === 0 ? [] : changedParts(snaps[i - 1]!, snaps[i]!),
    })),
    forms: forms.map((f) => ({ ...f, generatedByName: names.get(f.generatedBy) ?? null })),
    // Signer names are KYC: roles only without ops:student_private:read.
    signatures: signatures.map((s) => ({
      ...s,
      signers: kyc ? s.signers : s.signers.map((x) => ({ role: x.role, name: x.role })),
      confirmedByName: names.get(s.confirmedBy) ?? null,
    })),
    approval: approval
      ? {
          approvedAt: approval.approvedAt,
          approvedByName: names.get(approval.approvedBy) ?? null,
          applicationVersion: approval.applicationVersion,
          admissionNumber: approval.admissionNumber,
          reauthMethod: approval.reauthMethod,
          reauthVerifiedAt: approval.reauthVerifiedAt,
        }
      : null,
    /** Section 05 of the paper form: document types and their recorded state (no references). */
    documents: documentChecklist(docs),
    /** What still blocks final confirmation (empty = only the approver's password is left). */
    confirmationGaps: app.status === 'admission_confirmed' ? [] : check.gaps.map((g) => g.message),
    /** The same gaps as a task list (rendered as is: no gate logic on the client). */
    tasks:
      app.status === 'admission_confirmed'
        ? []
        : confirmationTasks(
            app.status,
            check.gaps,
            forms.some((f) => f.version === app.currentVersion),
          ),
    signerRule: settings['admissions.signatures.required_signers'],
    declarations: settings['admissions.declarations'],
    paymentGate: settings['admission.payment_gate'],
    can: {
      write: can(actor, 'ops:admissions:write'),
      confirm: can(actor, 'ops:admissions:confirm'),
      printForm: can(actor, 'ops:admissions:write') && can(actor, 'ops:student_private:read'),
    },
  };
}

/** Application of an admission case (its own, or the bundle it belongs to); null if none. */
export async function applicationOfAdmission(db: Database, admission: AdmissionRow) {
  const [row] = await db
    .select()
    .from(opsApplications)
    .where(
      admission.applicationId
        ? eq(opsApplications.id, admission.applicationId)
        : eq(opsApplications.admissionId, admission.id),
    );
  return row ?? null;
}
