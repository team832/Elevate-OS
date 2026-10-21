import { describe, expect, it } from 'vitest';
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import type { IsoDate } from '@elevate/shared-types';
import { demoReviewGrid } from '../../src/domain/feedback';
import {
  attendanceFacts,
  cohortComparison,
  constructiveSummary,
  inIstPeriod,
  readableSections,
  reportSections,
  reportTransition,
  scoreTrends,
  type ReportAudience,
} from '../../src/domain/student-report';

type Result = AcademicStudentSummaryV1['results'][number];
const result = (over: Partial<Result> = {}): Result => ({
  assessmentId: crypto.randomUUID(),
  code: 'CT-1',
  subject: 'Quant',
  examType: 'sectional',
  heldOn: '2026-09-01' as IsoDate,
  state: 'scored',
  score: 20,
  maxScore: 40,
  percentile: 60,
  rank: 3,
  cohort: { label: 'Sample batch', scored: 12 },
  resultVersion: 1,
  ...over,
});
const ALL = { fees: true, privateData: true, feedback: true };
const NONE = { fees: false, privateData: false, feedback: false };

describe('report sections by audience (acceptance 21)', () => {
  it.each<[ReportAudience, typeof ALL, string[] | undefined, string[]]>([
    [
      'internal',
      ALL,
      undefined,
      ['overview', 'programmes', 'results', 'attendance', 'feedback', 'fees', 'guardians'],
    ],
    ['internal', NONE, undefined, ['overview', 'programmes', 'results', 'attendance']],
    ['admin_dossier', ALL, ['overview', 'guardians', 'summary'], ['overview', 'guardians']],
    ['guardian', ALL, undefined, ['overview', 'programmes', 'results', 'attendance', 'summary']],
    ['guardian', ALL, ['overview', 'feedback', 'guardians', 'fees'], ['overview', 'fees']],
    ['student', NONE, ['fees', 'results'], ['results']],
  ])('%s %o requested %o → %o', (audience, can, requested, expected) => {
    expect(reportSections(audience, can, requested as never)).toEqual(expected);
  });

  it('a reader never sees more than their permissions allow', () => {
    expect(readableSections(['overview', 'feedback', 'fees', 'guardians'], NONE)).toEqual([
      'overview',
    ]);
  });
});

describe('report workflow: draft → reviewed → final', () => {
  const p = (over = {}) => ({
    isCreator: false,
    canReview: true,
    reviewBeforeFinal: true,
    ...over,
  });
  it.each([
    ['draft', 'reviewed', p(), true],
    ['draft', 'reviewed', p({ isCreator: true }), 'own_report'],
    ['draft', 'reviewed', p({ canReview: false }), 'needs_reviewer'],
    ['draft', 'final', p(), 'review_first'],
    ['draft', 'final', p({ reviewBeforeFinal: false, isCreator: true }), true],
    [
      'draft',
      'final',
      p({ reviewBeforeFinal: false, canReview: false, isCreator: true }),
      'needs_reviewer',
    ],
    ['reviewed', 'final', p({ isCreator: true }), true],
    ['reviewed', 'final', p({ canReview: false }), 'needs_reviewer'],
    ['final', 'final', p(), 'illegal'],
    ['final', 'reviewed', p(), 'illegal'],
  ] as const)('%s → %s', (from, to, ctx, expected) => {
    const r = reportTransition(from, to, ctx);
    expect(r.ok ? true : r.reason).toBe(expected);
  });
});

describe('IST period boundary (fixes the UTC-day bug)', () => {
  it.each([
    ['2026-09-30T18:29:59Z', true], // 23:59:59 IST on 30 Sep
    ['2026-09-30T18:30:00Z', false], // 00:00 IST on 1 Oct — UTC still says 30 Sep
    ['2026-08-31T18:30:00Z', true], // 00:00 IST on 1 Sep — UTC says 31 Aug
    ['2026-08-31T18:29:59Z', false],
  ])('%s in 1–30 Sep → %s', (at, expected) => {
    expect(inIstPeriod(at, '2026-09-01', '2026-09-30')).toBe(expected);
  });
});

describe('measured evidence: missing is not zero, comparisons only inside one assessment and cohort', () => {
  it('attendance rate excludes excused and unrecorded; nothing countable → null', () => {
    expect(
      attendanceFacts({ held: 10, present: 5, partial: 1, late: 1, absent: 1, excused: 1 }),
    ).toMatchObject({
      recorded: 9,
      notRecorded: 1,
      attended: 7,
      ratePercent: 87.5,
    });
    expect(
      attendanceFacts({ held: 4, present: 0, partial: 0, late: 0, absent: 0, excused: 2 })
        .ratePercent,
    ).toBeNull();
  });

  it.each([
    [result(), 'Percentile 60, rank 3 of 12 scored in Sample batch'],
    [
      result({ state: 'absent', score: null, percentile: null, rank: null }),
      'Absent — not scored, not compared',
    ],
    [
      result({ cohort: { label: 'Tiny batch', scored: 1 } }),
      'Insufficient data (1 scored in Tiny batch)',
    ],
  ])('cohort comparison %#', (r, text) => expect(cohortComparison(r)).toBe(text));

  const absent = { state: 'absent', score: null, percentile: null, rank: null } as const;
  const on = (d: string) => d as IsoDate;
  it.each([
    [
      'same subject + exam type; absent is not a point; changed formats labelled',
      [
        result({ heldOn: on('2026-09-01'), score: 15, maxScore: 30 }),
        result({ heldOn: on('2026-09-10'), ...absent }),
        result({ heldOn: on('2026-09-20'), score: 28, maxScore: 40 }),
        result({ examType: 'full_mock', score: 60, maxScore: 120 }),
      ],
      [
        [
          'Quant sectional',
          'ok',
          '2 scored results, 50% to 70% (up 20 points); formats differ (out of 30, 40), compared as percentages',
        ],
        ['Quant full mock', 'insufficient', 'insufficient data (1 scored result)'],
      ],
    ],
    [
      'Quant and Verbal interleaved are never one series',
      [
        result({ heldOn: on('2026-09-01'), score: 15, maxScore: 30 }),
        result({ heldOn: on('2026-09-02'), subject: 'Verbal', score: 27, maxScore: 30 }),
        result({ heldOn: on('2026-09-03'), score: 21, maxScore: 30 }),
        result({ heldOn: on('2026-09-04'), subject: 'Verbal', score: 27, maxScore: 30 }),
        result({ heldOn: on('2026-09-05'), subject: null, score: 10, maxScore: 30 }),
      ],
      [
        ['Quant sectional', 'ok', '2 scored results, 50% to 70% (up 20 points)'],
        ['Verbal sectional', 'ok', '2 scored results, 90% to 90% (level)'],
        ['Subject not recorded sectional', 'insufficient', 'insufficient data (1 scored result)'],
      ],
    ],
  ])('trends: %s', (_name, rows, expected) => {
    expect(scoreTrends(rows).map((t) => [t.label, t.status, t.text])).toEqual(expected);
  });
});

describe('constructive summary (acceptance 17)', () => {
  it('never invents strengths and keeps the facts', () => {
    const s = constructiveSummary({
      attendance: attendanceFacts({
        held: 4,
        present: 3,
        partial: 0,
        late: 0,
        absent: 1,
        excused: 0,
      }),
      results: [result(), result({ state: 'absent', score: null, percentile: null, rank: null })],
      feedback: [
        {
          subject: 'Quant',
          strengths: null,
          areasToImprove: 'Ratios',
          actionPlan: 'Daily practice set',
        },
      ],
    });
    expect(s.evidence).toEqual([
      'Attendance: 3 of 4 recorded classes attended (75%); 0 excused, 0 not recorded.',
      'Results: 1 assessment scored, 1 missed (absent, not counted as zero).',
      'Trend — Quant sectional: insufficient data (1 scored result).',
    ]);
    expect(s.strengths).toEqual(['No strengths recorded for this period.']);
    expect(s.areas).toEqual(['Quant: Ratios']);
    expect(s.nextSteps).toEqual(['Quant: Daily practice set']);
  });

  it('says what is unavailable instead of zeros', () => {
    const s = constructiveSummary({ attendance: null, results: null, feedback: [] });
    expect(s.evidence).toEqual([
      'Attendance: not available for this period.',
      'Results: not available for this period.',
    ]);
    expect(s.nextSteps).toEqual(['No next step recorded for this period.']);
  });
});

describe('demo review grid (acceptance 4)', () => {
  const S = (
    id: string,
    dayNumber: number,
    teacherStaffId: string | null,
    attendance: string,
    isSubstitute = false,
  ) => ({
    id,
    dayNumber,
    teacherStaffId,
    attendance,
    isSubstitute,
  });
  const R = (
    id: string,
    demoSessionId: string,
    teacherStaffId: string,
    status: string,
    superseded = false,
  ) => ({
    id,
    demoSessionId,
    teacherStaffId,
    status,
    superseded,
  });
  it('pending / draft / submitted / not due per day per teacher; substitutes kept; superseded ignored', () => {
    const grid = demoReviewGrid(
      [
        S('s1', 1, 'tA', 'present'),
        S('s2', 1, 'tB', 'late', true),
        S('s3', 2, 'tA', 'absent'),
        S('s4', 2, 'tC', 'present'),
        S('s5', 3, 'tA', 'scheduled'),
        S('s6', 3, null, 'present'),
      ],
      [
        R('r1', 's1', 'tA', 'final'),
        R('r0', 's4', 'tC', 'final', true),
        R('r2', 's4', 'tC', 'draft'),
        R('r3', 's1', 'tB', 'final'),
      ],
    );
    const states = grid.map((d) => [
      d.dayNumber,
      d.teachers.map((t) => `${t.staffId}:${t.state}${t.isSubstitute ? ':sub' : ''}`),
    ]);
    expect(states).toEqual([
      [1, ['tA:submitted', 'tB:pending:sub']],
      [2, ['tA:not_due', 'tC:draft']],
      [3, ['tA:not_due']],
    ]);
  });
});
