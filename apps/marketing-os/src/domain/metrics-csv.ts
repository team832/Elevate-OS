/**
 * Metrics CSV parsing (MKT-028, MKT-029; docs/ALGORITHMS.md §8) — a TypeScript port of the
 * legacy `tools/import-metrics.mjs` (read-only reference) using the formats in
 * data/legacy/marketing/metrics-csv-formats.json, with the audit's defects fixed:
 *  1. Instagram impressions are stored as impressions, never as views.
 *  2. Dates are parsed with a DECLARED format (no `Date.parse`, no US-style guessing).
 *  3. Every value carries a state (reported / missing / not_applicable / estimated) and the
 *     capture time is recorded by the importer (server/metrics.ts), not just "imported on".
 *  4. Rows are validated; rejected rows are reported with reasons, never silently dropped.
 */
import { isIsoDate, type IsoDate } from '@elevate/shared-types';
import { METRIC_KEYS, type MetricKey, type MetricState } from './vocabulary';

export const CSV_FORMATS = ['instagram_meta_business_suite', 'youtube_studio_table_data'] as const;
export type CsvFormatId = (typeof CSV_FORMATS)[number];

export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
  'MMM D, YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Minimal RFC 4180 parser (quotes, escaped quotes, commas/newlines in quotes, BOM); drops blank rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a BOM
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Find a column by any of several header names: exact (case-insensitive) first, then "contains". */
export function headerFinder(header: readonly string[]) {
  const h = header.map((x) => x.trim().toLowerCase());
  return (...names: string[]): number => {
    for (const n of names) {
      const i = h.findIndex((x) => x === n);
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = h.findIndex((x) => x.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
}

/** Same detection order as the legacy script: YouTube first, then Instagram. */
export function detectCsvFormat(header: readonly string[]): CsvFormatId | null {
  const h = header.map((x) => x.trim().toLowerCase()).join('|');
  if (h.includes('video title') || h.includes('watch time')) return 'youtube_studio_table_data';
  if (h.includes('permalink') || h.includes('reach') || h.includes('post type')) {
    return 'instagram_meta_business_suite';
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parse the date part of a cell in the declared format. A trailing time ("18:00",
 * "T18:00:00Z") is ignored — the calendar date as written in the export is kept.
 */
export function parseDeclaredDate(
  raw: string,
  format: DateFormat,
): { ok: true; date: IsoDate } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'publish date is empty' };
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let match: RegExpExecArray | null;
  switch (format) {
    case 'YYYY-MM-DD':
      match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value);
      if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case 'DD/MM/YYYY':
    case 'MM/DD/YYYY':
    case 'DD-MM-YYYY': {
      const sep = format === 'DD-MM-YYYY' ? '-' : '/';
      const re = new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{4})(?:[T\\s,].*)?$`);
      match = re.exec(value);
      if (match) {
        const a = Number(match[1]);
        const b = Number(match[2]);
        y = Number(match[3]);
        [d, m] = format === 'MM/DD/YYYY' ? [b, a] : [a, b];
      }
      break;
    }
    case 'MMM D, YYYY':
      match = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:[\s,].*)?$/.exec(value);
      if (match) {
        const idx = MONTHS.indexOf(match[1]!.toLowerCase());
        if (idx >= 0) [y, m, d] = [Number(match[3]), idx + 1, Number(match[2])];
      }
      break;
  }
  if (y === undefined || m === undefined || d === undefined) {
    return { ok: false, error: `"${value}" is not a ${format} date` };
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isIsoDate(iso)) return { ok: false, error: `"${value}" is not a real ${format} date` };
  return { ok: true, date: iso };
}

const MISSING_MARKERS = new Set(['', '-', '--', '—', 'n/a', 'na', 'null']);

export type ParsedNumber =
  { state: 'missing' } | { state: 'reported'; value: number } | { state: 'invalid'; raw: string };

/** Blank (or an explicit "no data" marker) is MISSING — never a fake 0; "0" is a reported zero. */
export function parseMetricNumber(raw: string | undefined): ParsedNumber {
  const original = (raw ?? '').trim();
  if (MISSING_MARKERS.has(original.toLowerCase())) return { state: 'missing' };
  const s = original.replace(/[,%\s]/g, '');
  if (s === '') return { state: 'missing' };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { state: 'invalid', raw: original };
  return { state: 'reported', value: n };
}

export interface MetricCell {
  value: number | null;
  state: MetricState;
  basis: string | null;
}

export interface ParsedMetricRow {
  /** 1-based line in the file (the header is line 1). */
  rowNumber: number;
  postKey: string;
  link: string | null;
  title: string | null;
  publishedOn: IsoDate;
  platformFormat: string | null;
  formatEstimated: boolean;
  metrics: Record<MetricKey, MetricCell>;
}

export interface RejectedRow {
  rowNumber: number;
  reasons: string[];
  /** The first cells of the row, for the report. */
  preview: string;
}

export interface MetricsCsvResult {
  format: CsvFormatId | null;
  /** Which header was used for each field (null = not in this export). */
  headerMap: Record<string, string | null>;
  rows: ParsedMetricRow[];
  rejected: RejectedRow[];
  skipped: { rowNumber: number; reason: string }[];
  errors: string[];
}

type FieldSpec = Partial<Record<MetricKey, string[]>>;

const INSTAGRAM_METRICS: FieldSpec = {
  views: ['views', 'plays'],
  reach: ['reach'],
  impressions: ['impressions'],
  likes: ['likes'],
  comments: ['comments'],
  shares: ['shares'],
  saves: ['saves'],
};
const INSTAGRAM_NOT_APPLICABLE: MetricKey[] = ['watch_hours', 'ctr_pct'];

const YOUTUBE_METRICS: FieldSpec = {
  views: ['views'],
  watch_hours: ['watch time (hours)', 'watch time'],
  impressions: ['impressions'],
  ctr_pct: ['impressions click-through rate', 'click-through rate'],
  likes: ['likes'],
  comments: ['comments added', 'comments'],
  shares: ['shares'],
};
const YOUTUBE_NOT_APPLICABLE: MetricKey[] = ['reach', 'saves'];

export function parseMetricsCsv(
  text: string,
  options: { dateFormat: DateFormat; expectedFormat?: CsvFormatId },
): MetricsCsvResult {
  const result: MetricsCsvResult = {
    format: null,
    headerMap: {},
    rows: [],
    rejected: [],
    skipped: [],
    errors: [],
  };
  const table = parseCsv(text);
  const header = table[0];
  if (!header) {
    result.errors.push('The file is empty.');
    return result;
  }
  const format = detectCsvFormat(header);
  if (!format) {
    result.errors.push(
      'Not an Instagram (Meta Business Suite) or YouTube Studio export: no recognised headers.',
    );
    return result;
  }
  if (options.expectedFormat && options.expectedFormat !== format) {
    result.errors.push(
      `Expected a ${options.expectedFormat} export but the headers look like ${format}.`,
    );
    return result;
  }
  result.format = format;
  const find = headerFinder(header);
  const name = (i: number) => (i >= 0 ? header[i]!.trim() : null);
  const isYouTube = format === 'youtube_studio_table_data';
  const cols = isYouTube
    ? {
        id: find('content'),
        title: find('video title'),
        published: find('video publish time', 'publish time'),
        duration: find('duration'),
        link: -1,
        format: -1,
      }
    : {
        id: -1,
        title: find('description', 'caption'),
        published: find('publish time', 'date'),
        duration: -1,
        link: find('permalink'),
        format: find('post type'),
      };
  const metricSpec = isYouTube ? YOUTUBE_METRICS : INSTAGRAM_METRICS;
  const notApplicable = isYouTube ? YOUTUBE_NOT_APPLICABLE : INSTAGRAM_NOT_APPLICABLE;
  const metricCols = new Map<MetricKey, number>();
  for (const key of METRIC_KEYS) {
    const names = metricSpec[key];
    metricCols.set(key, names ? find(...names) : -1);
    result.headerMap[key] = names ? name(metricCols.get(key)!) : null;
  }
  for (const [k, i] of Object.entries(cols)) result.headerMap[k] = name(i);

  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    const at = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    const preview = cells.slice(0, 3).join(' | ').slice(0, 160);
    if (isYouTube && at(cols.id).toLowerCase() === 'total') {
      result.skipped.push({ rowNumber, reason: 'Totals row' });
      return;
    }
    const reasons: string[] = [];
    const date = parseDeclaredDate(at(cols.published), options.dateFormat);
    if (!date.ok) reasons.push(`Publish date: ${date.error}.`);
    const contentId = at(cols.id);
    const link = isYouTube
      ? contentId
        ? `https://youtu.be/${contentId}`
        : null
      : at(cols.link) || null;
    const title = at(cols.title) ? at(cols.title).slice(0, 200) : null;
    if (!link && !title) reasons.push('Neither a link nor a title identifies the post.');

    const metrics = {} as Record<MetricKey, MetricCell>;
    for (const key of METRIC_KEYS) {
      if (notApplicable.includes(key)) {
        metrics[key] = {
          value: null,
          state: 'not_applicable',
          basis: `${format} does not report ${key}`,
        };
        continue;
      }
      const col = metricCols.get(key) ?? -1;
      if (col < 0) {
        metrics[key] = { value: null, state: 'missing', basis: 'column not in this export' };
        continue;
      }
      const parsed = parseMetricNumber(cells[col]);
      if (parsed.state === 'invalid') {
        reasons.push(`${header[col]!.trim()}: "${parsed.raw}" is not a non-negative number.`);
        metrics[key] = { value: null, state: 'missing', basis: 'invalid cell' };
      } else if (parsed.state === 'missing') {
        metrics[key] = {
          value: null,
          state: 'missing',
          basis: `blank in column "${header[col]!.trim()}"`,
        };
      } else {
        metrics[key] = {
          value: parsed.value,
          state: 'reported',
          basis: `column "${header[col]!.trim()}"`,
        };
      }
    }

    let platformFormat: string | null = null;
    let formatEstimated = false;
    if (isYouTube) {
      const secs = parseMetricNumber(cells[cols.duration]);
      if (secs.state === 'reported') {
        platformFormat = secs.value <= 180 ? 'short' : 'video';
        formatEstimated = true; // inferred from duration, not a platform flag
      }
    } else {
      platformFormat = at(cols.format) || null;
    }

    if (reasons.length > 0 || !date.ok) {
      result.rejected.push({ rowNumber, reasons, preview });
      return;
    }
    const postKey = link ?? `${title}|${date.date}`;
    const earlier = seen.get(postKey);
    if (earlier !== undefined) {
      result.rejected.push({
        rowNumber,
        reasons: [`Duplicate of row ${earlier} (same post).`],
        preview,
      });
      return;
    }
    seen.set(postKey, rowNumber);
    result.rows.push({
      rowNumber,
      postKey,
      link,
      title,
      publishedOn: date.date,
      platformFormat,
      formatEstimated,
      metrics,
    });
  });
  return result;
}
