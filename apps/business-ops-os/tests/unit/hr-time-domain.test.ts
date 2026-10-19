import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@elevate/shared-types';
import {
  checkDecision,
  checkWithdraw,
  isMissingClockOut,
  lateEarly,
  missingClockOutDueAt,
  sessionsOverlap,
  sessionWorkedMinutes,
  validateAttendanceImport,
  validateSessionTimes,
  workDateFor,
  type AttendanceRules,
  type ImportEmployee,
} from '../../src/domain/hr/attendance';
import {
  formatMinutes,
  holidaysFor,
  isValidTimeZone,
  monthRange,
  zonedParts,
  zonedToInstant,
} from '../../src/domain/hr/calendar';
import { csvField, parseCsv, recordsToObjects, toCsv } from '../../src/domain/hr/csv';
import {
  availabilityGrid,
  balanceFromLedger,
  checkLeaveCancel,
  countLeaveDays,
  overlappingLeave,
  validateLeaveSpan,
  type LeaveSpan,
} from '../../src/domain/hr/leave';
import {
  findAssignmentConflicts,
  scheduledMinutesTotal,
  scheduledShiftMinutes,
  scheduleForRange,
  shiftTimesOverlap,
  shiftWindow,
  validateShiftTemplate,
  type ShiftTemplateLike,
} from '../../src/domain/hr/shifts';
import { dailyTimesheet, periodSummary } from '../../src/domain/hr/timesheets';

const d = (s: string) => s as IsoDate;
const RULES: AttendanceRules = {
  multipleSessionsPerDay: false,
  lateGraceMinutes: 10,
  earlyDepartureGraceMinutes: 10,
  missingClockOutGraceMinutes: 60,
  maxSessionHours: 16,
};
const day: ShiftTemplateLike = {
  id: 't-day',
  code: 'DAY',
  name: 'Day (proposed)',
  startTime: '09:00',
  endTime: '17:30',
  crossesMidnight: false,
  unpaidBreakMinutes: 30,
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  status: 'proposed',
};
const night: ShiftTemplateLike = {
  ...day,
  id: 't-night',
  code: 'NIGHT',
  startTime: '22:00',
  endTime: '06:00',
  crossesMidnight: true,
  unpaidBreakMinutes: 60,
};

describe('calendar and timezones', () => {
  it('converts IST and other zones exactly', () => {
    expect(zonedToInstant(d('2026-10-19'), '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-19T03:30:00.000Z',
    );
    expect(zonedToInstant(d('2026-10-19'), '09:00', 'UTC').toISOString()).toBe(
      '2026-10-19T09:00:00.000Z',
    );
    // Europe/London is on BST (UTC+1) on 19 Oct 2026.
    expect(zonedToInstant(d('2026-10-19'), '09:00', 'Europe/London').toISOString()).toBe(
      '2026-10-19T08:00:00.000Z',
    );
    expect(zonedParts(new Date('2026-10-19T20:00:00Z'), 'Asia/Kolkata')).toMatchObject({
      date: '2026-10-20',
      time: '01:30',
    });
  });
  it('validates zones, months and formats minutes', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(() => monthRange('2026-13')).toThrow();
    expect(formatMinutes(450)).toBe('7 h 30 min');
    expect(formatMinutes(-15)).toBe('−15 min');
    expect(formatMinutes(null)).toBe('—');
  });
  it('matches holidays by location and decision state', () => {
    const hs = [
      { date: '2026-10-20', name: 'All sites', location: null, status: 'approved' as const },
      { date: '2026-10-21', name: 'Sikar only', location: 'Sikar', status: 'proposed' as const },
      { date: '2026-10-22', name: 'Withdrawn', location: null, status: 'withdrawn' as const },
    ];
    expect([...holidaysFor(hs, 'sikar', true).keys()]).toEqual(['2026-10-20', '2026-10-21']);
    expect([...holidaysFor(hs, 'sikar', false).keys()]).toEqual(['2026-10-20']);
    expect([...holidaysFor(hs, 'Jaipur', true).keys()]).toEqual(['2026-10-20']);
  });
});

describe('attendance hour calculations', () => {
  it('worked minutes exclude breaks; open sessions are null, not 0', () => {
    const inAt = new Date('2026-10-19T03:30:00Z');
    expect(
      sessionWorkedMinutes({
        clockInAt: inAt,
        clockOutAt: new Date('2026-10-19T12:00:00Z'),
        breakMinutes: 30,
      }),
    ).toBe(480);
    expect(sessionWorkedMinutes({ clockInAt: inAt, clockOutAt: null, breakMinutes: 0 })).toBeNull();
  });
  it('cross-midnight session keeps the clock-in work date in the employee timezone', () => {
    const inAt = zonedToInstant(d('2026-10-19'), '22:00', 'Asia/Kolkata');
    const outAt = zonedToInstant(d('2026-10-20'), '06:15', 'Asia/Kolkata');
    expect(workDateFor(inAt, 'Asia/Kolkata')).toBe('2026-10-19');
    expect(workDateFor(inAt, 'UTC')).toBe('2026-10-19');
    expect(sessionWorkedMinutes({ clockInAt: inAt, clockOutAt: outAt, breakMinutes: 60 })).toBe(
      435,
    );
    // 01:00 IST on the 20th is still the 19th in UTC.
    expect(workDateFor(zonedToInstant(d('2026-10-20'), '01:00', 'Asia/Kolkata'), 'UTC')).toBe(
      '2026-10-19',
    );
  });
  it('validates order, maximum length and break length', () => {
    const inAt = new Date('2026-10-19T03:30:00Z');
    expect(
      validateSessionTimes({ clockInAt: inAt, clockOutAt: inAt, breakMinutes: 0 }, RULES)[0]?.path,
    ).toBe('clockOut');
    expect(
      validateSessionTimes(
        { clockInAt: inAt, clockOutAt: new Date('2026-10-20T03:30:00Z'), breakMinutes: 0 },
        RULES,
      )[0]?.message,
    ).toMatch(/16 hours/);
    expect(
      validateSessionTimes(
        { clockInAt: inAt, clockOutAt: new Date('2026-10-19T04:00:00Z'), breakMinutes: 30 },
        RULES,
      )[0]?.path,
    ).toBe('breakMinutes');
    expect(
      validateSessionTimes({ clockInAt: inAt, clockOutAt: null, breakMinutes: 0 }, RULES),
    ).toEqual([]);
  });
  it('overlap detection treats an open session as running until now', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    const a = { clockInAt: new Date('2026-10-19T03:30:00Z'), clockOutAt: null };
    const b = {
      clockInAt: new Date('2026-10-19T08:00:00Z'),
      clockOutAt: new Date('2026-10-19T09:00:00Z'),
    };
    const c = {
      clockInAt: new Date('2026-10-19T11:00:00Z'),
      clockOutAt: new Date('2026-10-19T12:00:00Z'),
    };
    expect(sessionsOverlap(a, b, now)).toBe(true);
    expect(sessionsOverlap(a, c, now)).toBe(false);
  });
});

describe('late / early flags with grace', () => {
  const win = shiftWindow(day, d('2026-10-19'), 'Asia/Kolkata');
  it('within grace is not late; beyond grace reports the full difference', () => {
    const at = (t: string) => zonedToInstant(d('2026-10-19'), t, 'Asia/Kolkata');
    expect(
      lateEarly({ clockInAt: at('09:10'), clockOutAt: at('17:25') }, win, RULES),
    ).toMatchObject({
      late: false,
      lateMinutes: 0,
      early: false,
      earlyDepartureMinutes: 0,
    });
    expect(
      lateEarly({ clockInAt: at('09:11'), clockOutAt: at('17:00') }, win, RULES),
    ).toMatchObject({
      late: true,
      lateMinutes: 11,
      early: true,
      earlyDepartureMinutes: 30,
    });
  });
  it('no shift → not measured (null), never "on time"', () => {
    const r = lateEarly({ clockInAt: new Date(), clockOutAt: null }, null, RULES);
    expect(r).toMatchObject({ measured: false, lateMinutes: null, earlyDepartureMinutes: null });
  });
  it('night shift window ends the next day', () => {
    const w = shiftWindow(night, d('2026-10-19'), 'Asia/Kolkata');
    expect(w.start.toISOString()).toBe('2026-10-19T16:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-20T00:30:00.000Z');
  });
});

describe('missing clock-out', () => {
  const inAt = zonedToInstant(d('2026-10-19'), '09:00', 'Asia/Kolkata');
  const end = shiftWindow(day, d('2026-10-19'), 'Asia/Kolkata').end;
  const s = { clockInAt: inAt, clockOutAt: null, status: 'open' };
  it('flags after shift end + grace, not before', () => {
    expect(isMissingClockOut(s, end, RULES, new Date(end.getTime() + 59 * 60_000))).toBe(false);
    expect(isMissingClockOut(s, end, RULES, new Date(end.getTime() + 61 * 60_000))).toBe(true);
  });
  it('without a shift uses the maximum session length; closed sessions never flag', () => {
    expect(missingClockOutDueAt(s, null, RULES).getTime() - inAt.getTime()).toBe(16 * 3_600_000);
    expect(
      isMissingClockOut({ ...s, status: 'closed', clockOutAt: end }, end, RULES, new Date(2100, 0)),
    ).toBe(false);
    const lateIn = { ...s, clockInAt: new Date(end.getTime() + 30 * 60_000) };
    expect(missingClockOutDueAt(lateIn, end, RULES).getTime()).toBe(
      lateIn.clockInAt.getTime() + 16 * 3_600_000,
    );
  });
});

describe('decision checks (corrections and leave)', () => {
  const base = {
    from: 'pending',
    to: 'approved' as 'approved' | 'rejected',
    actorUserId: 'u-approver',
    requestedByUserId: 'u-emp',
    actorStaffId: 's-approver' as string | null,
    subjectStaffId: 's-emp',
    note: null as string | null,
  };
  it.each([
    ['approve', {}, null],
    ['reject with a note', { to: 'rejected', note: 'No evidence' }, null],
    ['reject without a note', { to: 'rejected' }, 'NOTE_REQUIRED'],
    ['requester decides', { actorUserId: 'u-emp' }, 'SELF_DECISION'],
    ['employee decides own record', { actorStaffId: 's-emp' }, 'SELF_DECISION'],
    ['already decided', { from: 'approved' }, 'ILLEGAL'],
  ] as const)('%s', (_label, over, code) => {
    const r = checkDecision({ ...base, ...over });
    expect(r.ok ? null : r.code).toBe(code);
  });
  it.each([
    ['requester withdraws', 'pending', 'u-emp', null],
    ['someone else withdraws', 'pending', 'u-approver', 'NOT_ALLOWED'],
    ['already decided', 'approved', 'u-emp', 'ILLEGAL'],
  ] as const)('withdraw: %s', (_label, from, actorUserId, code) => {
    const r = checkWithdraw({ from, actorUserId, requestedByUserId: 'u-emp' });
    expect(r.ok ? null : r.code).toBe(code);
  });
});

describe('CSV parser (RFC 4180)', () => {
  it('handles quotes, escaped quotes, commas and line breaks inside quotes', () => {
    const r = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n');
    expect(r.ok && r.records.map((x) => x.fields)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
    ]);
  });
  it('handles CRLF, a lone CR, a BOM, blank lines and no trailing newline', () => {
    const r = parseCsv('﻿a,b\r\n\r\n1,2\r3,4\n   \n5,6');
    expect(r.ok && r.records.map((x) => [x.line, ...x.fields])).toEqual([
      [1, 'a', 'b'],
      [3, '1', '2'],
      [4, '3', '4'],
      [6, '5', '6'],
    ]);
  });
  it('keeps empty fields and reports malformed quotes with a line', () => {
    const ok = parseCsv('a,,c\n,,\n');
    expect(ok.ok && ok.records.map((x) => x.fields)).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
    expect(parseCsv('a\n"open')).toMatchObject({ ok: false, line: 2 });
    expect(parseCsv('"a"b')).toMatchObject({ ok: false });
    expect(parseCsv('ab"c')).toMatchObject({ ok: false });
  });
  it('maps headers and refuses unknown or missing columns', () => {
    const r = parseCsv('Employee Code,DATE\nEMP-0001,2026-10-19');
    if (!r.ok) throw new Error('parse');
    const m = recordsToObjects(r.records, { required: ['employee_code', 'date'], optional: [] });
    expect(m.ok && m.rows[0]?.values).toEqual({ employee_code: 'EMP-0001', date: '2026-10-19' });
    expect(
      recordsToObjects(r.records, { required: ['employee_code', 'date', 'x'], optional: [] }),
    ).toMatchObject({ ok: false });
    expect(recordsToObjects(r.records, { required: ['date'], optional: [] })).toMatchObject({
      ok: false,
    });
  });
  it('writer quotes and neutralises formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField(-3)).toBe('-3');
    expect(
      toCsv([
        ['a', 'b"c'],
        [1, null],
      ]),
    ).toBe('a,"b""c"\r\n1,\r\n');
  });
});

describe('attendance CSV validation', () => {
  const employees = new Map<string, ImportEmployee>([
    ['EMP-0001', { staffId: 's1', timezone: 'Asia/Kolkata', inScope: true }],
    ['EMP-0002', { staffId: 's2', timezone: 'Asia/Kolkata', inScope: false }],
  ]);
  const now = new Date('2026-10-19T12:00:00Z');
  const header = 'employee_code,date,clock_in,clock_out,break_minutes,timezone,note\n';
  const run = (
    body: string,
    existing = [] as Parameters<typeof validateAttendanceImport>[1]['existing'],
  ) => validateAttendanceImport(header + body, { employees, existing, rules: RULES, now });

  it('accepts valid rows incl. an overnight row and reports every bad row', () => {
    const r = run(
      [
        'EMP-0001,2026-10-12,09:00,17:30,30,,ok',
        'EMP-0001,2026-10-13,22:00,2026-10-14 06:00,60,,night',
        'EMP-9999,2026-10-12,09:00,17:00,,,',
        'EMP-0002,2026-10-12,09:00,17:00,,,',
        'EMP-0001,2026-13-01,9:00,17:00,x,Mars/Base,',
        'EMP-0001,2026-10-15,17:00,09:00,,,',
        'EMP-0001,2026-10-30,09:00,17:00,,,',
      ].join('\n'),
    );
    if (!r.ok) throw new Error(r.fileError);
    expect(r.totalRows).toBe(7);
    expect(r.validRows).toBe(2);
    const errs = r.rows.map((x) => x.errors.join(' | '));
    expect(errs[2]).toMatch(/Unknown employee code/);
    expect(errs[3]).toMatch(/outside your scope/);
    expect(errs[4]).toMatch(/date .* not a valid/);
    expect(errs[4]).toMatch(/clock_in .* not HH:MM/);
    expect(errs[4]).toMatch(/break_minutes/);
    expect(errs[4]).toMatch(/Unknown timezone/);
    expect(errs[5]).toMatch(/clock_out must be after clock_in/);
    expect(errs[6]).toMatch(/future/);
    expect(r.rows[1]?.value?.clockOutAt.toISOString()).toBe('2026-10-14T00:30:00.000Z');
  });
  it('detects duplicates within the file and against existing sessions', () => {
    const r = run(
      [
        'EMP-0001,2026-10-12,09:00,13:00,,,',
        'EMP-0001,2026-10-12,09:00,13:00,,,',
        'EMP-0001,2026-10-13,09:00,13:00,,,',
      ].join('\n'),
      [
        {
          staffId: 's1',
          workDate: '2026-10-13',
          clockInAt: new Date('2026-10-13T02:00:00Z'),
          clockOutAt: new Date('2026-10-13T04:00:00Z'),
        },
      ],
    );
    if (!r.ok) throw new Error(r.fileError);
    expect(r.rows.map((x) => x.ok)).toEqual([true, false, false]);
    expect(r.rows[1]?.errors[0]).toMatch(/row 2/);
    expect(r.rows[2]?.errors[0]).toMatch(/already recorded/);
  });
  it('file-level errors: empty, header only, unknown column', () => {
    expect(
      validateAttendanceImport('', { employees, existing: [], rules: RULES, now }),
    ).toMatchObject({ ok: false });
    expect(run('')).toMatchObject({ ok: false, fileError: 'The file has no data rows.' });
    expect(
      validateAttendanceImport('employee_code,date,clock_in,clock_out,colour\n', {
        employees,
        existing: [],
        rules: RULES,
        now,
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('shifts', () => {
  it('validates templates', () => {
    expect(validateShiftTemplate(day)).toEqual([]);
    expect(validateShiftTemplate(night)).toEqual([]);
    expect(validateShiftTemplate({ ...day, endTime: '08:00' }).map((i) => i.path)).toContain(
      'endTime',
    );
    expect(validateShiftTemplate({ ...night, endTime: '23:00' }).map((i) => i.path)).toContain(
      'endTime',
    );
    expect(validateShiftTemplate({ ...day, unpaidBreakMinutes: 600 }).map((i) => i.path)).toContain(
      'unpaidBreakMinutes',
    );
    expect(validateShiftTemplate({ ...day, workingWeekdays: [] }).map((i) => i.path)).toContain(
      'workingWeekdays',
    );
    expect(validateShiftTemplate({ ...day, startTime: '9am' }).map((i) => i.path)).toContain(
      'startTime',
    );
  });
  it('scheduled minutes subtract the unpaid break, including overnight', () => {
    expect(scheduledShiftMinutes(day)).toBe(480);
    expect(scheduledShiftMinutes(night)).toBe(420);
  });
  it('assignment conflicts: overlapping dates refused; split shifts only if times do not overlap', () => {
    const templates = new Map([
      [day.id, day],
      [night.id, night],
    ]);
    const existing = [
      {
        id: 'a1',
        staffId: 's1',
        shiftTemplateId: day.id,
        fromDate: '2026-10-01',
        toDate: null,
        status: 'active' as const,
      },
      {
        id: 'a2',
        staffId: 's1',
        shiftTemplateId: day.id,
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        status: 'cancelled' as const,
      },
    ];
    const c = { staffId: 's1', fromDate: '2026-11-01', toDate: '2026-11-30' };
    expect(findAssignmentConflicts(c, day, existing, templates, false)).toEqual([
      { assignmentId: 'a1', reason: 'dates_overlap' },
    ]);
    expect(findAssignmentConflicts(c, night, existing, templates, true)).toEqual([]);
    expect(findAssignmentConflicts(c, day, existing, templates, true)).toEqual([
      { assignmentId: 'a1', reason: 'times_overlap' },
    ]);
    expect(
      findAssignmentConflicts(
        { ...c, fromDate: '2026-01-05', toDate: '2026-01-06' },
        day,
        existing,
        templates,
        false,
      ),
    ).toEqual([]);
    expect(
      findAssignmentConflicts({ ...c, staffId: 's2' }, day, existing, templates, false),
    ).toEqual([]);
  });
  it('overnight shift overlaps an early-morning shift on the next day', () => {
    const early = {
      ...day,
      id: 't-early',
      startTime: '05:00',
      endTime: '09:00',
      workingWeekdays: [2],
    };
    expect(shiftTimesOverlap({ ...night, workingWeekdays: [1] }, early)).toBe(true);
    expect(shiftTimesOverlap({ ...night, workingWeekdays: [3] }, early)).toBe(false);
  });
  it('a day with no assignment is not scheduled, not 0 hours', () => {
    const templates = new Map([[day.id, day]]);
    const a = [
      {
        id: 'a1',
        staffId: 's1',
        shiftTemplateId: day.id,
        fromDate: '2026-10-19',
        toDate: '2026-10-25',
        status: 'active' as const,
      },
    ];
    const holidays = new Map([
      [
        '2026-10-20',
        {
          date: '2026-10-20',
          name: 'Holiday (fictional)',
          location: null,
          status: 'approved' as const,
        },
      ],
    ]);
    const s = scheduleForRange(d('2026-10-18'), d('2026-10-25'), a, templates, holidays);
    expect(s.map((x) => (x.status === 'scheduled' ? x.minutes : x.reason))).toEqual([
      'no_assignment',
      480,
      'holiday',
      480,
      480,
      480,
      480,
      'non_working_day',
    ]);
    expect(scheduledMinutesTotal(s)).toEqual({ status: 'ok', minutes: 2400, scheduledDays: 5 });
    expect(
      scheduledMinutesTotal(
        scheduleForRange(d('2026-10-01'), d('2026-10-05'), [], templates, new Map()),
      ),
    ).toMatchObject({ status: 'missing' });
  });
});

describe('leave', () => {
  const span = (s: string, e: string, sp = 'full', ep = 'full') =>
    ({ startDate: s, endDate: e, startPart: sp, endPart: ep }) as LeaveSpan;
  const monSat = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
  it('validates half-day parts', () => {
    expect(
      validateLeaveSpan(span('2026-10-20', '2026-10-20', 'first_half', 'first_half'), true),
    ).toEqual([]);
    expect(
      validateLeaveSpan(span('2026-10-20', '2026-10-20', 'first_half', 'second_half'), true)[0]
        ?.path,
    ).toBe('endPart');
    expect(validateLeaveSpan(span('2026-10-20', '2026-10-22', 'first_half'), true)[0]?.path).toBe(
      'startPart',
    );
    expect(
      validateLeaveSpan(span('2026-10-20', '2026-10-22', 'full', 'second_half'), true)[0]?.path,
    ).toBe('endPart');
    expect(
      validateLeaveSpan(span('2026-10-20', '2026-10-20', 'first_half', 'first_half'), false)[0]
        ?.message,
    ).toMatch(/half days/);
    expect(validateLeaveSpan(span('2026-10-22', '2026-10-20'), true)[0]?.path).toBe('endDate');
  });
  it('counts working days, excluding Sundays and holidays, with half days', () => {
    const holidays = new Map([['2026-10-21', { name: 'Holiday (fictional)' }]]);
    // Sat 17 (pm only) … Fri 23 (am only): Sat .5, Sun 0, Mon 1, Tue 1, Wed holiday, Thu 1, Fri .5
    const r = countLeaveDays(
      span('2026-10-17', '2026-10-23', 'second_half', 'first_half'),
      monSat,
      holidays,
    );
    expect(r.days).toBe(4);
    expect(r.perDate.filter((x) => x.excluded).map((x) => x.excluded)).toEqual([
      'non_working_day',
      'holiday',
    ]);
    expect(countLeaveDays(span('2026-10-18', '2026-10-18'), monSat, new Map()).days).toBe(0);
  });
  it('detects overlap with own pending/approved leave, half-day aware', () => {
    const existing = [
      {
        id: 'l1',
        status: 'approved',
        ...span('2026-10-20', '2026-10-20', 'first_half', 'first_half'),
      },
      { id: 'l2', status: 'rejected', ...span('2026-10-22', '2026-10-23') },
      { id: 'l3', status: 'pending', ...span('2026-10-26', '2026-10-28') },
    ];
    expect(
      overlappingLeave(span('2026-10-20', '2026-10-20', 'second_half', 'second_half'), existing),
    ).toEqual([]);
    expect(overlappingLeave(span('2026-10-19', '2026-10-20'), existing).map((x) => x.id)).toEqual([
      'l1',
    ]);
    expect(overlappingLeave(span('2026-10-22', '2026-10-22'), existing)).toEqual([]);
    expect(overlappingLeave(span('2026-10-28', '2026-10-29'), existing).map((x) => x.id)).toEqual([
      'l3',
    ]);
    expect(overlappingLeave(span('2026-10-28', '2026-10-29'), existing, 'l3')).toEqual([]);
  });
  it('cancellation rules', () => {
    const c = {
      startDate: '2026-10-20',
      today: '2026-10-19',
      actorIsRequesterOrSubject: true,
      actorCanApprove: false,
      actorIsSubject: true,
    };
    expect(checkLeaveCancel({ ...c, status: 'pending' }).ok).toBe(true);
    expect(checkLeaveCancel({ ...c, status: 'approved' }).ok).toBe(true);
    expect(checkLeaveCancel({ ...c, status: 'approved', today: '2026-10-20' })).toMatchObject({
      code: 'NOT_ALLOWED',
    });
    expect(
      checkLeaveCancel({
        ...c,
        status: 'approved',
        today: '2026-10-21',
        actorIsRequesterOrSubject: false,
        actorCanApprove: true,
        actorIsSubject: false,
      }),
    ).toMatchObject({ code: 'NOTE_REQUIRED' });
    expect(
      checkLeaveCancel({
        ...c,
        status: 'approved',
        today: '2026-10-21',
        actorIsRequesterOrSubject: false,
        actorCanApprove: true,
        actorIsSubject: false,
        reason: 'Returned early',
      }).ok,
    ).toBe(true);
    expect(checkLeaveCancel({ ...c, status: 'rejected' })).toMatchObject({ code: 'ILLEGAL' });
  });
  it('balance ledger: not configured without allocation; 0 is a real balance', () => {
    expect(balanceFromLedger([])).toMatchObject({ status: 'not_configured' });
    expect(balanceFromLedger([{ entryType: 'usage', days: '-1.0' }])).toMatchObject({
      status: 'not_configured',
    });
    expect(
      balanceFromLedger([
        { entryType: 'allocation', days: '2' },
        { entryType: 'usage', days: '-2' },
      ]),
    ).toMatchObject({ status: 'configured', balance: 0 });
    expect(
      balanceFromLedger([
        { entryType: 'allocation', days: '12' },
        { entryType: 'adjustment', days: '-0.5' },
        { entryType: 'usage', days: '-3.5' },
        { entryType: 'reversal', days: '1.5' },
      ]),
    ).toEqual({
      status: 'configured',
      allocated: 12,
      adjusted: -0.5,
      used: 3.5,
      reversed: 1.5,
      balance: 9.5,
    });
  });
  it('availability grid', () => {
    const g = availabilityGrid(
      [d('2026-10-20'), d('2026-10-21')],
      [
        { staffId: 's1', scheduledDates: new Set(['2026-10-20', '2026-10-21']) },
        { staffId: 's2', scheduledDates: new Set() },
      ],
      [
        {
          staffId: 's1',
          code: 'LVR-000001',
          status: 'approved',
          ...span('2026-10-21', '2026-10-21', 'second_half', 'second_half'),
        },
      ],
    );
    expect(g[0]?.cells).toEqual([
      { state: 'scheduled' },
      { state: 'on_leave', part: 'second_half', code: 'LVR-000001', status: 'approved' },
    ]);
    expect(g[1]?.cells[0]).toEqual({ state: 'not_scheduled' });
  });
});

describe('timesheet summary', () => {
  const templates = new Map([[day.id, day]]);
  const a = [
    {
      id: 'a1',
      staffId: 's1',
      shiftTemplateId: day.id,
      fromDate: '2026-10-19',
      toDate: null,
      status: 'active' as const,
    },
  ];
  const sched = scheduleForRange(d('2026-10-19'), d('2026-10-20'), a, templates, new Map());
  it('worked vs scheduled with unapproved difference; superseded rows excluded', () => {
    const at = (date: string, t: string) => zonedToInstant(d(date), t, 'Asia/Kolkata');
    const days = dailyTimesheet(
      sched,
      [
        {
          workDate: '2026-10-19',
          clockInAt: at('2026-10-19', '09:20'),
          clockOutAt: at('2026-10-19', '18:30'),
          breakMinutes: 30,
          status: 'closed',
          lateMinutes: 20,
          earlyDepartureMinutes: 0,
          missingClockOutFlaggedAt: null,
        },
        {
          workDate: '2026-10-19',
          clockInAt: at('2026-10-19', '08:00'),
          clockOutAt: at('2026-10-19', '20:00'),
          breakMinutes: 0,
          status: 'superseded',
          lateMinutes: 0,
          earlyDepartureMinutes: 0,
          missingClockOutFlaggedAt: null,
        },
        {
          workDate: '2026-10-20',
          clockInAt: at('2026-10-20', '09:00'),
          clockOutAt: null,
          breakMinutes: 0,
          status: 'open',
          lateMinutes: 0,
          earlyDepartureMinutes: null,
          missingClockOutFlaggedAt: new Date(),
        },
      ],
      new Map(),
      new Map([['2026-10-20', 1]]),
    );
    const s = periodSummary(d('2026-10-19'), d('2026-10-20'), days);
    expect(s.scheduledMinutes).toEqual({ status: 'ok', value: 960 });
    expect(s.workedMinutes).toEqual({ status: 'ok', value: 520 });
    expect(s.unapprovedDifferenceMinutes).toEqual({ status: 'ok', value: -440 });
    expect(s).toMatchObject({
      lateCount: 1,
      earlyCount: 0,
      missingClockOuts: 1,
      unresolvedExceptions: 2,
    });
  });
  it('nothing recorded → missing, not zero', () => {
    const s = periodSummary(
      d('2026-10-19'),
      d('2026-10-20'),
      dailyTimesheet(sched, [], new Map(), new Map()),
    );
    expect(s.workedMinutes.status).toBe('missing');
    expect(s.unapprovedDifferenceMinutes.status).toBe('missing');
    expect(s.scheduledMinutes.status).toBe('ok');
  });
});
