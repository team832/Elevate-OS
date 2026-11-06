/**
 * The drawing layer under ./document (split from it): light-paper colours, the logo, page sizes,
 * wrapping and missing-value text, table rows, page breaks, and the running header and footer.
 */
import type { Font } from '@pdf-lib/fontkit';
import {
  beginText,
  endText,
  LineCapStyle,
  LineJoinStyle,
  type PDFDocument,
  PDFHexString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setLineJoin,
  setTextMatrix,
  showText,
  type Color,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { fmtDateTime } from '../../ui/format';

/** The Devanagari block (all in the font) and the joiners that change how its letters combine. */
const HINDI_RUN = /([\u0900-\u097F\u200C\u200D]+)/;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const UNSUPPORTED_NOTE = 'Some characters are not in the print fonts and show as "?".';

const hex = (h: string) =>
  rgb(...([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]));
export const INK = hex('#1d1b18');
export const MUTED = hex('#5e5a53');
export const LINE = hex('#cbc6bd');
export const WHITE = hex('#ffffff');
export const RULE = hex('#e4e1db');
export const HEAD_FILL = hex('#f5f4f1');
export const ACCENT = hex('#ed862a');
export const TONES = {
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
  /** A5 portrait (the half-sheet fee receipt, F4-01). */
  a5: { w: 419.53, h: 595.28, margin: 32, top: 72, bottom: 52, body: 8.5 },
};
export const LEAD = 1.35;
export const PAD = 4;

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
export interface Style {
  font: PDFFont;
  color: Color;
  align?: 'left' | 'right';
}
/** The Hindi partner of a Latin font: the embedded font, and fontkit's parse of it for shaping. */
export interface HindiFont {
  font: PDFFont;
  shaper: Font;
}

/** Page geometry, text primitives and the running header/footer; content blocks are in PdfBuilder. */
export class PdfCanvas {
  /** Every text line drawn, in order — lets tests check output without a PDF text extractor. */
  readonly lines: string[] = [];
  /** True when some character was in neither font and printed as "?". */
  unsupportedCharacters = false;
  protected readonly p: (typeof SIZES)['a4'];
  protected readonly charset: Set<number>;
  protected readonly generatedAt: Date;
  protected page!: PDFPage;
  protected y = 0;

  constructor(
    protected readonly doc: PDFDocument,
    protected readonly regular: PDFFont,
    protected readonly bold: PDFFont,
    private readonly hindi: Map<PDFFont, HindiFont>,
    protected readonly meta: PdfMeta,
  ) {
    this.p = SIZES[meta.size ?? 'a4'];
    this.charset = new Set(regular.getCharacterSet());
    this.generatedAt = meta.generatedAt ?? new Date();
    this.newPage();
  }

  protected get width() {
    return this.p.w - 2 * this.p.margin;
  }

  protected newPage() {
    this.page = this.doc.addPage([this.p.w, this.p.h]);
    this.y = this.p.h - this.p.top;
  }

  /** Start a new page unless `height` points still fit above the bottom margin. */
  protected ensure(height: number) {
    if (this.y - height < this.p.bottom) this.newPage();
  }

  protected clean = (value: Cell): string =>
    value === null || value === undefined || value === ''
      ? '—'
      : Array.from(String(value).replace(/\r\n?/g, '\n'), (ch) => {
          if (ch === '\n' || this.charset.has(ch.codePointAt(0)!) || HINDI_RUN.test(ch)) return ch;
          if (/\s/.test(ch)) return ' ';
          this.unsupportedCharacters = true;
          return '?';
        }).join('');

  /** Width of a line as `text` draws it. */
  protected widthOf(s: string, font: PDFFont, size: number) {
    const { shaper } = this.hindi.get(font)!;
    return s
      .split(HINDI_RUN)
      .reduce(
        (w, run, i) =>
          w +
          (i % 2
            ? (shaper.layout(run).advanceWidth * size) / shaper.unitsPerEm
            : font.widthOfTextAtSize(run, size)),
        0,
      );
  }

  /** Word wrap; a word wider than the line (a long reference, an email) breaks between letters. */
  protected wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const fits = (s: string) => this.widthOf(s, font, size) <= width;
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
        for (const { segment } of GRAPHEMES.segment(word)) {
          if (line && !fits(line + segment)) {
            out.push(line);
            line = '';
          }
          line += segment;
        }
      }
      out.push(line);
    }
    return out;
  }

  protected text(s: string, x: number, y: number, font: PDFFont, size: number, color: Color = INK) {
    s.split(HINDI_RUN).forEach((run, i) => {
      if (i % 2) x = this.shaped(run, x, y, font, size, color);
      else if (run) {
        this.page.drawText(run, { x, y, font, size, color });
        x += font.widthOfTextAtSize(run, size);
      }
    });
    this.lines.push(s);
  }

  /** drawText keeps fontkit's glyph choice but drops its positions (marks, kerning), so place each glyph. */
  private shaped(run: string, x: number, y: number, on: PDFFont, size: number, color: Color) {
    const { font, shaper } = this.hindi.get(on)!;
    const scale = size / shaper.unitsPerEm;
    const glyphs = font.encodeText(run).asString(); // four hex digits per glyph, in layout order
    const ops = [
      pushGraphicsState(),
      beginText(),
      setFillingColor(color),
      setFontAndSize(this.page.node.newFontDictionary(font.name, font.ref), size),
    ];
    shaper.layout(run).positions.forEach((p, i) => {
      ops.push(
        setTextMatrix(1, 0, 0, 1, x + p.xOffset * scale, y + p.yOffset * scale),
        showText(PDFHexString.of(glyphs.slice(i * 4, i * 4 + 4))),
      );
      x += p.xAdvance * scale;
    });
    this.page.pushOperators(...ops, endText(), popGraphicsState());
    return x;
  }

  protected hline(y: number, from: number, to: number, color: Color, thickness = 0.5) {
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

  /** Start a new page unless `height` points still fit (keep a block together). */
  keep(height: number) {
    this.ensure(height);
  }

  protected row(
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
    const padY = 'tight' in this.p ? PAD - 1 : PAD; // paper-form density: the form's first sheet is full
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
      const height = take * lead + 2 * padY;
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
          const dx = align === 'right' ? widths[i]! - PAD - this.widthOf(line, font, size) : PAD;
          this.text(line, x + dx, this.y - padY - (n + 1) * lead + 3, font, size, color);
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

  /** Draw the running header and footer on every page (A4 only) and return the file. */
  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    if (this.meta.size !== 'card') {
      const { w, h, margin } = this.p;
      const right = (s: string, y: number, font: PDFFont, size: number, color: Color = INK) =>
        this.text(s, w - margin - this.widthOf(s, font, size), y, font, size, color);
      const [title, reference, footer] = [
        this.meta.title,
        this.meta.reference,
        `${this.meta.templateVersion} · Generated ${fmtDateTime(this.generatedAt)}`,
      ].map(this.clean) as [string, string, string];
      // The reference takes the room the title leaves, at most three lines above the rule (the file's title keeps all of it).
      const wrapped = this.wrap(reference, this.regular, 9, w - 2 * margin - 88 - this.widthOf(title, this.bold, 11));
      const refLines = wrapped.length > 3 ? [...wrapped.slice(0, 2), `${wrapped[2]!.slice(0, -1)}…`] : wrapped;
      pages.forEach((page, i) => {
        this.page = page;
        this.logo(margin, h - 30, 16);
        this.text(title, margin + 72, h - 44, this.bold, 11);
        refLines.forEach((l, n) => right(l, h - 44 + (refLines.length - 1 - n) * 10, this.regular, 9, MUTED));
        this.hline(h - 56, margin, w - margin, ACCENT, 1);
        this.hline(44, margin, w - margin, LINE);
        this.text(footer, margin, 32, this.regular, 8, MUTED);
        right(`Page ${i + 1} of ${pages.length}`, 32, this.regular, 8, MUTED);
        if (this.unsupportedCharacters)
          this.text(UNSUPPORTED_NOTE, margin, 20, this.regular, 8, MUTED);
      });
    } else if (this.unsupportedCharacters)
      // A card has no footer, so the note sits in its bottom margin.
      pages.forEach((page) => {
        this.page = page;
        this.text(UNSUPPORTED_NOTE, this.p.margin, 4, this.regular, 5, MUTED);
      });
    this.doc.setTitle(`${this.meta.title} — ${this.meta.reference}`);
    this.doc.setCreator('Elevate OS');
    this.doc.setCreationDate(this.generatedAt);
    return this.doc.save();
  }
}
