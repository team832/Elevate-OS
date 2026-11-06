/**
 * Receipts, certificates and admit cards (F4-01 … F4-03): financial year, numbers, amount in
 * words (Indian numbering), wording placeholders, settings, and the three PDFs (page sizes,
 * marks, Hindi names, two admit cards per A4). PDF_SAMPLE_OUT=<folder> writes the files to look at.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { AcademicAdmitCardsV1 } from '@elevate/shared-contracts';
import {
  documentNumber,
  fillWording,
  financialYearOf,
  rupeesInWords,
  unknownPlaceholders,
} from '../../src/domain/documents';
import { SETTING_DEFINITIONS, validateSettingChange } from '../../src/domain/policies';
import { admitCardsPdf } from '../../src/server/pdf/admit-card';
import { certificatePdf } from '../../src/server/pdf/certificate';
import { receiptPdf } from '../../src/server/pdf/receipt';
import type { CertificateListItem } from '../../src/server/certificates';
import type { ReceiptDocument } from '../../src/server/receipts';

const out = process.env.PDF_SAMPLE_OUT;
const save = (name: string, bytes: Uint8Array) =>
  out ? writeFileSync(path.join(out, name), bytes) : undefined;
const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages();
const HINDI = 'आरव नमूना';

describe('financial year and numbers', () => {
  it.each([
    ['2027-03-31', '2026-27'],
    ['2027-04-01', '2027-28'],
    ['2026-11-06', '2026-27'],
    ['2026-01-15', '2025-26'],
    ['2099-12-31', '2099-00'],
  ])('%s is in %s', (day, year) => expect(financialYearOf(day)).toBe(year));

  it('pads the sequence', () => {
    expect(documentNumber(['ER', '2026-27'], 1, 6)).toBe('ER/2026-27/000001');
    expect(documentNumber(['EC', 'BONAFIDE', '2026-27'], 12, 4)).toBe('EC/BONAFIDE/2026-27/0012');
  });
});

describe('amount in words (Indian numbering)', () => {
  it.each([
    [1, 'One Paisa Only'],
    [2, 'Two Paise Only'],
    [101, 'Rupees One and One Paisa Only'],
    [100, 'Rupees One Only'],
    [10_000_000, 'Rupees One Lakh Only'],
    [50, 'Fifty Paise Only'],
    [12_000_000, 'Rupees One Lakh Twenty Thousand Only'],
    [1_234_567, 'Rupees Twelve Thousand Three Hundred Forty Five and Sixty Seven Paise Only'],
    [120_405_005, 'Rupees Twelve Lakh Four Thousand Fifty and Five Paise Only'],
    [99_999, 'Rupees Nine Hundred Ninety Nine and Ninety Nine Paise Only'],
    [1_000_000_000, 'Rupees One Crore Only'],
    [
      123_456_789_000,
      'Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety Only',
    ],
  ])('%i paise', (paise, words) => expect(rupeesInWords(paise)).toBe(words));
});

describe('certificate wording', () => {
  it('fills the placeholders and names unknown ones', () => {
    expect(unknownPlaceholders('{student} in {batch} on {issue date}')).toEqual(['batch']);
    expect(
      fillWording('{student} ({admission number})', {
        student: 'Sample Student',
        'admission number': 'EE-1',
        programme: '',
        'academic year': '',
        'issue date': '',
        institute: '',
      }),
    ).toBe('Sample Student (EE-1)');
  });

  const types = SETTING_DEFINITIONS['certificates.types'].defaultValue;
  it.each([
    [
      'an unknown placeholder',
      {
        ...types,
        types: [{ ...types.types[0]!, template: 'Certified for {batch} only, as recorded.' }],
      },
      /braces/,
    ],
    ['the same code twice', { ...types, types: [types.types[0]!, types.types[0]!] }, /once/],
    ['a small-letter prefix', { ...types, numberPrefix: 'ec' }, /Number prefix/],
  ])('the setting refuses %s', (_n, value, message) => {
    const r = validateSettingChange('certificates.types', value);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(message);
  });

  it('accepts the proposed defaults', () => {
    for (const key of [
      'fees.receipts',
      'certificates.types',
      'tests.admit_card_block_defaulters',
      'tests.admit_card_instructions',
    ] as const)
      expect(validateSettingChange(key, SETTING_DEFINITIONS[key].defaultValue).ok).toBe(true);
    expect(SETTING_DEFINITIONS['tests.admit_card_block_defaulters'].defaultValue).toEqual({
      leaveOut: false,
    });
  });
});

const receipt = (over: Partial<ReceiptDocument> = {}): ReceiptDocument => ({
  number: 'ER/2026-27/000001',
  issuedAt: new Date('2026-11-06T05:00:00Z'),
  duplicate: false,
  cancelled: false,
  isSample: true,
  student: HINDI,
  admissionNumber: null,
  programme: 'CLAT',
  charge: 'Tuition',
  amountPaise: 1_234_567,
  paymentDate: '2026-11-05',
  method: 'UPI',
  reference: 'SAMPLE-UTR-0000000000000000000000000000000000000000000001',
  instalment: '1 of 3, due 05 Nov 2026',
  balancePaise: 2_500_000,
  recordedBy: 'Sample Finance Officer',
  ...over,
});

describe('receipt PDF', () => {
  it.each([
    ['a4', 595.28],
    ['a5', 419.53],
  ] as const)(
    '%s: one page, the amount in figures and words, Hindi name shaped',
    async (size, width) => {
      const r = await receiptPdf(receipt(), size);
      save(`receipt-${size}.pdf`, r.bytes);
      const p = await pages(r.bytes);
      expect(p).toHaveLength(1);
      expect(p[0]!.getWidth()).toBeCloseTo(width, 1);
      expect(r.unsupported).toBe(false);
      expect(r.lines).toEqual(
        expect.arrayContaining([HINDI, '₹12,345.67', 'Not assigned yet', '₹25,000.00 to pay']),
      );
      expect(r.lines.join(' ')).toContain(
        'Rupees Twelve Thousand Three Hundred Forty Five and Sixty Seven Paise Only',
      );
      expect(r.lines.join(' ')).not.toMatch(/Duplicate|Cancelled/);
    },
  );

  it.each([
    [{ duplicate: true }, 'Duplicate'],
    [
      { cancelled: true, duplicate: true },
      'Cancelled: this payment was reversed and does not count · Duplicate',
    ],
    [{ balancePaise: null }, 'Not recorded (no charge recorded)'],
    [{ balancePaise: -10_000 }, '₹100.00 paid in advance'],
  ])('%j prints %s', async (over, text) => {
    const r = await receiptPdf(receipt(over), 'a5');
    if ('cancelled' in over) save('receipt-cancelled-a5.pdf', r.bytes);
    expect(await pages(r.bytes)).toHaveLength(1);
    expect(r.lines.join(' ')).toContain(text);
  });
});

const certificate = (over: Partial<CertificateListItem['c']> = {}): CertificateListItem => ({
  c: {
    id: '00000000-0000-4000-8000-000000000001',
    certificateType: 'bonafide',
    certificateNumber: 'EC/BONAFIDE/2026-27/0001',
    financialYear: '2026-27',
    sequence: 1,
    studentId: '00000000-0000-4000-8000-000000000002' as never,
    programmeId: null,
    batchId: null,
    issueDate: '2026-11-06',
    body: `This is to certify that ${HINDI}, admission number EE-2026-001, is a bonafide student of Elevate Education.`,
    status: 'issued',
    issuedBy: '00000000-0000-4000-8000-000000000003' as never,
    issuedAt: new Date('2026-11-06T05:00:00Z'),
    printCount: 1,
    revokedBy: null,
    revokedAt: null,
    revokeReason: null,
    ...over,
  },
  student: HINDI,
  isSample: true,
  programme: 'CLAT',
  issuedByName: 'Sample Director',
  admissionId: '00000000-0000-4000-8000-000000000004',
  typeLabel: 'Bonafide certificate',
});

describe('certificate PDF', () => {
  it.each<[Partial<CertificateListItem['c']>, string[], string[]]>([
    [{}, [], ['Duplicate', 'Revoked']],
    [{ printCount: 2 }, ['Duplicate'], ['Revoked']],
    [
      {
        status: 'revoked' as const,
        revokedAt: new Date('2026-11-07T05:00:00Z'),
        revokeReason: 'Issued in error',
      },
      [],
      ['Duplicate'],
    ],
  ])('%j: one A4 page with the stored wording', async (over, has, hasNot) => {
    const r = await certificatePdf(certificate(over));
    if (over.revokeReason) save('certificate-revoked.pdf', r.bytes);
    else if (!over.printCount) save('certificate.pdf', r.bytes);
    expect(await pages(r.bytes)).toHaveLength(1);
    const text = r.lines.join(' ');
    expect(text).toContain('is a bonafide student of Elevate Education.');
    expect(r.lines).toContain('EC/BONAFIDE/2026-27/0001');
    for (const t of has) expect(text).toContain(t);
    for (const t of hasNot) expect(text).not.toContain(t);
    if (over.revokeReason) expect(text).toMatch(/Revoked on .*: Issued in error/);
  });
});

const admitData = (instructions: string | null = null): AcademicAdmitCardsV1 => ({
  contract: 'academic.admit_cards',
  version: 1,
  generatedAt: '2026-11-06T05:00:00.000Z' as never,
  assessment: {
    id: '00000000-0000-4000-8000-0000000000a1',
    code: 'SAMPLE-MOCK-1',
    title: 'Sample CLAT mock 1',
    status: 'scheduled',
    courseName: 'Sample CLAT',
    scheduledDate: '2026-11-20' as never,
    startTime: '10:00',
    durationMinutes: 120,
    rosterSnapshotAt: '2026-11-06T05:00:00.000Z' as never,
    venue: { online: false, roomId: null, roomName: 'Room 1 (R1)' },
    instructions,
    isSample: true,
  },
  rooms: [],
  rows: Array.from({ length: 5 }, (_, i) => ({
    rosterId: `00000000-0000-4000-8000-0000000001${i}0`,
    coreStudentId: null,
    admissionNumber: i === 4 ? null : `EE-2026-00${i + 1}`,
    displayName: i === 0 ? HINDI : `Sample Student ${i + 1}`,
    batchId: '00000000-0000-4000-8000-0000000000b1' as never,
    batchCode: 'SAMPLE-CLAT-A',
    rollNumber: i + 1,
  })),
});

describe('admit cards PDF', () => {
  it.each([
    [2, 1],
    [5, 3],
  ])('%i cards on %i A4 sheets, long instructions included', async (n, sheets) => {
    const d = admitData();
    const r = await admitCardsPdf(
      d,
      d.rows.slice(0, n),
      'Bring this card. '.repeat(35).slice(0, 600),
    );
    if (n === 5) save('admit-cards.pdf', r.bytes);
    const p = await pages(r.bytes);
    expect(p).toHaveLength(sheets);
    expect(p[0]!.getWidth()).toBeCloseTo(595.28, 1);
    expect(r.lines.filter((l) => l.startsWith('Admit card · '))).toHaveLength(n);
    expect(r.lines).toEqual(
      expect.arrayContaining([HINDI, 'Room 1 (R1)', '10:00 IST, 120 minutes']),
    );
    expect(r.lines.includes('Not assigned')).toBe(n === 5);
  });

  it.each([
    [{ online: true, roomId: null, roomName: null }, 'Online'],
    [{ online: false, roomId: null, roomName: null }, 'Venue not set'],
  ])('venue %j prints %s', async (venue, text) => {
    const d = admitData();
    const r = await admitCardsPdf(
      { ...d, assessment: { ...d.assessment, venue } },
      d.rows.slice(0, 1),
      'Bring this card.',
    );
    expect(r.lines).toContain(text);
  });
});
