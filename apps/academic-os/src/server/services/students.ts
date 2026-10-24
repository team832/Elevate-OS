/**
 * Students and enrolments (ACD-019). Contact details (student email/phone, date of birth and
 * every guardian field) are returned only to holders of academic:students:write (the
 * coordinator) — PLT-014 minimisation. Teachers see students of their batches only.
 */
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  academicBatches,
  academicCourses,
  academicEnrolments,
  academicStudents,
  programmes,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assertStudentInScope, audit, resolveScope, studentIdsInScope, todayIst, type Actor, type Scope } from '../context';
import type { createStudentBody, manualEnrolmentBody } from '../schemas';
import { lockOpenBatch, placementHistory, startPlacement, withReasons } from './placements';

type StudentRow = typeof academicStudents.$inferSelect;

/** Student codes are `STU-` + 8 hex characters of a fresh UUID (unique index; never reused). */
export function newStudentCode(): string {
  return `STU-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Brief §5 allow-lists for teachers (own scope): no contact, guardian, Ops reference, city, school board or manual reason. */
const STUDENT_FIELDS = ['id', 'code', 'fullName', 'preferredName', 'currentStage', 'status', 'isSample'] as const;
const ENROLMENT_FIELDS = ['id', 'programmeId', 'courseId', 'batchId', 'status', 'startDate', 'academicYear', 'lateJoiner', 'source'] as const;
const pick = <T, K extends keyof T>(row: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, row[k]])) as Pick<T, K>;

/** full = academic:students:write; teacher = own scope (allow-lists); hidden = other read-only roles (director, auditor): the record with contacts nulled (PLT-014). */
type View = 'full' | 'teacher' | 'hidden';
const viewFor = (actor: Actor, scope: Scope): View => (can(actor.user, 'academic:students:write') ? 'full' : scope.kind === 'own' ? 'teacher' : 'hidden');

export function presentStudent(row: StudentRow, view: View) {
  if (view === 'full') return { ...row, contactsHidden: false as const };
  if (view === 'teacher') return { ...pick(row, STUDENT_FIELDS), contactsHidden: true as const };
  return { ...row, dateOfBirth: null, email: null, phone: null, guardianName: null, guardianRelationship: null, guardianEmail: null, guardianPhone: null, contactsHidden: true as const };
}

export async function listStudents(db: Database, actor: Actor, filter: { batchId?: string; q?: string } = {}) {
  const scope = await resolveScope(db, actor, 'academic:students:read');
  const visible = await studentIdsInScope(db, scope);
  if (visible && visible.length === 0) return [];
  const conditions = [];
  if (visible) conditions.push(inArray(academicStudents.id, visible));
  if (filter.q) conditions.push(or(ilike(academicStudents.fullName, `%${filter.q}%`), ilike(academicStudents.code, `%${filter.q}%`)));
  if (filter.batchId) {
    const ids = await db
      .select({ id: academicEnrolments.studentId })
      .from(academicEnrolments)
      .where(and(eq(academicEnrolments.batchId, filter.batchId as BatchId), eq(academicEnrolments.status, 'active')));
    if (ids.length === 0) return [];
    conditions.push(inArray(academicStudents.id, ids.map((i) => i.id)));
  }
  const rows = await db.select().from(academicStudents).where(conditions.length ? and(...conditions) : undefined).orderBy(asc(academicStudents.fullName)).limit(500);
  const enrolments = rows.length
    ? await db
        .select({ studentId: academicEnrolments.studentId, batchCode: academicBatches.code, status: academicEnrolments.status })
        .from(academicEnrolments)
        .leftJoin(academicBatches, eq(academicBatches.id, academicEnrolments.batchId))
        .where(inArray(academicEnrolments.studentId, rows.map((r) => r.id)))
    : [];
  const view = viewFor(actor, scope);
  return rows.map((r) => ({
    ...presentStudent(r, view),
    batches: enrolments.filter((e) => e.studentId === r.id && e.status === 'active').map((e) => e.batchCode ?? '(awaiting batch)'),
  }));
}

export async function getStudentRecord(db: Database, actor: Actor, studentId: string) {
  const scope = await resolveScope(db, actor, 'academic:students:read');
  await assertStudentInScope(db, scope, studentId);
  const [row] = await db.select().from(academicStudents).where(eq(academicStudents.id, studentId as StudentId));
  if (!row) throw new NotFoundError('Student not found.');
  const enrolments = await db
    .select({ enrolment: academicEnrolments, batchCode: academicBatches.code, courseCode: academicCourses.code, programmeCode: programmes.code })
    .from(academicEnrolments)
    .innerJoin(programmes, eq(programmes.id, academicEnrolments.programmeId))
    .leftJoin(academicBatches, eq(academicBatches.id, academicEnrolments.batchId))
    .leftJoin(academicCourses, eq(academicCourses.id, academicEnrolments.courseId))
    .where(eq(academicEnrolments.studentId, row.id));
  const visibleBatches = scope.kind === 'own' ? new Set<string>(scope.batchIds) : null;
  const placements = withReasons(actor, (await placementHistory(db, { studentId: row.id })).filter((p) => !visibleBatches || visibleBatches.has(p.batchId)));
  const view = viewFor(actor, scope);
  return {
    placements,
    student: presentStudent(row, view),
    enrolments: enrolments
      .filter((e) => !visibleBatches || (e.enrolment.batchId && visibleBatches.has(e.enrolment.batchId)))
      .map((e) => ({ ...(view === 'teacher' ? pick(e.enrolment, ENROLMENT_FIELDS) : e.enrolment), batchCode: e.batchCode, courseCode: e.courseCode, programmeCode: e.programmeCode })),
  };
}

export async function createStudent(db: Database, actor: Actor, input: z.output<typeof createStudentBody>) {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(academicStudents)
      .values({
        code: newStudentCode(),
        fullName: input.fullName,
        preferredName: input.preferredName ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        currentStage: input.currentStage ?? null,
        schoolBoard: input.schoolBoard ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        guardianName: input.guardianName ?? null,
        guardianRelationship: input.guardianRelationship ?? null,
        guardianEmail: input.guardianEmail ?? null,
        guardianPhone: input.guardianPhone ?? null,
      })
      .returning();
    await audit(tx, actor, { action: 'student.created', entityType: 'student', entityId: row!.id, after: { id: row!.id, code: row!.code } });
    return presentStudent(row!, 'full');
  });
}

/**
 * The ONLY path besides the admission intake that creates an active enrolment: a coordinator
 * (academic:enrolments:decide) enrols by hand for a legacy/outside case, with a reason. It is
 * labelled `source: manual`, audited, and placed in the batch (seat and clash checked).
 */
export async function enrolManually(db: Database, actor: Actor, input: z.output<typeof manualEnrolmentBody>, now = new Date()) {
  return withTransaction(db, async (tx) => {
    const [student] = await tx.select().from(academicStudents).where(eq(academicStudents.id, input.studentId as StudentId));
    if (!student) throw new ValidationError('Student not found.');
    const batch = await lockOpenBatch(tx, input.batchId);
    const startDate = input.startDate ?? todayIst(now);
    const [row] = await tx
      .insert(academicEnrolments)
      .values({
        studentId: student.id,
        programmeId: batch.programmeId,
        courseId: batch.courseId,
        batchId: batch.id,
        startDate,
        lateJoiner: Boolean(batch.startDate && startDate > batch.startDate),
        source: 'manual',
        manualReason: input.reason,
        createdByUserId: actor.user.id,
      })
      .returning();
    await audit(tx, actor, { action: 'enrolment.created', entityType: 'enrolment', entityId: row!.id, after: row, metadata: { source: 'manual', reason: input.reason } });
    await startPlacement(tx, actor, { enrolment: row!, batch, startDate, reason: input.reason, placedByUserId: actor.user.id, checkClash: true, action: 'placement.started' });
    return row!;
  });
}

export async function listEnrolments(db: Database, filter: { batchId?: string } = {}) {
  return db
    .select({ enrolment: academicEnrolments, studentCode: academicStudents.code, studentName: academicStudents.fullName, batchCode: academicBatches.code })
    .from(academicEnrolments)
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .leftJoin(academicBatches, eq(academicBatches.id, academicEnrolments.batchId))
    .where(filter.batchId ? eq(academicEnrolments.batchId, filter.batchId as BatchId) : undefined)
    .orderBy(asc(academicStudents.fullName))
    .limit(1000);
}
