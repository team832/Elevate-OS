/**
 * Shared server helpers: the acting user, record-level scope (`own` for
 * teachers), and audit. Every service takes an `Actor` so permission scope is
 * enforced in the query, not in the UI.
 *
 * TEACHER SCOPE (`own`), resolved from core.staff_members.user_id:
 * - sessions / class records / attendance: sessions whose teacher is the user's staff record;
 * - batches / assessments: batches with a teaching assignment ACTIVE ON THE DATE in question
 *   (default today): start date ≤ date ≤ end date, open ends allowed; an `ended` row without an
 *   end date counts as ended. Past sessions and authorship are not affected (sessions are scoped
 *   by their teacher).
 * - students / progress: students placed (from on or before the date) in a batch where that
 *   staff member's assignment window is open on the date, with overlapping dates.
 * A user with no staff record has an empty scope (sees nothing), never "all".
 * A `pending` assignment (no batch yet, R9) and a subject capability grant nothing.
 */
import { and, eq, gte, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import { scopeFor, type GrantScope, type Permission } from '@elevate/authorization';
import {
  academicBatchPlacements,
  academicBatches,
  academicEnrolments,
  academicTeacherAssignments,
  staffMembers,
  type Database,
} from '@elevate/database';
import { recordAudit } from '@elevate/server-kit';
import { ForbiddenError, NotFoundError } from '@elevate/shared-contracts';
import type { BatchId, StaffMemberId, StudentId } from '@elevate/shared-types';

export interface Actor {
  user: AuthenticatedUser;
  requestId?: string | null;
}

export type Scope =
  | { kind: 'all' }
  | { kind: 'own'; staffId: StaffMemberId | null; batchIds: BatchId[] };

export async function staffIdForUser(db: Database, userId: string): Promise<StaffMemberId | null> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId as AuthenticatedUser['id']))
    .limit(1);
  return row?.id ?? null;
}

const ta = academicTeacherAssignments;
/** The end of an assignment window: its end date, else open while `active` (an `ended` row without a date is closed). */
const assignmentOpenOrEndsOnOrAfter = (day: string | typeof academicBatchPlacements.startDate) =>
  or(and(isNull(ta.endDate), eq(ta.status, 'active')), gte(ta.endDate, day));

/** SQL: the assignment window is open on `day` (start ≤ day ≤ end; open ends allowed); pending rows never count. */
export const assignmentActiveOn = (day: string) => and(ne(ta.status, 'pending'), isNotNull(ta.batchId), or(isNull(ta.startDate), lte(ta.startDate, day)), assignmentOpenOrEndsOnOrAfter(day));

/** Batches where the staff member has an assignment active on `day` (YYYY-MM-DD, default today IST). */
export async function assignedBatchIds(db: Database, staffId: StaffMemberId, day: string = todayIst()): Promise<BatchId[]> {
  const rows = await db
    .selectDistinct({ batchId: ta.batchId })
    .from(ta)
    .where(and(eq(ta.staffMemberId, staffId), assignmentActiveOn(day)));
  return rows.map((r) => r.batchId!); // assignmentActiveOn excludes rows without a batch
}

/** Resolve the actor's scope for a permission (own scope: assignments active on `day`); throws FORBIDDEN when it is not held. */
export async function resolveScope(db: Database, actor: Actor, permission: Permission, day?: string): Promise<Scope> {
  const scope: GrantScope | null = scopeFor(actor.user, permission);
  if (scope === null) throw new ForbiddenError('You do not have permission to do this.', { details: { permission } });
  if (scope === 'all') return { kind: 'all' };
  const staffId = await staffIdForUser(db, actor.user.id);
  return { kind: 'own', staffId, batchIds: staffId ? await assignedBatchIds(db, staffId, day) : [] };
}

/** Throw NOT_FOUND (not FORBIDDEN — do not leak existence) unless the batch is in scope. */
export function assertBatchInScope(scope: Scope, batchId: string): void {
  if (scope.kind === 'own' && !scope.batchIds.includes(batchId as BatchId)) {
    throw new NotFoundError('Batch not found.');
  }
}

/** Throw NOT_FOUND unless the session is taught by the actor (own scope). */
export function assertSessionInScope(scope: Scope, session: { teacherStaffId: string | null }): void {
  if (scope.kind === 'own' && (!scope.staffId || session.teacherStaffId !== scope.staffId)) {
    throw new NotFoundError('Session not found.');
  }
}

/**
 * Student ids visible under an own scope: on `day` the teacher has an assignment window open in
 * the batch, and the student's placement there overlaps that window and has started. A closed
 * window shows nothing (past sessions stay visible through the session teacher, not this list).
 */
export async function studentIdsInScope(db: Database, scope: Scope, day: string = todayIst()): Promise<StudentId[] | null> {
  if (scope.kind === 'all') return null;
  if (!scope.staffId) return [];
  const p = academicBatchPlacements;
  const rows = await db
    .selectDistinct({ studentId: academicEnrolments.studentId })
    .from(p)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .innerJoin(ta, eq(ta.batchId, p.batchId))
    .where(
      and(
        eq(ta.staffMemberId, scope.staffId),
        lte(p.startDate, day),
        assignmentActiveOn(day),
        or(isNull(ta.startDate), isNull(p.endDate), gte(p.endDate, ta.startDate)),
        assignmentOpenOrEndsOnOrAfter(p.startDate),
      ),
    );
  return rows.map((r) => r.studentId);
}

export async function assertStudentInScope(db: Database, scope: Scope, studentId: string): Promise<void> {
  const ids = await studentIdsInScope(db, scope);
  if (ids && !ids.includes(studentId as StudentId)) throw new NotFoundError('Student not found.');
}

export async function getBatchOrThrow(db: Database, batchId: string) {
  const [batch] = await db
    .select()
    .from(academicBatches)
    .where(eq(academicBatches.id, batchId as BatchId))
    .limit(1);
  if (!batch) throw new NotFoundError('Batch not found.');
  return batch;
}

/** Audit a business-state change in the current transaction (module `academic`). */
export function audit(
  tx: Database,
  actor: Actor | null,
  input: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> },
) {
  return recordAudit(tx, {
    actorType: actor ? 'user' : 'system',
    actorUserId: actor?.user.id ?? null,
    module: 'academic',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    requestId: actor?.requestId ?? null,
    metadata: input.metadata,
  });
}

/** Today's calendar date in Asia/Kolkata (overridable in tests through `now`). */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
