/**
 * Students marked absent between two dates (F4-06), for Business Ops' follow-up calls
 * (AcademicAbsencesV1). Only the mark `absent`: late, excused, partial and unmarked are not
 * absences. Cancelled or rescheduled classes are left out, and so are students without a canonical
 * identity (Business Ops can follow up only on those).
 */
import { and, asc, eq, gte, isNotNull, lte, notInArray } from 'drizzle-orm';
import { academicAttendance, academicBatches, academicClassSessions, academicStudents, academicSubjects, type Database } from '@elevate/database';
import { ABSENCES_MAX_DAYS, ValidationError, type AcademicAbsencesV1 } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';

const s = academicClassSessions;

export async function absencesBetween(db: Database, { from, to }: { from: IsoDate; to: IsoDate }, now = new Date()): Promise<AcademicAbsencesV1> {
  if (from > to) throw new ValidationError('from must not be after to.');
  if (addDays(from, ABSENCES_MAX_DAYS - 1) < to) throw new ValidationError(`The window may span at most ${ABSENCES_MAX_DAYS} days.`);
  const absences = await db
    .select({
      coreStudentId: academicStudents.coreStudentId,
      batchId: academicBatches.id,
      batchCode: academicBatches.code,
      batchName: academicBatches.name,
      sessionId: s.id,
      date: s.date,
      startTime: s.startTime,
      subjectName: academicSubjects.name,
    })
    .from(academicAttendance)
    .innerJoin(s, eq(s.id, academicAttendance.sessionId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicAttendance.studentId))
    .innerJoin(academicBatches, eq(academicBatches.id, s.batchId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, s.subjectId))
    .where(and(eq(academicAttendance.status, 'absent'), gte(s.date, from), lte(s.date, to), notInArray(s.status, ['cancelled', 'rescheduled']), isNotNull(academicStudents.coreStudentId)))
    .orderBy(asc(s.date), asc(s.startTime));
  return { contract: 'academic.absences', version: 1, generatedAt: now.toISOString() as never, from, to, absences: absences as never };
}
