/**
 * Manually recorded administrative fee records (OPS-072). NOT a payment
 * system: no gateway, no card data, no verified transactions; the accounts
 * system remains the record (OD-013). Rules: domain/fees.ts.
 *
 * Permissions: `ops:fees:read` (counsellor: own scope = the admission's
 * counsellor or its lead's owner) and `ops:fees:record` (record, check, void).
 * A record is checked ("verified") only by a DIFFERENT person than the one who
 * recorded it. Rows are never deleted; mistakes are voided with a reason.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { opsAdmissions, opsDemos, opsFeeRecords, opsLeads, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { AdmissionId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  canVerifyFee,
  canVoidFee,
  MANUAL_FEE_DISCLAIMER,
  parseRupeesToPaise,
  summariseFees,
  validateFeeRecord,
  type FeeRecordLike,
  type FeeRecordStatus,
} from '../domain/fees';
import {
  admissionRow,
  assertAdmissionAccess,
  lockAccessible,
  namesOf,
  ownAdmissionFilter,
} from './admissions';
import type { FeeActionInput, FeeRecordInput } from './admissions-schemas';
import { accessScope, clean, nextCode, type Actor } from './context';
import { opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export type FeeRecordRow = typeof opsFeeRecords.$inferSelect;

/** The domain rules read only kind, direction, amount and status of a row. */
const asLike = (rows: FeeRecordRow[]) => rows as FeeRecordLike[];

async function recordsOf(db: Database, admissionId: string) {
  return db
    .select()
    .from(opsFeeRecords)
    .where(eq(opsFeeRecords.admissionId, admissionId as AdmissionId))
    .orderBy(desc(opsFeeRecords.recordedAt), desc(opsFeeRecords.code));
}

/** Summary of an admission's fee records (no permission check — callers check `ops:fees:read`). */
export async function feeSummaryFor(db: Database, admissionId: string) {
  return summariseFees(asLike(await recordsOf(db, admissionId)));
}

/** The record DTO: user names and the "manually recorded" marker. */
function present(r: FeeRecordRow, names: Map<string, string>) {
  return {
    ...r,
    recordedByName: names.get(r.recordedBy) ?? null,
    verifiedByName: r.verifiedBy ? (names.get(r.verifiedBy) ?? null) : null,
    voidedByName: r.voidedBy ? (names.get(r.voidedBy) ?? null) : null,
    manuallyRecorded: true as const,
  };
}

/** GET /admissions/{id}/fees — records, summary, the disclaimer and the fee settings. */
export async function listAdmissionFees(db: Database, actor: Actor, admissionId: string) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const admission = await admissionRow(db, admissionId);
  await assertAdmissionAccess(db, access, admission);
  const rows = await recordsOf(db, admission.id);
  const names = await namesOf(
    db,
    rows.flatMap((r) => [r.recordedBy, r.verifiedBy, r.voidedBy]),
  );
  const settings = await loadSettings(db);
  return {
    admission: { id: admission.id, code: admission.code, status: admission.status },
    records: rows.map((r) => present(r, names)),
    summary: summariseFees(asLike(rows)),
    disclaimer: MANUAL_FEE_DISCLAIMER,
    settings: { recording: settings['fees.recording'], schedule: settings['fees.schedule'] },
  };
}

function issuesError(issues: { path: string; message: string }[]) {
  return new ValidationError(issues[0]?.message ?? 'Invalid fee record.', {
    details: issues.map((i) => ({ location: 'body' as const, path: [i.path], message: i.message })),
  });
}

/** POST /admissions/{id}/fees — record a due amount, receipt, refund or adjustment. */
export async function recordFee(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: FeeRecordInput,
  requestId?: string,
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  const settings = await loadSettings(db);
  let amountPaise: unknown = input.amountPaise ?? null;
  if (input.amountRupees) {
    amountPaise = parseRupeesToPaise(input.amountRupees);
    if (amountPaise === null)
      throw issuesError([
        {
          path: 'amountRupees',
          message: 'Write the amount in rupees with at most two decimals, e.g. 1000 or 1000.50.',
        },
      ]);
  }
  return withTransaction(db, async (tx) => {
    const admission = await lockAccessible(tx, access, admissionId);
    const existing = await recordsOf(tx, admission.id);
    const issues = validateFeeRecord(
      {
        kind: input.kind,
        direction: input.direction ?? null,
        amountPaise,
        paymentDate: input.paymentDate ?? null,
        dueDate: input.dueDate ?? null,
        receiptReference: input.receiptReference ?? null,
      },
      asLike(existing),
      istToday(now),
      settings['fees.recording'].value,
    );
    if (input.demoId) {
      const [demo] = await tx
        .select()
        .from(opsDemos)
        .where(and(eq(opsDemos.id, input.demoId as never), eq(opsDemos.admissionId, admission.id)));
      if (!demo)
        issues.push({ path: 'demoId', message: 'That demo does not belong to this admission.' });
      else if (input.kind !== 'adjustment' || input.direction !== 'credit')
        issues.push({ path: 'demoId', message: 'A demo is linked only to a credit adjustment.' });
      else if (!['paid_verified', 'adjusted_against_fees'].includes(demo.feeStatus))
        issues.push({
          path: 'demoId',
          message: `The demo fee is ${demo.feeStatus}; nothing to adjust.`,
        });
      else {
        const demoPaise = demo.feeAmountInr ? parseRupeesToPaise(demo.feeAmountInr) : null;
        if (demoPaise !== null && typeof amountPaise === 'number' && amountPaise > demoPaise)
          issues.push({
            path: 'amountPaise',
            message: 'The adjustment is larger than the demo fee recorded on the booking.',
          });
        if (existing.some((r) => r.demoId === demo.id && r.status !== 'voided'))
          issues.push({ path: 'demoId', message: 'This demo fee is already adjusted.' });
      }
    }
    if (issues.length) throw issuesError(issues);
    const code = await nextCode(tx, 'feeRecord', 'ops.fee_records');
    const [row] = await tx
      .insert(opsFeeRecords)
      .values({
        code,
        admissionId: admission.id,
        leadId: admission.leadId,
        kind: input.kind,
        direction: input.kind === 'adjustment' ? (input.direction ?? null) : null,
        amountPaise: amountPaise as number,
        currency: 'INR',
        pricingReference: clean(input.pricingReference),
        receiptReference: clean(input.receiptReference),
        method: input.method ?? null,
        paymentDate: input.paymentDate ?? null,
        dueDate: input.dueDate ?? null,
        demoId: (input.demoId as never) ?? null,
        notes: clean(input.notes),
        recordedBy: actor.id,
        recordedAt: now,
      })
      .returning();
    if (!row) throw new Error('fee record insert returned no row');
    await opsAudit('fee_record')(
      tx,
      actor,
      row.id,
      'fee_record.created',
      {
        after: row,
        metadata: { leadId: admission.leadId, admissionId: admission.id, manuallyRecorded: true },
      },
      requestId,
    );
    return { ...row, manuallyRecorded: true as const, disclaimer: MANUAL_FEE_DISCLAIMER };
  });
}

/** POST /fees/{id} — `verify` (a different person) or `void` (with a reason). */
export async function feeRecordAction(
  db: Database,
  actor: Actor,
  feeId: string,
  input: FeeActionInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsFeeRecords, feeId, 'Fee record', true);
    await assertAdmissionAccess(tx, access, await admissionRow(tx, before.admissionId));
    const now = new Date();
    let patch: Partial<typeof opsFeeRecords.$inferInsert>;
    if (input.action === 'verify') {
      const check = canVerifyFee(
        { status: before.status as FeeRecordStatus, recordedBy: before.recordedBy },
        actor.id,
      );
      if (!check.ok) {
        if (check.code === 'SELF') throw new ForbiddenError(check.message);
        throw new InvalidStateTransitionError(check.message);
      }
      patch = {
        status: 'verified',
        verifiedBy: actor.id,
        verifiedAt: now,
        verificationNote: clean(input.note),
      };
    } else {
      const check = canVoidFee({ status: before.status as FeeRecordStatus }, input.reason);
      if (!check.ok) throw new InvalidStateTransitionError(check.message);
      patch = {
        status: 'voided',
        voidedBy: actor.id,
        voidedAt: now,
        voidReason: input.reason.trim(),
      };
    }
    const [after] = await tx
      .update(opsFeeRecords)
      .set(patch)
      .where(and(eq(opsFeeRecords.id, before.id), eq(opsFeeRecords.status, before.status)))
      .returning();
    if (!after) throw new InvalidStateTransitionError('The record changed meanwhile; reload.');
    await opsAudit('fee_record')(
      tx,
      actor,
      before.id,
      input.action === 'verify' ? 'fee_record.verified' : 'fee_record.voided',
      {
        before: { status: before.status },
        after: {
          status: after.status,
          ...(input.action === 'void' ? { voidReason: after.voidReason } : {}),
        },
        metadata: { leadId: before.leadId, admissionId: before.admissionId },
      },
      requestId,
    );
    return { ...after, manuallyRecorded: true as const, disclaimer: MANUAL_FEE_DISCLAIMER };
  });
}

/** GET /fees — fee records across admissions (finance view), newest code first, cursor = last code. */
export async function listFeeRecords(
  db: Database,
  actor: Actor,
  query: { status?: FeeRecordStatus; limit: number; cursor?: string },
) {
  const access = await accessScope(db, actor, 'ops:fees:read');
  const conditions = [ownAdmissionFilter(access)];
  if (query.status) conditions.push(eq(opsFeeRecords.status, query.status));
  if (query.cursor) conditions.push(lt(opsFeeRecords.code, query.cursor));
  const rows = await db
    .select({
      fee: opsFeeRecords,
      admissionCode: opsAdmissions.code,
      studentName: opsLeads.studentName,
    })
    .from(opsFeeRecords)
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsFeeRecords.leadId))
    .where(and(...conditions))
    .orderBy(desc(opsFeeRecords.code))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const names = await namesOf(
    db,
    page.flatMap((r) => [r.fee.recordedBy, r.fee.verifiedBy, r.fee.voidedBy]),
  );
  return {
    items: page.map((r) => ({
      ...present(r.fee, names),
      admissionCode: r.admissionCode,
      studentName: r.studentName,
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.fee.code ?? null) : null,
    disclaimer: MANUAL_FEE_DISCLAIMER,
  };
}
