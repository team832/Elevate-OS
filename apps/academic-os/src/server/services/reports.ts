/**
 * Academic print/CSV reports (R7; brief 17): batch attendance, batch curriculum coverage,
 * assessment analysis and the teacher weekly summary. One table shape serves the print view and
 * the CSV, so both always show the same figures. Each report checks the same permission as its
 * screen; a CSV download is audited. Parent-facing progress reports stay in Business Ops (R7).
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatchPlacements,
  academicBatches,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicStudents,
  academicSubjects,
  staffMembers,
  type Database,
} from '@elevate/database';
import { toCsv, type CsvCell } from '@elevate/server-kit';
import { NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, type IsoDate, type StaffMemberId } from '@elevate/shared-types';
import { attendanceDefinition, summariseAttendance, weekStart } from '../../domain';
import { assertBatchInScope, audit, getBatchOrThrow, resolveScope, todayIst, type Actor } from '../context';
import type { ReportKind, ReportQuery } from '../schemas-assessment';
import { getBatchCoverage } from './curriculum';
import { getAssessmentAnalysis, getResults } from './results';
import { taughtBy } from './session-guards';
import { getSetting } from './settings';

export interface ReportTable {
  kind: ReportKind;
  title: string;
  subtitle: string;
  definition: string;
  columns: string[];
  rows: CsvCell[][];
  notes: string[];
}

const need = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) throw new ValidationError(`Choose ${name} for this report.`);
  return value;
};

function windowOf(q: ReportQuery, now: Date) {
  const to = q.to ?? todayIst(now);
  const from = q.from ?? addDays(to as IsoDate, -27);
  if (from > to) throw new ValidationError('The start date must not be after the end date.');
  if (from < addDays(to as IsoDate, -366)) throw new ValidationError('A report may span at most one year.');
  return { from, to };
}

async function attendanceReport(db: Database, actor: Actor, q: ReportQuery, now: Date): Promise<ReportTable> {
  const scope = await resolveScope(db, actor, 'academic:attendance:read');
  const batchId = need(q.batchId, 'a batch');
  assertBatchInScope(scope, batchId);
  const batch = await getBatchOrThrow(db, batchId);
  const { from, to } = windowOf(q, now);
  const until = to < todayIst(now) ? to : todayIst(now);
  const rule = await getSetting(db, 'attendance.denominator');
  const held = await db
    .select({ id: academicClassSessions.id, date: academicClassSessions.date })
    .from(academicClassSessions)
    .where(and(eq(academicClassSessions.batchId, batch.id), eq(academicClassSessions.status, 'held'), gte(academicClassSessions.date, from), lte(academicClassSessions.date, until)));
  const placed = await db
    .select({ studentId: academicStudents.id, code: academicStudents.code, name: academicStudents.fullName, start: academicBatchPlacements.startDate, end: academicBatchPlacements.endDate })
    .from(academicBatchPlacements)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(and(eq(academicBatchPlacements.batchId, batch.id), lte(academicBatchPlacements.startDate, to)))
    .orderBy(asc(academicStudents.fullName), asc(academicBatchPlacements.startDate));
  const students = placed.filter((p) => !p.end || p.end >= from);
  const marks = held.length && students.length
    ? await db.select({ studentId: academicAttendance.studentId, sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(inArray(academicAttendance.sessionId, held.map((h) => h.id)))
    : [];
  const rows = students.map((p) => {
    const sessions = held.filter((h) => h.date >= p.start && (!p.end || h.date <= p.end)).map((h) => h.id);
    const a = summariseAttendance(sessions, marks.filter((m) => m.studentId === p.studentId), rule.value);
    return [p.code, p.name, `${p.start} to ${p.end ?? 'open'}`, a.heldSessions, a.present, a.late, a.partial, a.absent, a.excused, a.notRecorded, a.ratePercent];
  });
  return {
    kind: 'attendance',
    title: `Attendance: ${batch.code}`,
    subtitle: `${batch.name} · ${from} to ${to}`,
    definition: `${attendanceDefinition(rule.value)} Rule status: ${rule.status === 'approved' ? 'approved by the owner' : 'proposed, not approved by the owner'}.`,
    columns: ['Student code', 'Student', 'Placement', 'Delivered sessions', 'Present', 'Late', 'Partial', 'Absent', 'Excused', 'Not recorded', 'Attendance %'],
    rows,
    notes: [rows.length ? `${rows.length} placement(s) in the period; ${held.length} delivered session(s) in the batch.` : 'No student was placed in this batch during the period.', 'An empty attendance % means no countable mark was recorded (not 0 %).'],
  };
}

async function coverageReport(db: Database, actor: Actor, q: ReportQuery, now: Date): Promise<ReportTable> {
  const asOf = q.to ?? todayIst(now);
  const c = await getBatchCoverage(db, actor, need(q.batchId, 'a batch'), asOf);
  const subjects = new Map(c.coverage.subjects.map((s) => [s.subjectId, s.code]));
  return {
    kind: 'coverage',
    title: `Curriculum coverage: ${c.batch.code}`,
    subtitle: `${c.batch.name} · as of ${asOf} · plan ${c.plan ? `${c.plan.code} (${c.plan.status})` : 'none'}`,
    definition: `${c.note} Coverage shows what was taught in the batch; it says nothing about any student's mastery.`,
    columns: ['Subject', 'Chapter', 'Title', 'Planned classes', 'Planned hours', 'Verified hours', 'Recorded, not verified (minutes)', 'Completion %'],
    rows: c.coverage.chapters.map((ch) => [subjects.get(ch.subjectId) ?? '', ch.code, ch.title, ch.plannedClasses, ch.plannedHours, ch.verifiedHours, ch.unverifiedMinutes, ch.completionPercent]),
    notes: [`Course: ${c.coverage.course.verifiedHours} of ${c.coverage.course.plannedHours} planned hours verified.`],
  };
}

async function assessmentReport(db: Database, actor: Actor, q: ReportQuery): Promise<ReportTable> {
  const id = need(q.assessmentId, 'an assessment');
  const results = await getResults(db, actor, id);
  const { analysis, sections } = await getAssessmentAnalysis(db, actor, id);
  const a = results.assessment;
  const pct = (total: string | null, max: string) => (total === null || Number(max) <= 0 ? null : Math.round((Number(total) / Number(max)) * 1000) / 10);
  return {
    kind: 'assessment',
    title: `Assessment analysis: ${a.code}`,
    subtitle: `${a.title} · ${a.kind.replace(/_/g, ' ')} · ${a.scheduledDate ?? 'date not recorded'} · ${results.run ? `result version ${results.run.version} (${results.run.status})` : 'no final results'}`,
    definition: 'Average = mean of scored students only. Absent, exempt, withheld and pending (no result) are counted separately and never treated as 0. Rank and percentile are shown only under an approved policy.',
    columns: ['Student code', 'Student', 'Result', 'Score', 'Maximum', 'Score %', ...(results.showRank ? ['Rank', 'Percentile'] : [])],
    rows: results.results.map((r) => [r.studentCode, r.studentName, r.state, r.totalScore === null ? null : Number(r.totalScore), Number(r.maxScore), pct(r.totalScore, r.maxScore), ...(results.showRank ? [r.rank, r.percentile === null ? null : Number(r.percentile)] : [])]),
    notes: analysis
      ? [
          `Scored ${analysis.scored} of ${analysis.eligible} eligible; absent ${analysis.absent}, exempt ${analysis.exempt}, withheld ${analysis.withheld}, pending ${analysis.pending}.`,
          analysis.mean === null ? 'No average: nobody was scored.' : `Average ${analysis.mean} of ${analysis.max}${analysis.meanPercent === null ? '' : ` (${analysis.meanPercent}%)`}; highest ${analysis.highest}, lowest ${analysis.lowest}.`,
          ...sections.map((s) => `Section ${s.sectionCode}: average ${s.mean} of ${s.max} over ${s.scored} scored.`),
        ]
      : ['Results have not been finalised.'],
  };
}

async function teacherWeekReport(db: Database, actor: Actor, q: ReportQuery, now: Date): Promise<ReportTable> {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  const staffId = (q.staffId ?? (scope.kind === 'own' ? scope.staffId : undefined)) as StaffMemberId | null | undefined;
  if (!staffId) throw new ValidationError('Choose a teacher for this report.');
  if (scope.kind === 'own' && staffId !== scope.staffId) throw new NotFoundError('Teacher not found.');
  const [teacher] = await db.select({ name: staffMembers.fullName }).from(staffMembers).where(eq(staffMembers.id, staffId));
  if (!teacher) throw new NotFoundError('Teacher not found.');
  const from = weekStart(q.from ?? todayIst(now));
  const to = addDays(from as IsoDate, 6);
  const sessions = await db
    .select({ s: academicClassSessions, batchCode: academicBatches.code, subject: academicSubjects.name })
    .from(academicClassSessions)
    .innerJoin(academicBatches, eq(academicBatches.id, academicClassSessions.batchId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, academicClassSessions.subjectId))
    .where(and(taughtBy(db, staffId), gte(academicClassSessions.date, from), lte(academicClassSessions.date, to)))
    .orderBy(asc(academicClassSessions.date), asc(academicClassSessions.startTime));
  const records = sessions.length
    ? await db.select({ sessionId: academicClassRecords.sessionId, state: academicClassRecords.state }).from(academicClassRecords).where(and(inArray(academicClassRecords.sessionId, sessions.map((x) => x.s.id)), inArray(academicClassRecords.state, ['submitted', 'verified'])))
    : [];
  const logOf = (sessionId: string, status: string) => {
    const mine = records.filter((r) => r.sessionId === sessionId);
    if (mine.some((r) => r.state === 'verified')) return 'verified';
    if (mine.length) return 'submitted';
    return status === 'held' ? 'pending' : 'not due';
  };
  const rows = sessions.map(({ s, batchCode, subject }) => [s.date, s.startTime, batchCode, subject ?? 'Subject not recorded', s.status === 'held' ? 'delivered' : s.status, logOf(s.id, s.status)]);
  const count = (i: number, v: string) => rows.filter((r) => r[i] === v).length;
  return {
    kind: 'teacher-week',
    title: `Teacher week: ${teacher.name}`,
    subtitle: `${from} to ${to}`,
    definition: 'Sessions this teacher is timetabled for or took part in (co-teacher or substitute). Delivered = marked delivered (held). Log pending = a delivered session without a submitted or verified teaching log. Operational summary only: not HR attendance, leave or payroll.',
    columns: ['Date', 'Start', 'Batch', 'Subject', 'Session', 'Teaching log'],
    rows,
    notes: [`Planned ${rows.length}; delivered ${count(4, 'delivered')}; cancelled ${count(4, 'cancelled')}; logs pending ${count(5, 'pending')}.`],
  };
}

export async function buildReport(db: Database, actor: Actor, kind: ReportKind, q: ReportQuery, now = new Date()): Promise<ReportTable> {
  switch (kind) {
    case 'attendance':
      return attendanceReport(db, actor, q, now);
    case 'coverage':
      return coverageReport(db, actor, q, now);
    case 'assessment':
      return assessmentReport(db, actor, q);
    case 'teacher-week':
      return teacherWeekReport(db, actor, q, now);
  }
}

/** The CSV of a report; the download is audited (who, which report, which filters). */
export async function exportReportCsv(db: Database, actor: Actor, kind: ReportKind, q: ReportQuery, now = new Date()) {
  const report = await buildReport(db, actor, kind, q, now);
  const { format: _f, ...filters } = q;
  await audit(db, actor, { action: 'report.exported', entityType: 'report', entityId: kind, metadata: { filters, rows: report.rows.length } });
  return { filename: `${kind}-${(filters.batchId ?? filters.assessmentId ?? filters.staffId ?? 'report').slice(0, 8)}-${todayIst(now)}.csv`, csv: toCsv(report.columns, report.rows) };
}
