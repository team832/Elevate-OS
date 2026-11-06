/**
 * Absent students (F4-06): students Academic OS marked absent in class within a date range (the
 * AcademicAbsencesV1 contract: absent only), each with their follow-up calls to the family. Read by
 * counsellors (students of their own cases) and the operations manager: `ops:student_private:read`.
 * Logging a call (ops.absence_calls) uses `ops:guardians:write` (the same holders: family contact
 * work) and is audited. Academic is read outside any transaction; when it cannot be reached the
 * result says so ("unavailable"), never an empty list.
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  OPS_ABSENCE_CALL_OUTCOMES,
  opsAbsenceCalls,
  opsAdmissions,
  students,
  users,
  type Database,
} from '@elevate/database';
import { fetchInternal, toCsv, withTransaction } from '@elevate/server-kit';
import {
  ABSENCES_MAX_DAYS,
  academicAbsencesV1Schema,
  ConflictError,
  NotFoundError,
  ValidationError,
  type AcademicAbsencesV1,
} from '@elevate/shared-contracts';
import { addDays, isIsoDate, istInstant, istToday, type IsoDate } from '../domain/dates';
import { fmtDateTime } from '../ui/format';
import { academicUrl } from './academic-summary';
import { accessScope, type AccessScope, type Actor } from './context';
import { opsAudit } from './ops-common';
import { ownCase } from './students-filters';

export const ABSENCE_CALL_LABELS: Record<(typeof OPS_ABSENCE_CALL_OUTCOMES)[number], string> = {
  reached: 'Reached the family',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  will_attend: 'Will attend',
};

const day = z.string().refine(isIsoDate).optional().catch(undefined);
/** The page's and the download's filters; a bad value is ignored, never an error. */
export const absencesQuery = z.object({
  from: day,
  to: day,
  open: z.uuid().optional().catch(undefined),
});
export type AbsencesQuery = z.output<typeof absencesQuery>;

export const absenceCallBody = z.strictObject({
  studentId: z.uuid(),
  outcome: z.enum(OPS_ABSENCE_CALL_OUTCOMES),
  note: z.string().trim().max(1000).optional(),
});

/** The dates shown: the last 7 days (IST) unless given; at most Academic's limit. */
export function absenceWindow(q: AbsencesQuery, now = new Date()) {
  const to = (q.to ?? istToday(now)) as IsoDate;
  const from = (q.from ?? addDays(to, -6)) as IsoDate;
  if (from > to) throw new ValidationError('The first day cannot be after the last day.');
  if (addDays(from, ABSENCES_MAX_DAYS - 1) < to)
    throw new ValidationError(`Choose at most ${ABSENCES_MAX_DAYS} days.`);
  return { from, to };
}

export const fetchAcademicAbsences = (window: { from: string; to: string }) =>
  fetchInternal(
    academicUrl(`/academic/api/internal/v1/absences?${new URLSearchParams(window)}`),
    academicAbsencesV1Schema,
    { caller: 'ops', timeoutMs: 5000 },
  );

/** Students the caller follows up on: all, or those of their own cases (counsellor or lead owner). */
const followedBy = (db: Database, access: AccessScope): SQL | undefined =>
  access.scope === 'all'
    ? undefined
    : inArray(
        students.id,
        db.select({ id: opsAdmissions.studentId }).from(opsAdmissions).where(ownCase(db, access)),
      );

const audit = opsAudit('absence_call');

/** Students marked absent in the window that the caller may follow up on, most absences first. */
export async function absentStudents(
  db: Database,
  actor: Actor,
  q: AbsencesQuery,
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:student_private:read');
  const window = absenceWindow(q, now);
  const academic = await fetchAcademicAbsences(window);
  if (academic.status === 'unavailable')
    return { window, available: false as const, fetchedAt: academic.fetchedAt, rows: [] };
  const byStudent = new Map<string, AcademicAbsencesV1['absences']>();
  for (const a of academic.data.absences)
    byStudent.set(a.coreStudentId, [a, ...(byStudent.get(a.coreStudentId) ?? [])]); // newest first
  const ids = [...byStudent.keys()];
  const people = ids.length
    ? await db
        .select({ id: students.id, fullName: students.fullName, isSample: students.isSample })
        .from(students)
        .where(and(inArray(students.id, ids as never[]), followedBy(db, access)))
    : [];
  const calls = people.length
    ? await db
        .select({
          studentId: opsAbsenceCalls.studentId,
          outcome: opsAbsenceCalls.outcome,
          note: opsAbsenceCalls.note,
          calledAt: opsAbsenceCalls.calledAt,
          calledBy: users.displayName,
        })
        .from(opsAbsenceCalls)
        .innerJoin(users, eq(users.id, opsAbsenceCalls.calledBy))
        .where(
          inArray(
            opsAbsenceCalls.studentId,
            people.map((s) => s.id),
          ),
        )
        .orderBy(desc(opsAbsenceCalls.calledAt))
    : [];
  const rows = people
    .map((s) => {
      const own = calls.filter((c) => c.studentId === s.id);
      return { ...s, absences: byStudent.get(s.id)!, calls: own, lastCall: own[0] ?? null };
    })
    .sort((a, b) => b.absences.length - a.absences.length || a.fullName.localeCompare(b.fullName));
  return { window, available: true as const, fetchedAt: academic.fetchedAt, rows };
}

/** Record a call to a student's family about absences (own students only for counsellors). */
export async function logAbsenceCall(
  db: Database,
  actor: Actor,
  input: z.output<typeof absenceCallBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:guardians:write');
  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, input.studentId as never), followedBy(db, access)));
  if (!student) throw new NotFoundError('Student not found.');
  return withTransaction(db, async (tx) => {
    const [call] = await tx
      .insert(opsAbsenceCalls)
      .values({
        studentId: student.id,
        outcome: input.outcome,
        note: input.note || null,
        calledBy: actor.id,
      })
      .returning();
    await audit(
      tx,
      actor,
      call!.id,
      'absence_call.logged',
      { after: { studentId: student.id, outcome: call!.outcome, note: Boolean(call!.note) } },
      requestId,
    );
    return call!;
  });
}

/** The list as a spreadsheet, one row per absence; audited. Academic unreachable → 409, never an empty file. */
export async function absencesCsv(db: Database, actor: Actor, q: AbsencesQuery, now = new Date()) {
  const r = await absentStudents(db, actor, q, now);
  if (!r.available)
    throw new ConflictError(
      'Academic OS could not be reached, so the absences cannot be downloaded now. Try again later.',
    );
  const cells = r.rows.flatMap((s) =>
    s.absences.map((a) => [
      s.fullName,
      fmtDateTime(istInstant(a.date, a.startTime)),
      `${a.batchCode} · ${a.batchName}`,
      a.subjectName ?? 'No subject',
      s.lastCall ? ABSENCE_CALL_LABELS[s.lastCall.outcome] : 'No call logged',
      s.lastCall ? fmtDateTime(s.lastCall.calledAt) : '',
    ]),
  );
  await audit(db, actor, 'absences', 'absences.exported', {
    metadata: { ...r.window, rows: cells.length },
  });
  return {
    filename: `absent-students-${r.window.from}-${r.window.to}.csv`,
    csv: toCsv(['Student', 'Class', 'Batch', 'Subject', 'Last call', 'Last call at'], cells),
  };
}
