import { describe, expect, it } from 'vitest';
import {
  assessmentTrend,
  computeCoverage,
  findMissedClasses,
  prioritiseCatchup,
  summariseAttendance,
  type CatchupTaskInput,
} from '../../src/domain';

describe('computeCoverage', () => {
  const chapters = [
    { id: 'c1', subjectId: 'q', code: 'Q-01', title: 'Numbers' },
    { id: 'c2', subjectId: 'q', code: 'Q-02', title: 'Algebra' },
    { id: 'c3', subjectId: 'v', code: 'V-01', title: 'Grammar' },
    { id: 'c9', subjectId: 'v', code: 'V-09', title: 'Not in plan' },
  ];
  const subjects = [
    { id: 'q', code: 'QUANT', name: 'Quant' },
    { id: 'v', code: 'VERBAL', name: 'Verbal' },
  ];
  const items = [
    { chapterId: 'c1', plannedMinutes: 150, plannedClasses: 2, plannedDate: '2027-04-01' },
    { chapterId: 'c2', plannedMinutes: 75, plannedClasses: 1, plannedDate: '2027-04-10' },
    { chapterId: 'c3', plannedMinutes: 75, plannedClasses: 1, plannedDate: '2027-04-02' },
  ];

  it('counts only verified minutes as completed; unverified separate; superseded ignored', () => {
    const r = computeCoverage({
      items,
      chapters,
      subjects,
      records: [
        { chapterId: 'c1', actualMinutes: 75, state: 'verified', activity: 'main', completion: 'completed' },
        { chapterId: 'c1', actualMinutes: 70, state: 'submitted', activity: 'main', completion: 'completed' },
        { chapterId: 'c1', actualMinutes: 999, state: 'superseded', activity: 'main', completion: 'completed' },
        { chapterId: 'c9', actualMinutes: 30, state: 'verified', activity: 'main', completion: 'completed' },
      ],
      asOf: '2027-04-05',
    });
    const c1 = r.chapters.find((c) => c.chapterId === 'c1')!;
    expect(c1).toMatchObject({ plannedMinutes: 150, plannedHours: 2.5, verifiedMinutes: 75, unverifiedMinutes: 70, completionPercent: 50, plannedToDateMinutes: 150, varianceMinutes: -75 });
    const quant = r.subjects.find((s) => s.code === 'QUANT')!;
    expect(quant).toMatchObject({ plannedMinutes: 225, verifiedMinutes: 75, plannedToDateMinutes: 150 });
    expect(r.course).toMatchObject({ plannedMinutes: 300, plannedClasses: 4, verifiedMinutes: 75, plannedToDateMinutes: 225, completionPercent: 25 });
    expect(r.unplanned).toEqual([{ chapterId: 'c9', verifiedMinutes: 30, unverifiedMinutes: 0 }]);
  });

  it('nothing delivered yet is 0 % completed, not missing; undated plans give unknown planned-to-date', () => {
    const r = computeCoverage({ items: [{ ...items[0]!, plannedDate: null }], chapters, subjects, records: [], asOf: '2027-04-05' });
    expect(r.course).toMatchObject({ verifiedMinutes: 0, completionPercent: 0, plannedToDateMinutes: null, varianceMinutes: null });
  });

  it('an empty plan has no completion percentage (missing, not zero)', () => {
    expect(computeCoverage({ items: [], chapters, subjects, records: [], asOf: null }).course.completionPercent).toBeNull();
  });
});

describe('summariseAttendance', () => {
  it('excludes unrecorded sessions and excused absences from the rate', () => {
    const s = summariseAttendance(['s1', 's2', 's3', 's4', 's5'], [
      { sessionId: 's1', status: 'present' },
      { sessionId: 's2', status: 'late' },
      { sessionId: 's3', status: 'absent' },
      { sessionId: 's4', status: 'excused' },
    ]);
    expect(s).toMatchObject({ heldSessions: 5, recorded: 4, notRecorded: 1, ratePercent: 66.7 });
  });
  it('returns a missing rate (null), never 0 %, when nothing is recorded', () => {
    expect(summariseAttendance(['s1'], []).ratePercent).toBeNull();
    expect(summariseAttendance(['s1'], [{ sessionId: 's1', status: 'excused' }]).ratePercent).toBeNull();
    expect(summariseAttendance(['s1'], [{ sessionId: 's1', status: 'absent' }]).ratePercent).toBe(0);
  });
});

describe('findMissedClasses', () => {
  it('lists late-joiner and absent/excused sessions; unrecorded are not missed', () => {
    const r = findMissedClasses(
      '2027-04-10',
      [
        { id: 'a', date: '2027-04-05', chapterId: 'c1' },
        { id: 'b', date: '2027-04-12', chapterId: 'c2' },
        { id: 'c', date: '2027-04-13', chapterId: 'c2' },
        { id: 'd', date: '2027-04-14', chapterId: null },
      ],
      [
        { sessionId: 'b', status: 'absent' },
        { sessionId: 'c', status: 'present' },
      ],
    );
    expect(r.missed.map((m) => `${m.sessionId}:${m.reason}`)).toEqual(['a:late_joiner', 'b:absent']);
    expect(r.unrecorded).toBe(1);
  });
});

describe('assessmentTrend (least squares)', () => {
  it('returns insufficient data below the minimum, never a trend', () => {
    expect(assessmentTrend([{ date: '2027-01-01', percent: 50 }, { date: '2027-01-08', percent: 70 }])).toMatchObject({ status: 'insufficient_data', pointsUsed: 2 });
    expect(assessmentTrend([])).toMatchObject({ status: 'insufficient_data' });
  });
  it('computes the slope over the last N results in date order', () => {
    const r = assessmentTrend([
      { date: '2027-01-15', percent: 60 },
      { date: '2027-01-01', percent: 40 },
      { date: '2027-01-08', percent: 50 },
    ]);
    expect(r).toEqual({ status: 'ok', slope: 10, direction: 'improving', pointsUsed: 3, mean: 50 });
  });
  it('uses only the last N points and calls small slopes flat', () => {
    const pts = [10, 90, 90, 90.5, 91].map((p, i) => ({ date: `2027-01-0${i + 1}`, percent: p }));
    const r = assessmentTrend(pts, { lastN: 4 });
    expect(r).toMatchObject({ status: 'ok', direction: 'flat', pointsUsed: 4 });
    // with all five points the early 10 → 90 jump dominates
    expect(assessmentTrend(pts, { lastN: 5 })).toMatchObject({ direction: 'improving' });
  });
  it('detects a decline and ignores out-of-range values', () => {
    const r = assessmentTrend([
      { date: '2027-01-01', percent: 80 },
      { date: '2027-01-02', percent: 150 },
      { date: '2027-01-03', percent: 70 },
      { date: '2027-01-04', percent: 60 },
    ]);
    expect(r).toMatchObject({ status: 'ok', slope: -10, direction: 'declining', pointsUsed: 3 });
  });
});

describe('prioritiseCatchup', () => {
  const t = (over: Partial<CatchupTaskInput> & { id: string }): CatchupTaskInput => ({
    studentId: 'st',
    sessionDate: '2027-05-01',
    chapterId: 'c1',
    chapterWeight: 1,
    status: 'open',
    ...over,
  });
  const asOf = '2027-05-10';

  it('is deterministic and explains every factor', () => {
    const ranked = prioritiseCatchup(
      [
        t({ id: 'old', sessionDate: '2027-02-01' }),
        t({ id: 'recent', sessionDate: '2027-05-08' }),
        t({ id: 'heavy', sessionDate: '2027-04-01', chapterId: 'c2', chapterWeight: 8 }),
        t({ id: 'test-soon', sessionDate: '2027-04-25', chapterId: 'c3' }),
        t({ id: 'done', status: 'done' }),
      ],
      [{ id: 'a1', label: 'Chapter test 3', date: '2027-05-12', chapterIds: ['c3'] }],
      asOf,
    );
    // test-soon: recency 2×2 + weight 1×1 + urgency 3×3 = 14; heavy: 1×2 + 8×1 = 10;
    // recent: 3×2 + 1 = 7; old: 0 + 1 = 1.
    expect(ranked.map((r) => [r.taskId, r.score])).toEqual([
      ['test-soon', 14],
      ['heavy', 10],
      ['recent', 7],
      ['old', 1],
    ]);
    const heavy = ranked[1]!;
    expect(heavy).toMatchObject({ rank: 2, factors: { recencyPoints: 1, chapterWeight: 8, assessmentPoints: 0 } });
    expect(ranked[0]!.factors.upcomingAssessment).toMatchObject({ id: 'a1', daysUntil: 2 });
    expect(ranked[0]!.explanation).toContain('Chapter test 3 in 2 day(s)');
    expect(ranked.find((r) => r.taskId === 'old')!.score).toBe(1);
  });

  it('breaks ties by earlier missed date then id; ignores assessments outside the horizon or in the past', () => {
    const ranked = prioritiseCatchup(
      [t({ id: 'b', sessionDate: '2027-05-05' }), t({ id: 'a', sessionDate: '2027-05-05' }), t({ id: 'z', sessionDate: '2027-05-04' })],
      [
        { id: 'past', label: 'Past', date: '2027-05-01', chapterIds: ['c1'] },
        { id: 'far', label: 'Far', date: '2027-08-01', chapterIds: ['c1'] },
      ],
      asOf,
    );
    expect(ranked.map((r) => r.taskId)).toEqual(['z', 'a', 'b']);
    expect(ranked.every((r) => r.factors.upcomingAssessment === null)).toBe(true);
  });
});
