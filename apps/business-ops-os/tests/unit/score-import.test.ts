import { describe, expect, it } from 'vitest';
import {
  formatUnits,
  markUnits,
  MAX_SCORE_CSV_CHARS,
  readScoreCsv,
  scoreMappingProblems,
  ScoreRulesError,
  scoreRanges,
  stageScoreRows,
  suggestScoreMapping,
  type MarkingRules,
  type ScoreSection,
} from '../../src/domain/score-import';
import {
  matchScoreRows,
  normaliseName,
  type RosterEntry,
} from '../../src/domain/score-import-match';
import {
  planScoreImport,
  rankScores,
  reviewScoreImport,
  type ExistingResult,
  type RankEntry,
} from '../../src/domain/score-import-validate';

const section = (
  code: string,
  questionCount: number | null,
  perWrong = '-0.25',
  perUnattempted = '0',
  capMarks: string | null = null,
  perCorrect = '2',
): ScoreSection => ({
  code,
  name: ({ VA: 'Verbal', QA: 'Quant' } as Record<string, string>)[code] ?? code,
  questionCount,
  perCorrect,
  perWrong,
  perUnattempted,
  capMarks,
});
// Two sections of 2 questions, +2 / −0.25 → each from −0.5 to 4, total from −1 to 8.
const RULES: MarkingRules = { sections: [section('VA', 2), section('QA', 2)] };
const entry = (n: number, adm: string | null, code: string | null, name: string): RosterEntry => ({
  rosterEntryId: `re${n}`,
  studentId: `s${n}`,
  admissionNumber: adm,
  studentCode: code,
  displayName: name,
  batchLabel: 'Sample IPMAT A',
});
const ROSTER = [
  entry(1, 'ELV-001', 'C1', 'Aarav Sample'),
  entry(2, 'ELV-002', 'C2', 'Diya Sample'),
  entry(3, 'ELV-003', null, 'Kabir Sample'),
  entry(4, 'ELV-004', null, 'Kabir Sample'),
  entry(5, null, 'C5', 'Meera Sample Student'),
  entry(6, 'ELV-006', null, 'राहुल शर्मा'),
  entry(7, 'ELV-007', null, 'Aman Sample'),
  entry(8, 'ELV-008', null, 'Amar Sample'),
];
const HEADER = 'Admission No,Student code,Name,Verbal,Quant marks,Total,Attendance';

function stage(lines: string[], source: 'file' | 'ai' = 'file', rules = RULES, header = HEADER) {
  const file = readScoreCsv([header, ...lines].join('\n'));
  if (!file.ok) throw new Error(file.error);
  return stageScoreRows(
    file.rows,
    suggestScoreMapping(file.header, rules.sections).mapping,
    rules,
    source,
  );
}
const existing = (m: Record<string, Partial<ExistingResult>>) =>
  new Map(
    Object.entries(m).map(([k, v]) => [
      k,
      { attendance: 'present', scoreUnits: null, sectionUnits: {}, ...v } as ExistingResult,
    ]),
  );

describe('score import — exact marks', () => {
  it.each([
    ['1', 10_000],
    ['-0.25', -2_500],
    ['12.5', 125_000],
    ['', null],
    ['-0', 0],
    ['-0.00', 0],
    ['1.23456', undefined],
    ['AB', undefined],
  ])('markUnits(%j) = %j', (text, units) => expect(markUnits(text)).toBe(units));

  it('adds tenths without float drift and prints them back', () => {
    expect(markUnits('0.1')! + markUnits('0.2')!).toBe(markUnits('0.3'));
    expect(formatUnits(-2_500)).toBe('-0.25');
  });
});

describe('score import — columns', () => {
  it('maps known headings, reports unknown ones and never guesses', () => {
    const { mapping, unknown } = suggestScoreMapping(
      [...HEADER.split(','), 'Remarks'],
      RULES.sections,
    );
    expect(mapping).toEqual({
      'Admission No': 'admission_number',
      'Student code': 'student_code',
      Name: 'name',
      Verbal: 'section:VA',
      'Quant marks': 'section:QA',
      Total: 'total',
      Attendance: 'attendance',
      Remarks: '',
    });
    expect(unknown).toEqual(['Remarks']);
    expect(scoreMappingProblems(mapping, RULES.sections)).toEqual([]);
  });

  it.each([
    [
      { Remarks: '' },
      [/admission number, student code or student name/, /total marks or to a section/],
    ],
    [{ Name: 'name', A: 'total', B: 'total' }, [/Two columns are mapped to Total marks/]],
    [
      { Name: 'name', V: 'section:VA' },
      [/Map a Total column, or a column for every section \(no column for Quant\)/],
    ],
  ] as const)('mapping problems %#', (mapping, expected) => {
    const problems = scoreMappingProblems(mapping, RULES.sections);
    expect(problems).toHaveLength(expected.length);
    expected.forEach((re, i) => expect(problems[i]).toMatch(re));
  });
});

describe('score import — reading the file', () => {
  it.each([
    ['a $ heading', 'Name,$about\nAarav Sample,1', /cannot start with \$/],
    ['a file over the size cap', 'Name,Total\n' + 'x'.repeat(MAX_SCORE_CSV_CHARS), /too large/],
  ])('refuses %s', (_, text, error) => {
    expect(readScoreCsv(text)).toEqual({ ok: false, error: expect.stringMatching(error) });
  });

  it('warns about cells beyond the last column and keeps them in the original', () => {
    const [row] = stage([',,Aarav Sample,,,5,,late entry']);
    expect(row!.errors).toEqual([]);
    expect(row!.warnings).toEqual([
      // The value itself is never repeated in a message (raw cells are not stored).
      { code: 'extra_cells', message: 'Cells beyond the last column were ignored.' },
    ]);
    expect(Object.values(row!.original)).toContain('late entry');
  });
});

describe('score import — marking schemes (Academic scoreBounds)', () => {
  const MIXED: MarkingRules = {
    sections: [
      section('MCQ', 2, '-1', '0', null, '1'),
      section('SA', 2, '0', '0', null, '1'),
      section('UN', 2, '0', '-0.5', null, '1'),
    ],
  };
  it.each([
    ['MCQ −1 per wrong reaches −2', 'A,-2,0,0', []],
    ['short answer has no negative marking', 'A,0,-2,0', ['out_of_range']],
    ['negative unattempted marking counts', 'A,0,0,-1', []],
    ['below the unattempted floor', 'A,0,0,-1.5', ['out_of_range']],
  ])('%s', (_, line, codes) => {
    const [row] = stage([line], 'file', MIXED, 'Name,MCQ,SA,UN');
    expect(row!.errors.map((e) => e.code)).toEqual(codes);
  });

  it('caps a section and sums section ranges into the total range', () => {
    const capped: MarkingRules = {
      sections: [section('VA', 4, '-0.25', '0', '5'), section('QA', 2)],
    };
    const rows = stage([',,A,,,9,', ',,A,,,9.5,'], 'file', capped);
    expect(rows.map((r) => r.errors.map((e) => e.message))).toEqual([
      [],
      ['Total 9.5 is outside -1.5 to 9.'],
    ]);
  });

  it.each([
    ['−0.25 floor estimated from the maximum, with a warning', 'A,-1', [], ['estimated_floor']],
    [
      'below the estimated floor only warns (true n may be larger)',
      'A,-7',
      [],
      ['estimated_floor'],
    ],
    ['the maximum still blocks', 'A,5.5', ['out_of_range'], []],
    [
      'a loose hard floor (10 × the maximum below 0) still blocks',
      'A,-999999',
      ['out_of_range'],
      [],
    ],
    ['just above the loose floor only warns', 'A,-50', [], ['estimated_floor']],
    ['positive marks need no warning', 'A,3', [], []],
  ])('unknown question count: %s', (_, line, codes, warnings) => {
    // Really 10 questions at +1/−1 capped at 5: the estimate (5 questions, floor −5) is too high.
    const rules: MarkingRules = { sections: [section('X', null, '-1', '0', '5', '1')] };
    const [row] = stage([line], 'file', rules, 'Name,X');
    expect(row!.errors.map((e) => e.code)).toEqual(codes);
    expect(row!.warnings.map((w) => w.code)).toEqual(warnings);
  });
});

describe('score import — malformed marking rules', () => {
  it.each([
    ['no sections', [], /no sections/],
    [
      'per-correct 0',
      [section('X', 2, '-1', '0', null, '0')],
      /X: marks per correct answer must be above 0/,
    ],
    [
      'per-correct negative',
      [section('X', 2, '0', '0', null, '-1')],
      /X: marks per correct answer must be above 0/,
    ],
    [
      'per-correct empty with no count',
      [section('X', null, '0', '0', '4', '')],
      /X: marks per correct answer “” is not an exact mark/,
    ],
    ['no count and no cap', [section('X', null)], /X: give the number of questions or a maximum/],
    [
      'count not a whole number',
      [section('X', 2.5)],
      /X: the number of questions must be a whole number/,
    ],
    [
      'maximum below minimum',
      [section('X', 2, '0', '0', '-3')],
      /X: the maximum \(-3\) is below the minimum \(0\)/,
    ],
  ])('%s is reported, not thrown as a bare error', (_, sections, problem) => {
    const ranges = scoreRanges({ sections });
    expect(ranges.ok).toBe(false);
    if (!ranges.ok) expect(ranges.problems.join(' ')).toMatch(problem);
    let thrown: unknown;
    try {
      stageScoreRows([{ Name: 'A' }], { Name: 'name' }, { sections });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ScoreRulesError);
    expect((thrown as ScoreRulesError).problems).toEqual(ranges.ok ? [] : ranges.problems);
  });
});

describe('score import — row checks', () => {
  it.each([
    ['negative-marking floor accepted', ',,Aarav Sample,,,-0.25,', [], -2_500],
    ['below the minimum rejected', ',,Aarav Sample,,,-1.25,', ['out_of_range'], -12_500],
    ['above the maximum rejected', ',,Aarav Sample,,,8.5,', ['out_of_range'], 85_000],
    ['section sum ≠ total', ',,Aarav Sample,3,4,6,', ['section_sum_mismatch'], 60_000],
    ['total from complete sections', ',,Aarav Sample,2,1.5,,', [], 35_000],
    ['incomplete sections, no total', ',,Aarav Sample,2,,,', ['sections_incomplete'], null],
    ['absent with marks', ',,Aarav Sample,,,5,Absent', ['absent_with_marks'], 50_000],
    ['AB in a marks column', ',,Aarav Sample,,,AB,', ['invalid_mark'], null],
    ['unknown attendance word', ',,Aarav Sample,,,5,maybe', ['invalid_attendance'], 50_000],
  ])('%s', (_, line, codes, score) => {
    const [row] = stage([line]);
    expect(row!.errors.map((e) => e.code)).toEqual(codes);
    expect(row!.scoreUnits).toBe(score);
    expect(row!.original.Name).toBe('Aarav Sample');
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'attendance %j is an unknown word, not a lookup hit',
    (word) => {
      const [row] = stage([`,,Aarav Sample,,,5,${word}`]);
      expect(row!.attendance).toBeNull();
      expect(row!.errors.map((e) => e.code)).toEqual(['invalid_attendance']);
    },
  );

  it('present with blank marks is "not entered", not absent; AB attendance is absent', () => {
    const [present, absent] = stage([',,Aarav Sample,,,,Present', ',,Diya Sample,,,,AB']);
    expect(present).toMatchObject({
      attendance: 'present',
      scoreUnits: null,
      notEntered: true,
      errors: [],
    });
    expect(absent).toMatchObject({ attendance: 'absent', scoreUnits: null, errors: [] });
  });
});

describe('score import — roster matching', () => {
  it.each([
    ['exact admission number', 'elv-001,,,,,5,', 'matched', 'admission_number', 's1', []],
    ['student code', ',C5,,,,5,', 'matched', 'student_code', 's5', []],
    ['exact unique name', ',,  aarav   SAMPLE ,,,5,', 'matched', 'exact_name', 's1', []],
    ['two students share the name', ',,Kabir Sample,,,5,', 'ambiguous', 'none', null, ['s3', 's4']],
    ['similar name is only suggested', ',,Aarav Sampel,,,5,', 'suggested', 'none', null, ['s1']],
    [
      'unknown admission number, exact name → suggestion',
      'ELV-999,,Diya Sample,,,5,',
      'suggested',
      'none',
      null,
      ['s2'],
    ],
    ['admission and code disagree', 'ELV-001,C2,,,,5,', 'ambiguous', 'none', null, ['s1', 's2']],
    ['unknown student', ',,Zed Nobody,,,5,', 'unmatched', 'none', null, []],
    [
      'admission number but a different name',
      'ELV-001,,Diya Sample,,,5,',
      'ambiguous',
      'none',
      null,
      ['s1', 's2'],
    ],
    [
      'code but a different name',
      ',C5,Kabir Sample,,,5,',
      'ambiguous',
      'none',
      null,
      ['s5', 's3', 's4'],
    ],
    [
      'admission number and a slightly different name',
      'ELV-001,,Aarav Sampel,,,5,',
      'matched',
      'admission_number',
      's1',
      [],
    ],
    [
      'admission number of one student, exact name of another',
      'ELV-007,,Amar Sample,,,5,',
      'ambiguous',
      'none',
      null,
      ['s7', 's8'],
    ],
    ['exact Devanagari name', ',,राहुल  शर्मा,,,5,', 'matched', 'exact_name', 's6', []],
  ])('%s', (_, line, status, basis, studentId, candidates) => {
    const [row] = matchScoreRows(stage([line]), ROSTER);
    expect(row!.match).toMatchObject({ status, basis, studentId });
    expect(row!.match.candidates.map((c) => c.studentId)).toEqual(candidates);
  });

  it('names both people when the identifier and the name disagree; warns on a near miss', () => {
    const [clash, near] = matchScoreRows(
      stage(['ELV-001,,Diya Sample,,,5,', 'ELV-001,,Aarav Sampel,,,5,']),
      ROSTER,
    );
    expect(clash!.match.message).toBe(
      'Admission number “ELV-001” is Aarav Sample on the roster, but the row says “Diya Sample”.',
    );
    expect(near!.warnings).toEqual([
      {
        code: 'name_mismatch',
        message: 'The row says “Aarav Sampel”; the roster says Aarav Sample.',
      },
    ]);
  });

  it.each([
    ['Rahul शर्मा', 'rahul शर्मा'],
    ['राहुल शर्मा', 'राहुल शर्मा'],
    ["  José  O'Neil ", 'jose o neil'],
  ])('normaliseName(%j) keeps letters of every script', (name, expected) => {
    expect(normaliseName(name)).toBe(expected);
  });

  it('a non-Latin name is an identifier, not "no identifier"', () => {
    const [row] = matchScoreRows(stage([',,सीता वर्मा,,,5,']), ROSTER);
    expect(row!.match.message).toBe('Name “सीता वर्मा” is not on this test’s roster.');
  });

  it('marks every row for the same student duplicate and lists roster members missing from the file', () => {
    const review = reviewScoreImport(
      stage(['ELV-001,,,,,5,', ',,Aarav Sample,,,6,', ',,Zed Nobody,,,5,']),
      ROSTER,
      new Map(),
    );
    expect(review.rows.map((r) => r.match.status)).toEqual(['duplicate', 'duplicate', 'unmatched']);
    expect(review.missingFromFile.map((e) => e.studentId)).toEqual([
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
    ]);
    expect(review.counts).toMatchObject({ duplicate: 2, unmatched: 1, new: 2 });
  });
});

describe('score import — confirm plan', () => {
  const plan = (
    lines: string[],
    decisions = {},
    prior = new Map<string, ExistingResult>(),
    source: 'file' | 'ai' = 'file',
  ) => planScoreImport(matchScoreRows(stage(lines, source), ROSTER), ROSTER, prior, decisions);

  type Opts = {
    resolutions?: Record<string, string>;
    source?: 'ai';
    prior?: Record<string, Partial<ExistingResult>>;
  };
  it.each<[string, string[], Opts, RegExp]>([
    ['an ambiguous row is unresolved', [',,Kabir Sample,,,5,'], {}, /more than one student fits/],
    [
      'a suggested row is unresolved',
      [',,Aarav Sampel,,,5,'],
      {},
      /choose the student from the suggestions/,
    ],
    ['an invalid row must be fixed or skipped', ['ELV-001,,,,,9,'], {}, /outside -1 to 8/],
    [
      'a student off the roster cannot be chosen',
      [',,Zed Nobody,,,5,'],
      { resolutions: { 'row-1': 'x9' } },
      /not on this test’s roster/,
    ],
    [
      'two rows cannot be resolved to one student',
      ['ELV-001,,,,,5,', ',,Aarav Sampel,,,6,'],
      { resolutions: { 'row-2': 's1' } },
      /row 1 is already for Aarav Sample/,
    ],
    [
      'an empty resolution is no decision',
      [',,Aarav Sampel,,,5,'],
      { resolutions: { 'row-1': '' } },
      /^Row 1: choose the student from the suggestions/,
    ],
    ['an AI row needs a human check', ['ELV-001,,,,,5,'], { source: 'ai' }, /read by AI/],
    [
      'a verified result needs an overwrite review',
      ['ELV-001,,,,,6,'],
      { prior: { s1: { scoreUnits: 50_000 } } },
      /confirm the overwrite/,
    ],
  ])('refuses: %s', (_, lines, opts, message) => {
    const result = plan(
      lines,
      { resolutions: opts.resolutions },
      existing(opts.prior ?? {}),
      opts.source,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]!.message).toMatch(message);
  });

  it('writes resolved rows, skips skipped ones and keeps blank marks as "not entered"', () => {
    const result = plan(
      ['ELV-001,,,2,3,5,', ',,Kabir Sample,,,4,', ',,Aarav Sampel,,,7,', 'ELV-002,,,,,,Present'],
      { resolutions: { 'row-2': 's4', 'row-3': 'skip' } },
    );
    expect(result).toMatchObject({ ok: true, skipped: ['row-3'], overwrites: [] });
    if (!result.ok) return;
    expect(result.writes).toEqual([
      expect.objectContaining({
        studentId: 's1',
        scoreUnits: 50_000,
        sectionUnits: { VA: 20_000, QA: 30_000 },
        attendance: null,
      }),
      expect.objectContaining({ studentId: 's4', rosterEntryId: 're4', scoreUnits: 40_000 }),
      expect.objectContaining({ studentId: 's2', scoreUnits: null, attendance: 'present' }),
    ]);
  });

  it('an empty resolution keeps a matched row matched', () => {
    expect(plan(['ELV-001,,,,,5,'], { resolutions: { 'row-1': '' } })).toMatchObject({
      ok: true,
      writes: [{ studentId: 's1' }],
    });
  });

  it('writes AI rows and overwrites only with the per-row confirmations', () => {
    const result = plan(
      ['ELV-001,,,,,6,'],
      { aiConfirmed: ['row-1'], overwriteConfirmed: ['row-1'] },
      existing({ s1: { scoreUnits: 50_000 } }),
      'ai',
    );
    expect(result).toMatchObject({
      ok: true,
      overwrites: [{ studentId: 's1', scoreUnits: 60_000, source: 'ai', overwrite: true }],
    });
  });

  it('re-importing the same file changes nothing', () => {
    const lines = ['ELV-001,,,2,3,5,Present', 'ELV-002,,,,,,Absent'];
    const first = plan(lines);
    if (!first.ok) throw new Error('first import refused');
    const saved = existing(Object.fromEntries(first.writes.map((w) => [w.studentId, w])));
    expect(plan(lines, {}, saved)).toEqual({
      ok: true,
      writes: [],
      overwrites: [],
      unchanged: ['row-1', 'row-2'],
      skipped: [],
    });
  });
});

describe('score import — ranking', () => {
  const e = (
    adm: string,
    score: number | null,
    attendance: RankEntry['attendance'] = 'present',
    marksState: RankEntry['marksState'] = 'verified',
  ) => ({
    admissionNumber: adm,
    displayName: `Sample ${adm}`,
    attendance,
    marksState,
    scoreUnits: score,
  });

  it('ranks 1, 2, 2, 4 with ties in admission-number order; zero ranks, the rest do not', () => {
    const ranked = rankScores([
      e('A9', null, 'absent'),
      e('A5', 80_000),
      e('A1', 80_000),
      e('A7', 50_000, 'present', 'imported_for_review'),
      e('A2', 90_000),
      e('A3', 0),
      e('A4', 70_000, 'excused'),
      e('A6', null, 'unmarked'),
      e('A8', null),
    ]);
    expect(ranked.map((r) => [r.admissionNumber, r.rank])).toEqual([
      ['A2', 1],
      ['A1', 2],
      ['A5', 2],
      ['A3', 4],
      ['A4', null],
      ['A6', null],
      ['A7', null],
      ['A8', null],
      ['A9', null],
    ]);
  });
});
