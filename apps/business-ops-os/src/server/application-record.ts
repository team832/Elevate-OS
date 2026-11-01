/**
 * Everything the printed admission record shows besides the application version itself: the
 * section 05 document states, the fee summary and instalment tracker from recorded ledger rows,
 * the fee verifiers and, after confirmation, the approval (owner's paper form, 21 Oct 2026).
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  opsAdmissionApprovals,
  opsAdmissionChecks,
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  opsKycDocuments,
  students,
  type Database,
  type opsApplications,
} from '@elevate/database';
import { istToday } from '../domain';
import {
  documentChecklist,
  feeSummary,
  feeTracker,
  type TrackerRecord,
} from '../domain/admission-form';
import type { ApplicationSnapshot } from '../domain/applications';
import { versionChain, versionRows } from '../domain/fee-plans';
import { acceptedVersions } from '../domain/fee-year';
import { namesOf } from './admissions';
import { inOrder } from './ops-common';
import type { AdmissionRecord } from './pdf/admission-documents';

export async function admissionRecord(
  db: Database,
  app: typeof opsApplications.$inferSelect,
  snapshot: ApplicationSnapshot,
  version: number,
  generatedAt: Date,
): Promise<AdmissionRecord> {
  const planId = snapshot.feeAgreement?.planId;
  const [docs, records, family, checks, [approval], [person]] = await inOrder([
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
    // Every case of the student: a version chain may run across them.
    db
      .select({ r: opsFeeRecords, applicationId: opsAdmissions.applicationId })
      .from(opsFeeRecords)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
      .where(or(eq(opsAdmissions.id, app.admissionId), eq(opsAdmissions.studentId, app.studentId))),
    db.select().from(opsFeePlans).where(eq(opsFeePlans.studentId, app.studentId)),
    db
      .select({ by: opsAdmissionChecks.recordedBy })
      .from(opsAdmissionChecks)
      .where(
        and(
          eq(opsAdmissionChecks.admissionId, app.admissionId),
          eq(opsAdmissionChecks.status, 'done'),
          inArray(opsAdmissionChecks.itemKey, ['fee_verification_1', 'fee_verification_2']),
        ),
      ),
    db.select().from(opsAdmissionApprovals).where(eq(opsAdmissionApprovals.applicationId, app.id)),
    db.select({ isSample: students.isSample }).from(students).where(eq(students.id, app.studentId)),
  ]);
  const names = await namesOf(db, [...checks.map((c) => c.by), approval?.approvedBy ?? null]);
  const agreement = family.find((p) => p.id === planId);
  const { own: instalments, mapped } = agreement
    ? versionRows(
        agreement,
        family,
        await db
          .select()
          .from(opsFeeInstalments)
          .where(
            inArray(
              opsFeeInstalments.planId,
              family.map((p) => p.id),
            ),
          )
          .orderBy(asc(opsFeeInstalments.sequence)),
        records.map(({ r }) => r) as never[],
      )
    : { own: [], mapped: [] };
  // Beside the agreement's rows: the bundle's other rows, and the registration fee (once per student).
  const ledger = [
    ...(mapped as TrackerRecord[]),
    ...records
      .filter(
        ({ r, applicationId }) =>
          !r.planId &&
          (r.admissionId === app.admissionId ||
            applicationId === app.id ||
            r.chargeCategory === 'registration'),
      )
      .map(({ r }) => r as unknown as TrackerRecord),
  ];
  const chain = agreement ? versionChain(agreement, family) : [];
  const inForce = acceptedVersions(family).inForce.find((p) => chain.includes(p));
  return {
    isSample: person?.isSample ?? false,
    reference: app.reference,
    version,
    generatedAt,
    snapshot,
    documents: documentChecklist(docs),
    summary: feeSummary(snapshot, ledger),
    tracker: feeTracker(snapshot, ledger, instalments, istToday(generatedAt)),
    laterVersion: inForce && inForce.id !== planId ? inForce.version : null,
    // Names of the fee verifiers are printed only once the admission is confirmed.
    checkedBy: approval ? checks.map((c) => names.get(c.by) ?? 'Unknown') : [],
    admission: approval
      ? {
          number: approval.admissionNumber,
          date: istToday(approval.approvedAt),
          approvedBy: names.get(approval.approvedBy) ?? null,
        }
      : null,
  };
}
