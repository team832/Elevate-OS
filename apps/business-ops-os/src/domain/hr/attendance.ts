/**
 * Staff attendance rules (OPS-050…OPS-052). Pure.
 *
 * - A session runs from clock-in to clock-out; worked minutes = elapsed −
 *   unpaid break. An open session has no worked minutes yet (null, not 0).
 * - The work date is the clock-in's calendar day in the employee's timezone.
 * - Late arrival / early departure are measured against the shift window with
 *   grace minutes from the proposed policy `attendance.rules`.
 * - A session still open after shift end + grace (or after the maximum session
 *   length when no shift applies) is a missing clock-out.
 * - Corrections never overwrite: see `checkCorrectionTransition`.
 * This is STAFF attendance only; it is never a performance measure on its own.
 */
import { isIsoDate, type IsoDate } from '@elevate/shared-types';
import { isValidTimeZone, minutesBetween, zonedDate, zonedToInstant, type Issue } from './calendar';
import { parseCsv, recordsToObjects } from './csv';

export interface AttendanceRules {
  multipleSessionsPerDay: boolean;
  lateGraceMinutes: number;
  earlyDepartureGraceMinutes: number;
  missingClockOutGraceMinutes: number;
  maxSessionHours: number;
}

export interface SessionTimes {
  clockInAt: Date;
  clockOutAt: Date | null;
  breakMinutes: number;
}

/** Calendar day of the clock-in in the employee's timezone. */
export function workDateFor(clockInAt: Date, timezone: string): IsoDate {
  return zonedDate(clockInAt, timezone);
}

/** Minutes worked in a closed session (elapsed − break, never below 0); null while open. */
export function sessionWorkedMinutes(s: SessionTimes): number | null {
  if (!s.clockOutAt) return null;
  return Math.max(0, minutesBetween(s.clockInAt, s.clockOutAt) - Math.max(0, s.breakMinutes));
}

/** Validate session times: order, maximum length, break shorter than the session. */
export function validateSessionTimes(s: SessionTimes, rules: AttendanceRules): Issue[] {
  const issues: Issue[] = [];
  if (Number.isNaN(s.clockInAt.getTime()))
    issues.push({ path: 'clockIn', message: 'Clock-in is not a valid time.' });
  if (s.clockOutAt && Number.isNaN(s.clockOutAt.getTime()))
    issues.push({ path: 'clockOut', message: 'Clock-out is not a valid time.' });
  if (issues.length) return issues;
  if (!Number.isInteger(s.breakMinutes) || s.breakMinutes < 0)
    issues.push({ path: 'breakMinutes', message: 'Break must be 0 or more whole minutes.' });
  if (s.clockOutAt) {
    const elapsed = minutesBetween(s.clockInAt, s.clockOutAt);
    if (s.clockOutAt.getTime() <= s.clockInAt.getTime())
      issues.push({ path: 'clockOut', message: 'Clock-out must be after clock-in.' });
    else if (elapsed > rules.maxSessionHours * 60)
      issues.push({
        path: 'clockOut',
        message: `A session cannot be longer than ${rules.maxSessionHours} hours (proposed policy).`,
      });
    else if (s.breakMinutes >= elapsed)
      issues.push({ path: 'breakMinutes', message: 'Break must be shorter than the session.' });
  }
  return issues;
}

/** True when two sessions overlap in time (an open session runs until `now`). */
export function sessionsOverlap(
  a: { clockInAt: Date; clockOutAt: Date | null },
  b: { clockInAt: Date; clockOutAt: Date | null },
  now: Date,
): boolean {
  const aEnd = (a.clockOutAt ?? now).getTime();
  const bEnd = (b.clockOutAt ?? now).getTime();
  return a.clockInAt.getTime() < bEnd && b.clockInAt.getTime() < aEnd;
}

/**
 * Late / early minutes against a shift window. A value is reported only when
 * it exceeds the grace (then the full difference is reported); null when there
 * is no shift (not measured — never "on time").
 */
export function lateEarly(
  s: { clockInAt: Date; clockOutAt: Date | null },
  shift: { start: Date; end: Date } | null,
  rules: Pick<AttendanceRules, 'lateGraceMinutes' | 'earlyDepartureGraceMinutes'>,
): {
  measured: boolean;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  late: boolean;
  early: boolean;
} {
  if (!shift)
    return {
      measured: false,
      lateMinutes: null,
      earlyDepartureMinutes: null,
      late: false,
      early: false,
    };
  const lateBy = minutesBetween(shift.start, s.clockInAt);
  const late = lateBy > rules.lateGraceMinutes;
  let early = false;
  let earlyBy: number | null = null;
  if (s.clockOutAt) {
    const before = minutesBetween(s.clockOutAt, shift.end);
    early = before > rules.earlyDepartureGraceMinutes;
    earlyBy = early ? before : 0;
  }
  return {
    measured: true,
    lateMinutes: late ? lateBy : 0,
    earlyDepartureMinutes: earlyBy,
    late,
    early,
  };
}

/**
 * Missing clock-out: an open session past shift end + grace, or — when no
 * shift applies or the clock-in came after the shift ended — past clock-in +
 * the maximum session length.
 */
export function missingClockOutDueAt(
  s: { clockInAt: Date },
  shiftEnd: Date | null,
  rules: Pick<AttendanceRules, 'missingClockOutGraceMinutes' | 'maxSessionHours'>,
): Date {
  // A clock-in after the shift has ended (work outside the shift) falls back to the maximum length.
  if (shiftEnd && s.clockInAt.getTime() < shiftEnd.getTime())
    return new Date(shiftEnd.getTime() + rules.missingClockOutGraceMinutes * 60_000);
  return new Date(s.clockInAt.getTime() + rules.maxSessionHours * 3_600_000);
}

export function isMissingClockOut(
  s: { clockInAt: Date; clockOutAt: Date | null; status: string },
  shiftEnd: Date | null,
  rules: Pick<AttendanceRules, 'missingClockOutGraceMinutes' | 'maxSessionHours'>,
  now: Date,
): boolean {
  if (s.status !== 'open' || s.clockOutAt) return false;
  return now.getTime() > missingClockOutDueAt(s, shiftEnd, rules).getTime();
}

// --- decisions (corrections and leave) -------------------------------------------------------

export type DecisionCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'ILLEGAL' | 'SELF_DECISION' | 'NOT_ALLOWED' | 'NOTE_REQUIRED';
      message: string;
    };

/**
 * pending → approved | rejected, by someone who is neither the requester nor
 * the employee; a rejection needs a note. Decided requests are final.
 */
export function checkDecision(input: {
  from: string;
  to: 'approved' | 'rejected';
  actorUserId: string;
  requestedByUserId: string;
  actorStaffId: string | null;
  subjectStaffId: string;
  note?: string | null;
}): DecisionCheck {
  if (input.from !== 'pending')
    return { ok: false, code: 'ILLEGAL', message: `This request is already ${input.from}.` };
  if (input.actorUserId === input.requestedByUserId || input.actorStaffId === input.subjectStaffId)
    return {
      ok: false,
      code: 'SELF_DECISION',
      message: 'You cannot decide a request you made or one about yourself.',
    };
  if (input.to === 'rejected' && !input.note?.trim())
    return { ok: false, code: 'NOTE_REQUIRED', message: 'Give a reason for the rejection.' };
  return { ok: true };
}

/** pending → withdrawn, by the requester only. */
export function checkWithdraw(input: {
  from: string;
  actorUserId: string;
  requestedByUserId: string;
}): DecisionCheck {
  if (input.from !== 'pending')
    return { ok: false, code: 'ILLEGAL', message: `This request is already ${input.from}.` };
  if (input.actorUserId !== input.requestedByUserId)
    return { ok: false, code: 'NOT_ALLOWED', message: 'Only the requester can withdraw this.' };
  return { ok: true };
}

// --- CSV import validation (OPS-051) ----------------------------------------------------------

export const ATTENDANCE_CSV_COLUMNS = {
  required: ['employee_code', 'date', 'clock_in', 'clock_out'],
  optional: ['break_minutes', 'timezone', 'note'],
} as const;

export interface ImportEmployee {
  staffId: string;
  timezone: string;
  inScope: boolean;
}

export interface ExistingSession {
  staffId: string;
  workDate: string;
  clockInAt: Date;
  clockOutAt: Date | null;
}

export interface ImportRowValue {
  staffId: string;
  employeeCode: string;
  workDate: IsoDate;
  clockInAt: Date;
  clockOutAt: Date;
  breakMinutes: number;
  timezone: string;
  note: string | null;
}

export interface ImportRowResult {
  /** 1-based line in the file. */
  row: number;
  employeeCode: string;
  ok: boolean;
  errors: string[];
  value?: ImportRowValue;
}

export type ImportValidation =
  | { ok: false; fileError: string }
  | {
      ok: true;
      rows: ImportRowResult[];
      totalRows: number;
      validRows: number;
      invalidRows: number;
    };

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validate every row of an attendance CSV. Rows are independent: one bad row
 * never hides the others. `clock_out` is `HH:MM` on the same date, or
 * `YYYY-MM-DD HH:MM` for a session that ends on another day.
 */
export function validateAttendanceImport(
  csvText: string,
  ctx: {
    employees: ReadonlyMap<string, ImportEmployee>;
    existing: readonly ExistingSession[];
    rules: AttendanceRules;
    now: Date;
    maxRows?: number;
  },
): ImportValidation {
  const parsed = parseCsvForImport(csvText);
  if (!parsed.ok) return { ok: false, fileError: parsed.error };
  const mapped = recordsToObjects(parsed.records, ATTENDANCE_CSV_COLUMNS);
  if (!mapped.ok) return { ok: false, fileError: mapped.error };
  const maxRows = ctx.maxRows ?? 5000;
  if (mapped.rows.length === 0) return { ok: false, fileError: 'The file has no data rows.' };
  if (mapped.rows.length > maxRows)
    return { ok: false, fileError: `At most ${maxRows} rows per file.` };

  const accepted: ImportRowValue[] = [];
  const acceptedRow: number[] = [];
  const results: ImportRowResult[] = mapped.rows.map((r) => {
    const v = r.values;
    const errors: string[] = [];
    const code = (v.employee_code ?? '').toUpperCase();
    if (!r.fieldCountOk) errors.push('Wrong number of fields on this row.');
    const emp = code ? ctx.employees.get(code) : undefined;
    if (!code) errors.push('employee_code is empty.');
    else if (!emp) errors.push(`Unknown employee code "${code}".`);
    else if (!emp.inScope) errors.push(`Employee ${code} is outside your scope.`);
    const tz = v.timezone ? v.timezone : (emp?.timezone ?? '');
    if (v.timezone && !isValidTimeZone(v.timezone))
      errors.push(`Unknown timezone "${v.timezone}".`);
    const date = v.date ?? '';
    if (!isIsoDate(date)) errors.push(`date "${date}" is not a valid YYYY-MM-DD date.`);
    const clockIn = v.clock_in ?? '';
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(clockIn))
      errors.push(`clock_in "${clockIn}" is not HH:MM.`);
    const clockOutRaw = v.clock_out ?? '';
    let outDate: string | null = null;
    let outTime: string | null = null;
    if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(clockOutRaw)) {
      outDate = date;
      outTime = clockOutRaw;
    } else {
      const m = DATE_TIME_RE.exec(clockOutRaw);
      if (m && isIsoDate(m[1]!)) {
        outDate = m[1]!;
        outTime = `${m[2]}:${m[3]}`;
      } else if (!clockOutRaw) errors.push('clock_out is empty.');
      else errors.push(`clock_out "${clockOutRaw}" is not HH:MM or YYYY-MM-DD HH:MM.`);
    }
    let breakMinutes = 0;
    if (v.break_minutes) {
      if (!/^\d{1,4}$/.test(v.break_minutes))
        errors.push(`break_minutes "${v.break_minutes}" is not a whole number.`);
      else breakMinutes = Number(v.break_minutes);
    }
    if (errors.length || !emp || !outDate || !outTime || !tz)
      return { row: r.line, employeeCode: code, ok: false, errors };

    const clockInAt = zonedToInstant(date as IsoDate, clockIn, tz);
    const clockOutAt = zonedToInstant(outDate as IsoDate, outTime, tz);
    for (const issue of validateSessionTimes({ clockInAt, clockOutAt, breakMinutes }, ctx.rules))
      errors.push(
        issue.path === 'clockOut' && issue.message.startsWith('Clock-out must be after')
          ? 'clock_out must be after clock_in (use "YYYY-MM-DD HH:MM" for a session ending the next day).'
          : issue.message,
      );
    if (date > zonedDate(ctx.now, tz)) errors.push('date is in the future.');
    if (clockOutAt.getTime() > ctx.now.getTime()) errors.push('clock_out is in the future.');
    const candidate = { clockInAt, clockOutAt };
    for (const e of ctx.existing) {
      if (e.staffId !== emp.staffId) continue;
      if (sessionsOverlap(candidate, e, ctx.now)) {
        errors.push('Overlaps a session already recorded for this employee.');
        break;
      }
      if (!ctx.rules.multipleSessionsPerDay && e.workDate === date) {
        errors.push(
          'A session is already recorded for this employee on this date (one session per day — proposed policy).',
        );
        break;
      }
    }
    accepted.forEach((a, idx) => {
      if (a.staffId !== emp.staffId) return;
      if (sessionsOverlap(candidate, a, ctx.now))
        errors.push(`Duplicates or overlaps row ${acceptedRow[idx]} of this file.`);
      else if (!ctx.rules.multipleSessionsPerDay && a.workDate === date)
        errors.push(`Same employee and date as row ${acceptedRow[idx]} (one session per day).`);
    });
    if (errors.length) return { row: r.line, employeeCode: code, ok: false, errors };
    const value: ImportRowValue = {
      staffId: emp.staffId,
      employeeCode: code,
      workDate: date as IsoDate,
      clockInAt,
      clockOutAt,
      breakMinutes,
      timezone: tz,
      note: v.note ? v.note.slice(0, 500) : null,
    };
    accepted.push(value);
    acceptedRow.push(r.line);
    return { row: r.line, employeeCode: code, ok: true, errors: [], value };
  });
  const validRows = results.filter((r) => r.ok).length;
  return {
    ok: true,
    rows: results,
    totalRows: results.length,
    validRows,
    invalidRows: results.length - validRows,
  };
}

function parseCsvForImport(text: string) {
  if (text.length > 2_000_000)
    return { ok: false as const, error: 'The file is larger than 2 MB.', line: 0 };
  const r = parseCsv(text);
  if (!r.ok) return { ok: false as const, error: `Line ${r.line}: ${r.error}`, line: r.line };
  return r;
}
