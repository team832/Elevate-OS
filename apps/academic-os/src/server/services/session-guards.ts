/** Session guards shared by the teaching log, attendance and delivery (ACD-007, ACD-014). */
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { academicClassSessions, academicSessionTeachers, type AcademicSessionId, type Database } from '@elevate/database';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { Scope } from '../context';

export async function lockSession(tx: Database, sessionId: string) {
  const [session] = await tx.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId)).for('update');
  if (!session) throw new NotFoundError('Session not found.');
  return session;
}

export function assertLoggable(session: { status: string; date: string }, today: string) {
  if (session.status === 'cancelled' || session.status === 'rescheduled') {
    throw new InvalidStateTransitionError(`The session was ${session.status}; record the replacement session instead.`);
  }
  if (session.date > today) throw new ValidationError('A session cannot be logged before it happens.');
}

/** Sessions a staff member teaches: the planned teacher OR an active session_teachers row (co-teacher, substitute, actual). */
export function taughtBy(db: Database, staffId: StaffMemberId): SQL {
  return or(
    eq(academicClassSessions.teacherStaffId, staffId),
    inArray(
      academicClassSessions.id,
      db.select({ id: academicSessionTeachers.sessionId }).from(academicSessionTeachers).where(and(eq(academicSessionTeachers.staffId, staffId), isNull(academicSessionTeachers.removedAt))),
    ),
  )!;
}

/** Throw NOT_FOUND (never leak existence) unless an own-scope actor teaches the session. */
export async function assertSessionAccess(db: Database, scope: Scope, session: { id: string; teacherStaffId: string | null }): Promise<void> {
  if (scope.kind === 'all') return;
  if (scope.staffId && session.teacherStaffId === scope.staffId) return;
  if (scope.staffId) {
    const [row] = await db
      .select({ id: academicSessionTeachers.id })
      .from(academicSessionTeachers)
      .where(and(eq(academicSessionTeachers.sessionId, session.id as AcademicSessionId), eq(academicSessionTeachers.staffId, scope.staffId), isNull(academicSessionTeachers.removedAt)))
      .limit(1);
    if (row) return;
  }
  throw new NotFoundError('Session not found.');
}
