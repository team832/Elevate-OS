/** Demo classes read Academic's marks and reviews (owner answers 1 and 3, 21 Oct 2026). Pure. */
import { describe, expect, it } from 'vitest';
import {
  demoReviewGrid,
  markedAttendance,
  matchDemoReviews,
  reviewSessions,
} from '../../src/domain/feedback';

const mark = (status: string, teacherStaffIds: string[] = []) => ({
  status,
  teacherStaffIds,
  teacherNames: teacherStaffIds,
  recordedAt: null,
});

describe('Academic marks on linked demo classes', () => {
  it.each([
    ['unlinked keeps the counsellor mark', 'present', null, 'present'],
    [
      'linked, not yet recorded keeps the Ops value',
      'scheduled',
      mark('not_recorded'),
      'scheduled',
    ],
    ['linked and recorded: Academic wins', 'present', mark('absent'), 'absent'],
  ] as const)('%s', (_n, ops, m, expected) => {
    expect(markedAttendance(ops, m)).toBe(expected);
  });

  it('a linked class has one grid row per actual teacher; an unlinked one keeps its teacher', () => {
    const rows = reviewSessions([
      {
        id: 's1',
        teacherStaffId: 'tA',
        isSubstitute: false,
        academic: mark('present', ['tB', 'tC']),
      },
      { id: 's2', teacherStaffId: 'tA', isSubstitute: true, academic: null },
    ]);
    expect(rows.map((r) => `${r.id}:${r.teacherStaffId}:${r.isSubstitute}`)).toEqual([
      's1:tB:false',
      's1:tC:false',
      's2:tA:true',
    ]);
  });
});

describe('matchDemoReviews (IST day + author; demo reviews only)', () => {
  const sessions = [
    { id: 's1', startsAt: new Date('2026-10-20T19:00:00Z'), teacherStaffId: 'tA' }, // 21 Oct IST
    { id: 's2', startsAt: new Date('2026-10-22T05:00:00Z'), teacherStaffId: 'tB' },
  ];
  const review = (over: Record<string, unknown>) => ({
    reviewKey: 'k1',
    version: 1,
    reviewType: 'demo_session',
    sessionDate: '2026-10-21',
    opsDemoSessionId: null as string | null,
    authorStaffId: 'tA',
    superseded: false,
    ...over,
  });

  it.each([
    ['same IST day and author', {}, ['s1']],
    ['UTC day is not the IST day', { sessionDate: '2026-10-20' }, []],
    ['another author', { authorStaffId: 'tB' }, []],
    ['not a demo review', { reviewType: 'periodic_progress' }, []],
    [
      'the Ops class id wins over day and author',
      { opsDemoSessionId: 's2', authorStaffId: 'tC' },
      ['s2'],
    ],
    ['an unknown class id matches nothing', { opsDemoSessionId: 'sX' }, []],
  ])('%s', (_n, over, expected) => {
    expect(matchDemoReviews(sessions, [review(over)]).map((r) => r.demoSessionId)).toEqual(
      expected,
    );
  });

  it('feeds the grid: a matched review is submitted, the other attended class stays pending', () => {
    const grid = demoReviewGrid(
      [
        {
          id: 's1',
          dayNumber: 1,
          teacherStaffId: 'tA',
          isSubstitute: false,
          attendance: 'present',
        },
        { id: 's2', dayNumber: 2, teacherStaffId: 'tB', isSubstitute: false, attendance: 'late' },
      ],
      matchDemoReviews(sessions, [review({}), review({ reviewKey: 'k0', superseded: true })]),
    );
    expect(grid.map((d) => d.teachers.map((t) => [t.state, t.reviewIds]))).toEqual([
      [['submitted', ['k1:1']]],
      [['pending', []]],
    ]);
  });
});
