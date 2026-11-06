/**
 * Homework (F4-05): a teacher sets homework for a batch they teach (optionally a subject and
 * chapter, optionally copied from a teaching-log entry), marks each student submitted / late /
 * not submitted / excused with a remark, and may cancel it with a reason (kept, never deleted).
 * Its students = placed in the batch at any time from the set date to the due date, plus anyone
 * already marked. No mark = "not marked yet", never "not submitted" (domain/homework.ts).
 * Permissions: reading `academic:classes:read`, writing `academic:classes:record`; a teacher (own
 * scope) works only in batches they teach today, any other homework is NOT_FOUND.
 */
import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  academicBatchPlacements,
  academicBatches,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicHomework,
  academicHomeworkMarks,
  academicStudents,
  academicSubjects,
  academicTeacherAssignments,
  staffMembers,
  type Database,
} from '@elevate/database';
import { toCsv, withTransaction, type CsvCell } from '@elevate/server-kit';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import { addDays, isUuid, type BatchId, type IsoDate, type StaffMemberId, type StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { completionText, countsOf, homeworkCounts, HOMEWORK_STATUS_LABELS, sumCounts, type HomeworkCounts, type HomeworkStatus, type HomeworkTally } from '../../domain/homework';
import { assignmentActiveOn, audit, getBatchOrThrow, resolveScope, todayIst, type Actor, type Scope } from '../context';
import type { cancelHomeworkBody, createHomeworkBody, homeworkMarksBody, homeworkQuery } from '../schemas-homework';

const hw = academicHomework;
const hm = academicHomeworkMarks;
const p = academicBatchPlacements;
const NOT_FOUND = 'Homework not found.';

type Window = Pick<typeof hw.$inferSelect, 'id' | 'batchId' | 'setOn' | 'dueOn'>;
type Filters = Partial<z.output<typeof homeworkQuery>>;
export type HomeworkStudent = { studentId: StudentId; code: string; fullName: string; isSample: boolean; status: HomeworkStatus | null; remark: string | null };

const inScope = (scope: Scope, batchId: string) => scope.kind === 'all' || scope.batchIds.includes(batchId as BatchId);
const bad = (field: string, message: string) => new ValidationError(message, { details: [{ path: [field], message }] });
const student = { studentId: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName, isSample: academicStudents.isSample };

/** Each homework's students and marks (null = not marked yet), by homework id then student id. */
async function rosters(db: Database, items: readonly Window[]) {
  const out = new Map<string, Map<string, HomeworkStudent>>(items.map((h) => [h.id, new Map()]));
  if (!items.length) return out;
  const ids = items.map((h) => h.id);
  const placed = await db
    .select({ homeworkId: hw.id, ...student })
    .from(hw)
    .innerJoin(p, and(eq(p.batchId, hw.batchId), lte(p.startDate, hw.dueOn), or(isNull(p.endDate), gte(p.endDate, hw.setOn))))
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(inArray(hw.id, ids));
  const marked = await db
    .select({ homeworkId: hm.homeworkId, ...student, status: hm.status, remark: hm.remark })
    .from(hm)
    .innerJoin(academicStudents, eq(academicStudents.id, hm.studentId))
    .where(inArray(hm.homeworkId, ids));
  for (const { homeworkId, ...r } of placed) out.get(homeworkId)!.set(r.studentId, { ...r, status: null, remark: null });
  for (const { homeworkId, ...r } of marked) out.get(homeworkId)!.set(r.studentId, r);
  return out;
}

const labelled = (db: Database) =>
  db
    .select({
      h: hw,
      batchCode: academicBatches.code,
      batchName: academicBatches.name,
      subjectName: academicSubjects.name,
      chapterCode: academicChapters.code,
      chapterTitle: academicChapters.title,
      teacherName: staffMembers.fullName,
    })
    .from(hw)
    .innerJoin(academicBatches, eq(academicBatches.id, hw.batchId))
    .innerJoin(staffMembers, eq(staffMembers.id, hw.teacherStaffId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, hw.subjectId))
    .leftJoin(academicChapters, eq(academicChapters.id, hw.chapterId));

const filtersOf = (q: Filters) =>
  and(q.batchId ? eq(hw.batchId, q.batchId as BatchId) : undefined, q.from ? gte(hw.dueOn, q.from) : undefined, q.to ? lte(hw.dueOn, q.to) : undefined);

/** The reader's homework condition (null = nothing in scope). */
async function scoped(db: Database, actor: Actor, where: SQL | undefined): Promise<SQL | null> {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  if (scope.kind === 'own' && !scope.batchIds.length) return null;
  return and(scope.kind === 'own' ? inArray(hw.batchId, scope.batchIds) : undefined, where) ?? sql`true`;
}

/** Per-homework tallies in one aggregate query over every matching homework (students = placed in the window ∪ marked). */
async function tallies(db: Database, where: SQL) {
  const placed = db
    .select({ homeworkId: sql<string>`${hw.id}`.as('roster_homework_id'), studentId: sql<string>`${academicEnrolments.studentId}`.as('roster_student_id') })
    .from(hw)
    .innerJoin(p, and(eq(p.batchId, hw.batchId), lte(p.startDate, hw.dueOn), or(isNull(p.endDate), gte(p.endDate, hw.setOn))))
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .where(where);
  const marked = db
    .select({ homeworkId: sql<string>`${hm.homeworkId}`.as('roster_homework_id'), studentId: sql<string>`${hm.studentId}`.as('roster_student_id') })
    .from(hm)
    .innerJoin(hw, eq(hw.id, hm.homeworkId))
    .where(where);
  const r = placed.union(marked).as('roster');
  const n = (s?: HomeworkStatus) => (s ? sql<number>`count(*) filter (where ${hm.status} = ${s})` : sql<number>`count(*)`).mapWith(Number);
  const rows = await db
    .select({ homeworkId: r.homeworkId, students: n(), submitted: n('submitted'), late: n('late'), not_submitted: n('not_submitted'), excused: n('excused') })
    .from(r)
    .leftJoin(hm, and(eq(hm.homeworkId, r.homeworkId), eq(hm.studentId, r.studentId)))
    .groupBy(r.homeworkId);
  const none: HomeworkTally = { students: 0, submitted: 0, late: 0, not_submitted: 0, excused: 0 };
  const byId = new Map<string, HomeworkTally>(rows.map(({ homeworkId, ...t }) => [homeworkId, t]));
  return (id: string) => byId.get(id) ?? none;
}

export const HOMEWORK_LIST_LIMIT = 500;

/** Homework in the reader's scope, newest due date first, with counts; `limit: null` = every row (downloads). `total` counts them all. */
export async function listHomework(db: Database, actor: Actor, q: Filters = {}, { limit = HOMEWORK_LIST_LIMIT }: { limit?: number | null } = {}) {
  const where = await scoped(db, actor, filtersOf(q));
  if (!where) return { rows: [], total: 0 };
  const query = labelled(db).where(where).orderBy(desc(hw.dueOn), asc(academicBatches.code), asc(hw.title));
  const found = await (limit === null ? query : query.limit(limit));
  const [{ total }] = (await db.select({ total: count() }).from(hw).where(where)) as [{ total: number }];
  const tallyOf = await tallies(db, found.length ? inArray(hw.id, found.map((r) => r.h.id)) : sql`false`);
  return { rows: found.map(({ h, ...l }) => ({ ...h, ...l, counts: countsOf(tallyOf(h.id)) })), total };
}

/** One homework with its students (by name) and counts. */
export async function getHomework(db: Database, actor: Actor, id: string) {
  const scope = await resolveScope(db, actor, 'academic:classes:read');
  const [row] = isUuid(id) ? await labelled(db).where(eq(hw.id, id)) : [];
  if (!row || !inScope(scope, row.h.batchId)) throw new NotFoundError(NOT_FOUND);
  const { h, ...labels } = row;
  const students = [...(await rosters(db, [h])).get(h.id)!.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { ...h, ...labels, students, counts: homeworkCounts(students.map((s) => s.status)) };
}

/** Subject and chapter belong to the batch's course (and to each other), the log entry to the batch, the teacher teaches it today. */
async function assertParts(db: Database, batch: { id: BatchId; courseId: string }, input: z.output<typeof createHomeworkBody>, teacherStaffId: StaffMemberId | null) {
  if (!teacherStaffId) throw bad('teacherStaffId', 'Choose the teacher who set this homework.');
  const [subject] = input.subjectId ? await db.select().from(academicSubjects).where(eq(academicSubjects.id, input.subjectId as never)) : [];
  if (input.subjectId && subject?.courseId !== batch.courseId) throw bad('subjectId', 'The subject is not part of the batch’s course.');
  const [chapter] = input.chapterId ? await db.select().from(academicChapters).where(eq(academicChapters.id, input.chapterId as never)) : [];
  if (input.chapterId && (chapter?.courseId !== batch.courseId || (input.subjectId && chapter.subjectId !== input.subjectId)))
    throw bad('chapterId', 'The chapter is not part of the batch’s course or of the chosen subject.');
  const [record] = input.classRecordId ? await db.select({ batchId: academicClassRecords.batchId }).from(academicClassRecords).where(eq(academicClassRecords.id, input.classRecordId as never)) : [];
  if (input.classRecordId && record?.batchId !== batch.id) throw bad('classRecordId', 'That teaching-log entry belongs to another batch.');
  const ta = academicTeacherAssignments;
  const [teaches] = await db.select({ id: ta.id }).from(ta).where(and(eq(ta.batchId, batch.id), eq(ta.staffMemberId, teacherStaffId), assignmentActiveOn(todayIst())));
  if (!teaches) throw bad('teacherStaffId', 'This teacher does not teach the batch.');
}

export async function createHomework(db: Database, actor: Actor, input: z.output<typeof createHomeworkBody>) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  if (!inScope(scope, input.batchId)) throw new NotFoundError('Batch not found.');
  const batch = await getBatchOrThrow(db, input.batchId);
  const teacherStaffId = scope.kind === 'own' ? scope.staffId : ((input.teacherStaffId ?? null) as StaffMemberId | null);
  await assertParts(db, batch, input, teacherStaffId);
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(hw)
      .values({
        batchId: batch.id,
        subjectId: (input.subjectId ?? null) as never,
        chapterId: (input.chapterId ?? null) as never,
        classRecordId: (input.classRecordId ?? null) as never,
        title: input.title,
        instructions: input.instructions || null,
        setOn: input.setOn,
        dueOn: input.dueOn,
        teacherStaffId: teacherStaffId!,
        createdByUserId: actor.user.id,
      })
      .returning();
    await audit(tx, actor, { action: 'homework.set', entityType: 'homework', entityId: row!.id, after: row });
    return row!;
  });
}

async function lockOpen(tx: Database, scope: Scope, id: string) {
  const [row] = await tx.select().from(hw).where(eq(hw.id, id)).for('update');
  if (!row || !inScope(scope, row.batchId)) throw new NotFoundError(NOT_FOUND);
  if (row.cancelledAt) throw new InvalidStateTransitionError('This homework was cancelled; it cannot change.');
  return row;
}

/** Save the marks sent (others stay as they are); a mark only for a student on this homework's list. */
export async function markHomework(db: Database, actor: Actor, id: string, input: z.output<typeof homeworkMarksBody>) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const row = await lockOpen(tx, scope, id);
    const students = (await rosters(tx, [row])).get(row.id)!;
    const outside = input.marks.filter((m) => !students.has(m.studentId));
    if (outside.length)
      throw new ValidationError('A student is not on this homework’s list; nothing was saved.', { details: outside.map((m) => ({ path: ['marks', m.studentId], message: 'Not placed in the batch for this homework' })) });
    const changes = input.marks.filter((m) => {
      const s = students.get(m.studentId)!;
      return s.status !== m.status || s.remark !== (m.remark || null);
    });
    if (changes.length) {
      const markedAt = new Date();
      await tx
        .insert(hm)
        .values(changes.map((m) => ({ homeworkId: row.id, studentId: m.studentId as StudentId, status: m.status, remark: m.remark || null, markedByUserId: actor.user.id, markedAt })))
        .onConflictDoUpdate({
          target: [hm.homeworkId, hm.studentId],
          set: { status: sql`excluded.status`, remark: sql`excluded.remark`, markedByUserId: sql`excluded.marked_by_user_id`, markedAt: sql`excluded.marked_at` },
        });
      await audit(tx, actor, {
        action: 'homework.marked',
        entityType: 'homework',
        entityId: row.id,
        metadata: { changes: changes.map((m) => ({ studentId: m.studentId, from: students.get(m.studentId)!.status, to: m.status })) },
      });
    }
    return { saved: changes.length };
  });
}

export async function cancelHomework(db: Database, actor: Actor, id: string, input: z.output<typeof cancelHomeworkBody>) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  return withTransaction(db, async (tx) => {
    const row = await lockOpen(tx, scope, id);
    const [after] = await tx.update(hw).set({ cancelledAt: new Date(), cancelledByUserId: actor.user.id, cancelReason: input.reason }).where(eq(hw.id, row.id)).returning();
    await audit(tx, actor, { action: 'homework.cancelled', entityType: 'homework', entityId: row.id, metadata: { reason: input.reason } });
    return after!;
  });
}

/** Due-date window of the completion view: the last 30 days (IST) unless given. */
export function completionWindow(q: Filters) {
  const to = q.to ?? todayIst();
  return { from: q.from ?? addDays(to as IsoDate, -29), to };
}

/** Completion by batch and by teacher over EVERY homework due in the window (no cap); cancelled homework is left out. */
export async function homeworkCompletion(db: Database, actor: Actor, q: Filters = {}) {
  const window = completionWindow(q);
  const where = await scoped(db, actor, and(filtersOf({ ...q, ...window }), isNull(hw.cancelledAt)));
  if (!where) return { window, batches: [], teachers: [] };
  const rows = await db
    .select({ id: hw.id, batchId: hw.batchId, batchCode: academicBatches.code, batchName: academicBatches.name, teacherStaffId: hw.teacherStaffId, teacherName: staffMembers.fullName })
    .from(hw)
    .innerJoin(academicBatches, eq(academicBatches.id, hw.batchId))
    .innerJoin(staffMembers, eq(staffMembers.id, hw.teacherStaffId))
    .where(where);
  const tallyOf = await tallies(db, where);
  const group = (key: (r: (typeof rows)[number]) => string, name: (r: (typeof rows)[number]) => string) => {
    const groups = new Map<string, { id: string; name: string; homework: number; tallies: HomeworkTally[] }>();
    for (const r of rows) {
      const g = groups.get(key(r)) ?? { id: key(r), name: name(r), homework: 0, tallies: [] };
      g.homework += 1;
      g.tallies.push(tallyOf(r.id));
      groups.set(g.id, g);
    }
    return [...groups.values()].map(({ tallies: t, ...g }) => ({ ...g, counts: sumCounts(t) })).sort((a, b) => a.name.localeCompare(b.name));
  };
  return { window, batches: group((r) => r.batchId, (r) => `${r.batchCode} · ${r.batchName}`), teachers: group((r) => r.teacherStaffId, (r) => r.teacherName) };
}

// --- spreadsheet downloads (audited) ---------------------------------------------------------------

const COUNT_HEADERS = ['Students', 'Submitted', 'Late', 'Not submitted', 'Excused', 'Not marked yet', 'Completion'];
const countCells = (c: HomeworkCounts): CsvCell[] => [c.students, c.submitted, c.late, c.not_submitted, c.excused, c.unmarked, completionText(c)];

async function exported(db: Database, actor: Actor, name: string, header: string[], rows: CsvCell[][], metadata: Record<string, unknown> = {}) {
  await audit(db, actor, { action: 'homework.exported', entityType: 'homework', entityId: name, metadata: { ...metadata, rows: rows.length } });
  return { filename: `homework-${name.slice(0, 10)}-${todayIst()}.csv`, csv: toCsv(header, rows) };
}

export async function homeworkListCsv(db: Database, actor: Actor, q: Filters) {
  const { rows } = await listHomework(db, actor, q, { limit: null });
  const cells = rows.map((h) => [h.title, h.batchCode, h.subjectName, h.chapterTitle, h.teacherName, h.setOn, h.dueOn, h.cancelledAt ? `Cancelled: ${h.cancelReason}` : 'Set', ...countCells(h.counts)]);
  return exported(db, actor, 'list', ['Title', 'Batch', 'Subject', 'Chapter', 'Teacher', 'Set on', 'Due on', 'Status', ...COUNT_HEADERS], cells, { batchId: q.batchId, from: q.from, to: q.to });
}

export async function homeworkCompletionCsv(db: Database, actor: Actor, q: Filters) {
  const r = await homeworkCompletion(db, actor, q);
  const cells = [...r.batches.map((g) => ['Batch', g.name, g.homework, ...countCells(g.counts)]), ...r.teachers.map((g) => ['Teacher', g.name, g.homework, ...countCells(g.counts)])];
  return exported(db, actor, 'completion', ['By', 'Name', 'Homework', ...COUNT_HEADERS], cells, { ...r.window, batchId: q.batchId });
}

export async function homeworkMarksCsv(db: Database, actor: Actor, id: string) {
  const h = await getHomework(db, actor, id);
  const cells = h.students.map((s) => [s.fullName, s.code, s.status ? HOMEWORK_STATUS_LABELS[s.status] : 'Not marked yet', s.remark]);
  return exported(db, actor, h.id, ['Student', 'Code', 'Status', 'Remark'], cells);
}

// --- the "Set homework" form and the portal ------------------------------------------------------

/**
 * What the "Set homework" form offers for a batch: its course's subjects and active chapters, its
 * teachers today (coordinators choose one), the last 30 days' submitted teaching-log homework to copy
 * (a teacher sees their own entries), and the entry being copied (`recordId`).
 */
export async function homeworkForm(db: Database, actor: Actor, batchId: string, recordId?: string) {
  const scope = await resolveScope(db, actor, 'academic:classes:record');
  if (!isUuid(batchId) || !inScope(scope, batchId)) throw new NotFoundError('Batch not found.');
  const batch = await getBatchOrThrow(db, batchId);
  const ta = academicTeacherAssignments;
  const cr = academicClassRecords;
  const subjects = await db.select({ id: academicSubjects.id, name: academicSubjects.name }).from(academicSubjects).where(eq(academicSubjects.courseId, batch.courseId)).orderBy(asc(academicSubjects.sortOrder));
  const chapters = await db
    .select({ id: academicChapters.id, code: academicChapters.code, title: academicChapters.title })
    .from(academicChapters)
    .where(and(eq(academicChapters.courseId, batch.courseId), eq(academicChapters.status, 'active')))
    .orderBy(asc(academicChapters.code));
  const teachers =
    scope.kind === 'all'
      ? await db
          .selectDistinct({ id: staffMembers.id, fullName: staffMembers.fullName })
          .from(ta)
          .innerJoin(staffMembers, eq(staffMembers.id, ta.staffMemberId))
          .where(and(eq(ta.batchId, batch.id), assignmentActiveOn(todayIst())))
          .orderBy(asc(staffMembers.fullName))
      : [];
  const logged = await db
    .select({ id: cr.id, date: academicClassSessions.date, homework: cr.homework, homeworkDueOn: cr.homeworkDueOn, chapterId: cr.chapterId, subjectId: academicChapters.subjectId, chapterTitle: academicChapters.title })
    .from(cr)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, cr.sessionId))
    .innerJoin(academicChapters, eq(academicChapters.id, cr.chapterId))
    .where(
      and(
        eq(cr.batchId, batch.id),
        isNotNull(cr.homework),
        inArray(cr.state, ['submitted', 'verified']),
        gte(academicClassSessions.date, addDays(todayIst() as IsoDate, -30)),
        scope.kind === 'own' ? eq(cr.teacherStaffId, scope.staffId!) : undefined,
      ),
    )
    .orderBy(desc(academicClassSessions.date))
    .limit(20);
  return { batch: { id: batch.id, code: batch.code, name: batch.name }, subjects, chapters, teachers, logged, copied: logged.find((l) => l.id === recordId) ?? null };
}

/**
 * A student's homework due in [from, to] for the portal (F4-13, COMMON-W4 §4): cancelled homework is
 * left out; status null = not marked yet. `studentId` = the Academic student id or the canonical
 * (core) student id. No permission check inside: the caller checks the portal link first.
 */
export async function homeworkForStudent(db: Database, studentId: string, { from, to }: { from: string; to: string }) {
  if (!isUuid(studentId)) return [];
  const [s] = await db
    .select({ id: academicStudents.id })
    .from(academicStudents)
    .where(or(eq(academicStudents.id, studentId as StudentId), eq(academicStudents.coreStudentId, studentId as never)));
  if (!s) return [];
  const placed = db
    .select({ one: sql`1` })
    .from(p)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .where(and(eq(academicEnrolments.studentId, s.id), eq(p.batchId, hw.batchId), lte(p.startDate, hw.dueOn), or(isNull(p.endDate), gte(p.endDate, hw.setOn))));
  return db
    .select({ id: hw.id, title: hw.title, subjectName: academicSubjects.name, setOn: hw.setOn, dueOn: hw.dueOn, status: hm.status })
    .from(hw)
    .leftJoin(academicSubjects, eq(academicSubjects.id, hw.subjectId))
    .leftJoin(hm, and(eq(hm.homeworkId, hw.id), eq(hm.studentId, s.id)))
    .where(and(isNull(hw.cancelledAt), gte(hw.dueOn, from), lte(hw.dueOn, to), or(isNotNull(hm.id), exists(placed))))
    .orderBy(desc(hw.dueOn), asc(hw.title));
}
