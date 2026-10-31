import { writeFileSync } from 'node:fs';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFRawStream,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { formatPaise } from '../../src/domain/fees';
import { createPdf, pdfResponse } from '../../src/server/pdf/document';

const LONG_NAME = 'Sample Student '.repeat(9).slice(0, 120);
const LONG_REF = 'X'.repeat(300);
const UNSUPPORTED_NOTE = 'Some characters are not in the print fonts and show as "?".';
const CARD = { title: 'Sample', reference: 'Sample', templateVersion: 'v1', size: 'card' } as const;

/** Base fonts a page uses, and each separately placed glyph as [x, y]. */
async function drawn(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const fonts = page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  const contents = page.node.Contents()!;
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const ops = streams
    .map((s) => doc.context.lookup(s) as PDFRawStream)
    .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
    .join('\n');
  return {
    fonts: fonts
      .values()
      .map((f) => String(doc.context.lookup(f, PDFDict).get(PDFName.of('BaseFont'))))
      .join(' '),
    glyphs: [...ops.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\s+<[0-9A-F]{4}> Tj/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]),
  };
}

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
  pdf.paragraph('Guardian name as typed: தமிழ் (Tamil is not in the print fonts).');
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
    // Characters in neither font print as "?" and the footer says so.
    expect(pdf.unsupportedCharacters).toBe(true);
    expect(pdf.lines.some((l) => l.includes('?????'))).toBe(true);
    expect(pdf.lines).toContain(UNSUPPORTED_NOTE);
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

  it('a card has no footer, so its bottom margin says when "?" was printed', async () => {
    const card = await createPdf(CARD);
    card.keyValues([['Name', 'தமிழ் 😀']]);
    await card.finish();
    expect(card.unsupportedCharacters).toBe(true);
    expect(card.lines).toContain('????? ?');
    expect(card.lines).toContain(UNSUPPORTED_NOTE);
  });

  // The glyph counts come from layouts that matched a HarfBuzz rendering pixel for pixel.
  it.each([
    ['शर्मा', 4],
    ['कृष्ण', 4],
    ['प्रिया', 4],
    ['ज्ञान', 3],
    ['विद्या', 4],
    ['श्री', 2],
    ['नित्या', 5],
  ])('shapes %s into %i glyphs and prints no "?"', async (word, count) => {
    const pdf = await createPdf(CARD);
    pdf.paragraph(word);
    const { fonts, glyphs } = await drawn(await pdf.finish());
    expect(fonts).toContain('NotoSansDevanagari-Regular');
    expect(glyphs).toHaveLength(count);
    expect(pdf.lines).toEqual([word]);
    expect(pdf.unsupportedCharacters).toBe(false);
  });

  it('places marks where the font says, not at the next pen position', async () => {
    const pdf = await createPdf(CARD);
    pdf.paragraph('कु');
    const { glyphs } = await drawn(await pdf.finish());
    expect(glyphs[1]![0]! - glyphs[0]![0]!).toBeCloseTo((768 - 221) * 0.007, 3); // ka's advance, the mark's offset, 7 pt
  });

  it('every block picks the font per run, measures by those runs and keeps ₹ and digits in Noto Sans', async () => {
    const MIXED = "O'Brien शर्मा ₹500";
    const pdf = await createPdf({ title: MIXED, reference: MIXED, templateVersion: 'v1' });
    pdf.banner(MIXED);
    pdf.heading(MIXED);
    pdf.paragraph(MIXED);
    pdf.keyValues([['Name', MIXED]]);
    pdf.keyValuePairs([['Name', MIXED, 'Parent', MIXED]]);
    pdf.bars([{ label: MIXED, value: 1, note: MIXED }]);
    pdf.signatures([{ label: MIXED, name: MIXED }]);
    const { fonts } = await drawn(await pdf.finish());
    for (const font of [
      'NotoSans-Regular',
      'NotoSans-Bold',
      'NotoSansDevanagari-Regular',
      'NotoSansDevanagari-Bold',
    ])
      expect(fonts).toContain(font);
    expect(pdf.unsupportedCharacters).toBe(false);
    expect(pdf.lines.filter((l) => l === MIXED).length).toBeGreaterThanOrEqual(11);
    expect(pdf.lines.join(' ')).not.toContain('?');
  });

  it('right-aligns Hindi by its shaped width', async () => {
    const pdf = await createPdf({ title: 'Sample', reference: 'Sample', templateVersion: 'v1' });
    pdf.table(
      [
        { header: 'Sample', width: 0.5 },
        { header: 'Amount', width: 0.5, align: 'right' },
      ],
      [['Sample', 'ज्ञान']],
    );
    const { glyphs } = await drawn(await pdf.finish());
    expect(glyphs.at(-1)![0]).toBeCloseTo(48 + 499.28 - 4 - 5.55, 2); // margin + width - padding - na's advance at 10 pt
  });

  it('wraps a long Hindi word between letters, never inside one', async () => {
    const WORD = 'कि'.repeat(60);
    const pdf = await createPdf({ title: 'Sample', reference: 'Sample', templateVersion: 'v1' });
    pdf.table(
      [
        { header: 'Name', width: 0.3 },
        { header: 'Note', width: 0.7 },
      ],
      [[WORD, 'Sample']],
    );
    const parts = pdf.lines.filter((l) => l.includes('क'));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(WORD);
    for (const part of parts) expect(part).toMatch(/^(कि)+$/); // a split would strand the matra on a dotted circle
  });

  it('a document without Hindi does not use the Hindi font', async () => {
    const pdf = await createPdf(CARD);
    pdf.paragraph('Sample Student ₹500');
    expect((await drawn(await pdf.finish())).fonts).not.toContain('Devanagari');
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

describe('the running header', () => {
  const header = async (reference: string) => {
    const pdf = await createPdf({ title: 'Student Admission & Fee Record', reference, templateVersion: 't/1' });
    await pdf.finish();
    return pdf.lines;
  };

  it('a short reference stays on one line', async () => {
    expect(await header('APP-000123 · version 2')).toContain('APP-000123 · version 2');
  });

  it('a long reference wraps beside the title instead of running over it, and none of it is lost', async () => {
    const long = 'Sample Staff Member With A Very Long Family Name And Another Long Family Name · 1 Oct 2026 to 31 Oct 2026 · v12';
    const lines = await header(long);
    expect(lines).not.toContain(long);
    const pieces = lines.filter((l) => long.includes(l) && l !== 'Student Admission & Fee Record');
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join(' ')).toBe(long);
  });
});
