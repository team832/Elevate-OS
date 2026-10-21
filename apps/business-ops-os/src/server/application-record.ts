/**
 * Everything the printed admission record shows besides the application version itself: the
 * section 05 document states, the fee summary and instalment tracker from recorded ledger rows,
 * the fee verifiers and, after confirmation, the approval (owner's paper form, 21 Oct 2026).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  opsAdmissionApprovals,
  opsAdmissionChecks,
  opsFeeInstalments,
  opsFeeRecords,
  opsKycDocuments,
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
import { namesOf } from './admissions';
import type { AdmissionRecord } from './pdf/admission-documents';

export async function admissionRecord(
  db: Database,
  app: typeof opsApplications.$inferSelect,
  snapshot: ApplicationSnapshot,
  version: number,
  generatedAt: Date,
): Promise<AdmissionRecord> {
  const planId = snapshot.feeAgreement?.planId;
  const [docs, records, instalments, checks, [approval]] = await Promise.all([
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
    db.select().from(opsFeeRecords).where(eq(opsFeeRecords.admissionId, app.admissionId)),
    planId
      ? db
          .select({
            id: opsFeeInstalments.id,
            sequence: opsFeeInstalments.sequence,
            dueDate: opsFeeInstalments.dueDate,
            amountPaise: opsFeeInstalments.amountPaise,
          })
          .from(opsFeeInstalments)
          .where(eq(opsFeeInstalments.planId, planId as never))
          .orderBy(asc(opsFeeInstalments.sequence))
      : [],
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
  ]);
  const names = await namesOf(db, [...checks.map((c) => c.by), approval?.approvedBy ?? null]);
  const ledger = records as unknown as TrackerRecord[];
  return {
    reference: app.reference,
    version,
    generatedAt,
    snapshot,
    documents: documentChecklist(docs),
    summary: feeSummary(snapshot, ledger, instalments),
    tracker: feeTracker(snapshot, ledger, instalments, istToday(generatedAt)),
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
