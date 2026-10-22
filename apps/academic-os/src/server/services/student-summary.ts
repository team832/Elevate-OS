/**
 * One student's evidence for Business Ops (IR-OPS-STU-1): contract `academic.student_summary` v1,
 * served by the internal route only (system scope, caller `ops`). Attendance counts held class
 * sessions in the window within the student's batch placements (a transfer moves the window to
 * the new batch); teachers come from the sessions actually
 * held (class record teacher, else the session's teacher), so later timetable changes never
 * rewrite who taught. Results: final runs of PUBLISHED assessments only (draft and unpublished marks
 * never leave Academic); absent is never a score; exempt/withheld have no v1 state and are not sent;
 * rank/percentile are null unless setting progress.show_rank_percentile is approved with show = true.
 * The attendance rate and its definition follow the `attendance.denominator` setting exactly as the
 * institute summary does, so Ops never recomputes it; nothing recorded is null, never 0.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  academicAssessments,
  academicAttendance,
  academicBatches,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicResultRuns,
  academicResults,
  academicStudents,
  academicSubjects,
  programmes,
  type Database,
} from '@elevate/database';
import {
  NotFoundError,
  academicStudentSummaryV1Schema,
  type AcademicStudentSummaryV1,
} from '@elevate/shared-contracts';
import type { StaffMemberId, StudentId } from '@elevate/shared-types';
import { attendanceDefinition, summariseAttendance, type AttendanceStatus } from '../../domain';
import { NO_BATCH_HISTORY, inPlacement, placementsOf } from './progress';
import { rankVisible } from './results';
import { getSetting } from './settings';

export async function buildStudentSummary(
  db: Database,
  studentId: string,
  window: { from: string; to: string },
): Promise<AcademicStudentSummaryV1 & { extensions?: { attendanceNotRecorded: { enrolmentId: string; reason: string }[] } }> {
  const [student] = await db
    .select({ id: academicStudents.id })
    .from(academicStudents)
    .where(eq(academicStudents.id, studentId as StudentId));
  if (!student) throw new NotFoundError('Student not found.');
  const enrolments = await db
    .select({
      e: academicEnrolments,
      programmeCode: programmes.code,
      batchName: academicBatches.name,
    })
    .from(academicEnrolments)
    .innerJoin(programmes, eq(programmes.id, academicEnrolments.programmeId))
    .leftJoin(academicBatches, eq(academicBatches.id, academicEnrolments.batchId))
    .where(eq(academicEnrolments.studentId, student.id))
    .orderBy(asc(academicEnrolments.createdAt));

  const rule = (await getSetting(db, 'attendance.denominator')).value;
  const heldIds: string[] = [];
  const allMarks: { sessionId: string; status: AttendanceStatus }[] = [];
  const out: AcademicStudentSummaryV1['enrolments'] = [];
  const placements = await placementsOf(
    db,
    enrolments.map(({ e }) => e.id),
  );
  const attendanceNotRecorded: { enrolmentId: string; reason: string }[] = [];
  for (const { e, programmeCode, batchName } of enrolments) {
    const windows = placements.filter((p) => p.enrolmentId === e.id);
    if (e.batchId && windows.length === 0) attendanceNotRecorded.push({ enrolmentId: e.id, reason: NO_BATCH_HISTORY });
    const batchIds = [...new Set(windows.map((w) => w.batchId))];
    const sessions = batchIds.length
      ? await db
          .select({
            id: academicClassSessions.id,
            batchId: academicClassSessions.batchId,
            date: academicClassSessions.date,
            teacher: academicClassSessions.teacherStaffId,
            subject: academicSubjects.name,
          })
          .from(academicClassSessions)
          .leftJoin(academicSubjects, eq(academicSubjects.id, academicClassSessions.subjectId))
          .where(
            and(
              inArray(academicClassSessions.batchId, batchIds),
              eq(academicClassSessions.status, 'held'),
              gte(academicClassSessions.date, window.from),
              lte(academicClassSessions.date, window.to),
            ),
          )
      : [];
    const held = sessions.filter((s) =>
      inPlacement(
        s.date,
        windows.filter((w) => w.batchId === s.batchId),
      ),
    );
    const ids = held.map((h) => h.id);
    const [marks, records] = ids.length
      ? await Promise.all([
          db
            .select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status })
            .from(academicAttendance)
            .where(
              and(
                eq(academicAttendance.studentId, student.id),
                inArray(academicAttendance.sessionId, ids),
              ),
            ),
          db
            .select({
              sessionId: academicClassRecords.sessionId,
              teacher: academicClassRecords.teacherStaffId,
            })
            .from(academicClassRecords)
            .where(
              and(
                inArray(academicClassRecords.sessionId, ids),
                inArray(academicClassRecords.state, ['submitted', 'verified']),
              ),
            ),
        ])
      : [[], []];
    heldIds.push(...ids);
    allMarks.push(...marks);
    const recordedBy = new Map(records.map((r) => [r.sessionId as string, r.teacher]));
    const teachers = new Map<string, { staffId: StaffMemberId; subject: string }>();
    for (const h of held) {
      const staffId = recordedBy.get(h.id) ?? h.teacher;
      const subject = h.subject ?? 'Subject not recorded';
      if (staffId) teachers.set(`${staffId}|${subject}`, { staffId, subject });
    }
    out.push({
      enrolmentId: e.id,
      programmeCode,
      batchId: e.batchId,
      batchName,
      status: e.status,
      teachers: [...teachers.values()],
    });
  }

  const results = await db
    .select({
      r: academicResults,
      a: academicAssessments,
      run: academicResultRuns,
      subject: academicSubjects.name,
      cohort: academicBatches.name,
    })
    .from(academicResults)
    .innerJoin(
      academicResultRuns,
      and(eq(academicResultRuns.id, academicResults.runId), eq(academicResultRuns.status, 'final')),
    )
    .innerJoin(academicAssessments, eq(academicAssessments.id, academicResults.assessmentId))
    .innerJoin(academicBatches, eq(academicBatches.id, academicAssessments.batchId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, academicAssessments.subjectId))
    .where(
      and(
        eq(academicResults.studentId, student.id),
        isNotNull(academicAssessments.scheduledDate),
        isNotNull(academicAssessments.publishedAt),
        gte(academicAssessments.scheduledDate, window.from),
        lte(academicAssessments.scheduledDate, window.to),
      ),
    )
    .orderBy(asc(academicAssessments.scheduledDate), asc(academicAssessments.code));
  const showRank = await rankVisible(db);
  const sendable = results.filter(({ r }) => r.state === 'scored' || r.state === 'absent');
  const a = summariseAttendance(heldIds, allMarks, rule);

  const summary = academicStudentSummaryV1Schema.parse({
    contract: 'academic.student_summary',
    version: 1,
    generatedAt: new Date().toISOString(),
    studentId: student.id,
    window,
    enrolments: out,
    attendance: {
      held: a.heldSessions,
      present: a.present,
      partial: a.partial,
      late: a.late,
      absent: a.absent,
      excused: a.excused,
      ratePercent: a.ratePercent,
      definition: attendanceDefinition(rule),
    },
    results: sendable.map(({ r, a, run, subject, cohort }) => ({
      assessmentId: a.id,
      code: a.code,
      subject,
      examType: a.kind,
      heldOn: a.scheduledDate,
      state: r.state,
      score: r.state === 'scored' ? Number(r.totalScore) : null,
      maxScore: Number(r.maxScore),
      percentile: !showRank || r.percentile === null ? null : Number(r.percentile),
      rank: showRank ? r.rank : null,
      cohort: { label: cohort, scored: run.studentsScored },
      resultVersion: run.version,
    })),
  });
  // Contract v1 cannot say "missing" for attendance, so those enrolments add nothing to the counts and are named here.
  return attendanceNotRecorded.length ? { ...summary, extensions: { attendanceNotRecorded } } : summary;
}
