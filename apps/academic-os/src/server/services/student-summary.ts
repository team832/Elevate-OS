/**
 * One student's evidence for Business Ops (IR-OPS-STU-1): contract `academic.student_summary` v1,
 * served by the internal route only (system scope, caller `ops`). Attendance counts held class
 * sessions in the window from each enrolment's start (closed enrolments: only sessions with the
 * student's mark); teachers come from the sessions actually
 * held (class record teacher, else the session's teacher), so later timetable changes never
 * rewrite who taught. Results are final runs only; absent is never a score.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm';
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
import { summariseAttendance } from '../../domain';

export async function buildStudentSummary(
  db: Database,
  studentId: string,
  window: { from: string; to: string },
): Promise<AcademicStudentSummaryV1> {
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

  const totals = { held: 0, present: 0, partial: 0, late: 0, absent: 0, excused: 0 };
  const out: AcademicStudentSummaryV1['enrolments'] = [];
  for (const { e, programmeCode, batchName } of enrolments) {
    const held = e.batchId
      ? await db
          .select({
            id: academicClassSessions.id,
            teacher: academicClassSessions.teacherStaffId,
            subject: academicSubjects.name,
          })
          .from(academicClassSessions)
          .leftJoin(academicSubjects, eq(academicSubjects.id, academicClassSessions.subjectId))
          .where(
            and(
              eq(academicClassSessions.batchId, e.batchId),
              eq(academicClassSessions.status, 'held'),
              gte(
                academicClassSessions.date,
                e.startDate && e.startDate > window.from ? e.startDate : window.from,
              ),
              lte(academicClassSessions.date, window.to),
            ),
          )
      : [];
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
                ne(academicClassRecords.state, 'superseded'),
              ),
            ),
        ])
      : [[], []];
    // shortcut: enrolments have no end date — a closed enrolment (withdrawn/completed, e.g. a batch
    // change) counts only sessions with this student's mark; upgrade when enrolments get end_date.
    const marked = new Set(marks.map((m) => m.sessionId as string));
    const open = e.status === 'active' || e.status === 'paused';
    const taken = open ? held : held.filter((h) => marked.has(h.id));
    const a = summariseAttendance(
      taken.map((h) => h.id),
      marks,
    );
    totals.held += a.heldSessions;
    for (const k of ['present', 'partial', 'late', 'absent', 'excused'] as const) totals[k] += a[k];
    const recordedBy = new Map(records.map((r) => [r.sessionId as string, r.teacher]));
    const teachers = new Map<string, { staffId: StaffMemberId; subject: string }>();
    for (const h of taken) {
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
        gte(academicAssessments.scheduledDate, window.from),
        lte(academicAssessments.scheduledDate, window.to),
      ),
    )
    .orderBy(asc(academicAssessments.scheduledDate), asc(academicAssessments.code));

  return academicStudentSummaryV1Schema.parse({
    contract: 'academic.student_summary',
    version: 1,
    generatedAt: new Date().toISOString(),
    studentId: student.id,
    window,
    enrolments: out,
    attendance: totals,
    results: results.map(({ r, a, run, subject, cohort }) => ({
      assessmentId: a.id,
      code: a.code,
      subject,
      examType: a.kind,
      heldOn: a.scheduledDate,
      state: r.absent ? 'absent' : 'scored',
      score: r.absent ? null : Number(r.totalScore),
      maxScore: Number(r.maxScore),
      percentile: r.percentile === null ? null : Number(r.percentile),
      rank: r.rank,
      cohort: { label: cohort, scored: run.studentsScored },
      resultVersion: run.version,
    })),
  });
}
