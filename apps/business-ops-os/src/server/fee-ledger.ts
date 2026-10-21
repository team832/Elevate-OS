/**
 * The one place a fee ledger row is written (OPS-072, brief §9, D-039): tuition entries on an
 * annual agreement, the registration fee, demo fees, refunds and reversals. Manually recorded
 * figures, NOT verified payments (no gateway). Rules: domain/fees.ts, domain/fee-plans.ts.
 *
 * `recordFeeEntry(tx, …)` runs inside the caller's transaction and does NOT check permissions:
 * the caller must (recordFee and the fee routes check `ops:fees:record`; F-DEMO records demo
 * fees under its own demo permission). Rows are never deleted or rewritten: a refund names the
 * payment it returns and a reversal names the entry it cancels (`reverses_record_id`).
 */
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  opsAdmissions,
  opsDemos,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  type Database,
  type OpsFeeInstalmentId,
  type OpsFeePlanId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import type { AdmissionId, StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  effectiveRecords,
  MANUAL_FEE_DISCLAIMER,
  parseRupeesToPaise,
  validateFeeRecord,
  type FeeChargeCategory,
  type FeeDirection,
  type FeeIssue,
  type FeeRecordKind,
  type FeeRecordLike,
} from '../domain/fees';
import { lockAccessible } from './admissions';
import { accessScope, clean, nextCode, type Actor } from './context';
import { opsAudit } from './ops-common';
import { loadSettings } from './settings';

export type FeeRecordRow = typeof opsFeeRecords.$inferSelect;

/** The domain rules read kind, direction, amount, status, id, link and category of a row. */
export const asLike = (rows: FeeRecordRow[]) => rows as FeeRecordLike[];

export async function recordsOf(db: Database, admissionId: string) {
  return db
    .select()
    .from(opsFeeRecords)
    .where(eq(opsFeeRecords.admissionId, admissionId as AdmissionId))
    .orderBy(desc(opsFeeRecords.recordedAt), desc(opsFeeRecords.code));
}

/** The record DTO: user names and the "manually recorded" marker. */
export function present(r: FeeRecordRow, names: Map<string, string>) {
  return {
    ...r,
    recordedByName: names.get(r.recordedBy) ?? null,
    verifiedByName: r.verifiedBy ? (names.get(r.verifiedBy) ?? null) : null,
    voidedByName: r.voidedBy ? (names.get(r.voidedBy) ?? null) : null,
    manuallyRecorded: true as const,
  };
}

export function issuesError(issues: readonly FeeIssue[]) {
  return new ValidationError(issues[0]?.message ?? 'Invalid fee record.', {
    details: issues.map((i) => ({ location: 'body' as const, path: [i.path], message: i.message })),
  });
}

export const optText = (max: number) => z.string().trim().max(max).nullish();
/** Amount as integer paise or rupee text (parsed without floating point). */
export const amountFields = {
  amountPaise: z.int().nullish(),
  amountRupees: z.string().trim().max(20).nullish(),
};

/** Integer paise from `amountPaise` or rupee text (null = missing or not a valid amount). */
export const paiseOf = (paise: number | null | undefined, rupees: string | null | undefined) =>
  rupees ? parseRupeesToPaise(rupees) : (paise ?? null);

export interface FeeEntryInput {
  kind: FeeRecordKind;
  /** Default `tuition`; a refund or reversal takes the category of the entry it links to. */
  chargeCategory?: FeeChargeCategory | null;
  direction?: FeeDirection | null;
  amountPaise?: number | null;
  amountRupees?: string | null;
  pricingReference?: string | null;
  receiptReference?: string | null;
  method?: string | null;
  paymentDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  demoId?: string | null;
  planId?: string | null;
  instalmentId?: string | null;
  reversesRecordId?: string | null;
}

/** An instalment is recorded through its agreement, which must be this admission's active one. */
async function planLinkIssues(tx: Database, admissionId: string, input: FeeEntryInput) {
  if (!input.planId)
    return [{ path: 'instalmentId', message: 'An instalment is recorded through its agreement.' }];
  const [plan] = await tx
    .select()
    .from(opsFeePlans)
    .where(eq(opsFeePlans.id, input.planId as OpsFeePlanId));
  if (plan?.admissionId !== admissionId)
    return [{ path: 'planId', message: 'That fee agreement does not belong to this admission.' }];
  if (plan.status !== 'active')
    return [
      {
        path: 'planId',
        message: `The fee agreement is ${plan.status}; entries need an active one.`,
      },
    ];
  if (!input.instalmentId) return [];
  const [inst] = await tx
    .select({ planId: opsFeeInstalments.planId })
    .from(opsFeeInstalments)
    .where(eq(opsFeeInstalments.id, input.instalmentId as OpsFeeInstalmentId));
  return inst?.planId === plan.id
    ? []
    : [{ path: 'instalmentId', message: 'That instalment belongs to another agreement.' }];
}

/** Category rules that need the database: demo link, one charge each, demo credit setting. */
async function categoryIssues(
  tx: Database,
  admission: FeeAdmission,
  input: FeeEntryInput & { chargeCategory: FeeChargeCategory },
  amount: number | null,
  existing: FeeRecordRow[],
  demoCredit: boolean,
): Promise<FeeIssue[]> {
  const { chargeCategory: category, demoId } = input;
  if (category !== 'tuition' && (input.planId || input.instalmentId))
    return [{ path: 'planId', message: 'Only tuition is recorded on the annual agreement.' }];
  if (demoId) {
    const [demo] = await tx
      .select({ id: opsDemos.id })
      .from(opsDemos)
      .where(
        and(eq(opsDemos.id, demoId as never), eq(opsDemos.admissionId, admission.id as never)),
      );
    if (!demo) return [{ path: 'demoId', message: 'That demo does not belong to this admission.' }];
  } else if (category === 'demo') return [{ path: 'demoId', message: 'Name the demo.' }];
  const live = effectiveRecords(existing as (FeeRecordRow & FeeRecordLike)[]);
  const counted = live.filter(
    (r) => r.chargeCategory === category && (category !== 'demo' || r.demoId === demoId),
  );
  if (category === 'registration' && input.kind === 'due') {
    // Once per student (bundle): look across every admission of the student.
    const bundle = admission.studentId
      ? await tx
          .select()
          .from(opsFeeRecords)
          .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeeRecords.admissionId))
          .where(
            and(
              eq(opsAdmissions.studentId, admission.studentId),
              eq(opsFeeRecords.chargeCategory, 'registration'),
            ),
          )
          .then((rows) => rows.map((r) => r.fee_records))
      : existing.filter((r) => r.chargeCategory === 'registration');
    if (effectiveRecords(asLike(bundle)).some((r) => r.kind === 'due'))
      return [
        { path: 'kind', message: 'The registration fee is already charged for this student.' },
      ];
  }
  if (category === 'demo' && input.kind === 'due' && counted.some((r) => r.kind === 'due'))
    return [{ path: 'kind', message: 'The demo fee is already charged (charged once).' }];
  if (category === 'tuition' && !input.planId) {
    // Tuition lives on the annual agreement; no second tuition ledger beside it.
    const [plan] = await tx
      .select({ id: opsFeePlans.id })
      .from(opsFeePlans)
      .where(
        and(
          ne(opsFeePlans.status, 'closed'),
          admission.studentId
            ? or(
                eq(opsFeePlans.admissionId, admission.id),
                eq(opsFeePlans.studentId, admission.studentId),
              )
            : eq(opsFeePlans.admissionId, admission.id),
        ),
      )
      .limit(1);
    if (plan) return [{ path: 'planId', message: 'Record tuition on the annual agreement.' }];
  }
  if (category !== 'tuition' || !demoId) return [];
  // A tuition row naming a demo = the demo fee credited against tuition (setting fees.demo_credit).
  if (!demoCredit)
    return [
      {
        path: 'demoId',
        message: 'Demo fee credit toward tuition is off (setting “Demo fee credit on admission”).',
      },
    ];
  if (input.kind !== 'adjustment' || input.direction !== 'credit')
    return [{ path: 'demoId', message: 'A demo is linked only to a credit adjustment.' }];
  const demoRows = live.filter((r) => r.demoId === demoId);
  if (demoRows.some((r) => r.chargeCategory === 'tuition'))
    return [{ path: 'demoId', message: 'This demo fee is already credited.' }];
  const paid = demoRows.reduce(
    (s, r) =>
      s + (r.kind === 'received' ? r.amountPaise : r.kind === 'refund' ? -r.amountPaise : 0),
    0,
  );
  return amount !== null && amount > paid
    ? [{ path: 'amountPaise', message: 'The credit is larger than the demo fee recorded as paid.' }]
    : [];
}

/** Insert one validated ledger row and its audit row inside `tx` (no permission check here). */
export interface FeeAdmission {
  id: AdmissionId;
  leadId: string;
  /** The canonical student, when linked: "charged once" checks look across the bundle. */
  studentId?: StudentIdentityId | null;
}

export async function recordFeeEntry(
  tx: Database,
  actor: Actor,
  admission: FeeAdmission,
  input: FeeEntryInput,
  requestId?: string,
  now: Date = new Date(),
) {
  const settings = await loadSettings(tx);
  const existing = await recordsOf(tx, admission.id);
  const target = existing.find((r) => r.id === input.reversesRecordId);
  // A refund or reversal belongs where the entry it links to belongs.
  const entry = {
    ...input,
    ...(target && {
      chargeCategory: target.chargeCategory,
      planId: target.planId,
      instalmentId: target.instalmentId,
      demoId: target.demoId,
    }),
  };
  const category = entry.chargeCategory ?? 'tuition';
  const issues: FeeIssue[] = [];
  let amount = paiseOf(entry.amountPaise, entry.amountRupees);
  if (entry.amountRupees && amount === null)
    issues.push({
      path: 'amountRupees',
      message: 'Write the amount in rupees with at most two decimals, e.g. 1000 or 1000.50.',
    });
  if (category === 'registration' && entry.kind === 'due' && !target) {
    const configured = settings['fees.registration'].value.amountPaise;
    if (configured === null)
      throw issuesError([{ path: 'amountPaise', message: 'Registration fee not configured.' }]);
    if (amount !== null && amount !== configured)
      issues.push({ path: 'amountPaise', message: 'The registration fee comes from Settings.' });
    amount = configured;
  }
  issues.push(
    ...validateFeeRecord(
      { ...entry, direction: entry.direction ?? null, amountPaise: amount },
      asLike(existing),
      istToday(now),
      settings['fees.recording'].value,
    ),
  );
  if (!target) {
    issues.push(
      ...(await categoryIssues(
        tx,
        admission,
        { ...entry, chargeCategory: category },
        amount,
        existing,
        settings['fees.demo_credit'].value.creditTowardTuition,
      )),
    );
    if (entry.planId || entry.instalmentId)
      issues.push(...(await planLinkIssues(tx, admission.id, entry)));
  }
  if (issues.length) throw issuesError(issues);
  const [row] = await tx
    .insert(opsFeeRecords)
    .values({
      code: await nextCode(tx, 'feeRecord', 'ops.fee_records'),
      admissionId: admission.id,
      leadId: admission.leadId as never,
      kind: entry.kind,
      chargeCategory: category,
      reversesRecordId: target?.id ?? null,
      direction: entry.kind === 'adjustment' ? (entry.direction ?? null) : null,
      amountPaise: amount!,
      currency: 'INR',
      pricingReference: clean(entry.pricingReference),
      receiptReference: clean(entry.receiptReference),
      method: entry.method ?? null,
      paymentDate: entry.paymentDate ?? null,
      dueDate: entry.dueDate ?? null,
      demoId: (entry.demoId as never) ?? null,
      planId: entry.planId ?? null,
      instalmentId: entry.instalmentId ?? null,
      notes: clean(entry.notes),
      recordedBy: actor.id,
      recordedAt: now,
    })
    .returning();
  if (!row) throw new Error('fee record insert returned no row');
  const action = !target
    ? 'fee_record.created'
    : entry.kind === 'refund' && target.kind === 'received'
      ? 'fee_record.refunded'
      : 'fee_record.reversed';
  await opsAudit('fee_record')(
    tx,
    actor,
    row.id,
    action,
    {
      after: row,
      metadata: {
        leadId: admission.leadId,
        admissionId: admission.id,
        chargeCategory: category,
        reverses: target?.id ?? null,
        manuallyRecorded: true,
      },
    },
    requestId,
  );
  return { ...row, manuallyRecorded: true as const, disclaimer: MANUAL_FEE_DISCLAIMER };
}

/**
 * Record a ledger row on an admission (POST /admissions/{id}/fees, POST /fees for registration
 * and demo charges, POST /fee-plans/{id}/entries). Checks `ops:fees:record` and own scope.
 */
export async function recordFee(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: FeeEntryInput,
  requestId?: string,
  now: Date = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:fees:record');
  return withTransaction(db, async (tx) =>
    recordFeeEntry(tx, actor, await lockAccessible(tx, access, admissionId), input, requestId, now),
  );
}
