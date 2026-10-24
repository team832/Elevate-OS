/**
 * Assessment score import, step 1: read the file and stage its rows (owner brief 23 Oct 2026
 * §18, §20). Pure. CSV only (owner answer 2; Excel → "save as CSV"); AI-extracted rows from a
 * PDF are staged the same way with source 'ai'.
 * - Marks are exact integer units, 1 mark = 10 000 — the same unit as Academic OS marks.ts.
 * - A blank cell is "not entered", never 0. Attendance is read only from an Attendance column.
 * - Allowed range follows Academic's scoreBounds (scoring.ts): per section, max = questions ×
 *   marks per correct (capped), min = questions × the lowest of per-wrong, per-unattempted and 0;
 *   the total range is the sum of the section ranges.
 * Matching: score-import-match.ts. Review, confirm plan and ranking: score-import-validate.ts.
 */
import { parseCsv } from './feedback-import';

export const UNITS_PER_MARK = 10_000;
export type MarkUnits = number;
export const MAX_SCORE_ROWS = 2000;
export const MAX_SCORE_CSV_CHARS = 2_000_000;
/** Key under which a record keeps cells beyond the last heading (headings may not start with $). */
export const EXTRA_CELLS = '$extra';

const MARK_RE = /^([+-])?(\d{1,6})(?:\.(\d{1,4}))?$/;

/** An exact mark in units (as Academic's parseMarks); '' → null, not an exact mark → undefined. */
export function markUnits(text: string): MarkUnits | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = MARK_RE.exec(t);
  if (!m) return undefined;
  const units =
    (m[1] === '-' ? -1 : 1) * (Number(m[2]) * UNITS_PER_MARK + Number((m[3] ?? '').padEnd(4, '0')));
  return units || 0;
}

/** Human form of units: `12.75`, `-0.25`, `12`. */
export function formatUnits(units: MarkUnits): string {
  const abs = Math.abs(units);
  const frac = String(abs % UNITS_PER_MARK)
    .padStart(4, '0')
    .replace(/0+$/, '');
  return `${units < 0 ? '-' : ''}${Math.floor(abs / UNITS_PER_MARK)}${frac ? `.${frac}` : ''}`;
}

/** One section's resolved rule, as Academic's ResolvedSectionRule (marks as decimal strings). */
export interface ScoreSection {
  code: string;
  name: string;
  /** Questions that count (dropped ones excluded); null = unknown, then capMarks is required. */
  questionCount: number | null;
  perCorrect: string;
  /** Signed, e.g. "-0.25". */
  perWrong: string;
  perUnattempted: string;
  capMarks: string | null;
}
export interface MarkingRules {
  sections: readonly ScoreSection[];
}
export interface MarkRange {
  minUnits: MarkUnits;
  maxUnits: MarkUnits;
  /** A question count is unknown, so the floor is only an estimate: negatives warn above `floorUnits`. */
  estimated: boolean;
  /** Below this nothing is possible: `minUnits`, or when estimated 10 × the larger of max and |estimate| below 0. */
  floorUnits: MarkUnits;
}
export type ScoreRanges =
  | { ok: true; total: MarkRange; sections: Record<string, MarkRange> }
  | { ok: false; problems: string[] };

/** Thrown by stageScoreRows for rules scoreRanges rejects; `problems` are ready to show. */
export class ScoreRulesError extends Error {
  constructor(readonly problems: string[]) {
    super(`The test's marking rules cannot be used: ${problems.join(' ')}`);
    this.name = 'ScoreRulesError';
  }
}

/** Allowed total and per-section ranges, or why the marking rules cannot be used. */
export function scoreRanges(rules: MarkingRules): ScoreRanges {
  const problems: string[] = rules.sections.length ? [] : ['The test has no sections.'];
  const sections: Record<string, MarkRange> = {};
  for (const s of rules.sections) {
    const fail = (message: string) => problems.push(`${s.code}: ${message}`);
    const mark = (text: string, what: string) => {
      const u = markUnits(text);
      if (u === null || u === undefined) fail(`${what} “${text}” is not an exact mark.`);
      return u ?? null;
    };
    const perCorrect = mark(s.perCorrect, 'marks per correct answer');
    const worst = Math.min(
      mark(s.perWrong, 'marks per wrong answer') ?? 0,
      mark(s.perUnattempted, 'marks per unattempted question') ?? 0,
      0,
    );
    const cap = s.capMarks === null ? null : mark(s.capMarks, 'maximum');
    if (perCorrect !== null && perCorrect <= 0) fail('marks per correct answer must be above 0.');
    if (s.questionCount !== null && !(Number.isInteger(s.questionCount) && s.questionCount >= 0))
      fail('the number of questions must be a whole number.');
    if (s.questionCount === null && cap === null)
      fail('give the number of questions or a maximum.');
    if (problems.length || perCorrect === null) continue;
    // shortcut: unknown count → cap ÷ perCorrect questions; the floor is then only an estimate.
    const n = s.questionCount ?? Math.ceil(cap! / perCorrect);
    const minUnits = n * worst;
    const maxUnits = cap === null ? n * perCorrect : Math.min(n * perCorrect, cap);
    const estimated = s.questionCount === null && worst < 0;
    // A loose hard floor for estimates, so a stray "-999999" is still blocked.
    const range = {
      minUnits,
      maxUnits,
      estimated,
      floorUnits: estimated ? -10 * Math.max(maxUnits, -minUnits) : minUnits,
    };
    if (range.maxUnits < range.minUnits)
      fail(
        `the maximum (${formatUnits(range.maxUnits)}) is below the minimum (${formatUnits(range.minUnits)}).`,
      );
    sections[s.code] = range;
  }
  if (problems.length) return { ok: false, problems };
  const all = Object.values(sections);
  return {
    ok: true,
    sections,
    total: {
      minUnits: all.reduce((a, r) => a + r.minUnits, 0),
      maxUnits: all.reduce((a, r) => a + r.maxUnits, 0),
      estimated: all.some((r) => r.estimated),
      floorUnits: all.reduce((a, r) => a + r.floorUnits, 0),
    },
  };
}

type FixedField = 'admission_number' | 'student_code' | 'name' | 'total' | 'attendance';
export type ScoreField = FixedField | `section:${string}`;
/** File column → field ('' = not imported). */
export type ScoreMapping = Record<string, ScoreField | ''>;

export const SCORE_FIELDS: Record<FixedField, { label: string; headings: string[] }> = {
  admission_number: {
    label: 'Admission number',
    headings: ['admission_number', 'admission_no', 'adm_no', 'admission'],
  },
  student_code: { label: 'Student code', headings: ['student_code', 'student_id', 'code'] },
  name: { label: 'Student name', headings: ['name', 'student_name', 'student', 'full_name'] },
  total: { label: 'Total marks', headings: ['total', 'total_marks', 'marks', 'score'] },
  attendance: { label: 'Attendance', headings: ['attendance', 'attendance_status'] },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** The file as header + one record per data row. */
export function readScoreCsv(
  text: string,
): { ok: true; header: string[]; rows: Record<string, string>[] } | { ok: false; error: string } {
  if (text.length > MAX_SCORE_CSV_CHARS)
    return { ok: false, error: 'The file is too large (over 2,000,000 characters); split it.' };
  const [head, ...body] = parseCsv(text);
  const header = (head ?? []).map((h) => h.trim());
  if (!header.length || !body.length)
    return { ok: false, error: 'The file needs a header row and at least one student row.' };
  if (header.some((h) => !h) || new Set(header).size !== header.length)
    return { ok: false, error: 'Every column needs its own, non-empty heading.' };
  if (header.some((h) => h.startsWith('$')))
    return { ok: false, error: 'Column headings cannot start with $.' };
  if (body.length > MAX_SCORE_ROWS)
    return { ok: false, error: `The file has more than ${MAX_SCORE_ROWS} rows; split it.` };
  return {
    ok: true,
    header,
    rows: body.map((cells) => {
      const extra = cells.slice(header.length).filter((c) => c.trim());
      return Object.fromEntries([
        ...header.map((h, i) => [h, cells[i] ?? '']),
        ...(extra.length ? [[EXTRA_CELLS, extra.join(', ')]] : []),
      ]);
    }),
  };
}

/** Column → field by heading; columns no field claims are listed as unknown, never guessed. */
export function suggestScoreMapping(
  header: readonly string[],
  sections: readonly ScoreSection[],
): { mapping: ScoreMapping; unknown: string[] } {
  const targets: [ScoreField, string[]][] = [
    ...Object.entries(SCORE_FIELDS).map(([f, v]): [ScoreField, string[]] => [
      f as FixedField,
      v.headings,
    ]),
    ...sections.map((s): [ScoreField, string[]] => [
      `section:${s.code}`,
      [slug(s.code), slug(s.name), `${slug(s.name)}_marks`],
    ]),
  ];
  const used = new Set<ScoreField>();
  const mapping: ScoreMapping = Object.fromEntries(
    header.map((h) => {
      const hit = targets.find(([f, names]) => !used.has(f) && names.includes(slug(h)))?.[0] ?? '';
      if (hit) used.add(hit);
      return [h, hit];
    }),
  );
  return { mapping, unknown: header.filter((h) => !mapping[h]) };
}

/** Problems with a mapping as a whole; an empty list means it can be used. */
export function scoreMappingProblems(
  mapping: ScoreMapping,
  sections: readonly ScoreSection[],
): string[] {
  const label = (f: string) =>
    SCORE_FIELDS[f as FixedField]?.label ??
    sections.find((s) => `section:${s.code}` === f)?.name ??
    f;
  const targets = Object.values(mapping).filter(Boolean);
  const unmapped = sections.filter((s) => !targets.includes(`section:${s.code}`));
  const valid = new Set([
    ...Object.keys(SCORE_FIELDS),
    ...sections.map((s) => `section:${s.code}`),
  ]);
  return [
    ...(targets.some((t) => ['admission_number', 'student_code', 'name'].includes(t))
      ? []
      : ['Map a column to admission number, student code or student name.']),
    ...(targets.some((t) => t === 'total' || t.startsWith('section:'))
      ? []
      : ['Map a column to the total marks or to a section’s marks.']),
    ...(!targets.includes('total') && unmapped.length && unmapped.length < sections.length
      ? [
          `Map a Total column, or a column for every section (no column for ${unmapped.map((s) => s.name).join(', ')}).`,
        ]
      : []),
    ...targets.filter((t) => !valid.has(t)).map((t) => `“${t}” is not a field you can import.`),
    ...[...new Set(targets.filter((t, i) => targets.indexOf(t) !== i))].map(
      (t) => `Two columns are mapped to ${label(t)}.`,
    ),
  ];
}

export type Attendance = 'present' | 'absent' | 'excused';
const ATTENDANCE_WORDS = new Map<string, Attendance>([
  ['present', 'present'],
  ['p', 'present'],
  ['attended', 'present'],
  ['absent', 'absent'],
  ['a', 'absent'],
  ['ab', 'absent'],
  ['abs', 'absent'],
  ['excused', 'excused'],
  ['exempt', 'excused'],
  ['ex', 'excused'],
  ['e', 'excused'],
  ['leave', 'excused'],
  ['on_leave', 'excused'],
]);

export type IssueCode =
  | 'invalid_mark'
  | 'invalid_attendance'
  | 'out_of_range'
  | 'section_sum_mismatch'
  | 'sections_incomplete'
  | 'absent_with_marks'
  // warnings (never block a write)
  | 'extra_cells'
  | 'name_mismatch'
  | 'estimated_floor';
export interface Issue {
  code: IssueCode;
  message: string;
}

export interface StagedRow {
  /** Stable within one import: `row-<rowNumber>`. */
  rowId: string;
  /** 1 = first row under the header. */
  rowNumber: number;
  source: 'file' | 'ai';
  /** The cells exactly as read or extracted. */
  original: Record<string, string>;
  admissionNumber: string | null;
  studentCode: string | null;
  name: string | null;
  /** Only from an Attendance column; null = the file does not say. */
  attendance: Attendance | null;
  totalUnits: MarkUnits | null;
  /** Mapped sections only; null = not entered. */
  sectionUnits: Record<string, MarkUnits | null>;
  /** The total, else the section sum when every section is entered; null = not entered. */
  scoreUnits: MarkUnits | null;
  /** No marks at all in the row (not the same as absent). */
  notEntered: boolean;
  /** Blocking problems: the row cannot be written until fixed or skipped. */
  errors: Issue[];
  /** Shown in the review; never block a write. */
  warnings: Issue[];
}

/** Parse and check each record against the marking rules. Matching comes later. */
export function stageScoreRows(
  records: readonly Record<string, string>[],
  mapping: ScoreMapping,
  rules: MarkingRules,
  source: 'file' | 'ai' = 'file',
): StagedRow[] {
  const ranges = scoreRanges(rules);
  if (!ranges.ok) throw new ScoreRulesError(ranges.problems);
  const mapped = rules.sections.filter((s) => Object.values(mapping).includes(`section:${s.code}`));
  const allMapped = mapped.length > 0 && mapped.length === rules.sections.length;
  return records.map((original, i) => {
    const cell = (f: ScoreField) => {
      const col = Object.keys(mapping).find((c) => mapping[c] === f);
      return col ? (original[col] ?? '').trim() : '';
    };
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    if (original[EXTRA_CELLS])
      warnings.push({
        code: 'extra_cells',
        message: "Cells beyond the last column were ignored.",
      });
    const inRange = (u: MarkUnits | null, what: string, r: MarkRange) => {
      if (u === null) return;
      if (u < r.floorUnits || u > r.maxUnits)
        errors.push({
          code: 'out_of_range',
          message: `${what} ${formatUnits(u)} is outside ${formatUnits(r.floorUnits)} to ${formatUnits(r.maxUnits)}.`,
        });
      else if (u < 0 && r.estimated && !warnings.some((w) => w.code === 'estimated_floor'))
        warnings.push({
          code: 'estimated_floor',
          message: `${what} ${formatUnits(u)} is negative and a question count is unknown, so the lowest possible mark cannot be checked (estimate: ${formatUnits(r.minUnits)}).`,
        });
    };
    const mark = (f: ScoreField, what: string) => {
      const text = cell(f);
      const u = markUnits(text);
      if (u !== undefined) return u;
      const hint = ATTENDANCE_WORDS.has(slug(text))
        ? ' To record absence, use an Attendance column.'
        : '';
      errors.push({
        code: 'invalid_mark',
        message: `${what} “${text}” is not a mark (a number with at most 4 decimals).${hint}`,
      });
      return null;
    };

    const totalUnits = mark('total', 'Total');
    const sectionUnits = Object.fromEntries(
      mapped.map((s) => {
        const u = mark(`section:${s.code}`, s.name);
        inRange(u, s.name, ranges.sections[s.code]!);
        return [s.code, u];
      }),
    );
    const entered = Object.values(sectionUnits).filter((u): u is MarkUnits => u !== null);
    const sum = entered.reduce((a, b) => a + b, 0);
    const complete = allMapped && entered.length === mapped.length;
    if (totalUnits !== null && complete && sum !== totalUnits)
      errors.push({
        code: 'section_sum_mismatch',
        message: `Sections add up to ${formatUnits(sum)} but the total is ${formatUnits(totalUnits)}.`,
      });
    if (totalUnits === null && entered.length && !complete)
      errors.push({
        code: 'sections_incomplete',
        message: 'Some section marks are blank and there is no total.',
      });
    const scoreUnits = totalUnits ?? (complete ? sum : null);
    inRange(totalUnits, 'Total', ranges.total); // a section sum is in range when its sections are

    const attendanceText = cell('attendance');
    const attendance = attendanceText ? (ATTENDANCE_WORDS.get(slug(attendanceText)) ?? null) : null;
    if (attendanceText && !attendance)
      errors.push({
        code: 'invalid_attendance',
        message: `Attendance “${attendanceText}” is not present, absent or excused.`,
      });
    const notEntered = scoreUnits === null && !entered.length;
    if ((attendance === 'absent' || attendance === 'excused') && !notEntered)
      errors.push({
        code: 'absent_with_marks',
        message: `Marked ${attendance} but the row has marks.`,
      });

    return {
      rowId: `row-${i + 1}`,
      rowNumber: i + 1,
      source,
      original: { ...original },
      admissionNumber: cell('admission_number') || null,
      studentCode: cell('student_code') || null,
      name: cell('name') || null,
      attendance,
      totalUnits,
      sectionUnits,
      scoreUnits,
      notEntered,
      errors,
      warnings,
    };
  });
}
