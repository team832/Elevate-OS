/**
 * Assessment scoring (ACD-016..018, BR-ACD-16) — pure and exact.
 *
 * - Rules are configurable per assessment with per-section overrides: marks per
 *   correct, marks per wrong (signed, e.g. −0.25), marks for unattempted, and an
 *   optional section cap. Nothing here knows any particular exam.
 * - A rule value that is null is UNKNOWN; scoring refuses to finalise with unknowns.
 * - Arithmetic is in integer units (1 mark = 10 000 units, see marks.ts).
 * - Only `submitted` attempts are scored (responses, else the manual total). Absent, exempt
 *   and withheld attempts get no score, rank or percentile — never zero.
 */
import { canonicalNumber, formatMarks, parseMarks, type MarkUnits } from './marks';

export type Responses = Record<string, (string | null)[]>;

export interface RuleValues {
  marksPerCorrect: string | null;
  marksPerWrong: string | null;
  marksUnattempted: string | null;
}

export interface SectionSpec {
  code: string;
  name?: string;
  questionCount: number;
  answerFormat: 'choice' | 'numeric';
  /** Allowed answers for `choice` sections (case-insensitive). */
  options: readonly string[];
  /** Per-section overrides; null = inherit the assessment rule. */
  marksPerCorrect: string | null;
  marksPerWrong: string | null;
  marksUnattempted: string | null;
  capMarks: string | null;
}

export interface ResolvedSectionRule {
  code: string;
  perCorrect: MarkUnits;
  perWrong: MarkUnits;
  perUnattempted: MarkUnits;
  cap: MarkUnits | null;
}

export interface RuleProblem {
  sectionCode: string;
  field: 'marksPerCorrect' | 'marksPerWrong' | 'marksUnattempted' | 'capMarks';
  message: string;
}

/**
 * Resolve each section's effective rule (section override → assessment default).
 * Returns the problems instead of guessing when a value is unknown or invalid.
 */
export function resolveRules(
  assessment: RuleValues,
  sections: readonly SectionSpec[],
): { rules: ResolvedSectionRule[]; problems: RuleProblem[] } {
  const rules: ResolvedSectionRule[] = [];
  const problems: RuleProblem[] = [];
  for (const s of sections) {
    const pick = (field: keyof RuleValues): MarkUnits | null => {
      const raw = s[field] ?? assessment[field];
      try {
        const units = parseMarks(raw);
        if (units === null) {
          problems.push({
            sectionCode: s.code,
            field,
            message: `${field} is unknown for section ${s.code}; set it on the section or the assessment.`,
          });
        }
        return units;
      } catch (error) {
        problems.push({ sectionCode: s.code, field, message: (error as Error).message });
        return null;
      }
    };
    const perCorrect = pick('marksPerCorrect');
    const perWrong = pick('marksPerWrong');
    const perUnattempted = pick('marksUnattempted');
    let cap: MarkUnits | null = null;
    try {
      cap = parseMarks(s.capMarks);
    } catch (error) {
      problems.push({ sectionCode: s.code, field: 'capMarks', message: (error as Error).message });
    }
    if (perCorrect !== null && perCorrect <= 0) {
      problems.push({
        sectionCode: s.code,
        field: 'marksPerCorrect',
        message: `marksPerCorrect must be positive (section ${s.code}).`,
      });
    }
    if (perWrong !== null && perWrong > 0) {
      problems.push({
        sectionCode: s.code,
        field: 'marksPerWrong',
        message: `marksPerWrong is a penalty and must be zero or negative, e.g. -0.25 (section ${s.code}).`,
      });
    }
    if (cap !== null && cap < 0) {
      problems.push({ sectionCode: s.code, field: 'capMarks', message: 'capMarks cannot be negative.' });
    }
    if (perCorrect !== null && perWrong !== null && perUnattempted !== null) {
      rules.push({ code: s.code, perCorrect, perWrong, perUnattempted, cap });
    }
  }
  return { rules, problems };
}

/** Normalised form used to compare a response with the key; null when the answer is out of range. */
export function normaliseAnswer(section: SectionSpec, raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (section.answerFormat === 'numeric') return canonicalNumber(value);
  const upper = value.toUpperCase();
  return section.options.some((o) => o.toUpperCase() === upper) ? upper : null;
}

export interface SectionScore {
  sectionCode: string;
  correct: number;
  wrong: number;
  unattempted: number;
  /** Questions dropped from the key (null key entry): no marks either way. */
  dropped: number;
  rawUnits: MarkUnits;
  scoreUnits: MarkUnits;
  maxUnits: MarkUnits;
  capped: boolean;
  /** Human strings for display and storage. */
  score: string;
  max: string;
}

export interface AttemptScore {
  sections: SectionScore[];
  totalUnits: MarkUnits;
  maxUnits: MarkUnits;
  total: string;
  max: string;
}

/**
 * Score one validated attempt. Per question: key null → dropped; response
 * null/'' → unattempted; equal → correct; otherwise wrong. Section score =
 * correct×perCorrect + wrong×perWrong + unattempted×perUnattempted, then capped
 * at `cap` if set. Max = (questions − dropped)×perCorrect, also capped.
 */
export function scoreAttempt(
  sections: readonly SectionSpec[],
  rules: readonly ResolvedSectionRule[],
  key: Responses,
  responses: Responses,
): AttemptScore {
  const out: SectionScore[] = [];
  let totalUnits = 0;
  let maxUnits = 0;
  for (const s of sections) {
    const rule = rules.find((r) => r.code === s.code);
    if (!rule) throw new Error(`No resolved rule for section ${s.code}`);
    const keyRow = key[s.code] ?? [];
    const row = responses[s.code] ?? [];
    let correct = 0;
    let wrong = 0;
    let unattempted = 0;
    let dropped = 0;
    for (let q = 0; q < s.questionCount; q += 1) {
      const k = keyRow[q];
      if (k === null || k === undefined) {
        dropped += 1;
        continue;
      }
      const r = row[q];
      if (r === null || r === undefined || r.trim() === '') {
        unattempted += 1;
        continue;
      }
      const nk = normaliseAnswer(s, k);
      const nr = normaliseAnswer(s, r);
      if (nk !== null && nr !== null && nk === nr) correct += 1;
      else wrong += 1;
    }
    const rawUnits =
      correct * rule.perCorrect + wrong * rule.perWrong + unattempted * rule.perUnattempted;
    const uncappedMax = (s.questionCount - dropped) * rule.perCorrect;
    const scoreUnits = rule.cap !== null ? Math.min(rawUnits, rule.cap) : rawUnits;
    const sectionMax = rule.cap !== null ? Math.min(uncappedMax, rule.cap) : uncappedMax;
    totalUnits += scoreUnits;
    maxUnits += sectionMax;
    out.push({
      sectionCode: s.code,
      correct,
      wrong,
      unattempted,
      dropped,
      rawUnits,
      scoreUnits,
      maxUnits: sectionMax,
      capped: scoreUnits !== rawUnits,
      score: formatMarks(scoreUnits),
      max: formatMarks(sectionMax),
    });
  }
  return { sections: out, totalUnits, maxUnits, total: formatMarks(totalUnits), max: formatMarks(maxUnits) };
}

export interface ScoreBounds {
  minUnits: MarkUnits;
  maxUnits: MarkUnits;
  /** The scheme can produce a total below zero (negative marking). */
  negativeAllowed: boolean;
}

/**
 * Lowest and highest total the scheme can produce: per section, n = questions − dropped
 * (null key entries); max = n × perCorrect (capped), min = n × the lower of perWrong and
 * perUnattempted, so min < 0 only when the scheme has negative marking.
 */
export function scoreBounds(sections: readonly SectionSpec[], rules: readonly ResolvedSectionRule[], key: Responses | null): ScoreBounds {
  let minUnits = 0;
  let maxUnits = 0;
  for (const s of sections) {
    const rule = rules.find((r) => r.code === s.code);
    if (!rule) throw new Error(`No resolved rule for section ${s.code}`);
    const dropped = key ? (key[s.code] ?? []).slice(0, s.questionCount).filter((k) => k === null).length : 0;
    const n = s.questionCount - dropped;
    const max = n * rule.perCorrect;
    maxUnits += rule.cap !== null ? Math.min(max, rule.cap) : max;
    minUnits += n * Math.min(rule.perWrong, rule.perUnattempted, 0);
  }
  return { minUnits, maxUnits, negativeAllowed: minUnits < 0 };
}

/**
 * Bounds of a test entered as totals only (no sections): max = the entered maximum; min = 0, or
 * -max when the rule has negative marking.
 * shortcut: -max is a loose floor (question counts unknown); enter sections for an exact floor.
 */
export function totalOnlyBounds(maxMarks: string, marksPerWrong: string | null): ScoreBounds {
  const maxUnits = parseMarks(maxMarks)!;
  const negativeAllowed = (parseMarks(marksPerWrong) ?? 0) < 0;
  return { minUnits: negativeAllowed ? -maxUnits : 0, maxUnits, negativeAllowed };
}

/** Bounds for finalising: the sections' rule, or the entered maximum when there are no sections. */
export function finaliseBounds(
  input: Pick<FinaliseInput, 'sections' | 'assessmentRule' | 'key' | 'maxMarks'>,
  rules: readonly ResolvedSectionRule[],
): ScoreBounds {
  return input.sections.length === 0 && input.maxMarks
    ? totalOnlyBounds(input.maxMarks, input.assessmentRule.marksPerWrong)
    : scoreBounds(input.sections, rules, input.key?.answers ?? null);
}

/** Competition ranking (1, 2, 2, 4): one more than the number of strictly higher totals. */
export const competitionRank = (total: MarkUnits, totals: readonly MarkUnits[]): number =>
  totals.filter((t) => t > total).length + 1;

/** Why a manually entered total is not acceptable under the scheme, or null when it is. */
export function manualScoreProblem(value: string, bounds: ScoreBounds): string | null {
  let units: MarkUnits | null;
  try {
    units = parseMarks(value);
  } catch {
    return `"${value}" is not an exact mark (a decimal with at most 4 places).`;
  }
  if (units === null) return 'Enter a score.';
  if (units < 0 && !bounds.negativeAllowed) return 'The score cannot be negative: this scheme has no negative marking.';
  if (units < bounds.minUnits) return `The score must be at least ${formatMarks(bounds.minUnits)}.`;
  if (units > bounds.maxUnits) return `The score must be at most ${formatMarks(bounds.maxUnits)} (the maximum).`;
  return null;
}

// --- validation before finalising -----------------------------------------------------

export type ValidationCode =
  | 'NO_SECTIONS'
  | 'RULE_INCOMPLETE'
  | 'NO_ANSWER_KEY'
  | 'KEY_INVALID'
  | 'KEY_VERSION_MISMATCH'
  | 'MISSING_RESPONSES'
  | 'OUT_OF_RANGE'
  | 'DUPLICATE_ATTEMPT'
  | 'NOT_ENROLLED'
  | 'MISSING_ATTEMPT';

export interface ValidationIssue {
  code: ValidationCode;
  message: string;
  studentId?: string;
  sectionCode?: string;
  /** 1-based question number. */
  questionNo?: number;
}

export type AttemptStatus = 'submitted' | 'absent' | 'exempt' | 'withheld';
export type ResultState = 'scored' | Exclude<AttemptStatus, 'submitted'>;

export interface AttemptInput {
  attemptId: string;
  studentId: string;
  status: AttemptStatus;
  responses: Responses | null;
  keyVersion: number | null;
  /** Directly entered total; used only when there are no responses. */
  manualScore?: string | null;
}

export interface FinaliseInput {
  assessmentRule: RuleValues;
  sections: readonly SectionSpec[];
  key: { version: number; answers: Responses } | null;
  attempts: readonly AttemptInput[];
  /** Students with an active enrolment in the assessment's batch (roster-managed: the active roster). */
  enrolledStudentIds: readonly string[];
  /** Entered maximum of a total-only test (no sections). */
  maxMarks?: string | null;
}

export interface FinaliseValidation {
  ok: boolean;
  issues: ValidationIssue[];
  rules: ResolvedSectionRule[];
}

/**
 * Everything that must hold before results can be finalised. Returns ALL issues
 * (not just the first), so the coordinator can fix them in one pass:
 * rule incomplete/invalid, key missing/invalid, key-version mismatch, missing
 * responses (section absent or fewer answers than questions), out-of-range
 * answers, duplicate attempts, attempts by students not enrolled in the batch,
 * and enrolled students with no attempt (enter them as absent explicitly).
 */
export function validateForFinalise(input: FinaliseInput): FinaliseValidation {
  const issues: ValidationIssue[] = [];
  if (input.sections.length === 0 && !input.maxMarks) {
    issues.push({ code: 'NO_SECTIONS', message: 'The assessment has no sections.' });
  }
  const { rules, problems } = resolveRules(input.assessmentRule, input.sections);
  for (const p of problems) {
    issues.push({ code: 'RULE_INCOMPLETE', message: p.message, sectionCode: p.sectionCode });
  }

  const submitted = input.attempts.filter((a) => a.status === 'submitted');
  const manualOnly = submitted.length > 0 && submitted.every((a) => a.responses === null && a.manualScore);
  if (!input.key) {
    if (!manualOnly && input.sections.length > 0) issues.push({ code: 'NO_ANSWER_KEY', message: 'No answer key has been entered.' });
  } else {
    for (const s of input.sections) {
      const row = input.key.answers[s.code];
      if (!row) {
        issues.push({
          code: 'KEY_INVALID',
          sectionCode: s.code,
          message: `Answer key v${input.key.version} has no answers for section ${s.code}.`,
        });
        continue;
      }
      if (row.length !== s.questionCount) {
        issues.push({
          code: 'KEY_INVALID',
          sectionCode: s.code,
          message: `Answer key has ${row.length} answers for ${s.code}; the section has ${s.questionCount} questions.`,
        });
      }
      row.forEach((answer, i) => {
        if (answer !== null && normaliseAnswer(s, answer) === null) {
          issues.push({
            code: 'KEY_INVALID',
            sectionCode: s.code,
            questionNo: i + 1,
            message: `Key answer "${answer}" for ${s.code} Q${i + 1} is not a valid ${s.answerFormat} answer.`,
          });
        }
      });
    }
  }

  const bounds =
    problems.length === 0 && rules.length === input.sections.length
      ? finaliseBounds(input, rules)
      : null;
  const enrolled = new Set(input.enrolledStudentIds);
  const seen = new Map<string, number>();
  for (const a of input.attempts) seen.set(a.studentId, (seen.get(a.studentId) ?? 0) + 1);
  for (const [studentId, count] of seen) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_ATTEMPT',
        studentId,
        message: `${count} attempts were entered for the same student.`,
      });
    }
  }

  for (const a of input.attempts) {
    if (!enrolled.has(a.studentId)) {
      issues.push({
        code: 'NOT_ENROLLED',
        studentId: a.studentId,
        message: 'Attempt by a student not placed in the batch on the assessment date.',
      });
    }
    if (a.status !== 'submitted') continue;
    if (a.responses === null && a.manualScore) {
      const problem = bounds ? manualScoreProblem(a.manualScore, bounds) : null;
      if (problem) issues.push({ code: 'OUT_OF_RANGE', studentId: a.studentId, message: problem });
      continue;
    }
    if (input.key && a.keyVersion !== input.key.version) {
      issues.push({
        code: 'KEY_VERSION_MISMATCH',
        studentId: a.studentId,
        message: `Responses were entered against key v${a.keyVersion ?? '?'}; the current key is v${input.key.version}.`,
      });
    }
    const responses = a.responses ?? {};
    for (const s of input.sections) {
      const row = responses[s.code];
      if (!row || row.length < s.questionCount) {
        issues.push({
          code: 'MISSING_RESPONSES',
          studentId: a.studentId,
          sectionCode: s.code,
          message: `Section ${s.code} has ${row?.length ?? 0} of ${s.questionCount} responses (use an empty value for unattempted).`,
        });
        continue;
      }
      if (row.length > s.questionCount) {
        issues.push({
          code: 'OUT_OF_RANGE',
          studentId: a.studentId,
          sectionCode: s.code,
          message: `Section ${s.code} has ${row.length} responses for ${s.questionCount} questions.`,
        });
      }
      row.forEach((r, i) => {
        if (r !== null && r.trim() !== '' && normaliseAnswer(s, r) === null) {
          issues.push({
            code: 'OUT_OF_RANGE',
            studentId: a.studentId,
            sectionCode: s.code,
            questionNo: i + 1,
            message: `Response "${r}" to ${s.code} Q${i + 1} is not a valid ${s.answerFormat} answer.`,
          });
        }
      });
    }
    for (const code of Object.keys(responses)) {
      if (!input.sections.some((s) => s.code === code)) {
        issues.push({
          code: 'OUT_OF_RANGE',
          studentId: a.studentId,
          sectionCode: code,
          message: `Responses for unknown section ${code}.`,
        });
      }
    }
  }

  for (const studentId of enrolled) {
    if (!seen.has(studentId)) {
      issues.push({
        code: 'MISSING_ATTEMPT',
        studentId,
        message: 'Enrolled student has no attempt; enter responses or mark the student absent.',
      });
    }
  }

  return { ok: issues.length === 0, issues, rules };
}

// --- aggregation: totals, ranks, percentiles --------------------------------------------

export interface StudentResult {
  attemptId: string;
  studentId: string;
  state: ResultState;
  /** No score (absent, exempt or withheld) — the `results.absent` column. */
  absent: boolean;
  score: AttemptScore | null;
  /** Competition rank (1, 2, 2, 4); null when absent. */
  rank: number | null;
  /** Percentile rank within the cohort, 4-decimal string; null when absent or cohort < 2. */
  percentile: string | null;
}

export interface SectionStats {
  sectionCode: string;
  /** Mean score as a mark string (rounded half-up to a unit). */
  mean: string;
  highest: string;
  lowest: string;
}

export interface AggregatedResults {
  results: StudentResult[];
  scored: number;
  absent: number;
  exempt: number;
  withheld: number;
  sectionStats: SectionStats[];
}

/**
 * Percentile rank of a score among N scored students:
 *   P = (B + 0.5·E) / N × 100
 * where B = scores strictly below and E = scores equal (including the student).
 * Computed in integers and rounded half-up to 4 decimals. Needs N ≥ 2.
 */
export function percentileRank(below: number, equal: number, n: number): string | null {
  if (n < 2) return null;
  // (2B + E) / (2N) × 100, in units of 1/10 000 percent.
  const numerator = (2 * below + equal) * 100 * 10_000;
  const denominator = 2 * n;
  const scaled = Math.floor((2 * numerator + denominator) / (2 * denominator)); // round half-up
  const whole = Math.floor(scaled / 10_000);
  const frac = String(scaled % 10_000).padStart(4, '0');
  return `${whole}.${frac}`;
}

/** Score every submitted attempt, then rank and compute percentiles within the scored cohort. */
export function aggregateResults(
  sections: readonly SectionSpec[],
  rules: readonly ResolvedSectionRule[],
  /** null only when every submitted attempt is a manual total. */
  key: Responses | null,
  attempts: readonly AttemptInput[],
  bounds: ScoreBounds = scoreBounds(sections, rules, key),
): AggregatedResults {
  const scoreOf = (a: AttemptInput): AttemptScore | null => {
    if (a.status !== 'submitted') return null;
    if (a.responses === null && a.manualScore) {
      const totalUnits = parseMarks(a.manualScore)!;
      return { sections: [], totalUnits, maxUnits: bounds.maxUnits, total: formatMarks(totalUnits), max: formatMarks(bounds.maxUnits) };
    }
    return scoreAttempt(sections, rules, key ?? {}, a.responses ?? {});
  };
  const scoredRows = attempts.map((a) => ({ attempt: a, score: scoreOf(a) }));
  const totals = scoredRows.filter((r) => r.score).map((r) => r.score!.totalUnits);
  const n = totals.length;
  const results: StudentResult[] = scoredRows.map(({ attempt, score }) => {
    if (!score) {
      const state = attempt.status === 'submitted' ? 'absent' : attempt.status;
      return { attemptId: attempt.attemptId, studentId: attempt.studentId, state, absent: true, score: null, rank: null, percentile: null };
    }
    const below = totals.filter((t) => t < score.totalUnits).length;
    const equal = totals.filter((t) => t === score.totalUnits).length;
    return {
      attemptId: attempt.attemptId,
      studentId: attempt.studentId,
      state: 'scored',
      absent: false,
      score,
      rank: competitionRank(score.totalUnits, totals),
      percentile: percentileRank(below, equal, n),
    };
  });
  const sectionStats: SectionStats[] = sections.map((s) => {
    // Manual totals have no section breakdown, so they are not section points.
    const values = scoredRows.flatMap((r) => r.score?.sections.filter((x) => x.sectionCode === s.code).map((x) => x.scoreUnits) ?? []);
    if (values.length === 0) return { sectionCode: s.code, mean: '', highest: '', lowest: '' };
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = Math.sign(sum) * Math.floor((2 * Math.abs(sum) + values.length) / (2 * values.length));
    return {
      sectionCode: s.code,
      mean: formatMarks(mean),
      highest: formatMarks(Math.max(...values)),
      lowest: formatMarks(Math.min(...values)),
    };
  });
  const count = (state: ResultState) => results.filter((r) => r.state === state).length;
  return { results, scored: n, absent: count('absent'), exempt: count('exempt'), withheld: count('withheld'), sectionStats };
}
