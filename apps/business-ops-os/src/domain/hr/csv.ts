/**
 * RFC 4180 CSV reading and writing (no dependency). Pure.
 *
 * Reader: optional UTF-8 BOM is dropped; records end at CRLF, LF or a lone CR;
 * fields may be quoted with `"` (a doubled `""` is a literal quote; quoted
 * fields may contain commas and line breaks); blank lines are skipped; an
 * unterminated quote or text after a closing quote is an error with its line.
 * Writer: quotes fields containing `,`, `"`, CR or LF, and neutralises
 * spreadsheet formulas (a leading `=`, `+`, `-`, `@`, tab or CR gets a `'`).
 */

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  line: number;
  fields: string[];
}

export type CsvParseResult =
  { ok: true; records: CsvRecord[] } | { ok: false; error: string; line: number };

export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let inQuotes = false;
  let quotedField = false; // the current field started with a quote
  let afterQuote = false; // a closing quote was just read
  let fieldStarted = false;
  let quotedFieldSeen = false; // any field of the current record was quoted

  const endField = () => {
    fields.push(field);
    field = '';
    quotedField = false;
    afterQuote = false;
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    const blank = fields.length === 1 && fields[0]!.trim() === '' && !quotedFieldSeen;
    if (!blank) records.push({ line: recordLine, fields });
    fields = [];
    quotedFieldSeen = false;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        afterQuote = true;
        i += 1;
        continue;
      }
      if (c === '\r' || c === '\n') {
        // Line break inside a quoted field: keep it, normalised as typed.
        if (c === '\r' && text[i + 1] === '\n') {
          field += '\r\n';
          i += 2;
        } else {
          field += c;
          i += 1;
        }
        line += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r' || c === '\n') {
      endRecord();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
      continue;
    }
    if (afterQuote) {
      return { ok: false, error: 'Unexpected text after a closing quote.', line };
    }
    if (c === '"') {
      if (fieldStarted) {
        return { ok: false, error: 'A quote inside an unquoted field must be quoted.', line };
      }
      inQuotes = true;
      quotedField = true;
      quotedFieldSeen = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    field += c;
    fieldStarted = true;
    i += 1;
  }
  if (inQuotes) return { ok: false, error: 'A quoted field is not closed.', line: recordLine };
  // Final record (no trailing line break).
  if (field !== '' || fields.length > 0 || quotedField) endRecord();
  return { ok: true, records };
}

/** Normalise a header cell: trim, lower-case, spaces/dashes → `_`. */
export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Records → objects keyed by the (normalised) header row. Reports unknown and
 * missing required columns and rows with a different field count.
 */
export function recordsToObjects(
  records: readonly CsvRecord[],
  columns: { required: readonly string[]; optional: readonly string[] },
):
  | { ok: true; rows: { line: number; values: Record<string, string>; fieldCountOk: boolean }[] }
  | { ok: false; error: string } {
  const [header, ...body] = records;
  if (!header) return { ok: false, error: 'The file is empty.' };
  const names = header.fields.map(normaliseHeader);
  const known = new Set([...columns.required, ...columns.optional]);
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length) return { ok: false, error: `Unknown column(s): ${unknown.join(', ')}.` };
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return { ok: false, error: `Column "${dup}" appears twice.` };
  const missing = columns.required.filter((c) => !names.includes(c));
  if (missing.length)
    return { ok: false, error: `Missing required column(s): ${missing.join(', ')}.` };
  return {
    ok: true,
    rows: body.map((r) => {
      const values: Record<string, string> = {};
      names.forEach((n, i) => {
        values[n] = (r.fields[i] ?? '').trim();
      });
      return { line: r.line, values, fieldCountOk: r.fields.length === names.length };
    }),
  };
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field: formula-neutralised and quoted when needed. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text with CRLF line endings (RFC 4180). */
export function toCsv(
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
) {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
