/**
 * Annual fee agreements (owner brief 2026-10-21 §9, D-039) and the instalment ledger — pure rules.
 * Algorithms: docs/ALGORITHMS.md → A-FEE-1 … A-FEE-7.
 *
 * Money is integer paise (INR). Every figure is MANUALLY RECORDED, not a verified payment
 * (MANUAL_FEE_DISCLAIMER). Only ledger rows count as paid — never a checkbox or a checklist item.
 *
 * Annual tuition is split by `fees.tuition_split` (approved 50/25/25): each share is rounded
 * down to the paisa and the remainder goes to the LAST instalment, so the shares always add up
 * to the agreed tuition. Registration and demo fees are separate charges, never in the split.
 * Due dates are entered by staff; an instalment without a due date is never overdue.
 *
 * Ledger kinds on an agreement: `received`, `refund`, `discount`, `waiver`, `adjustment` (credit
 * lowers what is owed, debit raises it). Rows are append-only: refunds and reversals are linked
 * rows (effectiveRecords in ./fees). Money recorded above what is owed is an explicit credit.
 */
import type { IsoDate } from './dates';
import { effectiveRecords, ledgerSums, MAX_FEE_PAISE, type FeeRecordLike } from './fees';

export const FEE_PLAN_STATUSES = ['draft', 'active', 'closed'] as const;
export type FeePlanStatus = (typeof FEE_PLAN_STATUSES)[number];
export const INSTALMENT_STATUSES = [
  'unpaid',
  'part_paid',
  'paid',
  'overdue',
  'waived_adjusted',
] as const;
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number];
/** Fee status shown in student lists (feeStatusForStudents). */
export const STUDENT_FEE_STATUSES = ['paid', 'due', 'overdue', 'not_configured'] as const;
export type StudentFeeStatus = (typeof STUDENT_FEE_STATUSES)[number];
/** Ledger kinds that may be recorded against an agreement (dues come from the instalments). */
export const PLAN_LEDGER_KINDS = [
  'received',
  'refund',
  'discount',
  'waiver',
  'adjustment',
] as const;

export const INSTALMENT_STATUS_LABELS: Record<InstalmentStatus, string> = {
  unpaid: 'Unpaid',
  part_paid: 'Part-paid',
  paid: 'Paid (as recorded)',
  overdue: 'Overdue',
  waived_adjusted: 'Waived or adjusted',
};
export const STUDENT_FEE_STATUS_LABELS: Record<StudentFeeStatus, string> = {
  paid: 'Paid (as recorded)',
  due: 'Due',
  overdue: 'Overdue',
  not_configured: 'Fee plan not configured',
};

export interface InstalmentLike {
  id: string;
  sequence: number;
  /** Null = no due date entered yet (never overdue). */
  dueDate: string | null;
  amountPaise: number;
}
export interface PlanLedgerRow extends FeeRecordLike {
  instalmentId?: string | null;
}

/** A-FEE-5: split the annual tuition by percentage shares: floor each, remainder to the last. */
export function splitTuition(totalPaise: number, sharesPercent: readonly number[]): number[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0 || !sharesPercent.length)
    throw new RangeError('splitTuition needs whole paise and at least one share');
  const shares = sharesPercent.map((p) => Math.floor((totalPaise * p) / 100));
  shares[shares.length - 1]! += totalPaise - shares.reduce((a, b) => a + b, 0);
  return shares;
}

type Issue = { path: string; message: string };

/** Validate a new agreement (or a new version): tuition, academic year, one due date per share. */
export function checkAgreementInput(input: {
  tuitionPaise: number;
  academicYear: string;
  dueDates: readonly string[];
  sharesPercent: readonly number[];
}): Issue[] {
  const issues: Issue[] = [];
  const { tuitionPaise, dueDates, sharesPercent } = input;
  if (!Number.isSafeInteger(tuitionPaise) || tuitionPaise <= 0 || tuitionPaise > MAX_FEE_PAISE)
    issues.push({
      path: 'totalPaise',
      message: 'The annual tuition must be whole paise above zero, at most ₹1,00,00,000.',
    });
  else if (splitTuition(tuitionPaise, sharesPercent).some((a) => a <= 0))
    issues.push({
      path: 'totalPaise',
      message: 'The tuition is too small to split into instalments.',
    });
  const [from, to] = input.academicYear.split('-').map(Number);
  if (!/^\d{4}-\d{2}$/.test(input.academicYear) || (from! + 1) % 100 !== to)
    issues.push({ path: 'academicYear', message: 'Give the academic year as 2026-27.' });
  if (dueDates.length !== sharesPercent.length)
    issues.push({
      path: 'dueDates',
      message: `Enter a due date for each of the ${sharesPercent.length} instalments.`,
    });
  else if (dueDates.some((d, i) => i > 0 && d < dueDates[i - 1]!))
    issues.push({
      path: 'dueDates',
      message: 'Each instalment must fall due on or after the one before.',
    });
  return issues;
}

export interface PlanTotals {
  totalPaise: number;
  scheduledPaise: number;
  paidPaise: number;
  refundedPaise: number;
  /** paid − refunded. */
  netPaidPaise: number;
  /** discounts + waivers + credit adjustments − debit adjustments (shown apart from tuition). */
  reductionsPaise: number;
  /** Still owed: max(0, total − reductions − netPaid). */
  outstandingPaise: number;
  /** Recorded above what is owed: max(0, −(total − reductions − netPaid)). Never absorbed. */
  creditPaise: number;
}

/** A-FEE-1: agreement totals straight from the ledger rows (so totals always equal the ledger). */
export function planTotals(
  totalPaise: number,
  instalments: readonly InstalmentLike[],
  ledger: readonly PlanLedgerRow[],
): PlanTotals {
  const s = ledgerSums(ledger);
  const reductions = s.discount + s.waiver + s.credit - s.debit;
  const balance = totalPaise - reductions - (s.received - s.refund);
  return {
    totalPaise,
    scheduledPaise: instalments.reduce((acc, i) => acc + i.amountPaise, 0),
    paidPaise: s.received,
    refundedPaise: s.refund,
    netPaidPaise: s.received - s.refund,
    reductionsPaise: reductions,
    outstandingPaise: Math.max(0, balance),
    creditPaise: Math.max(0, -balance),
  };
}

/** A-FEE-3: state of one instalment from what was applied to it. */
export function instalmentStatus(
  amountPaise: number,
  paidPaise: number,
  adjustedPaise: number,
  dueDate: string | null,
  today: IsoDate,
): InstalmentStatus {
  if (paidPaise + adjustedPaise >= amountPaise)
    return adjustedPaise > 0 ? 'waived_adjusted' : 'paid';
  if (dueDate !== null && dueDate < today) return 'overdue';
  return paidPaise + adjustedPaise > 0 ? 'part_paid' : 'unpaid';
}

export interface AllocatedInstalment<I extends InstalmentLike = InstalmentLike> {
  instalment: I;
  /** Net payments applied. */
  paidPaise: number;
  /** Discounts, waivers and net credit adjustments applied. */
  adjustedPaise: number;
  allocatedPaise: number;
  remainingPaise: number;
  status: InstalmentStatus;
}

const paymentSign = (r: FeeRecordLike) =>
  r.kind === 'received' ? 1 : r.kind === 'refund' ? -1 : 0;
const reductionSign = (r: FeeRecordLike) =>
  r.kind === 'discount' || r.kind === 'waiver' || r.direction === 'credit'
    ? 1
    : r.direction === 'debit'
      ? -1
      : 0;

/**
 * A-FEE-2: apply the ledger to instalments. Payments first, then reductions; each fills the
 * instalments its rows name (`instalmentId`) first, then the rest oldest due date first (no due
 * date last). Links only set priority: what is applied never exceeds what was recorded, and
 * nothing is applied beyond an instalment's amount.
 */
export function allocateInstalments<I extends InstalmentLike>(
  instalments: readonly I[],
  ledger: readonly PlanLedgerRow[],
  today: IsoDate,
): AllocatedInstalment<I>[] {
  const order = [...instalments].sort(
    (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sequence - b.sequence,
  );
  const rows = effectiveRecords(ledger);
  const room = new Map(order.map((i) => [i.id, i.amountPaise]));
  const apply = (sign: (r: FeeRecordLike) => number, available: number) => {
    const linked = new Map<string, number>();
    for (const r of rows)
      if (r.instalmentId && room.has(r.instalmentId))
        linked.set(r.instalmentId, (linked.get(r.instalmentId) ?? 0) + sign(r) * r.amountPaise);
    let pool = available;
    const given = new Map<string, number>();
    const give = (id: string, want: number) => {
      const take = Math.max(0, Math.min(want, room.get(id)!, pool));
      pool -= take;
      room.set(id, room.get(id)! - take);
      given.set(id, (given.get(id) ?? 0) + take);
    };
    for (const i of order) give(i.id, linked.get(i.id) ?? 0);
    for (const i of order) give(i.id, Infinity);
    return given;
  };
  const s = ledgerSums(ledger);
  // Everything applicable; a negative side (more refunded than paid, debits above reductions)
  // lowers the other one.
  const total = Math.max(0, s.received - s.refund + s.discount + s.waiver + s.credit - s.debit);
  const payments = Math.min(Math.max(0, s.received - s.refund), total);
  const paid = apply(paymentSign, payments);
  const adjusted = apply(reductionSign, total - payments);
  return order.map((instalment) => {
    const p = paid.get(instalment.id) ?? 0;
    const a = adjusted.get(instalment.id) ?? 0;
    return {
      instalment,
      paidPaise: p,
      adjustedPaise: a,
      allocatedPaise: p + a,
      remainingPaise: instalment.amountPaise - p - a,
      status: instalmentStatus(instalment.amountPaise, p, a, instalment.dueDate, today),
    };
  });
}

/** A-FEE-7: overall state of an agreement (a debit above the instalments stays owed). */
export function agreementStatus(
  instalments: readonly Pick<AllocatedInstalment, 'status' | 'allocatedPaise'>[],
  totals: Pick<PlanTotals, 'outstandingPaise'>,
): InstalmentStatus {
  const states = instalments.map((i) => i.status);
  if (states.includes('overdue')) return 'overdue';
  if (totals.outstandingPaise === 0 && states.every((s) => s === 'paid' || s === 'waived_adjusted'))
    return states.includes('waived_adjusted') ? 'waived_adjusted' : 'paid';
  return instalments.some((i) => i.allocatedPaise > 0) ? 'part_paid' : 'unpaid';
}

/** The first instalment (in due order) with something left to pay, or null. */
export const nextDue = <I extends InstalmentLike>(allocated: readonly AllocatedInstalment<I>[]) =>
  allocated.find((a) => a.remainingPaise > 0) ?? null;

export interface Reconciliation {
  reconciled: boolean;
  issues: string[];
}

/**
 * A-FEE-4: does the agreement agree with its ledger? Issues are shown above the tables. A credit
 * (more recorded than owed) is not an issue: it is shown as a credit.
 */
export function reconcilePlan(
  totals: PlanTotals,
  instalments: readonly InstalmentLike[],
  ledger: readonly PlanLedgerRow[],
): Reconciliation {
  const issues: string[] = [];
  const ids = new Set(instalments.map((i) => i.id));
  if (totals.scheduledPaise !== totals.totalPaise)
    issues.push('The instalments do not add up to the agreed tuition.');
  if (totals.netPaidPaise < 0) issues.push('More is recorded as refunded than as paid.');
  if (totals.reductionsPaise < 0) issues.push('Debit adjustments exceed the reductions recorded.');
  const rows = effectiveRecords(ledger);
  if (rows.some((r) => !(PLAN_LEDGER_KINDS as readonly string[]).includes(r.kind)))
    issues.push('A ledger row on this agreement has a kind an agreement does not use.');
  if (rows.some((r) => r.instalmentId && !ids.has(r.instalmentId)))
    issues.push('A ledger row points at an instalment of another agreement.');
  return { reconciled: issues.length === 0, issues };
}

/** List status of a student from the overall states of their ACTIVE agreements. */
export function studentFeeStatus(activePlans: readonly InstalmentStatus[]): StudentFeeStatus {
  if (activePlans.length === 0) return 'not_configured';
  if (activePlans.includes('overdue')) return 'overdue';
  return activePlans.every((s) => s === 'paid' || s === 'waived_adjusted') ? 'paid' : 'due';
}

// --- fee structure (A-FEE-6) -----------------------------------------------------------------

export type FeeStructureSource = 'sample' | 'website_stated' | 'owner_approved';
export type FeeStructureStatus = 'draft' | 'approved';
export type FeeStructureIssue = { path: string; message: string; forbidden?: true };

/**
 * A-FEE-6: may this edit of a fee-structure row go through? Only an owner-approved figure can be
 * approved (sample and website figures stay drafts). Marking a figure owner-approved or approved,
 * or changing the terms of an approved one, needs the approval permission; promoting also needs
 * a reason of at least 10 characters (where the owner confirmed it).
 */
export function checkFeeStructureChange(
  before: { source: FeeStructureSource; status: FeeStructureStatus },
  change: {
    source?: FeeStructureSource;
    status?: FeeStructureStatus;
    reason?: string | null;
    termsChanged: boolean;
  },
  canApprove: boolean,
): FeeStructureIssue | null {
  const source = change.source ?? before.source;
  const status = change.status ?? before.status;
  if (status === 'approved' && source !== 'owner_approved')
    return {
      path: 'status',
      message:
        'Only an owner-approved fee can be approved; sample and website figures stay drafts.',
    };
  const promoting =
    (source === 'owner_approved' && before.source !== 'owner_approved') ||
    (status === 'approved' && before.status !== 'approved');
  if ((promoting || (before.status === 'approved' && change.termsChanged)) && !canApprove)
    return {
      path: 'source',
      message: 'Approving a fee, or changing an approved one, needs the fee-approval permission.',
      forbidden: true,
    };
  if (promoting && (change.reason?.trim().length ?? 0) < 10)
    return {
      path: 'reason',
      message: 'Say where the owner confirmed this fee (at least 10 characters).',
    };
  return null;
}
