/**
 * Fee receipts (F4-01): one per payment (`received`, not a reversal), numbered from series
 * `receipt/<financial year>` the first time it is issued (when the payment is recorded, or
 * "Issue receipt" for an older one) and never renumbered. Every print counts: from the second the
 * PDF says "Duplicate"; once the payment is reversed or voided it says "Cancelled" (from the
 * ledger). `receiptFor` and `renderReceiptPdf` check no permission (COMMON-W4 §4): every caller
 * checks it may read the fee record first, as `receiptPdfFor` does.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFeeInstalments,
  opsFeeReceipts,
  opsFeeRecords,
  opsLeads,
  programmes,
  students,
  users,
  type Database,
  type OpsFeePlanId,
  type OpsFeeRecordId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, NotFoundError } from '@elevate/shared-contracts';
import { istToday } from '../domain';
import { documentNumber, financialYearOf } from '../domain/documents';
import { effectiveRecords, FEE_CHARGE_LABELS, type FeeRecordLike } from '../domain/fees';
import { fmtDate, humanise } from '../ui/format';
import { admissionRow, assertAdmissionAccess } from './admissions-lookups';
import { accessScope, type Actor } from './context';
import { takeNumber } from './document-numbers';
import { feeStatementFor } from './fee-statement';
import { opsAudit, rowById } from './ops-common';
import { receiptPdf, type ReceiptSize } from './pdf/receipt';
import { loadSettings } from './settings';

type FeeRow = typeof opsFeeRecords.$inferSelect;
export type Receipt = typeof opsFeeReceipts.$inferSelect;

export const receiptFor = async (db: Database, feeRecordId: string): Promise<Receipt | null> =>
  (
    await db
      .select()
      .from(opsFeeReceipts)
      .where(eq(opsFeeReceipts.feeRecordId, feeRecordId as OpsFeeRecordId))
  )[0] ?? null;

/** Receipts of these fee records by fee record id: one query for a ledger table. */
export async function receiptsOf(db: Database, feeRecordIds: readonly string[]) {
  const rows = feeRecordIds.length
    ? await db
        .select()
        .from(opsFeeReceipts)
        .where(inArray(opsFeeReceipts.feeRecordId, feeRecordIds as OpsFeeRecordId[]))
    : [];
  return new Map<string, Receipt>(rows.map((r) => [r.feeRecordId, r]));
}

/**
 * The payment's receipt inside the caller's transaction (fee-ledger.ts calls it as the payment is
 * recorded): the existing one, or a new number from the locked counter.
 */
export async function issueReceiptInTx(
  tx: Database,
  actor: Actor,
  fee: FeeRow,
  now = new Date(),
  requestId?: string,
) {
  const existing = await receiptFor(tx, fee.id);
  if (existing) return { receipt: existing, created: false };
  const { numberPrefix, yearFrom } = (await loadSettings(tx))['fees.receipts'].value;
  const year = financialYearOf(
    yearFrom === 'payment_date' && fee.paymentDate ? fee.paymentDate : istToday(now),
  );
  const [lead] = await tx
    .select({ isSample: opsLeads.isSample })
    .from(opsLeads)
    .where(eq(opsLeads.id, fee.leadId));
  const { n, sequence, mark } = await takeNumber(tx, `receipt/${year}`, lead?.isSample);
  const [receipt] = await tx
    .insert(opsFeeReceipts)
    .values({
      feeRecordId: fee.id,
      receiptNumber: mark + documentNumber([numberPrefix, year], n, 6),
      financialYear: year,
      sequence,
      issuedAt: now,
      issuedBy: actor.id,
    })
    .returning();
  await opsAudit('fee_receipt')(
    tx,
    actor,
    receipt!.id,
    'fee_receipt.issued',
    { after: receipt, metadata: { feeRecordId: fee.id } },
    requestId,
  );
  return { receipt: receipt!, created: true };
}

/** Reversed (a live reversal names it) or voided: its receipt prints "Cancelled". */
async function cancelled(db: Database, fee: FeeRow) {
  const rows = await db
    .select()
    .from(opsFeeRecords)
    .where(eq(opsFeeRecords.admissionId, fee.admissionId));
  return !effectiveRecords(rows as (FeeRow & FeeRecordLike)[]).some((r) => r.id === fee.id);
}

/** "Issue receipt" for a payment recorded before receipts existed (ops:fees:record, own scope). */
export async function issueReceipt(
  db: Database,
  actor: Actor,
  feeRecordId: string,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  return withTransaction(db, async (tx) => {
    const fee = await rowById(tx, opsFeeRecords, feeRecordId, 'Fee record', true);
    await assertAdmissionAccess(tx, access, await admissionRow(tx, fee.admissionId));
    if (fee.kind !== 'received' || fee.reversesRecordId)
      throw new InvalidStateTransitionError('Only a payment gets a receipt.');
    if (await cancelled(tx, fee))
      throw new InvalidStateTransitionError(
        'This payment was reversed or voided: no receipt is issued.',
      );
    return issueReceiptInTx(tx, actor, fee, new Date(), requestId);
  });
}

/** Everything the receipt prints, from the stored rows. */
async function receiptDocument(db: Database, receipt: Receipt) {
  const fee = await rowById(db, opsFeeRecords, receipt.feeRecordId, 'Fee record');
  const [c] = await db
    .select({
      a: opsAdmissions,
      leadName: opsLeads.studentName,
      isSample: opsLeads.isSample,
      student: students.fullName,
      programme: programmes.name,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(students, eq(students.id, opsAdmissions.studentId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(eq(opsAdmissions.id, fee.admissionId));
  const instalments = fee.planId
    ? await db
        .select({
          id: opsFeeInstalments.id,
          sequence: opsFeeInstalments.sequence,
          dueDate: opsFeeInstalments.dueDate,
        })
        .from(opsFeeInstalments)
        .where(eq(opsFeeInstalments.planId, fee.planId as OpsFeePlanId))
    : [];
  const instalment = instalments.find((i) => i.id === fee.instalmentId);
  const [recorder] = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, fee.recordedBy));
  return {
    number: receipt.receiptNumber,
    issuedAt: receipt.issuedAt,
    duplicate: receipt.printCount > 1,
    cancelled: await cancelled(db, fee),
    isSample: Boolean(c!.isSample),
    student: c!.student ?? c!.leadName,
    admissionNumber: c!.a.admissionNumber,
    programme: c!.programme,
    charge: FEE_CHARGE_LABELS[fee.chargeCategory],
    amountPaise: fee.amountPaise,
    paymentDate: fee.paymentDate,
    method: fee.method ? humanise(fee.method) : null,
    reference: fee.receiptReference,
    instalment: instalment
      ? `${instalment.sequence} of ${instalments.length}, due ${fmtDate(instalment.dueDate)}`
      : fee.planId
        ? 'Not named (applied to the oldest due first)'
        : null,
    balancePaise: (await feeStatementFor(db, c!.a, fee.recordedAt)).balancePaise,
    recordedBy: recorder?.name ?? null,
  };
}
export type ReceiptDocument = Awaited<ReturnType<typeof receiptDocument>>;

/** The receipt PDF; this print is counted first, so the second and later say "Duplicate". */
export async function renderReceiptPdf(
  db: Database,
  feeRecordId: string,
  size: ReceiptSize = 'a4',
  /** False for a portal download (F4-13): not a staff print, so the count stays. */
  counted = true,
): Promise<Uint8Array> {
  const where = eq(opsFeeReceipts.feeRecordId, feeRecordId as OpsFeeRecordId);
  const [receipt] = counted
    ? await db
        .update(opsFeeReceipts)
        .set({ printCount: sql`${opsFeeReceipts.printCount} + 1` })
        .where(where)
        .returning()
    : await db.select().from(opsFeeReceipts).where(where);
  if (!receipt) throw new NotFoundError('No receipt has been issued for this payment yet.');
  // An uncounted copy reads as one more print: "Duplicate" once the original was printed.
  const shown = counted ? receipt : { ...receipt, printCount: receipt.printCount + 1 };
  return (await receiptPdf(await receiptDocument(db, shown), size)).bytes;
}

/** The download for staff: whoever may read the fee record (ops:fees:read, own scope). */
export async function receiptPdfFor(
  db: Database,
  actor: Actor,
  feeRecordId: string,
  size: ReceiptSize,
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const fee = await rowById(db, opsFeeRecords, feeRecordId, 'Fee record');
  await assertAdmissionAccess(db, access, await admissionRow(db, fee.admissionId));
  const receipt = await receiptFor(db, fee.id);
  return {
    bytes: await renderReceiptPdf(db, fee.id, size),
    filename: `receipt-${receipt?.receiptNumber ?? fee.code}.pdf`,
  };
}
