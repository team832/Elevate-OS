import { describe, expect, it } from 'vitest';
import {
  OPS_CHECKLIST_STATUSES,
  OPS_DEMO_ATTENDANCE,
  OPS_DEMO_MOCK_STATUSES,
  OPS_DEMO_OUTCOMES,
} from '@elevate/database';
import { resolveSettings, validateSettingChange } from '../../src/domain';
import {
  checkAttendance,
  checkDayDate,
  checkChecklistEntry,
  checkDemoPlan,
  checkMock,
  checkOutcome,
  checkExtraDay,
  checkSessionChange,
  checkTeacherChange,
  closingAttendance,
  CHECKLIST_STATUSES,
  DEMO_ATTENDANCE,
  DEMO_OUTCOMES,
  dayState,
  demoChecklist,
  demoDays,
  demoFeeStatus,
  demoFollowUp,
  demoMockStatus,
  demoProgress,
  demoView,
  latestEntries,
  demoAttendanceStatus,
  MOCK_STATUSES,
  nextSession,
  setupGaps,
} from '../../src/domain/demos';

const at = (iso: string) => new Date(iso);
const s = (n: number, startsAt: string, attendance = 'scheduled', extra: object = {}) => ({
  sessionNumber: n,
  dayNumber: n,
  startsAt: at(startsAt),
  attendance,
  mockStatus: 'not_required',
  teacherStaffId: 't1',
  subject: 'English',
  ...extra,
});

describe('vocabularies mirror the schema', () => {
  it.each([
    [DEMO_OUTCOMES, OPS_DEMO_OUTCOMES],
    [DEMO_ATTENDANCE, OPS_DEMO_ATTENDANCE],
    [MOCK_STATUSES, OPS_DEMO_MOCK_STATUSES],
    [CHECKLIST_STATUSES, OPS_CHECKLIST_STATUSES],
  ])('%j', (domain, schema) => expect([...domain]).toEqual([...schema]));
});

describe('D-1 day summary (documented rule)', () => {
  it.each([
    [['present'], 'attended'],
    [['late'], 'attended'], // late still attended the class
    [['absent', 'present'], 'attended'], // mixed: one class attended is enough
    [['absent', 'late'], 'attended'],
    [['absent'], 'absent'],
    [['absent', 'absent'], 'absent'],
    [['absent', 'excused'], 'absent'], // a class missed without leave
    [['excused'], 'excused'],
    [['excused', 'cancelled'], 'excused'],
    [['absent', 'scheduled'], 'scheduled'], // a class still to come
    [['rescheduled'], 'scheduled'],
    [['not_recorded'], 'not_recorded'], // never counted
    [['not_recorded', 'absent'], 'absent'],
    [['cancelled', 'cancelled'], 'cancelled'],
    [[], 'not_scheduled'],
  ])('%j → %s', (states, expected) =>
    expect(dayState(states.map((attendance) => ({ attendance })))).toBe(expected),
  );
});

describe('D-1 progress: days attended, days scheduled and classes attended stay distinct', () => {
  const day = (dayNumber: number, attendance: string, hour = 4) => ({
    dayNumber,
    attendance,
    startsAt: at(`2026-10-${20 + dayNumber}T0${hour}:30:00Z`),
  });
  it.each([
    // two classes on day 1 (one absent, one present), day 2 absent, day 3 to come
    [[day(1, 'absent'), day(1, 'present', 6), day(2, 'absent'), day(3, 'scheduled')], 1, 3, 1, 4],
    [[day(1, 'present'), day(1, 'late', 6), day(2, 'late'), day(3, 'excused')], 2, 3, 3, 4],
    [[day(1, 'absent'), day(2, 'absent'), day(3, 'absent')], 0, 3, 0, 3], // absent never counts
    [[day(1, 'present'), day(2, 'cancelled')], 1, 1, 1, 1], // a cancelled day is not scheduled
  ])('%#', (sessions, attended, daysScheduled, sessionsAttended, liveSessions) => {
    const p = demoProgress(sessions, 3);
    expect(p).toMatchObject({
      attended,
      planned: 3,
      daysScheduled,
      sessionsAttended,
      liveSessions,
    });
    expect(p.label).toBe(`${attended} of 3 days attended`);
    expect(p.sessionsLabel).toBe(`${sessionsAttended} of ${liveSessions} classes attended`);
  });
  it('lists every planned day (empty ones too) with its classes and IST dates', () => {
    const days = demoDays([day(2, 'present'), day(2, 'absent', 6)], 3);
    expect(days.map((d) => [d.day, d.state, d.sessions.length, d.dates])).toEqual([
      [1, 'not_scheduled', 0, []],
      [2, 'attended', 2, ['2026-10-22']],
      [3, 'not_scheduled', 0, []],
    ]);
  });
});

describe('D-2 view at IST calendar boundaries', () => {
  // First class 10:00 IST on 21 Oct 2026 (04:30 UTC).
  const sessions = [s(1, '2026-10-21T04:30:00Z'), s(2, '2026-10-22T04:30:00Z')];
  it.each([
    ['open', '2026-10-20T18:29:59Z', sessions, 'upcoming'], // 23:59:59 IST on 20 Oct
    ['open', '2026-10-20T18:30:00Z', sessions, 'current'], // 00:00 IST on 21 Oct, before the class
    ['open', '2026-10-25T00:00:00Z', sessions, 'current'],
    ['converted', '2026-10-01T00:00:00Z', sessions, 'previous'],
    ['declined', '2026-10-25T00:00:00Z', sessions, 'previous'],
    [
      'open',
      '2026-10-21T12:00:00Z',
      [s(1, '2026-10-21T04:30:00Z', 'cancelled'), s(2, '2026-10-23T04:30:00Z')],
      'upcoming',
    ],
    ['open', '2026-10-21T12:00:00Z', [], 'upcoming'],
  ])('%s at %s → %s', (outcome, now, list, view) =>
    expect(demoView({ outcome, sessions: list }, at(now))).toBe(view),
  );
});

describe('D-3 next class', () => {
  it('earliest pending not started; past pending sessions wait for a record', () => {
    const list = [
      s(1, '2026-10-19T10:00:00Z', 'present'),
      s(2, '2026-10-20T10:00:00Z'),
      s(3, '2026-10-23T10:00:00Z', 'rescheduled'),
      s(4, '2026-10-22T10:00:00Z', 'cancelled'),
    ];
    const r = nextSession(list, at('2026-10-21T00:00:00Z'));
    expect(r.next?.sessionNumber).toBe(3);
    expect(r.awaitingRecord.map((x) => x.sessionNumber)).toEqual([2]);
  });
});

describe('D-4 attendance changes', () => {
  const now = at('2026-10-21T12:00:00Z');
  const past = at('2026-10-21T04:30:00Z');
  const future = at('2026-10-22T04:30:00Z');
  it.each([
    ['scheduled', past, 'present', null, true, false],
    ['scheduled', future, 'present', null, false, undefined], // not started
    ['rescheduled', past, 'absent', null, true, false],
    ['present', past, 'absent', null, false, undefined], // correction without reason
    ['present', past, 'absent', 'Marked the wrong student', true, true],
    ['absent', past, 'scheduled', 'Recorded by mistake', true, true],
    ['scheduled', past, 'scheduled', null, false, undefined],
    ['cancelled', past, 'present', 'x', false, undefined],
    ['present', past, 'present', 'x', false, undefined],
    ['scheduled', past, 'late', null, true, false],
    ['scheduled', past, 'excused', null, true, false],
    ['late', past, 'present', null, false, undefined], // correction without reason
    ['excused', past, 'absent', 'Leave was not approved', true, true],
    ['not_recorded', past, 'present', null, false, undefined],
  ] as const)('%s → %s (%s)', (from, startsAt, to, reason, ok, correction) => {
    const r = checkAttendance({ attendance: from, startsAt }, to, reason, now);
    expect(r.ok).toBe(ok);
    if (r.ok) expect(r.correction).toBe(correction);
  });
});

describe('D-5/D-6 session changes and outcome', () => {
  it.each([
    ['scheduled', 'cancel', 'Teacher ill', true],
    ['present', 'cancel', 'x', false],
    ['scheduled', 'cancel', ' ', false],
    ['absent', 'reschedule', 'Make-up class', true],
    ['cancelled', 'reschedule', 'Back on', true],
    ['present', 'reschedule', 'x', false],
    ['late', 'reschedule', 'x', false], // late is attended too
  ] as const)('%s %s', (attendance, action, reason, ok) =>
    expect(checkSessionChange({ attendance }, action, reason).ok).toBe(ok),
  );
  it.each([
    ['open', 'Chose another institute', true],
    ['open', '', false],
    ['converted', 'x', false],
  ])('outcome from %s', (current, reason, ok) => expect(checkOutcome(current, reason).ok).toBe(ok));
  it.each([
    ['scheduled', null, true],
    ['present', null, false], // the class happened: its teacher changes only with a reason
    ['late', 'Register showed the substitute', true],
    ['absent', ' ', false],
  ])('teacher change on a %s class (reason %j)', (attendance, reason, ok) =>
    expect(checkTeacherChange({ attendance }, reason).ok).toBe(ok),
  );
  it.each([
    ['2026-10-21T04:30:00Z', 'not_recorded'], // started, never recorded
    ['2026-10-21T12:00:00Z', 'not_recorded'], // starts exactly now
    ['2026-10-22T04:30:00Z', 'cancelled'],
  ])('closing the demo: pending session at %s → %s', (startsAt, expected) =>
    expect(closingAttendance({ startsAt: at(startsAt) }, at('2026-10-21T12:00:00Z'))).toBe(
      expected,
    ),
  );
  it.each([
    ['completed', 'ATT-1', true],
    ['prepared', 'ATT-1', false],
    ['prepared', null, true],
  ] as const)('mock %s with reference %s', (status, ref, ok) =>
    expect(checkMock(status, ref).ok).toBe(ok),
  );
});

describe('booking plan (days × classes)', () => {
  // `date` is the October date; classes start 16:00 IST unless `hour` (UTC) says otherwise.
  const c = (dayNumber: number, date: number, subject = 'English', len = 1, hour = 10) => {
    const startsAt = at(`2026-10-${date}T${hour}:30:00Z`);
    return { dayNumber, startsAt, endsAt: new Date(+startsAt + len * 3_600_000), subject };
  };
  const none = { subjectCap: null, maxConsecutiveDays: null };
  it.each([
    ['three days, one class each', [c(1, 21), c(2, 22), c(3, 23)], none, []],
    ['several classes a day', [c(1, 21), c(1, 21, 'Maths', 1, 12), c(2, 23), c(3, 27)], none, []],
    ['two days only', [c(1, 21), c(2, 22)], none, ['A demo has 3 demo day(s)']],
    ['a fourth day', [c(1, 21), c(2, 22), c(3, 23), c(4, 24)], none, ['A demo has 3 demo day(s)']],
    ['a day over two dates', [c(1, 21), c(1, 22, 'Maths'), c(2, 23), c(3, 24)], none, ['one date']],
    ['days out of date order', [c(1, 23), c(2, 22), c(3, 24)], none, ['one date']],
    [
      'overlap',
      [c(1, 21, 'English', 3), c(1, 21, 'Maths', 1, 12), c(2, 22), c(3, 23)],
      none,
      ['must not overlap'],
    ],
    ['ends before it starts', [c(1, 21, 'English', -1), c(2, 22), c(3, 23)], none, ['end after']],
    [
      'subject cap',
      [c(1, 21, 'English'), c(2, 22, 'Maths'), c(3, 23, 'Logic')],
      { ...none, subjectCap: 2 },
      ['At most 2 subject(s)'],
    ],
    [
      'consecutive days (IST)',
      [c(1, 21), c(2, 22), c(3, 24)],
      { ...none, maxConsecutiveDays: 3 },
      ['within 3 consecutive'],
    ],
    ['limits off while open', [c(1, 21, 'A'), c(2, 25, 'B'), c(3, 29, 'C')], none, []],
  ] as const)('%s', (_, sessions, limits, expected) => {
    const sorted = [...sessions].sort((a, b) => +a.startsAt - +b.startsAt);
    const problems = checkDemoPlan(sorted, 3, limits);
    expect(problems).toHaveLength(expected.length);
    expected.forEach((text, i) => expect(problems[i]).toContain(text));
  });
  it.each([
    [3, { allowed: false, maxExtraDays: 1 }, null, true], // within the plan
    [4, { allowed: false, maxExtraDays: 1 }, 'Missed two days', false], // setting off: never a 4th day
    [4, { allowed: true, maxExtraDays: 1 }, null, false], // needs a reason
    [4, { allowed: true, maxExtraDays: 1 }, 'Missed day 2 (illness)', true],
    [5, { allowed: true, maxExtraDays: 1 }, 'x', false], // beyond the extra days allowed
  ])('day %i with extension %j', (dayNumber, extension, reason, ok) =>
    expect(checkExtraDay(dayNumber, 3, extension, reason).ok).toBe(ok),
  );
  it('no day number may be skipped', () =>
    expect(checkExtraDay(5, 3, { allowed: true, maxExtraDays: 2 }, 'x', 3).ok).toBe(false));
  it('the refusal names the setting', () => {
    const r = checkExtraDay(4, 3, { allowed: false, maxExtraDays: 1 }, 'x');
    expect(!r.ok && r.message).toContain('"Extra demo days"');
  });
});

describe('D-9 day dates', () => {
  // day 1 on 21 Oct (two classes), day 2 on 23 Oct (recorded absent), day 3 on 25 Oct
  const c = (id: string, day: number, date: number, attendance = 'scheduled') => ({
    id,
    dayNumber: day,
    attendance,
    startsAt: at(`2026-10-${date}T05:30:00Z`),
  });
  const days = demoDays([c('a', 1, 21), c('b', 1, 21), c('d', 2, 23, 'absent'), c('e', 3, 25)], 3);
  it.each([
    ['a class added on its day’s date', 2, '2026-10-23', [], true],
    ['an absent day “made up” on a later date', 2, '2026-10-28', [], false],
    ['a class put on another day’s date', 2, '2026-10-25', [], false],
    ['one class of a two-class day moved alone', 1, '2026-10-22', ['a'], false],
    ['the whole day moved (both classes)', 1, '2026-10-22', ['a', 'b'], true],
    ['the whole day moved after the others', 1, '2026-10-27', ['a', 'b'], true],
    ['the whole day moved onto another day’s date', 1, '2026-10-23', ['a', 'b'], false],
    ['the sole class of a day moved', 3, '2026-10-27', ['e'], true],
  ] as const)('%s', (_, day, date, moving, ok) =>
    expect(checkDayDate(days, day, date as never, moving).ok).toBe(ok),
  );
});

describe('demo fee from ledger rows', () => {
  const row = (kind: string, amountPaise: number, status = 'recorded') =>
    ({ kind, amountPaise, status, direction: null }) as never;
  it.each([
    [[], 'not_assessed', 0, 0, null],
    [[row('received', 100000)], 'not_assessed', 0, 100000, null], // paid, nothing due: balance unknown
    [[row('due', 100000)], 'unpaid', 100000, 0, 100000],
    [[row('due', 100000), row('received', 40000)], 'part_paid', 100000, 40000, 60000],
    [[row('due', 100000), row('received', 100000)], 'paid', 100000, 100000, 0],
    [[row('due', 100000), row('received', 100000, 'voided')], 'unpaid', 100000, 0, 100000],
    [[row('due', 100000), row('waiver', 100000)], 'waived', 100000, 0, 0],
    [[row('due', 100000), row('waiver', 50000), row('received', 50000)], 'paid', 100000, 50000, 0],
    [
      [row('due', 100000), row('received', 100000), row('refund', 100000)],
      'refunded',
      100000,
      0,
      100000,
    ],
    [
      [row('due', 100000), row('received', 100000), row('refund', 30000)],
      'part_paid',
      100000,
      70000,
      30000,
    ],
  ])('%#: %s', (rows, state, assessed, paid, balance) =>
    expect(demoFeeStatus(rows)).toMatchObject({
      state,
      assessedPaise: assessed,
      paidPaise: paid,
      balancePaise: balance,
    }),
  );
});

describe('D-7 checklist', () => {
  const e = (itemKey: string, status: string, minute: number, reason: string | null = null) => ({
    itemKey,
    status,
    reason,
    at: at(`2026-10-20T10:${String(minute).padStart(2, '0')}:00Z`),
  });
  it('latest entry per item wins, history kept', () => {
    const entries = [
      e('fee_structure_explained', 'pending', 1),
      e('fee_structure_explained', 'complete', 5),
      e('student_feedback', 'waived', 2, 'Student unwell'),
    ];
    const latest = latestEntries(entries);
    expect(latest.get('fee_structure_explained')?.status).toBe('complete');
    expect(entries).toHaveLength(3);
  });
  it.each([
    [{ itemKey: 'student_feedback', status: 'waived' as const }, false],
    [
      {
        itemKey: 'student_feedback',
        status: 'waived' as const,
        reason: 'Guardian spoke for the student',
      },
      true,
    ],
    [{ itemKey: 'sessions_recorded', status: 'complete' as const }, false], // derived
    [{ itemKey: 'nonsense', status: 'complete' as const }, false],
    [{ itemKey: 'fee_structure_explained', status: 'not_applicable' as const }, true],
  ])('%j', (input, ok) => expect(checkChecklistEntry(input).ok).toBe(ok));
  it('derived items follow the sessions; unrecorded items are pending', () => {
    const sessions = [
      s(1, '2026-10-19T10:00:00Z', 'present'),
      s(2, '2026-10-20T10:00:00Z', 'present', { mockStatus: 'completed', mockAttemptRef: 'ATT-1' }),
      s(3, '2026-10-21T10:00:00Z', 'absent'),
    ];
    const c = demoChecklist([e('fee_structure_explained', 'complete', 1)], sessions);
    const status = Object.fromEntries(c.items.map((i) => [i.key, i.status]));
    expect(status).toMatchObject({
      sessions_recorded: 'complete',
      mock_prepared: 'complete',
      mock_result_linked: 'complete',
      fee_structure_explained: 'complete',
      guardian_feedback: 'pending',
    });
    expect(c.done).toBe(4);
    expect(c.total).toBe(11);
    const noMock = demoChecklist([], [s(1, '2026-10-19T10:00:00Z', 'scheduled')]);
    expect(noMock.items.find((i) => i.key === 'mock_prepared')?.status).toBe('not_applicable');
    expect(noMock.items.find((i) => i.key === 'sessions_recorded')?.status).toBe('pending');
  });
});

describe('summaries', () => {
  it.each([
    ['open', ['present', 'scheduled'], 'scheduled'],
    ['open', ['present', 'absent'], 'attended'],
    ['open', ['late', 'excused'], 'attended'],
    ['open', ['excused', 'absent'], 'missed'],
    ['open', ['absent', 'not_recorded'], 'missed'],
    ['open', ['cancelled', 'cancelled'], 'cancelled'],
    ['cancelled', ['present', 'cancelled'], 'cancelled'],
  ])('attendance status %s %j → %s', (outcome, states, expected) =>
    expect(
      demoAttendanceStatus(
        outcome,
        states.map((attendance) => ({ attendance })),
      ),
    ).toBe(expected),
  );
  it('mock status is the furthest stage; setup gaps list what is missing', () => {
    expect(
      demoMockStatus([
        { mockStatus: 'not_required' },
        { mockStatus: 'prepared' },
        { mockStatus: 'pending' },
      ]),
    ).toBe('prepared');
    expect(demoMockStatus([])).toBe('not_required');
    const gaps = setupGaps({ plannedDayCount: 3, counsellorStaffId: null }, [
      s(1, '2026-10-25T10:00:00Z', 'scheduled', { teacherStaffId: null }),
      s(2, '2026-10-26T10:00:00Z', 'cancelled'),
    ]);
    expect(gaps).toEqual([
      '2 demo day(s) without a class',
      'teacher not assigned for 1 class(es)',
      'no counsellor',
    ]);
  });
  it('follow-up urgency uses the earliest open follow-up (A-06 IST rules)', () => {
    const f = demoFollowUp(
      [
        { status: 'done', dueDate: '2026-10-10', title: 'a' },
        { status: 'open', dueDate: '2026-10-19', title: 'b' },
        { status: 'open', dueDate: '2026-10-25', title: 'c' },
      ],
      at('2026-10-20T18:30:00Z'), // 00:00 IST 21 Oct
      2,
    );
    expect(f).toMatchObject({ title: 'b', state: 'overdue', daysOverdue: 2 });
    expect(demoFollowUp([], new Date(), 2)).toBeNull();
  });
});

describe('demo settings (owner brief 2026-10-20)', () => {
  const settings = resolveSettings([]);
  it('day count defaults to 3, approved (D-038), editable; checklist enforcement off', () => {
    expect(settings['admissions.demo.day_count']).toMatchObject({
      value: { count: 3 },
      decisionState: 'approved',
      editable: true,
    });
    expect(settings['admissions.demo.day_count'].ownerDecision).toBe('D-038');
    expect(settings['admissions.demo.checklist_required']).toMatchObject({
      value: { requiredBeforeConversion: false },
      decisionState: 'proposed',
    });
    expect(settings['demo.terms'].value).not.toHaveProperty('days');
  });
  it.each([
    [{ count: 4 }, true],
    [{ count: 0 }, false],
    [{ count: 11 }, false],
    [{ days: 3 }, false],
  ])('change to %j', (value, ok) =>
    expect(validateSettingChange('admissions.demo.day_count', value).ok).toBe(ok),
  );
});
