/**
 * Payslip PDF `payslip/1` (F4-14): A4, one page per staff member (a run's bulk file has one page
 * each): institute line, employee facts, earnings and deductions, net pay in figures and in words
 * (Indian numbering, the receipts' helper), payment. "Draft" until the payroll is approved; "Sample data" on fictional
 * staff. Hindi names print through the toolkit's Devanagari font.
 */
import { INSTITUTE } from '@elevate/shared-ui';
import { formatPaise } from '../../domain/fees';
import { rupeesInWords } from '../../domain/documents';
import { PAY_MODE_LABELS } from '../../domain/payroll';
import { istToday } from '../../domain/dates';
import { fmtDate, fmtMonth } from '../../ui/format';
import type { RunPayslip } from '../payroll-read';
import { createPdf } from './document';

export const DRAFT_BANNER = 'Draft: this payroll is not approved, so this is not a payslip yet.';

const paidText = (s: RunPayslip) =>
  s.paidOn
    ? `Paid on ${fmtDate(s.paidOn)}, ${PAY_MODE_LABELS[s.paidMode!]}${s.paidReference ? `, reference ${s.paidReference}` : ''}`
    : 'Not marked paid yet';

export async function payslipsPdf(
  run: { month: string; status: string; isSample: boolean },
  slips: readonly RunPayslip[],
  reference: string,
) {
  const month = fmtMonth(run.month.slice(0, 7));
  const recordedOn = fmtDate(istToday(new Date()));
  const pdf = await createPdf({
    title: `Payslip · ${month}`,
    reference,
    templateVersion: 'payslip/1',
  });
  slips.forEach((s, i) => {
    if (i) pdf.pageBreak();
    if (run.status !== 'approved') pdf.banner(DRAFT_BANNER, 'warning');
    if (run.isSample || s.isSample)
      pdf.banner('Sample data: a fictional staff member, not a real payment.', 'neutral');
    pdf.paragraph(`Elevate Education · ${INSTITUTE.legalName} · ${INSTITUTE.address}`, {
      muted: true,
    });
    pdf.keyValuePairs([
      ['Employee', s.staffName, 'Employee ID', s.staffCode ?? 'Not recorded'],
      ['Job title', s.title ?? 'Not recorded', 'Department', s.department ?? 'Not recorded'],
      ['Month', month, 'Days in the month', s.daysInMonth],
      ['Loss-of-pay days', s.lossOfPayDays, 'Payment', paidText(s)],
    ]);
    // No snapshot columns: name and role are today's, and the line says so.
    pdf.paragraph(`Name, job title and department as recorded on ${recordedOn}.`, { muted: true });
    for (const [kind, title, total, sum] of [
      ['earning', 'Earnings', 'Gross earnings', s.earningsPaise],
      ['deduction', 'Deductions', 'Total deductions', s.deductionsPaise],
    ] as const) {
      pdf.space(12);
      pdf.table(
        [
          { header: title, width: 0.7 },
          { header: 'Amount', width: 0.3, align: 'right' },
        ],
        [
          ...s.lines
            .filter((l) => l.kind === kind)
            .map((l) => [l.label, formatPaise(l.amountPaise)]),
          [total, formatPaise(sum)],
        ],
      );
    }
    pdf.keyValues([
      ['Net pay', formatPaise(s.netPaise)],
      // Only a draft can be below zero (submitting refuses it).
      ['In words', `${s.netPaise < 0 ? 'Minus ' : ''}${rupeesInWords(Math.abs(s.netPaise))}`],
    ]);
  });
  return { bytes: await pdf.finish(), lines: pdf.lines };
}
