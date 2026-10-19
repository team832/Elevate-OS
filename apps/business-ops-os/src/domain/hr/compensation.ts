/**
 * Compensation records (OPS-036). Pure.
 *
 * COMPENSATION RECORDS ONLY — NOT A PAYROLL SYSTEM. No deductions, tax, PF,
 * ESI, gratuity or payslip calculations (D-028). Amounts are integer paise (INR).
 *
 * Effective dating: approving a record with `effectiveFrom = F` closes the
 * current approved record on F − 1 (status `superseded`). Approvals therefore
 * go forward in time; at most one record is `approved` (the open-ended current
 * terms) and the effective windows of approved + superseded records never
 * overlap, so exactly one record (or none) is effective on any date.
 */
import { addDays, isIsoDate, type IsoDate } from '../dates';

export const COMPENSATION_BASES = ['monthly', 'annual', 'hourly'] as const;
export type CompensationBasis = (typeof COMPENSATION_BASES)[number];
export const COMPENSATION_STATUSES = ['draft', 'approved', 'superseded', 'cancelled'] as const;
export type CompensationStatus = (typeof COMPENSATION_STATUSES)[number];
export const COMPONENT_KINDS = ['earning', 'allowance'] as const;

export const NOT_PAYROLL_NOTICE =
  'Compensation records only — not a payroll system; no statutory calculations (no deductions, tax, PF, ESI or payslips).';

export interface CompensationComponentInput {
  kind: 'earning' | 'allowance';
  label: string;
  amountPaise: number;
}

/** Labels that describe deductions or statutory items, which this module never records. */
const STATUTORY_LABEL =
  /\b(deductions?|tax|taxes|tds|pf|epf|provident|esi|esic|lwf|professional\s+tax|payslip|net\s+pay)\b/i;

/** 10 crore rupees in paise — a sanity bound against typing errors, not a policy. */
export const MAX_AMOUNT_PAISE = 10_000_000_000;

export function validateCompensation(input: {
  basis: CompensationBasis;
  amountPaise: number;
  components: readonly CompensationComponentInput[];
  effectiveFrom: string;
}): { ok: true } | { ok: false; issues: { path: (string | number)[]; message: string }[] } {
  const issues: { path: (string | number)[]; message: string }[] = [];
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0)
    issues.push({ path: ['amountPaise'], message: 'Amount must be a whole number of paise ≥ 0.' });
  else if (input.amountPaise > MAX_AMOUNT_PAISE)
    issues.push({ path: ['amountPaise'], message: 'Amount is implausibly large.' });
  if (!isIsoDate(input.effectiveFrom))
    issues.push({ path: ['effectiveFrom'], message: 'Effective date must be YYYY-MM-DD.' });
  const labels = new Set<string>();
  input.components.forEach((c, i) => {
    if (!COMPONENT_KINDS.includes(c.kind))
      issues.push({ path: ['components', i, 'kind'], message: 'Only earnings and allowances.' });
    const label = c.label.trim();
    if (!label) issues.push({ path: ['components', i, 'label'], message: 'Label is required.' });
    if (STATUTORY_LABEL.test(label))
      issues.push({
        path: ['components', i, 'label'],
        message: 'Deductions and statutory items are not recorded here (not a payroll system).',
      });
    if (labels.has(label.toLowerCase()))
      issues.push({ path: ['components', i, 'label'], message: 'Duplicate component label.' });
    labels.add(label.toLowerCase());
    if (!Number.isSafeInteger(c.amountPaise) || c.amountPaise < 0)
      issues.push({
        path: ['components', i, 'amountPaise'],
        message: 'Component amount must be a whole number of paise ≥ 0.',
      });
  });
  if (input.components.length > 0 && issues.length === 0) {
    const total = input.components.reduce((s, c) => s + c.amountPaise, 0);
    if (total !== input.amountPaise)
      issues.push({
        path: ['components'],
        message: `Components add up to ${total} paise but the amount is ${input.amountPaise} paise; the amount is the total of the listed earnings and allowances.`,
      });
  }
  return issues.length ? { ok: false, issues } : { ok: true };
}

export interface CompensationLike {
  id: string;
  staffId: string;
  status: CompensationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
}

/**
 * Approve `record`. Refused when it is not a draft, when the approver created
 * it or is the employee it is about (no self-approval), or when an approved or
 * superseded record of the same employee starts on or after its date (approvals
 * go forward in time; cancel and re-draft instead). Returns the record to
 * supersede (the current approved one) and its new end date.
 */
export function planCompensationApproval(
  record: CompensationLike,
  others: readonly CompensationLike[],
  approver: { userId: string; staffId: string | null },
):
  | { ok: true; supersede: { id: string; effectiveTo: IsoDate } | null }
  | { ok: false; code: 'ILLEGAL' | 'SELF_APPROVAL' | 'CONFLICT'; message: string } {
  if (record.status !== 'draft')
    return {
      ok: false,
      code: 'ILLEGAL',
      message: `Only drafts can be approved (this is ${record.status}).`,
    };
  if (record.createdBy === approver.userId)
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      message: 'A different authorised person must approve a record you drafted.',
    };
  if (approver.staffId && approver.staffId === record.staffId)
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      message: 'You cannot approve your own compensation.',
    };
  const sameEmployee = others.filter((o) => o.staffId === record.staffId && o.id !== record.id);
  const later = sameEmployee.find(
    (o) =>
      (o.status === 'approved' || o.status === 'superseded') &&
      o.effectiveFrom >= record.effectiveFrom,
  );
  if (later)
    return {
      ok: false,
      code: 'CONFLICT',
      message: `An approved record already starts on ${later.effectiveFrom}; a new record must start after it.`,
    };
  const current = sameEmployee.find((o) => o.status === 'approved');
  return {
    ok: true,
    supersede: current
      ? { id: current.id, effectiveTo: addDays(record.effectiveFrom as IsoDate, -1) }
      : null,
  };
}

/**
 * The record effective on `date` among approved and superseded records of one
 * employee. `conflict` is reported (never silently resolved) if windows overlap.
 */
export function effectiveRecordAt<T extends CompensationLike>(
  records: readonly T[],
  date: string,
): { record: T | null; conflict: boolean } {
  const hits = records.filter(
    (r) =>
      (r.status === 'approved' || r.status === 'superseded') &&
      r.effectiveFrom <= date &&
      (r.effectiveTo === null || r.effectiveTo >= date),
  );
  return { record: hits.length === 1 ? hits[0]! : null, conflict: hits.length > 1 };
}

/** Paise → "12345.67" (exact; no floating point). */
export function paiseToRupeesString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "45,000.50" style rupees for display (Indian grouping). */
export function formatInr(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const [whole, frac] = paiseToRupeesString(paise).split('.') as [string, string];
  const digits = whole.replace('-', '');
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${whole.startsWith('-') ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${frac}`;
}

/** CSV cell: quoted, quotes doubled, formula-injection characters neutralised. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CompensationExportRow {
  employeeCode: string;
  fullName: string;
  basis: CompensationBasis;
  amountPaise: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  components: readonly CompensationComponentInput[];
  recordId: string;
}

export const COMPENSATION_EXPORT_HEADER = [
  'export_reference',
  'as_of',
  'employee_code',
  'employee_name',
  'basis',
  'amount_paise',
  'amount_inr',
  'currency',
  'effective_from',
  'effective_to',
  'components',
  'record_id',
] as const;

/** CSV of the terms effective on `asOf` (sorted by employee code). */
export function compensationCsv(
  rows: readonly CompensationExportRow[],
  meta: { exportReference: string; asOf: string },
): string {
  const lines = [COMPENSATION_EXPORT_HEADER.join(',')];
  for (const r of [...rows].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))) {
    lines.push(
      [
        meta.exportReference,
        meta.asOf,
        r.employeeCode,
        r.fullName,
        r.basis,
        r.amountPaise,
        paiseToRupeesString(r.amountPaise),
        'INR',
        r.effectiveFrom,
        r.effectiveTo ?? '',
        r.components.map((c) => `${c.kind}:${c.label}:${c.amountPaise}`).join('; '),
        r.recordId,
      ]
        .map((v) => csvCell(v))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
