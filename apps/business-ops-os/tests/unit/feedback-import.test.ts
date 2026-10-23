import { describe, expect, it } from 'vitest';
import { categoryMeans, readMeans, teacherFacing } from '../../src/domain/feedback';
import {
  checkRow,
  feedbackKey,
  mappingProblems,
  markDuplicates,
  parseCsv,
  readFeedbackCsv,
  suggestMapping,
  type RowContext,
} from '../../src/domain/feedback-import';

const CATS = [
  { code: 'pace', label: 'Pace' },
  { code: 'doubt_resolution', label: 'Doubt resolution' },
];
const ctx: RowContext = {
  scaleMax: 5,
  categoryCodes: CATS.map((c) => c.code),
  teacher: (ref) =>
    (
      ({ 'DEMO-T01': 't1', 'Sample Teacher One': 't1', 'Sample Twin': 'ambiguous' }) as Record<
        string,
        string
      >
    )[ref] ?? null,
  student: (n) => (n === 'ADM-1' ? 's1' : null),
  batch: (_t, code, subject) =>
    code === 'SAMPLE-B1'
      ? {
          ok: true,
          batchCode: 'SAMPLE-B1',
          subjectName: subject ?? 'Quant',
          batchId: null,
          subjectId: null,
        }
      : { ok: false, message: `This teacher has no assignment in batch “${code}” in Academic OS.` },
};
const header = [
  'Teacher',
  'Batch',
  'Period start',
  'Period end',
  'Admission number',
  'Rating',
  'Pace',
  'Comment',
];
const mapping = suggestMapping(header, CATS);
const row = (over: Record<string, string> = {}) => ({
  Teacher: 'DEMO-T01',
  Batch: 'SAMPLE-B1',
  'Period start': '2026-09-01',
  'Period end': '2026-09-30',
  'Admission number': '',
  Rating: '4',
  Pace: '3',
  Comment: 'Explains clearly, sometimes fast.',
  ...over,
});

describe('feedback CSV', () => {
  it('parses quoted commas, escaped quotes and newlines; drops blank rows', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });

  it.each([
    ['', 'header row'],
    ['a,a\n1,2', 'own, non-empty heading'],
  ])('refuses %j (%s)', (text, msg) => {
    const r = readFeedbackCsv(text);
    expect(r.ok === false && r.error).toContain(msg);
  });

  it('suggests a mapping from headings, including categories', () => {
    expect(mapping).toEqual({
      Teacher: 'teacher',
      Batch: 'batch',
      'Period start': 'period_start',
      'Period end': 'period_end',
      'Admission number': 'admission_number',
      Rating: 'rating',
      Pace: 'category:pace',
      Comment: 'comment',
    });
    expect(mappingProblems({ A: 'teacher', B: 'teacher', C: 'salary' }, ['pace'])).toHaveLength(2);
    expect(mappingProblems({ A: 'rating', B: '' }, [])).toEqual(['Map one column to Teacher.']);
  });
});

describe('checkRow', () => {
  it('a complete row is valid with its stored values', () => {
    const r = checkRow(1, row({ 'Admission number': 'ADM-1' }), mapping, ctx);
    expect(r.outcome).toBe('valid');
    expect(r.values).toMatchObject({
      teacherStaffId: 't1',
      studentId: 's1',
      courseLabel: 'SAMPLE-B1',
      feedbackOn: '2026-09-30',
      rating: 4,
      categoryRatings: { pace: 3 },
    });
  });

  it.each([
    [{ Teacher: 'Nobody' }, 'unresolved', 'No staff member'],
    [{ Teacher: 'Sample Twin' }, 'unresolved', 'More than one staff member'],
    [{ Batch: 'OTHER' }, 'unresolved', 'no assignment in batch'],
    [{ 'Admission number': 'ADM-404' }, 'unresolved', 'No student has admission number'],
    [{ Rating: '6' }, 'invalid', 'not a whole number from 1 to 5'],
    [{ Pace: '0' }, 'invalid', 'pace'],
    [{ 'Period end': '' }, 'invalid', 'Review period missing'],
    [{ 'Period end': '2026-08-01' }, 'invalid', 'before period start'],
    [{ Batch: '' }, 'invalid', 'Batch missing'],
    [{ Rating: '', Pace: '', Comment: '' }, 'invalid', 'No rating and no written feedback'],
  ])('%j → %s', (over, outcome, message) => {
    const r = checkRow(2, row(over), mapping, ctx);
    expect(r.outcome).toBe(outcome);
    expect(r.messages.join(' ')).toContain(message);
    expect(r.values).toBeNull();
  });
});

describe('duplicates', () => {
  const valid = (over: Record<string, string>, n = 1) => checkRow(n, row(over), mapping, ctx);

  it('identified rows: same student + teacher + period + batch, even with other words', () => {
    const rows = markDuplicates(
      [
        valid({ 'Admission number': 'ADM-1' }),
        valid({ 'Admission number': 'ADM-1', Comment: 'Other words.' }, 2),
      ],
      new Set(),
    );
    expect(rows.map((r) => r.outcome)).toEqual(['valid', 'duplicate']);
  });

  it('anonymous rows are never dropped: an exact repeat is imported with a warning', () => {
    const rows = markDuplicates(
      [valid({}), valid({ Comment: 'Different answer.' }, 2), valid({}, 3)],
      new Set(),
    );
    expect(rows.map((r) => r.outcome)).toEqual(['valid', 'valid', 'valid']);
    expect(rows[2]!.values).not.toBeNull();
    expect(rows[2]!.messages.join(' ')).toContain('imported anyway');
  });

  it('against stored rows: identified rows are duplicates, anonymous ones only warned', () => {
    const named = valid({ 'Admission number': 'ADM-1' });
    const anon = valid({}, 2);
    const [a, b] = markDuplicates(
      [named, anon],
      new Set([feedbackKey(named.values!), feedbackKey(anon.values!)]),
    );
    expect(a).toMatchObject({
      outcome: 'duplicate',
      messages: ['Already recorded (same feedback is stored).'],
    });
    expect(b!.outcome).toBe('valid');
  });
});

describe('summaries', () => {
  it('a mean and its count per category, overall kept apart (codes are never encoded)', () => {
    expect(
      categoryMeans(
        [
          { ratingScaleMax: 5, rating: 4, categoryRatings: { pace: 3, ab__n: 2, overall: 5 } },
          { ratingScaleMax: 5, rating: 5, categoryRatings: null },
          { ratingScaleMax: 10, rating: 9, categoryRatings: { pace: 9 } },
        ],
        5,
      ),
    ).toEqual({
      means: {
        overall: { mean: 4.5, n: 2 },
        categories: {
          pace: { mean: 3, n: 1 },
          ab__n: { mean: 2, n: 1 },
          overall: { mean: 5, n: 1 },
        },
      },
      otherScale: 1,
    });
  });

  const stored = {
    overall: { mean: 4, n: 3 },
    categories: {
      pace: { mean: 1, n: 1 },
      ab: { mean: 3, n: 3 },
      ab__n: { mean: 2, n: 3 },
      broken: 2,
      partial: { mean: 2 },
    },
  };
  const summary = {
    id: 'x',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    responseCount: 3,
    eligiblePopulation: 30,
    ratingScaleMax: 5,
    categoryMeans: stored as never,
    strengths: 'Clear.',
    areasToImprove: 'Pace.',
    summaryText: 'Edited comments.',
    approvedAt: null,
  };

  it('readMeans: malformed entries are left out (hidden), never guessed', () => {
    expect(readMeans(stored)).toEqual([
      { code: null, mean: 4, n: 3 },
      { code: 'pace', mean: 1, n: 1 },
      { code: 'ab', mean: 3, n: 3 },
      { code: 'ab__n', mean: 2, n: 3 },
    ]);
    expect(readMeans({ overall: 4, overall__n: 3 })).toEqual([]);
    expect(readMeans(null)).toEqual([]);
  });

  it('below the minimum group size the teacher sees no figures or comments', () => {
    expect(teacherFacing(summary, { minGroupSize: 5, showComments: true })).toEqual({
      id: 'x',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      approvedAt: null,
      ratingScaleMax: 5,
      enough: false,
      minGroupSize: 5,
      responseCount: null,
      eligiblePopulation: null,
      categoryMeans: null,
      strengths: null,
      areasToImprove: null,
      summaryText: null,
    });
  });

  it.each([
    [true, 'Edited comments.'],
    [false, null],
  ])(
    'at or above it: only means from enough raters; comments only when shared (%s)',
    (showComments, text) => {
      expect(teacherFacing(summary, { minGroupSize: 3, showComments })).toEqual({
        id: 'x',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        approvedAt: null,
        ratingScaleMax: 5,
        enough: true,
        minGroupSize: 3,
        responseCount: 3,
        eligiblePopulation: 30,
        categoryMeans: { overall: 4, categories: { ab: 3, ab__n: 2 } },
        strengths: 'Clear.',
        areasToImprove: 'Pace.',
        summaryText: text,
      });
    },
  );
});
