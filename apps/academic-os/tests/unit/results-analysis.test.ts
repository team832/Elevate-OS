import { describe, expect, it } from 'vitest';
import {
  aggregateResults,
  assessmentTrend,
  analyseAssessment,
  attendanceDefinition,
  manualScoreProblem,
  parseMarks,
  resolveRules,
  scoreBounds,
  splitComparable,
  summariseAttendance,
  supportSignals,
  validateForFinalise,
  type AttemptInput,
  type SectionSpec,
} from '../../src/domain';

const section = (over: Partial<SectionSpec> = {}): SectionSpec => ({
  code: 'S1',
  questionCount: 4,
  answerFormat: 'choice',
  options: ['A', 'B', 'C', 'D'],
  marksPerCorrect: null,
  marksPerWrong: null,
  marksUnattempted: null,
  capMarks: null,
  ...over,
});
const negative = { marksPerCorrect: '1', marksPerWrong: '-0.25', marksUnattempted: '0' };
const plain = { marksPerCorrect: '2', marksPerWrong: '0', marksUnattempted: '0' };
const sections = [section()];
const key = { S1: ['A', 'B', 'C', null] };
const attempt = (studentId: string, over: Partial<AttemptInput> = {}): AttemptInput => ({
  attemptId: `att-${studentId}`,
  studentId,
  status: 'submitted',
  responses: null,
  keyVersion: null,
  manualScore: null,
  ...over,
});

describe('scoreBounds and manual marks', () => {
  it('max = (questions − dropped) × per correct; min is negative only with negative marking', () => {
    const neg = scoreBounds(sections, resolveRules(negative, sections).rules, key);
    expect(neg).toEqual({ minUnits: parseMarks('-0.75'), maxUnits: parseMarks('3'), negativeAllowed: true });
    const pos = scoreBounds(sections, resolveRules(plain, sections).rules, null);
    expect(pos).toEqual({ minUnits: 0, maxUnits: parseMarks('8'), negativeAllowed: false });
  });

  it.each([
    ['3', negative, null],
    ['-0.5', negative, null],
    ['-1', negative, 'at least -0.75'],
    ['3.5', negative, 'at most 3'],
    ['-0.5', plain, 'cannot be negative'],
    ['1.23456', plain, 'decimal'],
  ])('manual score %s under %o → %s', (value, rule, problem) => {
    const bounds = scoreBounds(sections, resolveRules(rule, sections).rules, key);
    const result = manualScoreProblem(value, bounds);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });
});

describe('aggregateResults with result states (brief 16, test 16)', () => {
  const { rules } = resolveRules(negative, sections);
  const agg = aggregateResults(sections, rules, key, [
    attempt('resp', { responses: { S1: ['A', 'B', 'D', null] }, keyVersion: 1 }), // 1 + 1 − 0.25 = 1.75
    attempt('manual', { manualScore: '2.5' }),
    attempt('away', { status: 'absent' }),
    attempt('free', { status: 'exempt' }),
    attempt('held', { status: 'withheld', manualScore: '3' }),
  ]);
  const by = Object.fromEntries(agg.results.map((r) => [r.studentId, r]));

  it('scores only submitted attempts; manual score used when there are no responses', () => {
    expect(by.resp).toMatchObject({ state: 'scored', score: { total: '1.75', max: '3' } });
    expect(by.manual).toMatchObject({ state: 'scored', score: { total: '2.5', max: '3' } });
    expect(agg.scored).toBe(2);
  });

  it.each(['away', 'free', 'held'])('%s gets no score, rank or percentile (never 0)', (id) => {
    expect(by[id]).toMatchObject({ score: null, rank: null, percentile: null, absent: true });
  });

  it('keeps each state and counts them separately', () => {
    expect([by.away!.state, by.free!.state, by.held!.state]).toEqual(['absent', 'exempt', 'withheld']);
    expect(agg).toMatchObject({ absent: 1, exempt: 1, withheld: 1 });
    expect(agg.sectionStats[0]).toMatchObject({ sectionCode: 'S1', mean: '1.75' });
  });
});

describe('validateForFinalise with manual marks and non-scored states', () => {
  const input = (attempts: AttemptInput[]) => ({
    assessmentRule: negative,
    sections,
    key: { version: 1, answers: key },
    attempts,
    enrolledStudentIds: attempts.map((a) => a.studentId),
  });
  it('accepts manual totals, exempt and withheld without responses', () => {
    const v = validateForFinalise(input([attempt('m', { manualScore: '1' }), attempt('e', { status: 'exempt' }), attempt('w', { status: 'withheld' })]));
    expect(v.issues).toEqual([]);
  });
  it('needs no answer key when every submitted attempt is a manual total', () => {
    const v = validateForFinalise({ ...input([attempt('m', { manualScore: '1' }), attempt('a', { status: 'absent' })]), key: null });
    expect(v.issues).toEqual([]);
    const agg = aggregateResults(sections, v.rules, null, [attempt('m', { manualScore: '1' })]);
    expect(agg.results[0]).toMatchObject({ state: 'scored', score: { total: '1', max: '4' } }); // no key: nothing dropped
    const withResponses = validateForFinalise({ ...input([attempt('r', { responses: { S1: ['A', 'B', 'C', 'D'] }, keyVersion: 1 })]), key: null });
    expect(withResponses.issues.map((i) => i.code)).toContain('NO_ANSWER_KEY');
  });
  it('flags a manual total outside the scheme (e.g. after the rule changed)', () => {
    const v = validateForFinalise(input([attempt('m', { manualScore: '5' })]));
    expect(v.issues).toEqual([expect.objectContaining({ code: 'OUT_OF_RANGE', studentId: 'm' })]);
  });
});

describe('analyseAssessment (test 18: cohort average uses the scored population)', () => {
  const u = (v: string) => parseMarks(v)!;
  it('averages scored students only; absent, exempt, withheld and pending are excluded and counted', () => {
    const a = analyseAssessment(
      [
        { state: 'scored', totalUnits: u('2'), maxUnits: u('4') },
        { state: 'scored', totalUnits: u('3'), maxUnits: u('4') },
        { state: 'absent', totalUnits: null, maxUnits: u('4') },
        { state: 'exempt', totalUnits: null, maxUnits: u('4') },
        { state: 'withheld', totalUnits: null, maxUnits: u('4') },
      ],
      7,
    );
    expect(a).toEqual({
      eligible: 7,
      scored: 2,
      absent: 1,
      exempt: 1,
      withheld: 1,
      pending: 2,
      mean: '2.5',
      highest: '3',
      lowest: '2',
      max: '4',
      meanPercent: 62.5,
    });
  });
  it('has no average (not zero) when nobody is scored, and no % when the maximum is 0', () => {
    expect(analyseAssessment([{ state: 'absent', totalUnits: null, maxUnits: 0 }], 1)).toMatchObject({ scored: 0, mean: null, meanPercent: null, highest: null });
  });
});

describe('splitComparable (trend only across the same type and maximum)', () => {
  it('keeps same-kind, same-subject, same-max assessments and labels the rest not comparable', () => {
    const current = { id: 'a', kind: 'chapter_test', subjectId: 'q', maxUnits: 40 };
    const split = splitComparable(current, [
      current,
      { id: 'b', kind: 'chapter_test', subjectId: 'q', maxUnits: 40 },
      { id: 'c', kind: 'chapter_test', subjectId: 'q', maxUnits: 50 },
      { id: 'd', kind: 'full_mock', subjectId: 'q', maxUnits: 40 },
      { id: 'e', kind: 'chapter_test', subjectId: 'v', maxUnits: 40 },
    ]);
    expect(split.comparable.map((x) => x.id)).toEqual(['a', 'b']);
    expect(split.notComparable.map((x) => x.id)).toEqual(['c', 'd', 'e']);
  });
  it('keeps negative percentages (negative marking) as trend points', () => {
    const r = assessmentTrend([-10, -5, 0].map((percent, i) => ({ date: `2027-01-0${i + 1}`, percent })));
    expect(r).toMatchObject({ status: 'ok', pointsUsed: 3, direction: 'improving' });
  });
});

describe('attendance denominator setting', () => {
  const marks = [
    { sessionId: 's1', status: 'present' as const },
    { sessionId: 's2', status: 'late' as const },
    { sessionId: 's3', status: 'absent' as const },
    { sessionId: 's4', status: 'excused' as const },
  ];
  it.each([
    [{ lateCountsAsAttended: true, excludeExcused: true }, 66.7],
    [{ lateCountsAsAttended: false, excludeExcused: true }, 33.3],
    [{ lateCountsAsAttended: true, excludeExcused: false }, 50],
  ])('%o → %s %%', (opts, rate) => {
    expect(summariseAttendance(['s1', 's2', 's3', 's4', 's5'], marks, opts)).toMatchObject({ ratePercent: rate, notRecorded: 1 });
    expect(attendanceDefinition(opts)).toContain('not recorded');
  });
});

describe('supportSignals (raw facts, no invented thresholds)', () => {
  it('lists the recent absence streak, overdue catch-up and a declining comparable trend', () => {
    const signals = supportSignals({
      delivered: [
        { date: '2026-09-01', status: 'present' },
        { date: '2026-09-02', status: 'absent' },
        { date: '2026-09-03', status: null },
        { date: '2026-09-04', status: 'absent' },
      ],
      overdueCatchup: 2,
      declining: { label: 'chapter test out of 40', slope: -5, pointsUsed: 3 },
    });
    expect(signals.map((s) => s.kind)).toEqual(['absence_streak', 'overdue_catch_up', 'declining_scores']);
    expect(signals[0]!.text).toContain('last 2 recorded');
  });
  it('is empty when nothing is notable', () => {
    expect(supportSignals({ delivered: [{ date: '2026-09-01', status: 'present' }], overdueCatchup: 0, declining: null })).toEqual([]);
  });
});
