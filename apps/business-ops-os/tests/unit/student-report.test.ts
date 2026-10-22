/** Student report kinds (D-078): kind order and labels, and the two summary tones on one input. */
import { describe, expect, it } from 'vitest';
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import {
  attendanceFacts,
  constructiveSummary,
  REPORT_KIND_LABELS,
  reportKinds,
  toneOf,
} from '../../src/domain/student-report';

type Result = AcademicStudentSummaryV1['results'][number];
const result = (over: Partial<Result>): Result => ({
  assessmentId: crypto.randomUUID(),
  code: 'CT-1',
  subject: 'Quant',
  examType: 'sectional',
  heldOn: '2026-09-01' as never,
  state: 'scored',
  score: 16,
  maxScore: 40,
  percentile: 60,
  rank: 3,
  cohort: { label: 'Sample batch', scored: 12 },
  resultVersion: 1,
  ...over,
});
const input = {
  attendance: attendanceFacts({
    held: 10,
    present: 7,
    partial: 0,
    late: 1,
    absent: 2,
    excused: 0,
    ratePercent: 80,
    definition: 'present + late of held',
  }),
  results: [
    result({ code: 'VA-1', subject: 'Verbal', score: 20, maxScore: 40 }),
    result({}),
    result({ code: 'CT-2', heldOn: '2026-09-20' as never, score: 24 }),
    result({ code: 'CT-3', state: 'absent', score: null, percentile: null, rank: null }),
  ],
  feedback: [
    { subject: 'Quant', strengths: null, areasToImprove: 'Ratios', actionPlan: 'Daily practice' },
  ],
};

describe('report kinds', () => {
  it('offers the owner kinds first, limited to the enabled setting; family kinds use the affirmative tone', () => {
    expect(reportKinds(['student', 'internal', 'guardian'])).toEqual([
      'guardian',
      'internal',
      'student',
    ]);
    expect(REPORT_KIND_LABELS.guardian).toBe('PTM report (for parents)');
    expect(['guardian', 'student', 'internal', 'admin_dossier'].map(toneOf as never)).toEqual([
      'affirmative',
      'affirmative',
      'neutral',
      'neutral',
    ]);
  });
});

describe('constructive summary tones (same input)', () => {
  it.each([
    [
      'neutral',
      [
        'Attendance rate: 80% (present + late of held). 8 of 10 recorded classes attended; 0 excused, 0 held but not recorded.',
        'Results: 3 assessments scored, 1 missed (absent, not counted as zero).',
        'Trend — Verbal sectional: insufficient data (1 scored result).',
        'Trend — Quant sectional: 2 scored results, 40% to 60% (up 20 points).',
      ],
      'No strengths recorded for this period.',
    ],
    [
      'affirmative',
      [
        'Attendance rate: 80% (present + late of held). 8 of 10 recorded classes attended.',
        'Trend — Quant sectional: 2 scored results, 40% to 60% (up 20 points).',
        'Results: 3 assessments scored, 1 not attempted (not counted as zero).',
        'Trend — Verbal sectional: insufficient data (1 scored result).',
      ],
      'No strengths recorded yet.',
    ],
  ] as const)('%s: evidence order and empty strengths', (tone, evidence, noStrengths) => {
    const s = constructiveSummary(input, { tone });
    expect(s.evidence).toEqual(evidence);
    expect(s.strengths).toEqual([noStrengths]);
    expect(s.areas).toEqual(['Quant: Ratios']);
    expect(s.nextSteps).toEqual(['Quant: Daily practice']);
  });

  it('affirmative never promotes low attendance or a falling trend, and keeps empty states honest', () => {
    const s = constructiveSummary(
      {
        attendance: { ...input.attendance, ratePercent: 60 },
        results: [input.results[1]!, { ...input.results[2]!, score: 8 }],
        feedback: [],
      },
      { tone: 'affirmative' },
    );
    expect(s.evidence).toEqual([
      'Attendance rate: 60% (present + late of held). 8 of 10 recorded classes attended.',
      'Results: 2 assessments scored.',
      'Trend — Quant sectional: 2 scored results, 40% to 20% (down 20 points).',
    ]);
    expect(s.areas).toEqual(['Nothing to work on recorded yet.']);
    expect(s.nextSteps).toEqual(['No next step recorded yet.']);
  });
});
