import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { formatPaise } from '../../src/domain/fees';
import { createPdf, pdfResponse } from '../../src/server/pdf/document';

const LONG_NAME = 'Sample Student '.repeat(9).slice(0, 120);
const LONG_REF = 'X'.repeat(300);

/** The toolkit's example document: fictional sample data only (D-036). */
async function sampleDocument() {
  const pdf = await createPdf({
    title: 'Admission form',
    reference: 'Sample APP-0001',
    templateVersion: 'Template sample-v1',
    generatedAt: new Date('2026-10-21T08:00:00Z'),
  });
  pdf.banner('Application — admission pending');
  pdf.heading('Student');
  pdf.keyValues([
    ['Full name', LONG_NAME],
    ['Preferred name', null],
    ['Email', 'sample.student@example.test'],
    ['Reference', LONG_REF],
  ]);
  pdf.heading('Annual fee agreement');
  pdf.table(
    [
      { header: 'Instalment', width: 0.4 },
      { header: 'Due date', width: 0.3 },
      { header: 'Amount', width: 0.3, align: 'right' },
    ],
    [
      ['1 (50%)', '—', formatPaise(6_000_000)],
      ['2 (25%)', null, formatPaise(3_000_000)],
      ['3 (25%)', undefined, formatPaise(3_000_000)],
      ['Annual tuition', '', formatPaise(12_000_000)],
    ],
  );
  pdf.paragraph('Guardian name as typed: आरव शर्मा (Devanagari is not in the print font).');
  pdf.paragraph('[\u00a0\u00a0] I agree (no-break spaces keep the box)');
  pdf.heading('Attendance log (sample rows)');
  pdf.table(
    [
      { header: 'Date', width: 0.25 },
      { header: 'Session', width: 0.5 },
      { header: 'Status', width: 0.25 },
    ],
    Array.from({ length: 150 }, (_, i) => [
      `Sample day ${i + 1}`,
      `Sample session ${i + 1}`,
      'present',
    ]),
  );
  pdf.signatures([
    { label: 'Student', name: LONG_NAME },
    { label: 'Parent / guardian' },
    { label: 'Admissions staff' },
  ]);
  return pdf;
}

describe('PDF toolkit', () => {
  it('builds a multi-page A4 document with page numbers, ₹ amounts and missing values', async () => {
    const pdf = await sampleDocument();
    const bytes = await pdf.finish();
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, bytes);

    const loaded = await PDFDocument.load(bytes);
    const pages = loaded.getPages();
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) expect(page.getSize()).toEqual({ width: 595.28, height: 841.89 });
    pages.forEach((_, i) => expect(pdf.lines).toContain(`Page ${i + 1} of ${pages.length}`));

    expect(pdf.lines).toEqual(expect.arrayContaining(['₹60,000.00', '₹1,20,000.00', '—']));
    expect(pdf.lines.filter((l) => l === 'Instalment').length).toBe(1);
    expect(pdf.lines.filter((l) => l === 'Session').length).toBeGreaterThanOrEqual(2); // header repeated
    // Nothing clipped: every character of the long name and the unbroken reference is drawn.
    expect(pdf.lines.filter((l) => /^X+$/.test(l)).join('')).toBe(LONG_REF);
    expect(pdf.lines.join(' ')).toContain(LONG_NAME.slice(0, 40));
    // Unsupported glyphs print as "?" and the footer says so.
    expect(pdf.unsupportedCharacters).toBe(true);
    expect(pdf.lines.some((l) => l.includes('?? ????'))).toBe(true);
    expect(pdf.lines).toContain('Some characters are not in the print font and show as "?".');
    expect(pdf.lines).toContain('[\u00a0\u00a0] I agree (no-break spaces keep the box)');
  });

  it('makes a CR80 ID-card page without a running header or footer', async () => {
    const card = await createPdf({
      title: 'ID card',
      reference: '001',
      templateVersion: 'v1',
      size: 'card',
    });
    card.logo(10, 143, 14);
    card.keyValues([
      ['Name', LONG_NAME],
      ['Admission no.', '001'],
    ]);
    const loaded = await PDFDocument.load(await card.finish());
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getPage(0).getSize()).toEqual({ width: 242.65, height: 153.07 });
    expect(card.lines.some((l) => l.startsWith('Page '))).toBe(false);
  });

  it('pdfResponse sets download headers and a safe file name', async () => {
    const res = pdfResponse(new Uint8Array([37, 80, 68, 70]), 'admission "form"/001.pdf');
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="admission__form__001.pdf"',
      'cache-control': 'no-store',
    });
  });
});
