/**
 * Manually recorded administrative fee records (OPS-072). NOT a payment
 * system: no gateway, no card data, no verified transactions; the accounts
 * system remains the record (OD-013). Rules: domain/fees.ts.
 *
 * Permissions: `ops:fees:read` (counsellor: own scope = the admission's
 * counsellor or its lead's owner) and `ops:fees:record` (record, check, refund,
 * reverse, void). A record is checked ("verified") only by a DIFFERENT person than
 * the one who recorded it. Rows are never deleted: refunds and reversals are linked
 * rows (fee-ledger.ts); legacy admission-level rows may still be voided with a reason.
 *
 * Annual fee agreements (brief §9, D-039) live in fee-agreements.ts, re-exported here.
 */
import { and, asc, desc, eq, lt, ne } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { z } from 'zod';
import {
  opsAdmissions,
  opsFeeRecords,
  opsFeeStructures,
  opsLeads,
  OPS_FEE_BILLING_PERIODS,
  OPS_FEE_STRUCTURE_MODES,
  OPS_FEE_STRUCTURE_STATUSES,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  isoDateSchema,
} from '@elevate/shared-contracts';
import { checkFeeStructureChange } from '../domain/fee-plans';
import {
  canVerifyFee,
  canVoidFee,
  FEE_METHODS,
  MANUAL_FEE_DISCLAIMER,
  summariseFees,
  type FeeRecordStatus,
} from '../domain/fees';
import {
  admissionRow,
  assertAdmissionAccess,
  lockAccessible,
  namesOf,
  ownAdmissionFilter,
} from './admissions';
import { accessScope, clean, type Actor } from './context';
import {
  amountFields,
  asLike,
  issuesError,
  optText,
  paiseOf,
  present,
  recordFeeEntry,
  recordsOf,
} from './fee-ledger';
import { defined, fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';

export * from './fee-agreements';
export { recordFee, recordFeeEntry, type FeeEntryInput, type FeeRecordRow } from './fee-ledger';

/** Summary of an admission's fee records (no permission check — callers check `ops:fees:read`). */
export async function feeSummaryFor(db: Database, admissionId: string) {
  return summariseFees(asLike(await recordsOf(db, admissionId)));
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

/** POST /fees — a registration or demo charge, payment, discount or waiver (never tuition). */
export const feeChargeBody = z
  .object({
    admissionId: z.uuid(),
    chargeCategory: z.enum(['registration', 'demo']),
    kind: z.enum(['due', 'received', 'discount', 'waiver']),
    ...amountFields,
    demoId: z.uuid().nullish(),
    receiptReference: optText(120),
    method: z.enum(FEE_METHODS).nullish(),
    paymentDate: isoDateSchema.nullish(),
    notes: optText(1000),
  })
  .strict();

/** POST /fees/{id} — check, void (legacy rows), refund a payment, or reverse an entry. */
export const feeRecordActionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), note: optText(500) }).strict(),
  z.object({ action: z.literal('void'), reason: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      action: z.literal('refund'),
      ...amountFields,
      paymentDate: isoDateSchema,
      receiptReference: optText(120),
      method: z.enum(FEE_METHODS).nullish(),
      notes: optText(1000),
    })
    .strict(),
  z.object({ action: z.literal('reverse'), reason: z.string().trim().min(1).max(500) }).strict(),
]);
export type FeeRecordActionInput = z.output<typeof feeRecordActionBody>;

export async function feeRecordAction(
  db: Database,
  actor: Actor,
  feeId: string,
  input: FeeRecordActionInput,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsFeeRecords, feeId, 'Fee record', true);
    const admission = await lockAccessible(tx, access, before.admissionId);
    if (input.action === 'refund' && before.kind !== 'received')
      throw fieldError('action', 'Only a payment can be refunded; reverse other entries.');
    if (input.action === 'refund' || input.action === 'reverse') {
      const { action, ...body } = input;
      return recordFeeEntry(
        tx,
        actor,
        admission,
        action === 'refund'
          ? { ...body, kind: 'refund', reversesRecordId: before.id }
          : {
              kind: before.kind,
              direction: before.direction,
              amountPaise: before.amountPaise,
              notes: input.action === 'reverse' ? input.reason : null,
              reversesRecordId: before.id,
            },
        requestId,
      );
    }
    const now = new Date();
    let patch: Partial<typeof opsFeeRecords.$inferInsert>;
    if (input.action === 'verify') {
      const check = canVerifyFee(
        { status: before.status, recordedBy: before.recordedBy },
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
      if (before.planId || before.chargeCategory !== 'tuition' || before.reversesRecordId)
        throw new InvalidStateTransitionError(
          'This entry is append-only: reverse it (a linked entry) instead of voiding it.',
        );
      const [linked] = await tx
        .select({ id: opsFeeRecords.id })
        .from(opsFeeRecords)
        .where(
          and(eq(opsFeeRecords.reversesRecordId, before.id), ne(opsFeeRecords.status, 'voided')),
        )
        .limit(1);
      if (linked) throw new InvalidStateTransitionError('Reverse its refunds first, then void it.');
      const check = canVoidFee({ status: before.status }, input.reason);
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

// --- fee structure (owner 21 Oct 2026; rule: domain/fee-plans.ts A-FEE-6) ---------------------

export const feeStructureUpdateBody = z
  .object({
    label: z.string().trim().min(1).max(160).optional(),
    mode: z.enum(OPS_FEE_STRUCTURE_MODES).optional(),
    ...amountFields,
    billingPeriod: z.enum(OPS_FEE_BILLING_PERIODS).optional(),
    instalmentCount: z.int().min(1).max(24).nullish(),
    instalmentNote: optText(300),
    billingNote: optText(500),
    sourceNote: optText(500),
    /** A person can only move a figure to `owner_approved` (never back to sample or website). */
    source: z.literal('owner_approved').optional(),
    status: z.enum(OPS_FEE_STRUCTURE_STATUSES).optional(),
    reason: optText(1000),
  })
  .strict();

/** GET /fee-structures — every row, sample and website figures included (each says its source). */
export async function listFeeStructures(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:fees:read');
  const items = await db
    .select()
    .from(opsFeeStructures)
    .orderBy(asc(opsFeeStructures.programmeCodes), asc(opsFeeStructures.mode));
  return { items, anyApproved: items.some((r) => r.status === 'approved') };
}

/** PATCH /fee-structures/{id} — edit a row; promoting to owner-approved/approved is checked and audited. */
export async function updateFeeStructure(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof feeStructureUpdateBody>,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:fees:record');
  const { reason, amountPaise, amountRupees, ...rest } = input;
  const paise = paiseOf(amountPaise, amountRupees);
  if (paise !== null && (!Number.isSafeInteger(paise) || paise <= 0))
    throw issuesError([
      { path: 'amountPaise', message: 'The amount must be whole paise above zero.' },
    ]);
  const patch = defined({ ...rest, amountPaise: paise ?? undefined });
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, opsFeeStructures, id, 'Fee structure', true);
    const { source: _s, status: _st, ...terms } = patch;
    const issue = checkFeeStructureChange(
      before,
      {
        source: input.source,
        status: input.status,
        reason,
        termsChanged: Object.keys(terms).length > 0,
      },
      can(actor, 'ops:admissions:approve'),
    );
    if (issue) throw issue.forbidden ? new ForbiddenError(issue.message) : issuesError([issue]);
    const source = input.source ?? before.source;
    const [after] = await tx
      .update(opsFeeStructures)
      .set({ ...patch, isSample: source === 'sample', updatedBy: actor.id })
      .where(eq(opsFeeStructures.id, before.id))
      .returning();
    await opsAudit('fee_structure')(
      tx,
      actor,
      before.id,
      'fee_structure.updated',
      { before, after, metadata: { reason: reason ?? null } },
      requestId,
    );
    return after!;
  });
}
