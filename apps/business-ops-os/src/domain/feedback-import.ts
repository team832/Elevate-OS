/**
 * Student feedback about teachers — spreadsheet import (owner brief 23 Oct 2026 §15, ruling R8).
 * Pure. Upload → column mapping → preview with row-level outcomes → commit of valid rows only.
 * - A teacher is matched by staff code or exact full name; a name two people share stays
 *   unresolved (never guessed). Batches must be one the teacher is assigned to in Academic OS.
 * - Duplicates: with a student identity, the same student + teacher + period + batch. Rows without
 *   one are never dropped (an exact repeat is only flagged); the file's sha256 stops re-imports.
 */
import { isIsoDate } from './dates';

export const MAX_FEEDBACK_CSV_CHARS = 2_000_000;
export const MAX_FEEDBACK_ROWS = 2000;

/** Fields a file column can map to; a rating category maps as `category:<code>`. */
export const IMPORT_FIELDS = {
  teacher: 'Teacher (staff code or exact full name)',
  batch: 'Batch code',
  subject: 'Subject',
  period_start: 'Period start (YYYY-MM-DD)',
  period_end: 'Period end (YYYY-MM-DD)',
  admission_number: 'Admission number (identifies the student)',
  submitted_by: 'Given by (student or guardian)',
  feedback_on: 'Date given (YYYY-MM-DD)',
  rating: 'Overall rating',
  comment: 'Written feedback',
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
/**
 * Key under which a stored row keeps the staff ids it may be about, decided at preview (never
 * re-matched on read). File headings may not start with `$`, so it cannot clash with a column.
 */
export const ABOUT_KEY = '$about';
/** The staff ids a stored row keeps under ABOUT_KEY. */
export const aboutOf = (raw: Record<string, unknown>): string[] => {
  const about = raw[ABOUT_KEY];
  return Array.isArray(about) ? (about as string[]) : [];
};
/** File column → field (`''` = not imported). */
export type Mapping = Record<string, string>;

/** Minimal RFC 4180 parser (quotes, "" escapes, commas/newlines in quotes, BOM); drops blank rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^\uFEFF/, '');
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
      rows.push([...row, cell]);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** The file as header + one record per data row (row 1 = first row under the header). */
export function readFeedbackCsv(
  text: string,
): { ok: true; header: string[]; rows: Record<string, string>[] } | { ok: false; error: string } {
  const [head, ...body] = parseCsv(text);
  const header = (head ?? []).map((h) => h.trim());
  if (!header.length || !body.length)
    return { ok: false, error: 'The file needs a header row and at least one feedback row.' };
  if (header.some((h) => !h) || new Set(header).size !== header.length)
    return { ok: false, error: 'Every column needs its own, non-empty heading.' };
  if (header.some((h) => h.startsWith('$')))
    return { ok: false, error: 'Column headings cannot start with $.' };
  if (body.length > MAX_FEEDBACK_ROWS)
    return { ok: false, error: `The file has more than ${MAX_FEEDBACK_ROWS} rows; split it.` };
  return {
    ok: true,
    header,
    rows: body.map((cells) =>
      Object.fromEntries(header.map((h, i) => [h, cells[i]?.trim() ?? ''])),
    ),
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Column → field by heading: field key, field label start, or category code/label. */
export function suggestMapping(
  header: readonly string[],
  categories: readonly { code: string; label: string }[],
): Mapping {
  const targets: [string, string[]][] = [
    ...Object.entries(IMPORT_FIELDS).map(
      ([k, label]) => [k, [k, norm(label.split(' (')[0]!)]] as [string, string[]],
    ),
    ...categories.map((c) => [`category:${c.code}`, [c.code, norm(c.label)]] as [string, string[]]),
  ];
  const used = new Set<string>();
  return Object.fromEntries(
    header.map((h) => {
      const hit = targets.find(([k, names]) => !used.has(k) && names.includes(norm(h)))?.[0] ?? '';
      if (hit) used.add(hit);
      return [h, hit];
    }),
  );
}

/** Problems with a mapping as a whole (no Teacher column, unknown targets, a field mapped twice). */
export function mappingProblems(mapping: Mapping, categoryCodes: readonly string[]): string[] {
  const valid = new Set([
    ...Object.keys(IMPORT_FIELDS),
    ...categoryCodes.map((c) => `category:${c}`),
  ]);
  const targets = Object.values(mapping).filter(Boolean);
  return [
    ...(targets.includes('teacher') ? [] : ['Map one column to Teacher.']),
    ...Object.keys(mapping)
      .filter((c) => c.startsWith('$'))
      .map((c) => `“${c}” is not a column of the file.`),
    ...targets.filter((t) => !valid.has(t)).map((t) => `“${t}” is not a field you can import.`),
    ...[...new Set(targets.filter((t, i) => targets.indexOf(t) !== i))].map(
      (t) => `Two columns are mapped to ${IMPORT_FIELDS[t as ImportField] ?? t}.`,
    ),
  ];
}

export type BatchMatch =
  | {
      ok: true;
      batchCode: string;
      subjectName: string | null;
      batchId: string | null;
      subjectId: string | null;
    }
  | { ok: false; message: string };

export interface RowContext {
  scaleMax: number;
  categoryCodes: readonly string[];
  /** Resolved staff id, 'ambiguous' (two people share the name) or null (no match). */
  teacher: (ref: string) => string | 'ambiguous' | null;
  /** Core student id for an admission number, or null. */
  student: (admissionNumber: string) => string | null;
  batch: (teacherStaffId: string, batchCode: string, subject: string | null) => BatchMatch;
}

/** One row as it will be stored in ops.student_teacher_feedback (method `import`). */
export interface FeedbackValues {
  teacherStaffId: string;
  studentId: string | null;
  submittedByKind: 'student' | 'guardian';
  courseLabel: string | null;
  subjectRef: string | null;
  batchId: string | null;
  subjectId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  feedbackOn: string;
  rating: number | null;
  categoryRatings: Record<string, number> | null;
  comment: string;
}

export type ImportOutcome = 'valid' | 'invalid' | 'duplicate' | 'unresolved';
export interface CheckedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  outcome: ImportOutcome;
  messages: string[];
  values: FeedbackValues | null;
}

/** Outcome of one row before duplicate checks: invalid > unresolved > valid. */
export function checkRow(
  rowNumber: number,
  raw: Record<string, unknown>,
  mapping: Mapping,
  ctx: RowContext,
): CheckedRow {
  const get = (field: string) => Object.entries(mapping).find(([, f]) => f === field)?.[0] ?? null;
  const cell = (field: string) => {
    const col = get(field);
    return col ? String(raw[col] ?? '').trim() : '';
  };
  const errors: string[] = [];
  const unresolved: string[] = [];
  const rate = (text: string, what: string) => {
    if (!text) return null;
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= ctx.scaleMax) return n;
    errors.push(`${what} “${text}” is not a whole number from 1 to ${ctx.scaleMax}.`);
    return null;
  };
  const date = (text: string, what: string) => {
    if (!text) return null;
    if (isIsoDate(text)) return text;
    errors.push(`${what} “${text}” is not a date written YYYY-MM-DD.`);
    return null;
  };

  const teacherRef = cell('teacher');
  const teacher = teacherRef ? ctx.teacher(teacherRef) : null;
  if (!teacherRef) errors.push('Teacher missing.');
  else if (teacher === 'ambiguous')
    unresolved.push(`More than one staff member is called “${teacherRef}”; use the staff code.`);
  else if (!teacher) unresolved.push(`No staff member has the code or name “${teacherRef}”.`);

  const periodStart = date(cell('period_start'), 'Period start');
  const periodEnd = date(cell('period_end'), 'Period end');
  if (!cell('period_start') || !cell('period_end')) errors.push('Review period missing.');
  else if (periodStart && periodEnd && periodEnd < periodStart)
    errors.push('Period end is before period start.');
  const feedbackOn = date(cell('feedback_on'), 'Date given') ?? periodEnd;

  const by = cell('submitted_by').toLowerCase();
  const submittedByKind = !by || by === 'student' ? 'student' : 'guardian';
  if (by && !['student', 'guardian', 'parent'].includes(by))
    errors.push(`Given by “${cell('submitted_by')}” must be student or guardian.`);

  const rating = rate(cell('rating'), 'Rating');
  const categoryEntries = ctx.categoryCodes.flatMap((code) => {
    const v = rate(cell(`category:${code}`), code.replace(/_/g, ' '));
    return v === null ? [] : [[code, v] as const];
  });
  const comment = cell('comment');
  if (rating === null && !categoryEntries.length && !comment && !errors.length)
    errors.push('No rating and no written feedback.');

  const admission = cell('admission_number');
  const studentId = admission ? ctx.student(admission) : null;
  if (admission && !studentId) unresolved.push(`No student has admission number “${admission}”.`);

  const batchCode = cell('batch');
  const subject = cell('subject') || null;
  let batch: BatchMatch | null = null;
  if (!batchCode) errors.push('Batch missing.');
  else if (teacher && teacher !== 'ambiguous') {
    batch = ctx.batch(teacher, batchCode, subject);
    if (!batch.ok) unresolved.push(batch.message);
  }

  const outcome: ImportOutcome = errors.length
    ? 'invalid'
    : unresolved.length
      ? 'unresolved'
      : 'valid';
  return {
    rowNumber,
    raw,
    outcome,
    messages: [...errors, ...unresolved],
    values:
      outcome === 'valid' && batch?.ok
        ? {
            teacherStaffId: teacher as string,
            studentId,
            submittedByKind,
            courseLabel: batch.batchCode,
            subjectRef: batch.subjectName,
            batchId: batch.batchId,
            subjectId: batch.subjectId,
            periodStart,
            periodEnd,
            feedbackOn: feedbackOn!,
            rating,
            categoryRatings: categoryEntries.length ? Object.fromEntries(categoryEntries) : null,
            comment,
          }
        : null,
  };
}

type KeyFields = Pick<
  FeedbackValues,
  | 'teacherStaffId'
  | 'studentId'
  | 'periodStart'
  | 'periodEnd'
  | 'courseLabel'
  | 'subjectRef'
  | 'rating'
  | 'categoryRatings'
  | 'comment'
  | 'submittedByKind'
  | 'feedbackOn'
>;

/**
 * Duplicate key: with a student, student + teacher + period + batch; without one, the whole row
 * (an exact repeat), because two anonymous answers may come from two different students.
 */
export function feedbackKey(v: KeyFields): string {
  const period = [v.teacherStaffId, v.periodStart, v.periodEnd, v.courseLabel?.toUpperCase()];
  if (v.studentId) return JSON.stringify(['student', v.studentId, ...period]);
  const cats = Object.entries(v.categoryRatings ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    'anonymous',
    ...period,
    v.subjectRef,
    v.submittedByKind,
    v.feedbackOn,
    v.rating,
    cats,
    v.comment.trim(),
  ]);
}

/**
 * Marks valid identified rows that repeat a stored row or an earlier row of the file as
 * duplicates. An anonymous row is never dropped (two students may give the same answers; the
 * file's sha256 guards against importing a file twice): an exact repeat only gets a warning.
 */
export function markDuplicates(rows: readonly CheckedRow[], existing: ReadonlySet<string>) {
  const seen = new Set(existing);
  return rows.map((r): CheckedRow => {
    if (r.outcome !== 'valid' || !r.values) return r;
    const key = feedbackKey(r.values);
    const repeat = seen.has(key);
    seen.add(key);
    if (!repeat) return r;
    if (!r.values.studentId)
      return {
        ...r,
        messages: ['Same answers as another anonymous response; imported anyway.'],
      };
    const message = existing.has(key)
      ? 'Already recorded (same feedback is stored).'
      : 'Repeats an earlier row of this file.';
    return { ...r, outcome: 'duplicate', messages: [message], values: null };
  });
}

export const countOutcomes = (rows: readonly { outcome: ImportOutcome }[]) => ({
  rowsTotal: rows.length,
  rowsValid: rows.filter((r) => r.outcome === 'valid').length,
  // Unresolved rows count as invalid in the import's totals (they are not imported).
  rowsInvalid: rows.filter((r) => r.outcome === 'invalid' || r.outcome === 'unresolved').length,
  rowsDuplicate: rows.filter((r) => r.outcome === 'duplicate').length,
});
