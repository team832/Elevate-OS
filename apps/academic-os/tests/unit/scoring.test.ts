import { describe, expect, it } from 'vitest';
import {
  aggregateResults,
  canonicalNumber,
  formatMarks,
  parseMarks,
  percentileRank,
  resolveRules,
  scoreAttempt,
  toNumericString,
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
const clatRule = { marksPerCorrect: '1', marksPerWrong: '-0.25', marksUnattempted: '0' };

describe('exact marks (integer units)', () => {
  it('parses decimals exactly and formats them back', () => {
    expect(parseMarks('-0.25')).toBe(-2500);
    expect(parseMarks('1')).toBe(10_000);
    expect(parseMarks(0.5)).toBe(5000);
    expect(parseMarks('')).toBeNull();
    expect(parseMarks(null)).toBeNull();
    expect(formatMarks(127_500)).toBe('12.75');
    expect(formatMarks(-5000)).toBe('-0.5');
    expect(formatMarks(0)).toBe('0');
    expect(toNumericString(-2500)).toBe('-0.2500');
  });
  it('rejects values that would need rounding (more than 4 decimals) or garbage', () => {
    expect(() => parseMarks('0.33333')).toThrow();
    expect(() => parseMarks('abc')).toThrow();
    expect(() => parseMarks(1 / 3)).toThrow();
  });
  it('has no float drift: 120 wrong answers at −0.25 sum to exactly −30', () => {
    const sum = Array.from({ length: 120 }, () => parseMarks('-0.25')!).reduce((a, b) => a + b, 0);
    expect(formatMarks(sum)).toBe('-30');
    // the float version drifts for tenths: 0.1 × 3
    expect(formatMarks(parseMarks('0.1')! * 3)).toBe('0.3');
  });
  it('canonicalises numeric answers', () => {
    expect(canonicalNumber('12.50')).toBe('12.5');
    expect(canonicalNumber('+012')).toBe('12');
    expect(canonicalNumber('-0')).toBe('0');
    expect(canonicalNumber('1e3')).toBeNull();
  });
});

describe('resolveRules', () => {
  it('uses section overrides before the assessment rule', () => {
    const { rules, problems } = resolveRules(clatRule, [
      section({ code: 'MCQ' }),
      section({ code: 'SA', answerFormat: 'numeric', marksPerWrong: '0', marksPerCorrect: '4' }),
    ]);
    expect(problems).toEqual([]);
    expect(rules).toEqual([
      { code: 'MCQ', perCorrect: 10_000, perWrong: -2500, perUnattempted: 0, cap: null },
      { code: 'SA', perCorrect: 40_000, perWrong: 0, perUnattempted: 0, cap: null },
    ]);
  });
  it('reports unknown (null) values instead of assuming zero', () => {
    const { rules, problems } = resolveRules(
      { marksPerCorrect: '1', marksPerWrong: null, marksUnattempted: '0' },
      [section()],
    );
    expect(rules).toEqual([]);
    expect(problems.map((p) => p.field)).toEqual(['marksPerWrong']);
  });
  it('rejects a positive "penalty" and a non-positive reward', () => {
    const { problems } = resolveRules({ marksPerCorrect: '0', marksPerWrong: '0.25', marksUnattempted: '0' }, [section()]);
    expect(problems.map((p) => p.field).sort()).toEqual(['marksPerCorrect', 'marksPerWrong']);
  });
});

describe('scoreAttempt', () => {
  const sections = [section()];
  const { rules } = resolveRules(clatRule, sections);
  const key = { S1: ['A', 'B', 'C', 'D'] };

  it('applies negative marking and unattempted marks exactly (quarter marks)', () => {
    const s = scoreAttempt(sections, rules, key, { S1: ['A', 'C', null, 'd'] });
    expect(s.sections[0]).toMatchObject({ correct: 2, wrong: 1, unattempted: 1, dropped: 0, score: '1.75', max: '4' });
    expect(s.total).toBe('1.75');
  });
  it('can go negative when every answer is wrong', () => {
    const s = scoreAttempt(sections, rules, key, { S1: ['B', 'A', 'D', 'C'] });
    expect(s.total).toBe('-1');
  });
  it('awards marks for unattempted questions when the rule says so', () => {
    const { rules: r } = resolveRules({ ...clatRule, marksUnattempted: '0.25' }, sections);
    expect(scoreAttempt(sections, r, key, { S1: [null, null, null, null] }).total).toBe('1');
  });
  it('caps a section score and its maximum', () => {
    const capped = [section({ capMarks: '2.5' })];
    const { rules: r } = resolveRules(clatRule, capped);
    const s = scoreAttempt(capped, r, key, { S1: ['A', 'B', 'C', 'D'] });
    expect(s.sections[0]).toMatchObject({ score: '2.5', max: '2.5', capped: true });
  });
  it('drops questions with a null key entry (no marks either way, max reduced)', () => {
    const s = scoreAttempt(sections, rules, { S1: ['A', null, 'C', 'D'] }, { S1: ['A', 'A', 'B', null] });
    expect(s.sections[0]).toMatchObject({ correct: 1, wrong: 1, unattempted: 1, dropped: 1, score: '0.75', max: '3' });
  });
  it('compares numeric short answers canonically', () => {
    const num = [section({ code: 'SA', answerFormat: 'numeric', questionCount: 2 })];
    const { rules: r } = resolveRules({ marksPerCorrect: '4', marksPerWrong: '0', marksUnattempted: '0' }, num);
    expect(scoreAttempt(num, r, { SA: ['12.5', '7'] }, { SA: ['12.50', '8'] }).total).toBe('4');
  });
});

describe('validateForFinalise', () => {
  const sections = [section()];
  const key = { version: 2, answers: { S1: ['A', 'B', 'C', 'D'] } };
  const attempt = (studentId: string, over: Partial<AttemptInput> = {}): AttemptInput => ({
    attemptId: `att-${studentId}`,
    studentId,
    status: 'submitted',
    responses: { S1: ['A', null, 'C', 'B'] },
    keyVersion: 2,
    ...over,
  });

  it('passes a complete, consistent set', () => {
    const v = validateForFinalise({
      assessmentRule: clatRule,
      sections,
      key,
      attempts: [attempt('s1'), attempt('s2', { status: 'absent', responses: null, keyVersion: null })],
      enrolledStudentIds: ['s1', 's2'],
    });
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('reports every problem: rule, missing responses, out-of-range, key mismatch, duplicate, not enrolled, missing attempt', () => {
    const v = validateForFinalise({
      assessmentRule: { ...clatRule, marksPerWrong: null },
      sections,
      key,
      attempts: [
        attempt('s1', { responses: { S1: ['A', 'B'] } }),
        attempt('s2', { responses: { S1: ['A', 'E', null, null] } }),
        attempt('s3', { keyVersion: 1 }),
        attempt('s4'),
        attempt('s4'),
        attempt('outsider'),
      ],
      enrolledStudentIds: ['s1', 's2', 's3', 's4', 's5'],
    });
    const codes = v.issues.map((i) => i.code);
    expect(v.ok).toBe(false);
    expect(codes).toContain('RULE_INCOMPLETE');
    expect(codes).toContain('MISSING_RESPONSES');
    expect(codes).toContain('OUT_OF_RANGE');
    expect(codes).toContain('KEY_VERSION_MISMATCH');
    expect(codes).toContain('DUPLICATE_ATTEMPT');
    expect(codes).toContain('NOT_ENROLLED');
    expect(v.issues.find((i) => i.code === 'MISSING_ATTEMPT')?.studentId).toBe('s5');
    expect(v.issues.find((i) => i.code === 'OUT_OF_RANGE')).toMatchObject({ studentId: 's2', questionNo: 2 });
  });

  it('requires an answer key that matches the sections', () => {
    const noKey = validateForFinalise({ assessmentRule: clatRule, sections, key: null, attempts: [], enrolledStudentIds: [] });
    expect(noKey.issues.map((i) => i.code)).toEqual(['NO_ANSWER_KEY']);
    const shortKey = validateForFinalise({
      assessmentRule: clatRule,
      sections,
      key: { version: 1, answers: { S1: ['A', 'Z'] } },
      attempts: [],
      enrolledStudentIds: [],
    });
    expect(shortKey.issues.map((i) => i.code)).toEqual(['KEY_INVALID', 'KEY_INVALID']);
  });
});

describe('aggregateResults and percentiles', () => {
  const sections = [section()];
  const { rules } = resolveRules(clatRule, sections);
  const key = { S1: ['A', 'B', 'C', 'D'] };
  const a = (id: string, answers: (string | null)[] | null): AttemptInput => ({
    attemptId: id,
    studentId: id,
    status: answers ? 'submitted' : 'absent',
    responses: answers ? { S1: answers } : null,
    keyVersion: 1,
  });

  it('ranks with ties (1, 2, 2, 4), excludes absentees, computes percentile ranks', () => {
    const r = aggregateResults(sections, rules, key, [
      a('top', ['A', 'B', 'C', 'D']), // 4
      a('mid1', ['A', 'B', 'C', null]), // 3
      a('mid2', ['A', 'B', null, 'D']), // 3
      a('low', ['B', null, null, null]), // -0.25
      a('away', null),
    ]);
    const by = Object.fromEntries(r.results.map((x) => [x.studentId, x]));
    expect(by.top).toMatchObject({ rank: 1, percentile: '87.5000' });
    expect(by.mid1).toMatchObject({ rank: 2, percentile: '50.0000' });
    expect(by.mid2!.rank).toBe(2);
    expect(by.low).toMatchObject({ rank: 4, percentile: '12.5000' });
    expect(by.low!.score!.total).toBe('-0.25');
    expect(by.away).toMatchObject({ absent: true, score: null, rank: null, percentile: null });
    expect(r.scored).toBe(4);
    expect(r.absent).toBe(1);
    expect(r.sectionStats[0]).toEqual({ sectionCode: 'S1', mean: '2.4375', highest: '4', lowest: '-0.25' });
  });

  it('gives no percentile for a cohort of one (insufficient data)', () => {
    expect(percentileRank(0, 1, 1)).toBeNull();
    const r = aggregateResults(sections, rules, key, [a('only', ['A', 'B', 'C', 'D'])]);
    expect(r.results[0]).toMatchObject({ rank: 1, percentile: null });
  });

  it('rounds percentiles half-up to 4 decimals', () => {
    expect(percentileRank(1, 1, 3)).toBe('50.0000');
    expect(percentileRank(0, 1, 3)).toBe('16.6667');
    expect(percentileRank(2, 1, 3)).toBe('83.3333');
  });
});
