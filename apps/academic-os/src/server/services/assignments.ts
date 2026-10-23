/**
 * Teaching assignments (ACD-003; brief 23 Oct 2026 §4, R9): teacher × course subject × batch with
 * academic year, branch, effective dates and role. `pending` = recorded without a batch: it opens
 * no batch, session or student (only `active`/dated rows do, see context.assignmentActiveOn) until
 * a coordinator sets a batch, which activates it. Every change is audited; history is kept.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import {
  academicBatches,
  academicCourses,
  academicSubjects,
  academicTeacherAssignments,
  branches,
  programmes,
  staffMembers,
  type CoreBranchId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, teachingAssignmentsV1Schema, ValidationError, type TeachingAssignmentsV1 } from '@elevate/shared-contracts';
import type { BatchId, StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assignmentActiveOn, audit, getBatchOrThrow, resolveScope, todayIst, type Actor } from '../context';
import type { createAssignmentBody } from '../schemas';
import type { endAssignmentBody, updateAssignmentBody } from '../schemas-placements';

const t = academicTeacherAssignments;

type AssignmentFilter = { batchId?: string; staffIds?: readonly string[]; history?: boolean; status?: (typeof t.$inferSelect)['status']; q?: string };

/** Current assignments (open today by their dates) plus pending ones; with `history` every row. `q` = teacher, subject or batch. */
function assignmentWhere(f: AssignmentFilter) {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  return and(
    f.history ? undefined : or(assignmentActiveOn(todayIst()), eq(t.status, 'pending')),
    f.batchId ? eq(t.batchId, f.batchId as BatchId) : undefined,
    f.staffIds ? inArray(t.staffMemberId, f.staffIds as StaffMemberId[]) : undefined,
    f.status ? eq(t.status, f.status) : undefined,
    like ? or(ilike(staffMembers.fullName, like), ilike(academicSubjects.name, like), ilike(academicBatches.code, like)) : undefined,
  );
}

const assignmentRows = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: t.id,
      batchId: t.batchId,
      batchCode: academicBatches.code,
      subjectId: t.subjectId,
      subjectCode: academicSubjects.code,
      subjectName: academicSubjects.name,
      courseId: academicSubjects.courseId,
      courseCode: academicCourses.code,
      courseName: academicCourses.name,
      /** Class level where the programme is one (CLASS_11, CLASS_12). */
      programmeCode: programmes.code,
      programmeName: programmes.name,
      staffMemberId: t.staffMemberId,
      staffName: staffMembers.fullName,
      employmentType: t.employmentType,
      role: t.role,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      academicYear: t.academicYear,
      branchId: t.branchId,
      branchName: branches.name,
    })
    .from(t)
    .leftJoin(academicBatches, eq(academicBatches.id, t.batchId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, t.subjectId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
    .innerJoin(programmes, eq(programmes.id, academicCourses.programmeId))
    .innerJoin(staffMembers, eq(staffMembers.id, t.staffMemberId))
    .leftJoin(branches, eq(branches.id, t.branchId))
    .where(where);

export async function listAssignmentsFor(db: Database, filter: AssignmentFilter) {
  return assignmentRows(db, assignmentWhere(filter)).orderBy(asc(academicBatches.code), asc(academicSubjects.code), desc(t.startDate));
}

/** Contract `academic.teaching_assignments` v1 for HR (internal route, caller ops): every row incl. pending and ended, one page. */
export async function teachingAssignmentsPage(db: Database, query: { staffId?: string; status?: AssignmentFilter['status']; q?: string; page: number; pageSize: number }): Promise<TeachingAssignmentsV1> {
  const where = assignmentWhere({ history: true, staffIds: query.staffId ? [query.staffId] : undefined, status: query.status, q: query.q });
  // Only the joins `where` can reference (courses and programmes are inner joins on NOT NULL FKs).
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(t)
    .leftJoin(academicBatches, eq(academicBatches.id, t.batchId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, t.subjectId))
    .innerJoin(staffMembers, eq(staffMembers.id, t.staffMemberId))
    .where(where);
  const rows = await assignmentRows(db, where)
    .orderBy(asc(staffMembers.fullName), asc(academicSubjects.name), desc(t.startDate), asc(t.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return teachingAssignmentsV1Schema.parse({
    contract: 'academic.teaching_assignments',
    version: 1,
    generatedAt: new Date().toISOString(),
    total: n,
    page: query.page,
    pageSize: query.pageSize,
    items: rows.map((a) => ({
      assignmentId: a.id,
      staffId: a.staffMemberId,
      teacherName: a.staffName,
      courseName: a.courseName,
      subjectName: a.subjectName,
      classLevel: a.programmeCode.startsWith('CLASS_') ? a.programmeName : null,
      batchCode: a.batchCode,
      batchId: a.batchId,
      subjectId: a.subjectId,
      academicYear: a.academicYear,
      branchName: a.branchName,
      startDate: a.startDate,
      endDate: a.endDate,
      role: a.role,
      status: a.status,
    })),
  });
}

export type AssignmentRow = Awaited<ReturnType<typeof listAssignmentsFor>>[number];

/** Teachers (own scope) get their own rows, read-only; coordinators everyone's. */
export async function listAssignments(db: Database, actor: Actor) {
  const scope = await resolveScope(db, actor, 'academic:assignments:read');
  if (scope.kind === 'own') return scope.staffId ? listAssignmentsFor(db, { staffIds: [scope.staffId] }) : [];
  return listAssignmentsFor(db, {});
}

/** Subjects and branches for the assignment form (all courses, draft syllabus courses included). */
export async function assignmentOptions(db: Database) {
  const subjects = await db
    .select({ id: academicSubjects.id, name: academicSubjects.name, courseId: academicCourses.id, courseCode: academicCourses.code, programmeName: programmes.name })
    .from(academicSubjects)
    .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
    .innerJoin(programmes, eq(programmes.id, academicCourses.programmeId))
    .orderBy(asc(academicCourses.code), asc(academicSubjects.sortOrder));
  const branchRows = await db.select({ id: branches.id, name: branches.name, status: branches.status }).from(branches).where(ne(branches.status, 'archived')).orderBy(asc(branches.name));
  return { subjects, branches: branchRows };
}

export async function createAssignment(db: Database, actor: Actor, input: z.input<typeof createAssignmentBody>) {
  return withTransaction(db, async (tx) => {
    const [subject] = await tx.select().from(academicSubjects).where(eq(academicSubjects.id, input.subjectId as never));
    if (!subject) throw new ValidationError('Subject not found.');
    const batch = input.batchId ? await usableBatchOrThrow(tx, input.batchId) : null;
    if (batch && subject.courseId !== batch.courseId) throw new ValidationError('The subject is not part of the batch’s course.');
    const staff = await activeStaffOrThrow(tx, input.staffMemberId);
    if (input.branchId) await branchOrThrow(tx, input.branchId);
    if (batch) await assertNoOverlap(tx, { batchId: batch.id, subjectId: subject.id, staffMemberId: staff.id, startDate: input.startDate ?? null, endDate: input.endDate ?? null });
    else await assertNoPending(tx, staff.id, subject.id);
    const [row] = await tx
      .insert(t)
      .values({
        batchId: batch?.id ?? null,
        subjectId: subject.id,
        courseId: subject.courseId,
        staffMemberId: staff.id,
        employmentType: input.employmentType ?? null,
        role: input.role ?? 'primary',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        academicYear: input.academicYear ?? null,
        branchId: (input.branchId as CoreBranchId | undefined) ?? null,
        status: !batch ? 'pending' : input.endDate ? 'ended' : 'active',
      })
      .returning();
    await audit(tx, actor, { action: batch ? 'assignment.created' : 'assignment.pending_recorded', entityType: 'teacher_assignment', entityId: row!.id, after: row });
    return row!;
  });
}

/**
 * Edit role, employment, start date, academic year or branch (null clears year/branch). A batch can
 * be set only on a pending assignment, which activates it. History is never rewritten: an ended
 * assignment is not edited, a started one keeps its role and start date, and moving a teacher to
 * another batch is end + create.
 */
export async function updateAssignment(db: Database, actor: Actor, assignmentId: string, input: z.output<typeof updateAssignmentBody>, now = new Date()) {
  return withTransaction(db, async (tx) => {
    const before = await assignmentForUpdate(tx, assignmentId);
    const today = todayIst(now);
    if (before.status === 'ended' && !(before.endDate && before.endDate >= today)) throw new ConflictError('This assignment has ended; its history is kept as it was.');
    const started = before.status !== 'pending' && (before.startDate === null || before.startDate < today);
    const rewritesHistory = (input.role !== undefined && input.role !== before.role) || (input.startDate !== undefined && input.startDate !== before.startDate);
    if (started && rewritesHistory) throw new ConflictError('This assignment has already started, so its role and start date are history. End it and record a new one.');
    const activating = input.batchId !== undefined;
    if (activating) {
      if (before.status !== 'pending') throw new ValidationError('Only a pending assignment takes a batch. To move a teacher, end this assignment and create a new one (history is kept).');
      await activeStaffOrThrow(tx, before.staffMemberId);
      const batch = await usableBatchOrThrow(tx, input.batchId!);
      if (batch.courseId !== before.courseId) throw new ValidationError('The batch does not run this assignment’s course.');
    }
    if (input.branchId) await branchOrThrow(tx, input.branchId);
    const next = {
      ...before,
      ...input,
      batchId: (input.batchId as BatchId | undefined) ?? before.batchId,
      branchId: input.branchId === undefined ? before.branchId : (input.branchId as CoreBranchId | null),
      status: activating ? (before.endDate ? ('ended' as const) : ('active' as const)) : before.status,
    };
    if (next.startDate && next.endDate && next.startDate > next.endDate) throw new ValidationError(`The start date cannot be after the end date (${next.endDate}).`);
    if (next.batchId) await assertNoOverlap(tx, { ...next, batchId: next.batchId }, before.id);
    const { id: _id, createdAt: _c, updatedAt: _u, ...set } = next;
    const [row] = await tx.update(t).set(set).where(eq(t.id, before.id)).returning();
    await audit(tx, actor, { action: activating ? 'assignment.activated' : 'assignment.updated', entityType: 'teacher_assignment', entityId: before.id, before, after: row });
    return row!;
  });
}

/**
 * End an assignment, or change a planned end that is today or later: store its last day and keep
 * the row as history. A stored end date always means status `ended`; current, upcoming or ended
 * is read from the dates. A past end cannot be rewritten. Past sessions are never touched.
 */
export async function endAssignment(db: Database, actor: Actor, assignmentId: string, input: z.output<typeof endAssignmentBody>, now = new Date()) {
  return withTransaction(db, async (tx) => {
    const before = await assignmentForUpdate(tx, assignmentId);
    if (before.status === 'pending') throw new ConflictError('A pending assignment has no batch to end. Withdraw it instead.');
    if (before.status !== 'active' && !(before.endDate && before.endDate >= todayIst(now))) throw new ConflictError('This assignment has already ended.');
    if (before.startDate && input.endDate < before.startDate) throw new ValidationError(`The end date cannot be before the start date (${before.startDate}).`);
    await assertNoOverlap(tx, { ...before, batchId: before.batchId!, endDate: input.endDate }, before.id);
    const [row] = await tx.update(t).set({ endDate: input.endDate, status: 'ended' }).where(eq(t.id, before.id)).returning();
    await audit(tx, actor, { action: 'assignment.ended', entityType: 'teacher_assignment', entityId: before.id, before, after: row });
    return row!;
  });
}

/** Withdraw a pending assignment (it never opened anything, so nothing is lost; the audit keeps the row). */
export async function withdrawAssignment(db: Database, actor: Actor, assignmentId: string, reason: string) {
  return withTransaction(db, async (tx) => {
    const before = await assignmentForUpdate(tx, assignmentId);
    if (before.status !== 'pending') throw new ConflictError('Only a pending assignment can be withdrawn. End an active one instead (history is kept).');
    await tx.delete(t).where(eq(t.id, before.id));
    await audit(tx, actor, { action: 'assignment.withdrawn', entityType: 'teacher_assignment', entityId: before.id, before, metadata: { reason } });
    return { id: before.id, withdrawn: true };
  });
}

async function assignmentForUpdate(tx: Database, id: string) {
  const [row] = await tx.select().from(t).where(eq(t.id, id as never)).for('update');
  if (!row) throw new NotFoundError('Assignment not found.');
  return row;
}

/** Refuse (409) another assignment of the same teacher, batch and subject whose dates overlap (open ends count; a dateless `ended` row is closed). */
async function assertNoOverlap(
  tx: Database,
  a: { batchId: BatchId; subjectId: string; staffMemberId: StaffMemberId; startDate: string | null; endDate: string | null },
  exceptId?: string,
) {
  const [clash] = await tx
    .select({ id: t.id, startDate: t.startDate, endDate: t.endDate })
    .from(t)
    .where(
      and(
        eq(t.batchId, a.batchId),
        eq(t.subjectId, a.subjectId as never),
        eq(t.staffMemberId, a.staffMemberId),
        exceptId ? ne(t.id, exceptId as never) : undefined,
        a.endDate ? or(isNull(t.startDate), lte(t.startDate, a.endDate)) : undefined,
        or(and(isNull(t.endDate), eq(t.status, 'active')), a.startDate ? gte(t.endDate, a.startDate) : isNotNull(t.endDate)),
      ),
    )
    .limit(1);
  if (clash) throw new ConflictError(`This teacher already has this subject in this batch from ${clash.startDate ?? 'the start'} to ${clash.endDate ?? 'open'}.`);
}

async function assertNoPending(tx: Database, staffId: StaffMemberId, subjectId: string) {
  const [dup] = await tx.select({ id: t.id }).from(t).where(and(eq(t.staffMemberId, staffId), eq(t.subjectId, subjectId as never), eq(t.status, 'pending'))).limit(1);
  if (dup) throw new ConflictError('This teacher already has a pending assignment for this subject. Set its batch instead.');
}

/** A batch that can still take a teacher (not completed or cancelled). */
async function usableBatchOrThrow(tx: Database, batchId: string) {
  const batch = await getBatchOrThrow(tx, batchId);
  if (batch.status === 'completed' || batch.status === 'cancelled') throw new ValidationError(`Batch ${batch.code} is ${batch.status}; it takes no new teacher.`);
  return batch;
}

async function branchOrThrow(db: Database, branchId: string) {
  const [row] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId as CoreBranchId));
  if (!row) throw new ValidationError('Branch not found.');
}

export async function activeStaffOrThrow(db: Database, staffId: string) {
  const [staff] = await db.select().from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!staff || staff.status === 'inactive') throw new ValidationError('The staff member does not exist or is inactive.');
  return staff;
}
