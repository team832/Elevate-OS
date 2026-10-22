/**
 * Batches, teacher assignments, rooms, calendars and capacity (ACD-002,
 * ACD-003, ACD-009, ACD-010).
 */
import { and, asc, desc, eq, exists, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import {
  academicBatches,
  academicCalendarExclusions,
  academicCalendarRules,
  academicCourses,
  academicPlanItems,
  academicRooms,
  academicSubjects,
  academicTeacherAssignments,
  programmes,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, CourseId, StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { computeCapacity, monthKey } from '../../domain';
import { assertBatchInScope, assignmentActiveOn, audit, getBatchOrThrow, resolveScope, todayIst, type Actor } from '../context';
import type {
  createAssignmentBody,
  createBatchBody,
  createCalendarRuleBody,
  createExclusionBody,
  createRoomBody,
  updateBatchBody,
} from '../schemas';
import type { endAssignmentBody } from '../schemas-placements';
import { currentPlanForBatch } from './curriculum';
import { placedCounts, seatReport } from './placements';

/** Class length for a batch: batch override → course; with the label it carries. */
export function classLengthOf(
  batch: { classMinutesOverride: number | null },
  course: { classMinutes: number | null; classMinutesStatus: string },
): { minutes: number | null; status: string; source: 'batch' | 'course' | 'unknown' } {
  if (batch.classMinutesOverride !== null) return { minutes: batch.classMinutesOverride, status: 'approved', source: 'batch' };
  if (course.classMinutes !== null) return { minutes: course.classMinutes, status: course.classMinutesStatus, source: 'course' };
  return { minutes: null, status: 'unknown', source: 'unknown' };
}

export async function listBatches(db: Database, actor: Actor) {
  const scope = await resolveScope(db, actor, 'academic:batches:read');
  if (scope.kind === 'own' && scope.batchIds.length === 0) return [];
  const rows = await db
    .select({ batch: academicBatches, course: academicCourses, programmeCode: programmes.code })
    .from(academicBatches)
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId))
    .innerJoin(programmes, eq(programmes.id, academicBatches.programmeId))
    .where(scope.kind === 'own' ? inArray(academicBatches.id, scope.batchIds) : undefined)
    .orderBy(asc(academicBatches.code));
  const placed = await placedCounts(db);
  return rows.map(({ batch, course, programmeCode }) => ({
    ...batch,
    courseCode: course.code,
    courseName: course.name,
    programmeCode,
    classLength: classLengthOf(batch, course),
    activeEnrolments: placed.get(batch.id) ?? 0,
  }));
}

export async function createBatch(db: Database, actor: Actor, input: z.output<typeof createBatchBody>) {
  return withTransaction(db, async (tx) => {
    const [course] = await tx.select().from(academicCourses).where(eq(academicCourses.id, input.courseId as CourseId));
    if (!course) throw new ValidationError('Course not found.');
    const [row] = await tx
      .insert(academicBatches)
      .values({
        code: input.code,
        name: input.name,
        courseId: course.id,
        programmeId: course.programmeId,
        route: input.route ?? null,
        mode: input.mode ?? course.mode,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        classMinutesOverride: input.classMinutesOverride ?? null,
        capacity: input.capacity ?? null,
        targetExam: input.targetExam ?? null,
        targetExamDate: input.targetExamDate ?? null,
        targetExamDateStatus: input.targetExamDateStatus ?? null,
        status: input.status,
      })
      .returning();
    await audit(tx, actor, { action: 'batch.created', entityType: 'batch', entityId: row!.id, after: row });
    return row!;
  });
}

export async function updateBatch(db: Database, actor: Actor, batchId: string, input: z.output<typeof updateBatchBody>) {
  return withTransaction(db, async (tx) => {
    const before = await getBatchOrThrow(tx, batchId);
    if (input.coordinatorStaffId) await activeStaffOrThrow(tx, input.coordinatorStaffId);
    // Completing a batch never completes its students: each placement is ended one by one (brief section 7).
    const [row] = await tx.update(academicBatches).set({ ...input, coordinatorStaffId: input.coordinatorStaffId as StaffMemberId | null | undefined }).where(eq(academicBatches.id, before.id)).returning();
    await audit(tx, actor, { action: 'batch.updated', entityType: 'batch', entityId: before.id, before, after: row });
    return row!;
  });
}

export async function getBatch(db: Database, actor: Actor, batchId: string) {
  const scope = await resolveScope(db, actor, 'academic:batches:read');
  assertBatchInScope(scope, batchId);
  const batch = await getBatchOrThrow(db, batchId);
  const [course] = await db.select().from(academicCourses).where(eq(academicCourses.id, batch.courseId));
  const [programme] = await db.select().from(programmes).where(eq(programmes.id, batch.programmeId));
  const assignments = await listAssignmentsFor(db, { batchId: batch.id, history: true });
  const rules = await db.select().from(academicCalendarRules).where(eq(academicCalendarRules.batchId, batch.id)).orderBy(asc(academicCalendarRules.periodStart));
  const exclusions = await db
    .select()
    .from(academicCalendarExclusions)
    .where(or(eq(academicCalendarExclusions.batchId, batch.id), isNull(academicCalendarExclusions.batchId)))
    .orderBy(asc(academicCalendarExclusions.date), asc(academicCalendarExclusions.periodStart));
  const plan = await currentPlanForBatch(db, batch);
  return {
    ...batch,
    courseCode: course!.code,
    courseName: course!.name,
    programmeCode: programme!.code,
    classLength: classLengthOf(batch, course!),
    /** Students placed in the batch today (open placements, R13). */
    activeEnrolments: (await placedCounts(db, todayIst(), batch.id)).get(batch.id) ?? 0,
    seats: await seatReport(db, batch),
    currentPlan: plan ? { id: plan.id, code: plan.code, status: plan.status, countsStatus: plan.countsStatus, datesStatus: plan.datesStatus } : null,
    assignments,
    calendarRules: rules,
    exclusions,
  };
}

// --- teacher assignments ----------------------------------------------------------------------

/** Assignments current today by their dates, or with `history` every row (newest start first). */
async function listAssignmentsFor(db: Database, filter: { batchId?: string; staffId?: string | null; history?: boolean }) {
  const conditions = filter.history ? [] : [assignmentActiveOn(todayIst())!];
  if (filter.batchId) conditions.push(eq(academicTeacherAssignments.batchId, filter.batchId as BatchId));
  if (filter.staffId) conditions.push(eq(academicTeacherAssignments.staffMemberId, filter.staffId as StaffMemberId));
  return db
    .select({
      id: academicTeacherAssignments.id,
      batchId: academicTeacherAssignments.batchId,
      batchCode: academicBatches.code,
      subjectId: academicTeacherAssignments.subjectId,
      subjectCode: academicSubjects.code,
      subjectName: academicSubjects.name,
      staffMemberId: academicTeacherAssignments.staffMemberId,
      staffName: staffMembers.fullName,
      employmentType: academicTeacherAssignments.employmentType,
      role: academicTeacherAssignments.role,
      startDate: academicTeacherAssignments.startDate,
      endDate: academicTeacherAssignments.endDate,
      status: academicTeacherAssignments.status,
    })
    .from(academicTeacherAssignments)
    .innerJoin(academicBatches, eq(academicBatches.id, academicTeacherAssignments.batchId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicTeacherAssignments.subjectId))
    .innerJoin(staffMembers, eq(staffMembers.id, academicTeacherAssignments.staffMemberId))
    .where(and(...conditions))
    .orderBy(asc(academicBatches.code), asc(academicSubjects.code), desc(academicTeacherAssignments.startDate));
}

export async function listAssignments(db: Database, actor: Actor) {
  const scope = await resolveScope(db, actor, 'academic:assignments:read');
  if (scope.kind === 'own') return scope.staffId ? listAssignmentsFor(db, { staffId: scope.staffId }) : [];
  return listAssignmentsFor(db, {});
}

export async function createAssignment(db: Database, actor: Actor, input: z.input<typeof createAssignmentBody>) {
  return withTransaction(db, async (tx) => {
    const batch = await getBatchOrThrow(tx, input.batchId);
    const [subject] = await tx.select().from(academicSubjects).where(eq(academicSubjects.id, input.subjectId as never));
    if (!subject || subject.courseId !== batch.courseId) throw new ValidationError('The subject is not part of the batch’s course.');
    const staff = await activeStaffOrThrow(tx, input.staffMemberId);
    await assertNoOverlap(tx, { batchId: batch.id, subjectId: subject.id, staffMemberId: staff.id, startDate: input.startDate ?? null, endDate: input.endDate ?? null });
    const [row] = await tx
      .insert(academicTeacherAssignments)
      .values({ batchId: batch.id, subjectId: subject.id, staffMemberId: staff.id, employmentType: input.employmentType ?? null, role: input.role ?? 'primary', startDate: input.startDate ?? null, endDate: input.endDate ?? null, status: input.endDate ? 'ended' : 'active' })
      .returning();
    await audit(tx, actor, { action: 'assignment.created', entityType: 'teacher_assignment', entityId: row!.id, after: row });
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
    const [before] = await tx.select().from(academicTeacherAssignments).where(eq(academicTeacherAssignments.id, assignmentId as never)).for('update');
    if (!before) throw new NotFoundError('Assignment not found.');
    if (before.status !== 'active' && !(before.endDate && before.endDate >= todayIst(now))) throw new ConflictError('This assignment has already ended.');
    if (before.startDate && input.endDate < before.startDate) throw new ValidationError(`The end date cannot be before the start date (${before.startDate}).`);
    await assertNoOverlap(tx, { ...before, endDate: input.endDate }, before.id);
    const [row] = await tx
      .update(academicTeacherAssignments)
      .set({ endDate: input.endDate, status: 'ended' })
      .where(eq(academicTeacherAssignments.id, before.id))
      .returning();
    await audit(tx, actor, { action: 'assignment.ended', entityType: 'teacher_assignment', entityId: before.id, before, after: row });
    return row!;
  });
}

/** Refuse (409) another assignment of the same teacher, batch and subject whose dates overlap (open ends count; a dateless `ended` row is closed). */
async function assertNoOverlap(
  tx: Database,
  a: { batchId: BatchId; subjectId: string; staffMemberId: StaffMemberId; startDate: string | null; endDate: string | null },
  exceptId?: string,
) {
  const t = academicTeacherAssignments;
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

async function activeStaffOrThrow(db: Database, staffId: string) {
  const [staff] = await db.select().from(staffMembers).where(eq(staffMembers.id, staffId as StaffMemberId));
  if (!staff || staff.status === 'inactive') throw new ValidationError('The staff member does not exist or is inactive.');
  return staff;
}

/** Active core staff for pickers (read-only use of the core table). */
/** `teachingOnly`: staff with any teaching assignment, past or current (teacher pickers). */
export async function listStaff(db: Database, { teachingOnly = false } = {}) {
  const teaches = exists(db.select({ id: academicTeacherAssignments.id }).from(academicTeacherAssignments).where(eq(academicTeacherAssignments.staffMemberId, staffMembers.id)));
  return db
    .select({ id: staffMembers.id, fullName: staffMembers.fullName, title: staffMembers.title, userId: staffMembers.userId })
    .from(staffMembers)
    .where(and(inArray(staffMembers.status, ['active', 'on_leave']), teachingOnly ? teaches : undefined))
    .orderBy(asc(staffMembers.fullName));
}

// --- rooms, exclusions, calendar rules -----------------------------------------------------------

export async function listRooms(db: Database) {
  return db.select().from(academicRooms).orderBy(asc(academicRooms.code));
}

export async function createRoom(db: Database, actor: Actor, input: z.output<typeof createRoomBody>) {
  return withTransaction(db, async (tx) => {
    const [row] = await tx.insert(academicRooms).values({ code: input.code, name: input.name, capacity: input.capacity ?? null }).returning();
    await audit(tx, actor, { action: 'room.created', entityType: 'room', entityId: row!.id, after: row });
    return row!;
  });
}

export async function listExclusions(db: Database, batchId?: string) {
  return db
    .select()
    .from(academicCalendarExclusions)
    .where(batchId ? or(eq(academicCalendarExclusions.batchId, batchId as BatchId), isNull(academicCalendarExclusions.batchId)) : undefined)
    .orderBy(asc(academicCalendarExclusions.date), asc(academicCalendarExclusions.periodStart));
}

export async function createExclusion(db: Database, actor: Actor, input: z.output<typeof createExclusionBody>) {
  return withTransaction(db, async (tx) => {
    if (input.batchId) await getBatchOrThrow(tx, input.batchId);
    const [row] = await tx
      .insert(academicCalendarExclusions)
      .values({
        batchId: (input.batchId as BatchId | undefined) ?? null,
        kind: input.kind,
        label: input.label,
        date: input.date ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        days: input.date ? null : (input.days ?? null),
        slotsPerDay: input.date ? null : (input.slotsPerDay ?? null),
        status: input.status,
      })
      .returning();
    await audit(tx, actor, { action: 'calendar_exclusion.created', entityType: 'calendar_exclusion', entityId: row!.id, after: row });
    return row!;
  });
}

export async function createCalendarRule(db: Database, actor: Actor, input: z.output<typeof createCalendarRuleBody>) {
  return withTransaction(db, async (tx) => {
    const batch = await getBatchOrThrow(tx, input.batchId);
    const [row] = await tx
      .insert(academicCalendarRules)
      .values({ batchId: batch.id, label: input.label, periodStart: input.periodStart, periodEnd: input.periodEnd, weekdays: [...new Set(input.weekdays)].sort(), slotsPerDay: input.slotsPerDay, kind: input.kind, status: input.status })
      .returning();
    await audit(tx, actor, { action: 'calendar_rule.created', entityType: 'calendar_rule', entityId: row!.id, after: row });
    return row!;
  });
}

// --- capacity feasibility ------------------------------------------------------------------------------

/**
 * Capacity of a batch's calendar against the classes its current plan needs.
 * Window: the query, else the span of the batch's calendar rules. Exam blackouts
 * do not remove teaching slots and are ignored here.
 */
export async function getBatchFeasibility(db: Database, actor: Actor, batchId: string, window: { from?: string; to?: string }) {
  const scope = await resolveScope(db, actor, 'academic:timetable:read');
  assertBatchInScope(scope, batchId);
  const batch = await getBatchOrThrow(db, batchId);
  const rules = await db.select().from(academicCalendarRules).where(eq(academicCalendarRules.batchId, batch.id));
  const exclusions = (await listExclusions(db, batch.id)).filter((x) => x.kind !== 'exam_blackout');
  const plan = await currentPlanForBatch(db, batch);
  const items = plan ? await db.select().from(academicPlanItems).where(eq(academicPlanItems.planId, plan.id)) : [];
  const from = window.from ?? rules.map((r) => r.periodStart).sort()[0] ?? batch.startDate;
  const to = window.to ?? rules.map((r) => r.periodEnd).sort().at(-1) ?? batch.endDate;
  if (!from || !to) {
    return {
      batch: { id: batch.id, code: batch.code },
      plan: null,
      result: null,
      message: 'No calendar rules and no batch dates: add calendar rules before checking capacity.',
    };
  }
  const plannedByMonth: Record<string, number> = {};
  for (const i of items) {
    if (i.plannedDate && i.plannedDate >= from && i.plannedDate <= to) {
      plannedByMonth[monthKey(i.plannedDate)] = (plannedByMonth[monthKey(i.plannedDate)] ?? 0) + i.plannedClasses;
    }
  }
  const result = computeCapacity({
    window: { from, to },
    rules: rules.map((r) => ({ label: r.label, periodStart: r.periodStart, periodEnd: r.periodEnd, weekdays: r.weekdays, slotsPerDay: r.slotsPerDay, kind: r.kind })),
    exclusions: exclusions.map((x) => ({ label: x.label, kind: x.kind, date: x.date, periodStart: x.periodStart, periodEnd: x.periodEnd, days: x.days, slotsPerDay: x.slotsPerDay })),
    requiredClasses: plan ? items.reduce((a, i) => a + i.plannedClasses, 0) : null,
    plannedByMonth: Object.keys(plannedByMonth).length > 0 ? plannedByMonth : undefined,
  });
  return {
    batch: { id: batch.id, code: batch.code },
    plan: plan ? { id: plan.id, code: plan.code, status: plan.status, countsStatus: plan.countsStatus, datesStatus: plan.datesStatus } : null,
    window: { from, to },
    ruleStatuses: [...new Set(rules.map((r) => r.status))],
    exclusionStatuses: [...new Set(exclusions.map((x) => x.status))],
    result,
  };
}

export async function getCourseOrThrow(db: Database, courseId: string) {
  const [course] = await db.select().from(academicCourses).where(eq(academicCourses.id, courseId as CourseId));
  if (!course) throw new NotFoundError('Course not found.');
  return course;
}
