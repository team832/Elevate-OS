/**
 * What the student and parent portal shows of a student's fees (F4-13): the agreements in force
 * with their instalments, and the payments received. No permission check: the portal calls these
 * only for a student linked to the signed-in login, and checks a payment's student before a receipt.
 */
import { and, desc, eq, ne } from 'drizzle-orm';
import { opsAdmissions, opsFeePlans, opsFeeRecords, type Database } from '@elevate/database';
import type { StudentIdentityId } from '@elevate/shared-types';
import { INSTALMENT_STATUS_LABELS } from '../domain/fee-plans';
import { acceptedVersions } from '../domain/fee-year';
import { plansWithLedger } from './fee-agreements';

export async function portalFees(db: Database, studentId: string, now = new Date()) {
  const sid = studentId as StudentIdentityId;
  const plans = await db.select().from(opsFeePlans).where(eq(opsFeePlans.studentId, sid));
  const positions = await plansWithLedger(db, acceptedVersions(plans).inForce, now);
  const payments = await db
    .select({
      id: opsFeeRecords.id,
      paymentDate: opsFeeRecords.paymentDate,
      amountPaise: opsFeeRecords.amountPaise,
      method: opsFeeRecords.method,
      chargeCategory: opsFeeRecords.chargeCategory,
    })
    .from(opsFeeRecords)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
    .where(
      and(
        eq(opsAdmissions.studentId, sid),
        eq(opsFeeRecords.kind, 'received'),
        ne(opsFeeRecords.status, 'voided'),
      ),
    )
    .orderBy(desc(opsFeeRecords.paymentDate), desc(opsFeeRecords.recordedAt));
  return {
    agreements: positions.map((p) => ({
      id: p.plan.id,
      label: p.plan.label,
      academicYear: p.plan.academicYear,
      status: INSTALMENT_STATUS_LABELS[p.status],
      totals: p.totals,
      instalments: p.instalments.map((i) => ({
        id: i.instalment.id,
        sequence: i.instalment.sequence,
        dueDate: i.instalment.dueDate,
        amountPaise: i.instalment.amountPaise,
        paidPaise: i.paidPaise,
        remainingPaise: i.remainingPaise,
        status: INSTALMENT_STATUS_LABELS[i.status],
      })),
    })),
    payments,
  };
}

/** The student a fee record belongs to (through its admission), or null. */
export async function feeRecordStudentId(db: Database, feeRecordId: string) {
  const [row] = await db
    .select({ studentId: opsAdmissions.studentId })
    .from(opsFeeRecords)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
    .where(eq(opsFeeRecords.id, feeRecordId as never));
  return row?.studentId ?? null;
}
