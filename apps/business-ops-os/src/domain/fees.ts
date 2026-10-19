/**
 * Administrative fee records (OPS-072) — pure rules. Algorithm: docs/parts/admissions.md → A-ADM-1.
 *
 * These are MANUALLY RECORDED figures, never verified payment transactions:
 * there is no payment gateway and no card data. Money is integer paise in INR
 * (no floating point anywhere). Voided rows never count. A balance is only
 * computed when an amount due has been recorded — otherwise it is missing, not
 * zero ("nothing due" and "nothing recorded" are different facts).
 */

export const FEE_RECORD_KINDS = ['due', 'received', 'refund', 'adjustment'] as const;
export type FeeRecordKind = (typeof FEE_RECORD_KINDS)[number];
export const FEE_RECORD_STATUSES = ['recorded', 'verified', 'voided'] as const;
export type FeeRecordStatus = (typeof FEE_RECORD_STATUSES)[number];
export const FEE_DIRECTIONS = ['credit', 'debit'] as const;
export type FeeDirection = (typeof FEE_DIRECTIONS)[number];
export const FEE_METHODS = [
  'cash',
  'upi',
  'bank_transfer',
  'cheque',
  'card_terminal',
  'other',
] as const;
export type FeeMethod = (typeof FEE_METHODS)[number];

export const FEE_KIND_LABELS: Record<FeeRecordKind, string> = {
  due: 'Amount due',
  received: 'Amount received',
  refund: 'Refund',
  adjustment: 'Adjustment',
};
export const FEE_STATUS_LABELS: Record<FeeRecordStatus, string> = {
  recorded: 'Recorded (not verified)',
  verified: 'Checked by a second person',
  voided: 'Voided',
};

/** Shown next to every fee figure in the UI and returned by the API. */
export const MANUAL_FEE_DISCLAIMER =
  'Manually recorded — not a verified payment transaction. The accounts system remains the record (OD-013).';

/** Upper bound for one record: ₹1,00,00,000 (one crore) = 1,000,000,000 paise. */
export const MAX_FEE_PAISE = 1_000_000_000;

export interface FeeIssue {
  path: string;
  message: string;
}

/** Validate an amount in paise: a safe integer, > 0, ≤ MAX_FEE_PAISE. */
export function checkAmountPaise(value: unknown): { ok: true; value: number } | FeeIssue {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { path: 'amountPaise', message: 'Amount is required (whole paise).' };
  if (!Number.isInteger(value))
    return {
      path: 'amountPaise',
      message: 'Amount must be whole paise (an integer), e.g. 100000 for ₹1,000.',
    };
  if (value <= 0) return { path: 'amountPaise', message: 'Amount must be greater than zero.' };
  if (value > MAX_FEE_PAISE)
    return { path: 'amountPaise', message: 'Amount is above the ₹1,00,00,000 limit per record.' };
  return { ok: true, value };
}

/**
 * Parse a rupee amount typed by a person ("1000", "1,000.50") into integer
 * paise WITHOUT floating point. Null when the text is not a valid amount.
 */
export function parseRupeesToPaise(text: string): number | null {
  const t = text.trim().replace(/,/g, '').replace(/^₹\s*/, '');
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const rupees = Number(m[1]);
  const paise = Number((m[2] ?? '').padEnd(2, '0'));
  return rupees * 100 + paise;
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Integer paise → "₹1,00,000.00" (Indian grouping). Null → "—" (missing, never ₹0). */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const sign = paise < 0 ? '−' : '';
  const abs = Math.abs(paise);
  // Integer arithmetic for the split; Intl only formats the grouping.
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = inr.format(whole).replace(/\.00$/, '');
  return `${sign}₹${grouped}.${String(frac).padStart(2, '0')}`;
}

export interface FeeRecordLike {
  kind: FeeRecordKind;
  direction: FeeDirection | null;
  amountPaise: number;
  status: FeeRecordStatus;
}

export interface NewFeeRecordInput {
  kind: FeeRecordKind;
  direction?: FeeDirection | null;
  amountPaise: unknown;
  paymentDate?: string | null;
  dueDate?: string | null;
  receiptReference?: string | null;
}

export interface FeeRecordingConfig {
  /** Received amounts and refunds need a receipt/transaction reference (setting `fees.recording`). */
  requireReceiptReference: boolean;
}

export const DEFAULT_FEE_RECORDING_CONFIG: FeeRecordingConfig = { requireReceiptReference: true };

const sum = (rows: readonly FeeRecordLike[], pred: (r: FeeRecordLike) => boolean) =>
  rows.filter(pred).reduce((acc, r) => acc + r.amountPaise, 0);

/**
 * Validate a new fee record against the admission's existing records. Returns
 * every issue (empty = valid) so the API can report each field.
 * Rules: positive integer paise; `direction` iff adjustment; received/refund
 * need a payment date not after `today` (IST) and, when configured, a receipt
 * reference; a due record has no payment date; a refund may not exceed the
 * non-voided amount received minus earlier refunds.
 */
export function validateFeeRecord(
  input: NewFeeRecordInput,
  existing: readonly FeeRecordLike[],
  today: string,
  config: FeeRecordingConfig = DEFAULT_FEE_RECORDING_CONFIG,
): FeeIssue[] {
  const issues: FeeIssue[] = [];
  const amount = checkAmountPaise(input.amountPaise);
  if (!('ok' in amount)) issues.push(amount);
  if (input.kind === 'adjustment' && !input.direction)
    issues.push({
      path: 'direction',
      message: 'Say whether the adjustment is a credit or a debit.',
    });
  if (input.kind !== 'adjustment' && input.direction)
    issues.push({ path: 'direction', message: 'Only adjustments have a direction.' });
  if (input.kind === 'received' || input.kind === 'refund') {
    if (!input.paymentDate)
      issues.push({ path: 'paymentDate', message: 'Give the date the money moved.' });
    else if (input.paymentDate > today)
      issues.push({ path: 'paymentDate', message: 'The payment date cannot be in the future.' });
    if (config.requireReceiptReference && !input.receiptReference?.trim())
      issues.push({
        path: 'receiptReference',
        message: 'Give the receipt or transaction reference from the accounts system.',
      });
  }
  if (input.kind === 'due' && input.paymentDate)
    issues.push({
      path: 'paymentDate',
      message: 'An amount due has a due date, not a payment date.',
    });
  if (input.kind === 'refund' && 'ok' in amount) {
    const active = existing.filter((r) => r.status !== 'voided');
    const refundable =
      sum(active, (r) => r.kind === 'received') - sum(active, (r) => r.kind === 'refund');
    if (amount.value > refundable)
      issues.push({
        path: 'amountPaise',
        message: `A refund cannot exceed the amount recorded as received less earlier refunds (${formatPaise(Math.max(refundable, 0))} available).`,
      });
  }
  return issues;
}

export type FeeBalanceState =
  'no_records' | 'no_due_recorded' | 'outstanding' | 'settled' | 'credit_balance';

export interface FeeSummary {
  currency: 'INR';
  /** Sum of `due` plus debit adjustments. */
  duePaise: number;
  creditAdjustmentsPaise: number;
  receivedPaise: number;
  refundedPaise: number;
  /** received − refunded. */
  netReceivedPaise: number;
  /** Same, counting only records checked by a second person. */
  verifiedNetReceivedPaise: number;
  /** due − credits − netReceived; null (missing) when no amount due is recorded. */
  balancePaise: number | null;
  balanceState: FeeBalanceState;
  activeCount: number;
  unverifiedCount: number;
  voidedCount: number;
  disclaimer: string;
}

/** Aggregate an admission's fee records. Voided records are ignored (but counted). */
export function summariseFees(records: readonly FeeRecordLike[]): FeeSummary {
  const active = records.filter((r) => r.status !== 'voided');
  const verified = active.filter((r) => r.status === 'verified');
  const due =
    sum(active, (r) => r.kind === 'due') +
    sum(active, (r) => r.kind === 'adjustment' && r.direction === 'debit');
  const credits = sum(active, (r) => r.kind === 'adjustment' && r.direction === 'credit');
  const received = sum(active, (r) => r.kind === 'received');
  const refunded = sum(active, (r) => r.kind === 'refund');
  const net = received - refunded;
  const verifiedNet =
    sum(verified, (r) => r.kind === 'received') - sum(verified, (r) => r.kind === 'refund');
  const hasDue = active.some((r) => r.kind === 'due');
  const balance = hasDue ? due - credits - net : null;
  const balanceState: FeeBalanceState =
    active.length === 0
      ? 'no_records'
      : balance === null
        ? 'no_due_recorded'
        : balance > 0
          ? 'outstanding'
          : balance === 0
            ? 'settled'
            : 'credit_balance';
  return {
    currency: 'INR',
    duePaise: due,
    creditAdjustmentsPaise: credits,
    receivedPaise: received,
    refundedPaise: refunded,
    netReceivedPaise: net,
    verifiedNetReceivedPaise: verifiedNet,
    balancePaise: balance,
    balanceState,
    activeCount: active.length,
    unverifiedCount: active.filter((r) => r.status === 'recorded').length,
    voidedCount: records.length - active.length,
    disclaimer: MANUAL_FEE_DISCLAIMER,
  };
}

export const FEE_BALANCE_LABELS: Record<FeeBalanceState, string> = {
  no_records: 'No fee records',
  no_due_recorded: 'No amount due recorded — balance unknown',
  outstanding: 'Balance outstanding',
  settled: 'Settled (as recorded)',
  credit_balance: 'Credit balance (more recorded than due)',
};

/** May `actorUserId` mark this record as checked? Never the person who recorded it. */
export function canVerifyFee(
  record: { status: FeeRecordStatus; recordedBy: string },
  actorUserId: string,
): { ok: true } | { ok: false; code: 'SELF' | 'STATE'; message: string } {
  if (record.status !== 'recorded')
    return { ok: false, code: 'STATE', message: `A ${record.status} record cannot be verified.` };
  if (record.recordedBy === actorUserId)
    return {
      ok: false,
      code: 'SELF',
      message: 'You recorded this entry; a different person must check it.',
    };
  return { ok: true };
}

/** Void with a reason; a voided record stays visible and never counts. */
export function canVoidFee(
  record: { status: FeeRecordStatus },
  reason: string | null | undefined,
): { ok: true } | { ok: false; code: 'STATE' | 'REASON'; message: string } {
  if (record.status === 'voided')
    return { ok: false, code: 'STATE', message: 'The record is already voided.' };
  if (!reason?.trim())
    return { ok: false, code: 'REASON', message: 'Give the reason for voiding the record.' };
  return { ok: true };
}

/** Informational hint next to the `down_payment_verified` check (never part of the gate). */
export function downPaymentHint(summary: FeeSummary): string {
  if (summary.receivedPaise === 0) return 'No amount received is recorded in the fee records yet.';
  if (summary.verifiedNetReceivedPaise === 0)
    return `${formatPaise(summary.netReceivedPaise)} recorded as received, not yet checked by a second person.`;
  return `${formatPaise(summary.verifiedNetReceivedPaise)} recorded as received and checked by a second person.`;
}
