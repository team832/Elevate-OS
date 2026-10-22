import { describe, expect, it } from 'vitest';
import { checkTimetable, patternDates, type TimetableSession } from '../../src/domain';

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
const base = { exclusions: [], classLengthByBatch: { B1: { minutes: 75, status: 'locked' }, B2: { minutes: 75, status: 'locked' } }, workloadCap: null };
const codes = (sessions: TimetableSession[], extra: Record<string, unknown> = {}) =>
  checkTimetable({ ...base, sessions, ...extra }).hard.map((c) => c.code);

describe('checkTimetable — session teachers, unavailability, shared students (ACD-012, brief §9)', () => {
  it.each([
    ['a co-teacher in another batch at the same time', [s({ id: 'a', teacherStaffId: 'T1' }), s({ id: 'b', batchId: 'B2', teacherStaffId: 'T2', teacherStaffIds: ['T2', 'T1'] })], ['TEACHER_OVERLAP']],
    ['a substitute replacing the planned teacher frees the original', [s({ id: 'a', teacherStaffId: 'T1', teacherStaffIds: ['T3'] }), s({ id: 'b', batchId: 'B2', teacherStaffId: 'T1' })], []],
    ['cancelled sessions are ignored', [s({ id: 'a', teacherStaffId: 'T1' }), s({ id: 'b', batchId: 'B2', teacherStaffId: 'T1', status: 'cancelled' })], []],
  ])('%s', (_label, sessions, expected) => {
    expect(codes(sessions)).toEqual(expected);
  });

  it('a teacher with an academic unavailability record on the date is a hard conflict; other dates are fine', () => {
    const unavailability = [{ staffId: 'T1', from: '2027-04-05', to: '2027-04-06' }];
    expect(codes([s({ id: 'a', teacherStaffId: 'T1' })], { unavailability })).toEqual(['TEACHER_UNAVAILABLE']);
    expect(codes([s({ id: 'a', teacherStaffId: 'T1', date: '2027-04-07' })], { unavailability })).toEqual([]);
  });

  it('a student placed in two batches cannot have both classes at once (placement dates respected)', () => {
    const pair = [s({ id: 'a' }), s({ id: 'b', batchId: 'B2' })];
    const placements = [
      { studentId: 'S1', batchId: 'B1', from: '2027-04-01', to: null },
      { studentId: 'S1', batchId: 'B2', from: '2027-04-01', to: '2027-04-30' },
    ];
    expect(codes(pair, { placements })).toEqual(['STUDENT_OVERLAP']);
    expect(codes(pair, { placements: [placements[0]!, { ...placements[1]!, to: '2027-04-04' }] })).toEqual([]);
  });
});

describe('patternDates', () => {
  it('lists the weekday dates in the range and marks closures (not exam blackouts) as skipped', () => {
    const dates = patternDates({ weekday: 1, from: '2027-04-01', to: '2027-04-30', batchId: 'B1' }, [
      { date: '2027-04-12', batchId: null, kind: 'holiday', label: 'Holiday', status: 'confirmed' },
      { date: '2027-04-19', batchId: 'B1', kind: 'exam_blackout', label: 'Blackout', status: 'confirmed' },
      { date: '2027-04-26', batchId: 'B2', kind: 'holiday', label: 'Other batch', status: 'confirmed' },
    ]);
    expect(dates).toEqual([
      { date: '2027-04-05', skipped: null },
      { date: '2027-04-12', skipped: 'Holiday' },
      { date: '2027-04-19', skipped: null },
      { date: '2027-04-26', skipped: null },
    ]);
  });
});
