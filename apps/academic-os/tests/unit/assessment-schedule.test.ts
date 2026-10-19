import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAssessmentSchedule, type AssessmentCandidate, type BlackoutWindow } from '../../src/domain';

const plan = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../data/legacy/academic/class12-plan.json', import.meta.url)), 'utf8'),
) as {
  chapter_tests: {
    test_id: string;
    saturday_test_date: string;
    sunday_discussion_date: string;
    test_minutes: number;
    planned_topic_completion: string;
  }[];
  known_conflicts: { id: string; tests?: string[] }[];
};
const baseline = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../data/legacy/academic/ipmat-baseline.json', import.meta.url)), 'utf8'),
) as { calendar: { iimb_exam_date: string; iimb_exam_date_status: string; pre_iimb_mock_phase: { start: string; end: string } } };

const cand = (over: Partial<AssessmentCandidate> & { id: string }): AssessmentCandidate => ({
  label: over.id,
  date: '2027-05-08',
  startTime: null,
  durationMinutes: 60,
  discussionDate: null,
  prerequisiteCompletion: null,
  ...over,
});

describe('legacy known conflict: late weekend tests vs the provisional exam date and the mock phase', () => {
  const blackouts: BlackoutWindow[] = [
    {
      label: 'Pre-IIMB mock phase',
      kind: 'mock_phase',
      from: baseline.calendar.pre_iimb_mock_phase.start,
      to: baseline.calendar.pre_iimb_mock_phase.end,
      status: 'proposed',
    },
    {
      label: 'IIMB UG exam (provisional)',
      kind: 'exam',
      from: baseline.calendar.iimb_exam_date,
      to: baseline.calendar.iimb_exam_date,
      status: baseline.calendar.iimb_exam_date_status,
    },
  ];
  const result = checkAssessmentSchedule({
    candidates: plan.chapter_tests.map((t) =>
      cand({
        id: t.test_id,
        date: t.saturday_test_date,
        discussionDate: t.sunday_discussion_date,
        durationMinutes: t.test_minutes,
        prerequisiteCompletion: t.planned_topic_completion,
      }),
    ),
    otherAssessments: [],
    classes: [],
    blackouts,
    minGap: null,
  });

  it('detects the 12 tests listed in C12-CONFLICT-002 and no others', () => {
    const expected = plan.known_conflicts.find((c) => c.id === 'C12-CONFLICT-002')!.tests!;
    expect(result.verdict).toBe('infeasible');
    expect(result.conflictingCandidates).toEqual([...expected].sort());
  });

  it('flags VT14-B (C12-CONFLICT-001): its discussion falls on the provisional exam date, marked unverified', () => {
    const vt14b = result.hard.filter((c) => c.candidateId === 'VT14-B');
    expect(vt14b).toHaveLength(1);
    expect(vt14b[0]).toMatchObject({ code: 'BLACKOUT', date: '2027-11-14', unverified: true });
    expect(vt14b[0]!.message).toContain('unverified');
  });

  it('no legacy test is scheduled before its prerequisites (all "After planned completion")', () => {
    expect(result.hard.filter((c) => c.code === 'BEFORE_PREREQUISITE')).toEqual([]);
  });

  it('several tests on the same Saturday without clock times are warnings, not hard clashes', () => {
    expect(result.hard.filter((c) => c.code === 'ASSESSMENT_CLASH')).toEqual([]);
    expect(result.preferences.every((c) => c.code === 'SAME_DAY_TIME_UNKNOWN')).toBe(true);
  });
});

describe('checkAssessmentSchedule', () => {
  it('clashes with a class of the batch only when the times overlap (touching is fine)', () => {
    const classes = [{ id: 'cls', label: 'Quant class', date: '2027-05-08', startTime: '09:00', durationMinutes: 75 }];
    const touching = checkAssessmentSchedule({ candidates: [cand({ id: 't', startTime: '10:15' })], otherAssessments: [], classes, blackouts: [], minGap: null });
    expect(touching.verdict).toBe('feasible');
    const overlapping = checkAssessmentSchedule({ candidates: [cand({ id: 't', startTime: '10:00' })], otherAssessments: [], classes, blackouts: [], minGap: null });
    expect(overlapping.hard.map((c) => c.code)).toEqual(['CLASS_CLASH']);
  });

  it('clashes with another assessment and enforces a configurable minimum gap', () => {
    const other = [{ id: 'o', label: 'Other test', date: '2027-05-06', startTime: '09:00', durationMinutes: 60 }];
    const warn = checkAssessmentSchedule({ candidates: [cand({ id: 't', startTime: '09:00' })], otherAssessments: other, classes: [], blackouts: [], minGap: { minDays: 3, enforcement: 'warning' } });
    expect(warn.verdict).toBe('feasible');
    expect(warn.preferences.map((c) => c.code)).toEqual(['MIN_GAP']);
    const hard = checkAssessmentSchedule({ candidates: [cand({ id: 't', startTime: '09:00' })], otherAssessments: other, classes: [], blackouts: [], minGap: { minDays: 3, enforcement: 'hard' } });
    expect(hard.verdict).toBe('infeasible');
    const boundary = checkAssessmentSchedule({ candidates: [cand({ id: 't', startTime: '09:00' })], otherAssessments: other, classes: [], blackouts: [], minGap: { minDays: 2, enforcement: 'hard' } });
    expect(boundary.verdict).toBe('feasible');
    const sameSlot = checkAssessmentSchedule({ candidates: [cand({ id: 't', date: '2027-05-06', startTime: '09:30' })], otherAssessments: other, classes: [], blackouts: [], minGap: null });
    expect(sameSlot.hard.map((c) => c.code)).toEqual(['ASSESSMENT_CLASH']);
  });

  it('rejects a test on or before its prerequisites’ planned completion', () => {
    const r = checkAssessmentSchedule({ candidates: [cand({ id: 't', date: '2027-05-08', prerequisiteCompletion: '2027-05-08' })], otherAssessments: [], classes: [], blackouts: [], minGap: null });
    expect(r.hard.map((c) => c.code)).toEqual(['BEFORE_PREREQUISITE']);
  });

  it('a verified blackout is not flagged unverified; invalid dates are reported', () => {
    const r = checkAssessmentSchedule({
      candidates: [cand({ id: 't' }), cand({ id: 'bad', date: '2027-02-30' })],
      otherAssessments: [],
      classes: [],
      blackouts: [{ label: 'Board exam', kind: 'closure', from: '2027-05-08', to: '2027-05-08', status: 'official' }],
      minGap: null,
    });
    expect(r.hard.find((c) => c.code === 'BLACKOUT')).toMatchObject({ unverified: false });
    expect(r.hard.some((c) => c.code === 'INVALID_DATE' && c.candidateId === 'bad')).toBe(true);
  });
});
