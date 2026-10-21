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
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  rgb,
  setLineJoin,
  type Color,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { fmtDateTime } from '../../ui/format';

const hex = (h: string) =>
  rgb(...([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]));
const INK = hex('#1d1b18');
const MUTED = hex('#5e5a53');
const LINE = hex('#cbc6bd');
const WHITE = hex('#ffffff');
const RULE = hex('#e4e1db');
const HEAD_FILL = hex('#f5f4f1');
const ACCENT = hex('#ed862a');
const TONES = {
  warning: [hex('#fbf0d9'), hex('#73500a')],
  success: [hex('#e5f2e8'), hex('#1d6431')],
  neutral: [hex('#efede9'), hex('#45413b')],
} as const;

// BrandLogo (packages/shared-ui/src/components/brand.tsx), viewBox 19 18 628 170.
const LOGO_LETTERS =
  'M30.6 112h62.8a31.5 35 0 1 0-6.6 24M132.5 39.5v106M170.6 112h62.8a31.5 35 0 1 0-6.6 24' +
  'M264 79.5l34 66 34-66M519 51.5V127a21.5 21.5 0 0 0 21.5 21.5M501.5 78h39' +
  'M570.6 112h62.8a31.5 35 0 1 0-6.6 24';
const LOGO_CHEVRONS = [
  ['M413 25 468 78v39l-55-49-55 49V78z', hex('#ff8623')],
  ['M413 103l55 49v26l-55-43-55 43v-26z', hex('#ffa43d')],
] as const;

/** A4 portrait (normal or form density), and the CR80 ID-card size (85.6 × 54 mm) with no running header or footer. */
const SIZES = {
  a4: { w: 595.28, h: 841.89, margin: 48, top: 82, bottom: 62, body: 10 },
  card: { w: 242.65, h: 153.07, margin: 10, top: 10, bottom: 10, body: 7 },
  /** A4 at paper-form density (the owner's 3-sheet admission form). */
  'a4-dense': { w: 595.28, h: 841.89, margin: 40, top: 66, bottom: 52, body: 8.5, tight: true },
};
const LEAD = 1.35;
const PAD = 4;

// Next runs with cwd = the app folder; the root test runner with cwd = the repo root.
const FONT_DIR =
  ['assets/fonts', 'apps/business-ops-os/assets/fonts']
    .map((p) => path.resolve(p))
    .find(existsSync) ?? 'assets/fonts';
let fontBytes: [Buffer, Buffer] | undefined;

export interface PdfMeta {
  title: string;
  /** Application reference, admission number or report id: printed in the header of every page. */
  reference: string;
  templateVersion: string;
  size?: keyof typeof SIZES;
  generatedAt?: Date;
}
/** null / undefined / '' print as "—" (missing, never zero). */
export type Cell = string | number | null | undefined;
export interface Column {
  header: string;
  /** Fraction of the content width; a table's widths add up to 1. */
  width: number;
  align?: 'left' | 'right';
}
interface Style {
  font: PDFFont;
  color: Color;
  align?: 'left' | 'right';
}

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

export class PdfBuilder {
  /** Every text line drawn, in order — lets tests check output without a PDF text extractor. */
  readonly lines: string[] = [];
  /** True when some character was not in the font and printed as "?". */
  unsupportedCharacters = false;
  private readonly p: (typeof SIZES)['a4'];
  private readonly charset: Set<number>;
  private readonly generatedAt: Date;
  private page!: PDFPage;
  private y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly meta: PdfMeta,
  ) {
    this.p = SIZES[meta.size ?? 'a4'];
    this.charset = new Set(regular.getCharacterSet());
    this.generatedAt = meta.generatedAt ?? new Date();
    this.newPage();
  }

  private get width() {
    return this.p.w - 2 * this.p.margin;
  }

  private newPage() {
    this.page = this.doc.addPage([this.p.w, this.p.h]);
    this.y = this.p.h - this.p.top;
  }

  /** Start a new page unless `height` points still fit above the bottom margin. */
  private ensure(height: number) {
    if (this.y - height < this.p.bottom) this.newPage();
  }

  private clean = (value: Cell): string =>
    value === null || value === undefined || value === ''
      ? '—'
      : Array.from(String(value).replace(/\r\n?/g, '\n'), (ch) => {
          if (ch === '\n' || this.charset.has(ch.codePointAt(0)!)) return ch;
          if (/\s/.test(ch)) return ' ';
          this.unsupportedCharacters = true;
          return '?';
        }).join('');

  /** Word wrap; a word wider than the line (a long reference, an email) breaks between characters. */
  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/ +/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        line = '';
        for (const ch of word) {
          if (line && !fits(line + ch)) {
            out.push(line);
            line = '';
          }
          line += ch;
        }
      }
      out.push(line);
    }
    return out;
  }

  private text(s: string, x: number, y: number, font: PDFFont, size: number, color: Color = INK) {
    this.page.drawText(s, { x, y, font, size, color });
    this.lines.push(s);
  }

  private hline(y: number, from: number, to: number, color: Color, thickness = 0.5) {
    this.page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness, color });
  }

  /** Draw the Elevate logo with its top-left corner at (x, top). */
  logo(x: number, top: number, height: number) {
    const s = height / 170;
    const at = { x: x - 19 * s, y: top + 18 * s, scale: s };
    this.page.pushOperators(setLineJoin(LineJoinStyle.Round));
    this.page.drawSvgPath(LOGO_LETTERS, {
      ...at,
      borderColor: INK,
      borderWidth: 23,
      borderLineCap: LineCapStyle.Round,
    });
    for (const [d, color] of LOGO_CHEVRONS)
      this.page.drawSvgPath(d, { ...at, color, borderColor: color, borderWidth: 10 });
  }

  space(points: number) {
    this.y -= points;
  }

  /** Start the next block on a new page (separately signed sheets, as on paper). */
  pageBreak() {
    this.newPage();
  }

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

  private row(
    cells: string[],
    fractions: number[],
    styles: Style[],
    onBreak = () => {},
    fill?: Color,
  ) {
    const size = this.p.body;
    const lead = size * LEAD;
    const widths = fractions.map((f) => f * this.width);
    let cols = cells.map((c, i) => this.wrap(c, styles[i]!.font, size, widths[i]! - 2 * PAD));
    const freshRoom = Math.floor((this.p.h - this.p.top - this.p.bottom) / lead) - 4;
    let justBroke = false;
    for (;;) {
      const need = Math.max(...cols.map((c) => c.length));
      const room = Math.floor((this.y - this.p.bottom - 2 * PAD) / lead);
      if (!justBroke && room < Math.min(need, freshRoom)) {
        this.newPage();
        onBreak();
        justBroke = true;
        continue;
      }
      const take = Math.max(1, Math.min(need, room));
      const height = take * lead + 2 * PAD;
      const bottom = this.y - height;
      if (fill)
        this.page.drawRectangle({
          x: this.p.margin,
          y: bottom,
          width: this.width,
          height,
          color: fill,
        });
      let x = this.p.margin;
      cols.forEach((lines, i) => {
        const { font, color, align } = styles[i]!;
        lines.slice(0, take).forEach((line, n) => {
          const dx =
            align === 'right' ? widths[i]! - PAD - font.widthOfTextAtSize(line, size) : PAD;
          this.text(line, x + dx, this.y - PAD - (n + 1) * lead + 3, font, size, color);
        });
        x += widths[i]!;
      });
      this.hline(bottom, this.p.margin, this.p.margin + this.width, fill ? LINE : RULE);
      this.y = bottom;
      cols = cols.map((c) => c.slice(take));
      if (take >= need) return;
      this.newPage();
      onBreak();
      justBroke = true;
    }
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

  /** Draw the running header and footer on every page (A4 only) and return the file. */
  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    if (this.meta.size !== 'card') {
      const { w, h, margin } = this.p;
      const right = (s: string, y: number, font: PDFFont, size: number, color: Color = INK) =>
        this.text(s, w - margin - font.widthOfTextAtSize(s, size), y, font, size, color);
      const [title, reference, footer] = [
        this.meta.title,
        this.meta.reference,
        `${this.meta.templateVersion} · Generated ${fmtDateTime(this.generatedAt)}`,
      ].map(this.clean) as [string, string, string];
      pages.forEach((page, i) => {
        this.page = page;
        this.logo(margin, h - 30, 16);
        this.text(title, margin + 72, h - 44, this.bold, 11);
        right(reference, h - 44, this.regular, 9, MUTED);
        this.hline(h - 56, margin, w - margin, ACCENT, 1);
        this.hline(44, margin, w - margin, LINE);
        this.text(footer, margin, 32, this.regular, 8, MUTED);
        right(`Page ${i + 1} of ${pages.length}`, 32, this.regular, 8, MUTED);
        if (this.unsupportedCharacters)
          this.text(
            'Some characters are not in the print font and show as "?".',
            margin,
            20,
            this.regular,
            8,
            MUTED,
          );
      });
    }
    this.doc.setTitle(`${this.meta.title} — ${this.meta.reference}`);
    this.doc.setCreator('Elevate OS');
    this.doc.setCreationDate(this.generatedAt);
    return this.doc.save();
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
