/**
 * Printable documents (admission form, acknowledgement, ID card, progress report) as real PDFs.
 * Light paper look: white page, dark text, brand orange only in the logo and the header rule.
 * Colours are the light tokens in packages/shared-ui/src/styles.css; the logo is BrandLogo's SVG.
 * Font: Noto Sans 2.015 (SIL OFL 1.1, assets/fonts/OFL.txt), embedded as a subset.
 *
 * shortcut: no complex-script shaping (Devanagari etc.) and Latin + ₹ glyphs only; any character the
 * font lacks prints as "?" and the footer says so. Upgrade by vendoring Noto Sans Devanagari and
 * picking the font per text run.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import {
  HEAD_FILL,
  INK,
  LEAD,
  LINE,
  MUTED,
  PAD,
  PdfCanvas,
  RULE,
  TONES,
  WHITE,
  ACCENT,
  type Cell,
  type Column,
  type PdfMeta,
} from './document-canvas';

export type { Cell, Column, PdfMeta } from './document-canvas';

// Next runs with cwd = the app folder (or another workspace app serving the shared work
// entry, D-073); the root test runner with cwd = the repo root.
const FONT_DIR =
  ['assets/fonts', 'apps/business-ops-os/assets/fonts', '../business-ops-os/assets/fonts']
    .map((p) => path.resolve(p))
    .find(existsSync) ?? 'assets/fonts';
let fontBytes: [Buffer, Buffer] | undefined;

export async function createPdf(meta: PdfMeta): Promise<PdfBuilder> {
  fontBytes ??= [
    readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')),
    readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')),
  ];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all(
    fontBytes.map((b) => doc.embedFont(b, { subset: true })),
  );
  return new PdfBuilder(doc, regular!, bold!, meta);
}

/** The content blocks of a document (headings, key–value grids, tables, charts, banners, signatures). */
export class PdfBuilder extends PdfCanvas {
  /**
   * Label–value pairs, two per line, like the grid of the owner's paper form. `photo` keeps an
   * empty bordered 35 × 45 mm box at the right for a pasted passport-size photo (none is stored).
   */
  keyValuePairs(rows: [string, Cell, string?, Cell?][], { photo = false } = {}) {
    const [w, h] = [99, 128];
    const fractions = photo ? [0.15, 0.24, 0.13, 0.28] : [0.21, 0.29, 0.2, 0.3];
    const styles = [MUTED, INK, MUTED, INK].map((color) => ({ font: this.regular, color }));
    if (photo) this.ensure(h + 8);
    const top = this.y;
    for (const [a, b, c, d] of rows)
      this.row(
        [this.clean(a), this.clean(b), c ? this.clean(c) : ' ', c ? this.clean(d) : ' '],
        fractions,
        styles,
      );
    if (photo) {
      const x = this.p.margin + this.width - w;
      this.page.drawRectangle({
        x,
        y: top - h - 4,
        width: w,
        height: h,
        color: WHITE,
        borderColor: LINE,
        borderWidth: 0.75,
      });
      const size = this.p.body * 0.8;
      this.wrap('Paste passport-size photo', this.regular, size, w - 2 * PAD).forEach((line, n) =>
        this.text(line, x + PAD, top - h / 2 - n * size * LEAD, this.regular, size, MUTED),
      );
      // The next section's heading may sit beside the box's lower edge (it is short, at the left).
      this.y = Math.min(this.y, top - h + 20);
    }
    this.y -= 2;
  }

  heading(value: string) {
    const size = this.p.body * 1.25;
    this.ensure(size * LEAD + 10 + this.p.body * LEAD * 3); // keep a heading with its first lines
    const [above, below] = 'tight' in this.p ? [5, 4] : [8, 6];
    this.y -= above + size;
    this.text(this.clean(value), this.p.margin, this.y, this.bold, size);
    this.y -= below;
  }

  paragraph(value: Cell, { muted = false } = {}) {
    const lead = this.p.body * LEAD;
    for (const line of this.wrap(this.clean(value), this.regular, this.p.body, this.width)) {
      this.ensure(lead);
      this.y -= lead;
      this.text(line, this.p.margin, this.y + 3, this.regular, this.p.body, muted ? MUTED : INK);
    }
    this.y -= lead / 2;
  }

  /** Label → value rows; a missing value prints "—". */
  keyValues(rows: [string, Cell][]) {
    const styles = [
      { font: this.regular, color: MUTED },
      { font: this.regular, color: INK },
    ];
    for (const row of rows) this.row(row.map(this.clean), [0.32, 0.68], styles);
    this.y -= this.p.body / 2;
  }

  /**
   * Horizontal bars with the value printed beside each (report charts). `max` is the value that
   * fills a bar (100 for percentages); default: the largest value. A null value draws no bar and
   * prints `missingText` (absent is never 0). Every label and value also lands in `lines`.
   */
  bars(
    rows: { label: string; value: number | null; text?: string; note?: string }[],
    { max, missingText = 'Not recorded' }: { max?: number; missingText?: string } = {},
  ) {
    const known = rows.map((r) => r.value).filter((v): v is number => v !== null);
    const full = max ?? Math.max(1, ...known);
    const size = this.p.body;
    const rowH = size * LEAD + 5;
    const labelW = this.width * 0.34;
    const valueW = this.width * 0.16;
    const trackX = this.p.margin + labelW + PAD;
    const trackW = this.width - labelW - valueW - 2 * PAD;
    for (const r of rows) {
      const noteLines = r.note
        ? this.wrap(this.clean(r.note), this.regular, size * 0.85, this.width - labelW)
        : [];
      this.ensure(rowH + noteLines.length * size * LEAD);
      this.y -= rowH;
      const base = this.y + 4;
      const [label] = this.wrap(this.clean(r.label), this.regular, size, labelW - PAD);
      this.text(label ?? '', this.p.margin, base, this.regular, size);
      this.page.drawRectangle({
        x: trackX,
        y: base - 1,
        width: trackW,
        height: size * 0.7,
        color: RULE,
      });
      if (r.value !== null) {
        const w = Math.max(1, Math.min(1, r.value / full) * trackW);
        this.page.drawRectangle({
          x: trackX,
          y: base - 1,
          width: w,
          height: size * 0.7,
          color: ACCENT,
        });
      }
      const value = r.value === null ? missingText : (r.text ?? String(r.value));
      this.text(
        this.clean(value),
        trackX + trackW + PAD,
        base,
        this.bold,
        size,
        r.value === null ? MUTED : INK,
      );
      for (const line of noteLines) {
        this.y -= size * LEAD * 0.9;
        this.text(line, trackX, this.y + 4, this.regular, size * 0.85, MUTED);
      }
    }
    this.y -= this.p.body / 2;
  }

  /** Wrapping cells; the header row repeats on every page; a tall row continues on the next page. */
  table(columns: Column[], rows: Cell[][]) {
    const widths = columns.map((c) => c.width);
    const head = () =>
      this.row(
        columns.map((c) => this.clean(c.header)),
        widths,
        columns.map((c) => ({ font: this.bold, color: INK, align: c.align })),
        () => {},
        HEAD_FILL,
      );
    head();
    const styles = columns.map((c) => ({ font: this.regular, color: INK, align: c.align }));
    for (const r of rows) this.row(r.map(this.clean), widths, styles, head);
    this.y -= this.p.body / 2;
  }

  /** A full-width status line, e.g. "Application — admission pending". */
  banner(value: string, tone: keyof typeof TONES = 'warning') {
    const [bg, fg] = TONES[tone];
    const size = this.p.body * 1.1;
    const lines = this.wrap(this.clean(value), this.bold, size, this.width - 4 * PAD);
    const height = lines.length * size * LEAD + 4 * PAD;
    this.ensure(height + 6);
    this.y -= height + 6;
    this.page.drawRectangle({
      x: this.p.margin,
      y: this.y,
      width: this.width,
      height,
      color: bg,
      borderColor: fg,
      borderWidth: 0.75,
    });
    lines.forEach((line, n) =>
      this.text(
        line,
        this.p.margin + 2 * PAD,
        this.y + height - 2 * PAD - (n + 1) * size * LEAD + 3,
        this.bold,
        size,
        fg,
      ),
    );
    this.y -= 6;
  }

  /** Boxes for physical signatures, up to three per line: label, signature line, name, date line. */
  signatures(boxes: { label: string; name?: Cell }[]) {
    const size = this.p.body * 0.9;
    const lead = size * LEAD;
    const gap = 12;
    for (let i = 0; i < boxes.length; i += 3) {
      const group = boxes.slice(i, i + 3);
      const w = (this.width - gap * (group.length - 1)) / group.length;
      const wrapped = group.map((b) => ({
        label: this.wrap(this.clean(b.label), this.bold, size, w - 16),
        name: b.name ? this.wrap(this.clean(b.name), this.regular, size, w - 46) : [],
      }));
      const nameRows = Math.max(1, ...wrapped.map((b) => b.name.length)) - 1;
      const labelRows = Math.max(...wrapped.map((b) => b.label.length));
      const height = 92 + (nameRows + labelRows) * lead; // label, 40pt to sign on, signature line, name, date
      this.ensure(height + 8);
      this.y -= height + 8;
      const b = this.y;
      const sign = b + 44 + nameRows * lead;
      wrapped.forEach(({ label, name }, n) => {
        const x = this.p.margin + n * (w + gap);
        const rule = (y: number, from: number) => this.hline(y, from, x + w - 8, LINE);
        this.page.drawRectangle({
          x,
          y: b,
          width: w,
          height,
          borderColor: LINE,
          borderWidth: 0.75,
        });
        label.forEach((l, k) => this.text(l, x + 8, b + height - 14 - k * lead, this.bold, size));
        rule(sign, x + 8);
        this.text('Signature', x + 8, sign - 10, this.regular, size * 0.9, MUTED);
        this.text('Name', x + 8, b + 20 + nameRows * lead, this.regular, size, MUTED);
        name.forEach((l, k) =>
          this.text(l, x + 38, b + 20 + (nameRows - k) * lead, this.regular, size),
        );
        if (!name.length) rule(b + 19 + nameRows * lead, x + 38);
        this.text('Date', x + 8, b + 7, this.regular, size, MUTED);
        rule(b + 6, x + 38);
      });
    }
  }
}

/** The download response for a route; `defineRoute` has already checked sign-in and permission. */
export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
    },
  });
}
