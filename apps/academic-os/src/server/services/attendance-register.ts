/**
 * Monthly student attendance register (owner, 6 Nov 2026: "download the attendance … in sheet
 * format"): one batch and one month as CSV for Excel or Google Sheets. Rows = students placed in
 * the batch that month; columns = each delivered (held) class, as on the attendance report;
 * cells = the mark's code. Not recorded stays blank, never absent. Totals and attendance % come
 * from summariseAttendance under `attendance.denominator`. Same permission and teacher scope as
 * the attendance report; the download is audited with counts only (no names).
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatchPlacements,
  academicClassSessions,
  academicEnrolments,
  academicStudents,
  type Database,
} from '@elevate/database';
import { toCsv } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { attendanceDefinition, summariseAttendance, type AttendanceStatus } from '../../domain';
import { assertBatchInScope, audit, getBatchOrThrow, resolveScope, todayIst, type Actor } from '../context';
import { getSetting } from './settings';

const CODES: Record<AttendanceStatus, string> = { present: 'P', late: 'L', partial: 'PT', absent: 'A', excused: 'E' };
export const REGISTER_LEGEND =
  'Legend: P present, L late, PT partial, A absent, E excused, blank = not recorded (never counted as absent), NP = not placed in the batch on that day. Only classes marked delivered are listed.';

export async function attendanceRegisterCsv(db: Database, actor: Actor, batchId: string, month: string, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:attendance:read');
  assertBatchInScope(scope, batchId);
  const batch = await getBatchOrThrow(db, batchId);
  const today = todayIst(now);
  if (month > today.slice(0, 7)) throw new ValidationError('Choose this month or an earlier one.');
  const from = `${month}-01` as IsoDate;
  // The 28th plus 4 days is always in the next month; its 1st minus a day is this month's end.
  const to = addDays(`${addDays(`${month}-28` as IsoDate, 4).slice(0, 7)}-01` as IsoDate, -1);
  const rule = await getSetting(db, 'attendance.denominator');
  const held = await db
    .select({ id: academicClassSessions.id, date: academicClassSessions.date, startTime: academicClassSessions.startTime })
    .from(academicClassSessions)
    .where(and(eq(academicClassSessions.batchId, batch.id), eq(academicClassSessions.status, 'held'), gte(academicClassSessions.date, from), lte(academicClassSessions.date, to < today ? to : today)))
    .orderBy(asc(academicClassSessions.date), asc(academicClassSessions.startTime));
  const placed = await db
    .select({ studentId: academicStudents.id, code: academicStudents.code, name: academicStudents.fullName, isSample: academicStudents.isSample, start: academicBatchPlacements.startDate, end: academicBatchPlacements.endDate })
    .from(academicBatchPlacements)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(and(eq(academicBatchPlacements.batchId, batch.id), lte(academicBatchPlacements.startDate, to)))
    .orderBy(asc(academicStudents.fullName));
  const students = new Map<string, { code: string; name: string; isSample: boolean; spans: [string, string | null][] }>();
  for (const p of placed.filter((x) => !x.end || x.end >= from)) {
    const s = students.get(p.studentId) ?? { ...p, spans: [] as [string, string | null][] };
    s.spans.push([p.start, p.end]);
    students.set(p.studentId, s);
  }
  const marks = held.length && students.size
    ? await db.select({ studentId: academicAttendance.studentId, sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(inArray(academicAttendance.sessionId, held.map((h) => h.id)))
    : [];
  const markOf = new Map(marks.map((m) => [`${m.studentId}:${m.sessionId}`, m.status]));
  const rows = [...students].map(([id, s]) => {
    const placedOn = (date: string) => s.spans.some(([a, b]) => a <= date && (!b || date <= b));
    const t = summariseAttendance(held.filter((h) => placedOn(h.date)).map((h) => h.id), marks.filter((m) => m.studentId === id), rule.value);
    const cells = held.map((h) => {
      const mark = markOf.get(`${id}:${h.id}`);
      return placedOn(h.date) ? (mark ? CODES[mark] : '') : 'NP';
    });
    return [s.name, s.code, ...cells, t.heldSessions, t.present, t.late, t.partial, t.absent, t.excused, t.notRecorded, t.ratePercent, s.isSample ? 'Sample data' : ''];
  });
  await audit(db, actor, { action: 'attendance.register_exported', entityType: 'batch', entityId: batch.id, metadata: { month, students: rows.length, classes: held.length } });
  return {
    filename: `attendance-${batch.code}-${month}.csv`,
    csv: toCsv(
      ['Student', 'Student code', ...held.map((h) => `${h.date} ${h.startTime}`), 'Delivered classes', 'Present', 'Late', 'Partial', 'Absent', 'Excused', 'Not recorded', 'Attendance %', 'Sample data'],
      [
        ...rows,
        [],
        [`${batch.code} · ${batch.name} · ${month}`],
        [REGISTER_LEGEND],
        [`${attendanceDefinition(rule.value)} Rule status: ${rule.status === 'approved' ? 'approved by the owner' : 'proposed, not approved by the owner'}.`],
        ...(rows.length ? [] : [['No student was placed in this batch during the month.']]),
      ],
    ),
  };
}
