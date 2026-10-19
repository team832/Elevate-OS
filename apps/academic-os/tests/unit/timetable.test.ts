import { describe, expect, it } from 'vitest';
import { checkTimetable, intervalsOverlap, type TimetableSession } from '../../src/domain';

const s = (over: Partial<TimetableSession> & { id: string }): TimetableSession => ({
  batchId: 'B1',
  teacherStaffId: null,
  roomId: null,
  date: '2027-04-05',
  startTime: '09:00',
  durationMinutes: 75,
  status: 'scheduled',
  sessionType: 'teaching',
  ...over,
});
const len75 = { B1: { minutes: 75, status: 'locked' }, B2: { minutes: 75, status: 'locked' } };

describe('intervalsOverlap (half-open)', () => {
  it('treats touching intervals as not overlapping', () => {
    expect(intervalsOverlap(540, 615, 615, 690)).toBe(false);
    expect(intervalsOverlap(540, 615, 614, 690)).toBe(true);
    expect(intervalsOverlap(540, 615, 540, 615)).toBe(true);
    expect(intervalsOverlap(540, 615, 600, 610)).toBe(true);
  });
});

describe('checkTimetable', () => {
  it('a clean timetable is feasible (never "optimal")', () => {
    const r = checkTimetable({
      sessions: [s({ id: 'a' }), s({ id: 'b', startTime: '10:15' })],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    expect(r.verdict).toBe('feasible');
    expect(r.hard).toEqual([]);
    expect(r.notes[0]).toMatch(/workload cap is not configured/);
  });

  it('back-to-back sessions (touching) are not a conflict', () => {
    const r = checkTimetable({
      sessions: [
        s({ id: 'a', teacherStaffId: 'T', roomId: 'R' }),
        s({ id: 'b', startTime: '10:15', teacherStaffId: 'T', roomId: 'R' }),
      ],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    expect(r.hard).toEqual([]);
  });

  it('detects teacher, batch and room overlaps separately', () => {
    const r = checkTimetable({
      sessions: [
        s({ id: 'a', teacherStaffId: 'T', roomId: 'R' }),
        s({ id: 'b', batchId: 'B2', startTime: '10:00', teacherStaffId: 'T', roomId: 'R' }),
        s({ id: 'c', startTime: '10:14' }),
      ],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    const codes = r.hard.map((c) => `${c.code}:${c.sessionIds.join('+')}`).sort();
    expect(codes).toEqual(['BATCH_OVERLAP:a+c', 'ROOM_OVERLAP:a+b', 'TEACHER_OVERLAP:a+b']);
    expect(r.verdict).toBe('infeasible');
  });

  it('ignores cancelled and rescheduled sessions', () => {
    const r = checkTimetable({
      sessions: [s({ id: 'a' }), s({ id: 'b', status: 'cancelled' }), s({ id: 'c', status: 'rescheduled' })],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    expect(r.hard).toEqual([]);
    expect(r.checkedSessions).toBe(1);
  });

  it('flags sessions on holidays (centre-wide or batch-specific) but not on exam blackouts', () => {
    const r = checkTimetable({
      sessions: [s({ id: 'a' }), s({ id: 'b', batchId: 'B2', date: '2027-04-06' })],
      exclusions: [
        { date: '2027-04-05', batchId: null, kind: 'holiday', label: 'Holiday (fictional)', status: 'provisional' },
        { date: '2027-04-06', batchId: 'B1', kind: 'school_exam', label: 'B1 only', status: 'confirmed' },
        { date: '2027-04-06', batchId: null, kind: 'exam_blackout', label: 'Mock day', status: 'proposed' },
      ],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    expect(r.hard.map((c) => c.sessionIds[0])).toEqual(['a']);
    expect(r.hard[0]!.message).toContain('provisional');
  });

  it('duration mismatch is hard for a locked class length, a preference for a provisional one, and unknown lengths are reported', () => {
    const r = checkTimetable({
      sessions: [
        s({ id: 'a', durationMinutes: 60 }),
        s({ id: 'b', batchId: 'B2', durationMinutes: 60 }),
        s({ id: 'c', batchId: 'B3', durationMinutes: 60 }),
        s({ id: 't', durationMinutes: 45, sessionType: 'test', startTime: '14:00' }),
      ],
      exclusions: [],
      classLengthByBatch: { B1: { minutes: 75, status: 'locked' }, B2: { minutes: 75, status: 'provisional' } },
      workloadCap: null,
    });
    expect(r.hard.map((c) => `${c.code}:${c.sessionIds[0]}`)).toEqual(['DURATION_MISMATCH:a']);
    expect(r.preferences.map((c) => c.code).sort()).toEqual(['CLASS_LENGTH_UNKNOWN', 'DURATION_MISMATCH']);
  });

  it('teacher workload is a preference by default and hard only when configured', () => {
    const sessions = [
      s({ id: 'a', teacherStaffId: 'T' }),
      s({ id: 'b', teacherStaffId: 'T', startTime: '11:00' }),
      s({ id: 'c', teacherStaffId: 'T', startTime: '13:00' }),
    ];
    const warn = checkTimetable({
      sessions,
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: { maxMinutesPerDay: 150, maxMinutesPerWeek: null, enforcement: 'warning' },
    });
    expect(warn.verdict).toBe('feasible');
    expect(warn.preferences.map((c) => c.code)).toEqual(['TEACHER_WORKLOAD']);
    const hard = checkTimetable({
      sessions,
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: { maxMinutesPerDay: 150, maxMinutesPerWeek: null, enforcement: 'hard' },
    });
    expect(hard.verdict).toBe('infeasible');
    // at exactly the cap there is no finding (boundary)
    const atCap = checkTimetable({
      sessions,
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: { maxMinutesPerDay: 225, maxMinutesPerWeek: null, enforcement: 'hard' },
    });
    expect(atCap.hard).toEqual([]);
  });

  it('weekly workload groups Monday–Sunday', () => {
    const r = checkTimetable({
      sessions: [
        s({ id: 'mon', teacherStaffId: 'T', date: '2027-04-05' }),
        s({ id: 'sun', teacherStaffId: 'T', date: '2027-04-11' }),
        s({ id: 'nextmon', teacherStaffId: 'T', date: '2027-04-12' }),
      ],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: { maxMinutesPerDay: null, maxMinutesPerWeek: 100, enforcement: 'warning' },
    });
    expect(r.preferences).toHaveLength(1);
    expect(r.preferences[0]!.sessionIds.sort()).toEqual(['mon', 'sun']);
  });

  it('rejects invalid times and sessions past midnight', () => {
    const r = checkTimetable({
      sessions: [s({ id: 'bad', startTime: '25:00' }), s({ id: 'late', startTime: '23:30' })],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
    });
    expect(r.hard.map((c) => c.code).sort()).toEqual(['CROSSES_MIDNIGHT', 'INVALID_TIME']);
  });

  it('onlyInvolving limits the report to candidate sessions', () => {
    const r = checkTimetable({
      sessions: [s({ id: 'x1' }), s({ id: 'x2' }), s({ id: 'new', date: '2027-04-07' }), s({ id: 'new2', date: '2027-04-07' })],
      exclusions: [],
      classLengthByBatch: len75,
      workloadCap: null,
      onlyInvolving: ['new'],
    });
    expect(r.hard.map((c) => c.sessionIds.join('+'))).toEqual(['new+new2']);
  });
});
