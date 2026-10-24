/** ACD-029 draft timetable builder (A24): every slot passes checkTimetable; nothing is forced or guessed. */
import { describe, expect, it } from 'vitest';
import { buildTimetable, checkTimetable, patternDates, summariseBuild, type BuildInput, type TimetableSession } from '../../src/domain';

const MON = ['2099-02-02', '2099-02-09'];
const other = (over: Partial<TimetableSession> = {}): TimetableSession => ({ id: 'x1', batchId: 'X', teacherStaffId: 'T9', roomId: null, date: MON[0]!, startTime: '09:00', durationMinutes: 60, status: 'scheduled', sessionType: 'teaching', ...over });
const input = (over: Partial<BuildInput> = {}, centre: Partial<BuildInput['centre']> = {}): BuildInput => ({
  batchId: 'B',
  from: '2099-02-02',
  to: '2099-02-15',
  teachingWeekdays: [1, 2, 3, 4, 5],
  maxClassesPerDay: null,
  dayStart: '09:00',
  dayEnd: '12:00',
  classMinutes: 60,
  subjects: [
    { subjectId: 'S1', label: 'Quant', weeklyClasses: 3, teacherStaffIds: ['T1'] },
    { subjectId: 'S2', label: 'Verbal', weeklyClasses: 2, teacherStaffIds: ['T2'] },
  ],
  roomIds: ['R1'],
  ...over,
  centre: { existing: [], exclusions: [], classLengthByBatch: { B: { minutes: 60, status: 'locked' }, X: { minutes: 60, status: 'locked' } }, workloadCap: null, unavailability: [], placements: [], ...centre },
});
/** One subject, Mondays only, two start times (09:00, 10:00). */
const monday = (over: Partial<BuildInput> = {}, centre: Partial<BuildInput['centre']> = {}) =>
  input({ teachingWeekdays: [1], dayEnd: '11:00', subjects: [{ subjectId: 'S1', label: 'Quant', weeklyClasses: 1, teacherStaffIds: ['T1'] }], ...over }, centre);

describe('buildTimetable (A24)', () => {
  it('a clean build places every class with no hard conflict, spread across days', () => {
    const data = input();
    const res = buildTimetable(data);
    expect(res.unplaced).toEqual([]);
    expect(res.placed).toHaveLength(5);
    expect(new Set(res.placed.filter((p) => p.subjectId === 'S1').map((p) => p.weekday)).size).toBe(3);
    const sessions = res.placed.flatMap((p, i) =>
      patternDates({ weekday: p.weekday, from: data.from, to: data.to, batchId: 'B' }, []).map((d) => ({ ...other(), id: `${i}-${d.date}`, batchId: 'B', teacherStaffId: p.teacherStaffId, roomId: p.roomId, date: d.date, startTime: p.startTime })),
    );
    expect(checkTimetable({ sessions, exclusions: [], classLengthByBatch: data.centre.classLengthByBatch, workloadCap: null }).hard).toEqual([]);
  });

  it('is deterministic', () => {
    expect(buildTimetable(input())).toEqual(buildTimetable(input()));
  });

  it.each([
    ['a teacher busy in another batch', {}, { existing: [other({ teacherStaffId: 'T1', date: MON[1]! })] }, { startTime: '10:00', roomId: 'R1', classes: 2 }],
    ['a room booked by another batch', { roomIds: ['R1', 'R2'] }, { existing: [other({ roomId: 'R1' })] }, { startTime: '09:00', roomId: 'R2', classes: 2 }],
    ['a student placed in both batches', {}, { existing: [other()], placements: ['B', 'X'].map((batchId) => ({ studentId: 'ST1', batchId, from: '2099-01-01', to: null })) }, { startTime: '10:00', roomId: 'R1', classes: 2 }],
    ['a holiday (that date is skipped)', {}, { exclusions: [{ date: MON[1]!, batchId: null, kind: 'holiday' as const, label: 'Holiday (fictional)', status: 'confirmed' }] }, { startTime: '09:00', roomId: 'R1', classes: 1 }],
  ])('avoids %s', (_name, over, centre, expected) => {
    const res = buildTimetable(monday(over, centre));
    expect(res.placed).toEqual([expect.objectContaining({ weekday: 1, teacherStaffId: 'T1', ...expected })]);
  });

  it.each([
    ['an unavailable teacher', {}, { unavailability: [{ staffId: 'T1', from: MON[1]!, to: MON[1]! }] }, ['TEACHER_UNAVAILABLE']],
    ['a hard workload cap', {}, { workloadCap: { maxMinutesPerDay: 30, maxMinutesPerWeek: null, enforcement: 'hard' as const } }, ['TEACHER_WORKLOAD']],
    ['more classes than free slots', { subjects: [{ subjectId: 'S1', label: 'Quant', weeklyClasses: 3, teacherStaffIds: ['T1'] }] }, {}, ['BATCH_OVERLAP', 'TEACHER_OVERLAP']],
    ['the classes-per-day limit', { maxClassesPerDay: 1, subjects: [{ subjectId: 'S1', label: 'Quant', weeklyClasses: 2, teacherStaffIds: ['T1'] }] }, {}, ['DAILY_LIMIT']],
  ])('reports demand blocked by %s as unplaced, never forced', (_name, over, centre, reasons) => {
    const res = buildTimetable(monday(over, centre));
    expect(res.unplaced).toEqual([expect.objectContaining({ subjectId: 'S1', missing: 1, reasonCodes: reasons })]);
  });

  it('accepts a preference conflict and reports it', () => {
    const res = buildTimetable(monday({}, { workloadCap: { maxMinutesPerDay: 30, maxMinutesPerWeek: null, enforcement: 'warning' } }));
    expect(res.placed[0]!.preferences).toEqual(['TEACHER_WORKLOAD']);
  });

  it.each([
    ['class length', { classMinutes: null }, ['S1', 'S2'], 'CLASS_LENGTH_UNKNOWN'],
    ['teaching weekdays', { teachingWeekdays: [] }, ['S1', 'S2'], 'NO_TEACHING_DAYS'],
    ['a teacher for one subject', { subjects: [{ subjectId: 'S1', label: 'Quant', weeklyClasses: 2, teacherStaffIds: [] }, { subjectId: 'S2', label: 'Verbal', weeklyClasses: 1, teacherStaffIds: ['T2'] }] }, ['S1'], 'NO_TEACHER'],
    ['a start time inside the day window', { dayEnd: '09:30' }, ['S1', 'S2'], 'NO_START_TIMES'],
  ])('reports unknown %s instead of guessing', (_name, over, unplacedIds, code) => {
    const res = buildTimetable(input(over));
    expect(res.unplaced.map((u) => [u.subjectId, u.reasonCodes])).toEqual(unplacedIds.map((id) => [id, [code]]));
    expect(res.placed.every((p) => !unplacedIds.includes(p.subjectId))).toBe(true);
  });

  it('the system summary states what was and was not placed, never "optimal"', () => {
    const data = monday({ subjects: [{ subjectId: 'S1', label: 'Quant', weeklyClasses: 3, teacherStaffIds: ['T1'] }] });
    const text = summariseBuild(buildTimetable(data), data.subjects);
    expect(text).toMatch(/^Placed 2 of 3 weekly classes as draft patterns; nothing is published yet\. Classes fall on Monday\. Quant: 1 class not placed because the batch already has a class then; the teacher already has another class then\.$/);
    expect(text).not.toMatch(/optimal|best/i);
  });
});
