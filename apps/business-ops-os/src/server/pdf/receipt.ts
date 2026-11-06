/**
 * Fee receipt PDF `fee-receipt/1` (F4-01), A4 or A5: institute details, the payment, the amount in
 * figures and words, what is left to pay after it, and "Duplicate" / "Cancelled" marks. Built
 * only from stored rows (server/receipts.ts); missing values print "—", never zero.
 */
import { INSTITUTE } from '@elevate/shared-ui';
import { rupeesInWords } from '../../domain/documents';
import { formatPaise, MANUAL_FEE_DISCLAIMER } from '../../domain/fees';
import { fmtDate, fmtDateTime } from '../../ui/format';
import type { ReceiptDocument } from '../receipts';
import { createPdf } from './document';

export const RECEIPT_SIZES = ['a4', 'a5'] as const;
export type ReceiptSize = (typeof RECEIPT_SIZES)[number];
export const RECEIPT_TEMPLATE = 'fee-receipt/1';

const balanceText = (paise: number | null) =>
  paise === null
    ? 'Not recorded (no charge recorded)'
    : paise > 0
      ? `${formatPaise(paise)} to pay`
      : paise < 0
        ? `${formatPaise(-paise)} paid in advance`
        : 'Nothing left to pay';

export async function receiptPdf(r: ReceiptDocument, size: ReceiptSize = 'a4') {
  const pdf = await createPdf({
    title: 'Fee receipt',
    reference: r.number,
    templateVersion: RECEIPT_TEMPLATE,
    size,
  });
  pdf.paragraph(`Elevate Education · ${INSTITUTE.legalName}`);
  pdf.paragraph(
    `${INSTITUTE.address} · ${INSTITUTE.phone} · ${INSTITUTE.email} · GSTIN ${INSTITUTE.gstin}`,
    { muted: true },
  );
  const marks = [
    r.cancelled && 'Cancelled: this payment was reversed and does not count',
    r.duplicate && 'Duplicate',
    r.isSample && 'Sample data, fictional student',
  ].filter(Boolean);
  if (marks.length) pdf.banner(marks.join(' · '), r.cancelled ? 'warning' : 'neutral');
  pdf.keyValuePairs([
    ['Receipt no.', r.number, 'Issued', fmtDateTime(r.issuedAt)],
    ['Student', r.student, 'Admission no.', r.admissionNumber ?? 'Not assigned yet'],
    ['Programme', r.programme, 'For', r.charge],
    ['Payment date', fmtDate(r.paymentDate), 'Mode', r.method],
    ['Instalment', r.instalment, 'Reference', r.reference],
  ]);
  pdf.keyValues(
    [
      ['Amount received', formatPaise(r.amountPaise)],
      ['In words', rupeesInWords(r.amountPaise)],
      ['Balance after this payment (all fees)', balanceText(r.balancePaise)],
    ],
    { together: true },
  );
  pdf.paragraph(MANUAL_FEE_DISCLAIMER, { muted: true });
  pdf.signatures([{ label: 'Received by', name: r.recordedBy }]);
  return { bytes: await pdf.finish(), lines: pdf.lines, unsupported: pdf.unsupportedCharacters };
}
