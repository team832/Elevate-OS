import { describe, expect, it } from 'vitest';
import {
  assessmentBounds,
  competitionRank,
  formatMarks,
  parseMarks,
  readSetting,
  validateForFinalise,
  type SectionSpec,
} from '../../src/domain';

const units = (m: string) => parseMarks(m)!;
const rule = (marksPerWrong: string | null) => ({
  marksPerCorrect: '4',
  marksPerWrong,
  marksUnattempted: '0',
});
const qa: SectionSpec = {
  code: 'QA',
  questionCount: 10,
  answerFormat: 'choice',
  options: ['A', 'B', 'C', 'D'],
  marksPerCorrect: null,
  marksPerWrong: null,
  marksUnattempted: null,
  capMarks: null,
};
const shown = (b: ReturnType<typeof assessmentBounds>) =>
  b && [formatMarks(b.minUnits), formatMarks(b.maxUnits), b.negativeAllowed];

describe('competition ranking (1, 2, 2, 4)', () => {
  const totals = ['40', '30', '30', '0', '-2.5'].map(units);
  it.each([
    ['40', 1],
    ['30', 2],
    ['0', 4],
    ['-2.5', 5],
  ])('%s → rank %i', (total, rank) => {
    expect(competitionRank(units(total), totals)).toBe(rank);
  });
});

describe('score bounds for entering totals', () => {
  it.each([
    ['sections with negative marking', rule('-1'), [qa], null, ['-10', '40', true]],
    ['sections without negative marking', rule('0'), [qa], null, ['0', '40', false]],
    ['sections with an unknown rule value', rule(null), [qa], null, null],
    ['total-only test', rule('0'), [], '20', ['0', '20', false]],
    [
      'total-only test with negative marking (loose floor)',
      rule('-0.25'),
      [],
      '20',
      ['-20', '20', true],
    ],
    ['no sections and no maximum: unknown, never 0', rule('0'), [], null, null],
  ] as const)('%s', (_n, assessmentRule, sections, maxMarks, expected) => {
    expect(shown(assessmentBounds({ assessmentRule, sections, key: null, maxMarks }))).toEqual(
      expected,
    );
  });

  it('a total-only roster test can be finalised from manual totals within its maximum', () => {
    const base = {
      assessmentRule: rule('0'),
      sections: [],
      key: null,
      enrolledStudentIds: ['s1'],
      maxMarks: '20',
    };
    const attempt = (manualScore: string) => [
      {
        attemptId: 't1',
        studentId: 's1',
        status: 'submitted' as const,
        responses: null,
        keyVersion: null,
        manualScore,
      },
    ];
    expect(validateForFinalise({ ...base, attempts: attempt('20') }).ok).toBe(true);
    expect(
      validateForFinalise({ ...base, attempts: attempt('21') }).issues.map((i) => i.code),
    ).toEqual(['OUT_OF_RANGE']);
    expect(
      validateForFinalise({ ...base, maxMarks: null, attempts: attempt('5') }).issues.map(
        (i) => i.code,
      ),
    ).toContain('NO_SECTIONS');
  });
});

it('provisional publication is a proposed setting, off by default', () => {
  expect(readSetting('assessments.provisional_publication', undefined)).toEqual({ allowed: false });
});
