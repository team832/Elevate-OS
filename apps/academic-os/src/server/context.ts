/**
 * Shared server helpers: the acting user, record-level scope (`own` for
 * teachers), and audit. Every service takes an `Actor` so permission scope is
 * enforced in the query, not in the UI.
 *
 * TEACHER SCOPE (`own`), resolved from core.staff_members.user_id:
 * - sessions / class records / attendance: sessions whose teacher is the user's staff record;
 * - batches / assessments: batches with an ACTIVE teaching assignment for that staff record;
 * - students / progress: students with an active enrolment in those batches.
 * A user with no staff record has an empty scope (sees nothing), never "all".
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import { scopeFor, type GrantScope, type Permission } from '@elevate/authorization';
import {
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

export async function assignedBatchIds(db: Database, staffId: StaffMemberId): Promise<BatchId[]> {
  const rows = await db
    .selectDistinct({ batchId: academicTeacherAssignments.batchId })
    .from(academicTeacherAssignments)
    .where(
      and(
        eq(academicTeacherAssignments.staffMemberId, staffId),
        eq(academicTeacherAssignments.status, 'active'),
      ),
    );
  return rows.map((r) => r.batchId);
}

/** Resolve the actor's scope for a permission; throws FORBIDDEN when it is not held. */
export async function resolveScope(db: Database, actor: Actor, permission: Permission): Promise<Scope> {
  const scope: GrantScope | null = scopeFor(actor.user, permission);
  if (scope === null) throw new ForbiddenError('You do not have permission to do this.', { details: { permission } });
  if (scope === 'all') return { kind: 'all' };
  const staffId = await staffIdForUser(db, actor.user.id);
  return { kind: 'own', staffId, batchIds: staffId ? await assignedBatchIds(db, staffId) : [] };
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

/** Student ids visible under an own scope (active enrolment in an assigned batch). */
export async function studentIdsInScope(db: Database, scope: Scope): Promise<StudentId[] | null> {
  if (scope.kind === 'all') return null;
  if (scope.batchIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ studentId: academicEnrolments.studentId })
    .from(academicEnrolments)
    .where(
      and(inArray(academicEnrolments.batchId, scope.batchIds), eq(academicEnrolments.status, 'active')),
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
