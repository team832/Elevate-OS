/**
 * Demo students on an Academic class roster (R5, owner answer 3). The coordinator or the
 * session's teacher picks from Business Ops' demo sessions for that day (internal route
 * `GET /ops/api/internal/v1/demo-sessions?date=`); the day number, name and canonical student
 * come from the Ops item. Marks are recorded with the roster (attendance.ts) and read back by
 * Ops through `GET /academic/api/internal/v1/demo-attendance?ids=` — no copy, no entitlement.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicClassSessions,
  academicSessionDemoAttendees,
  academicSessionTeachers,
  staffMembers,
  type AcademicDemoAttendeeId,
  type Database,
} from '@elevate/database';
import { fetchInternal, withTransaction } from '@elevate/server-kit';
import { ConflictError, NotFoundError, ValidationError, academicDemoAttendanceV1Schema, opsDemoSessionsForDayV1Schema, type AcademicDemoAttendanceV1, type OpsDemoSessionsForDayV1, type SourceResult } from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { audit, resolveScope, type Actor } from '../context';
import { demoAttendeesOf } from './attendance';
import { assertSessionAccess, lockSession } from './session-guards';

export type DemoLoader = (date: string) => Promise<SourceResult<OpsDemoSessionsForDayV1>>;

/** Ops demo sessions on a day; "unavailable" (never empty) when Business Ops cannot be reached. */
export const loadOpsDemoSessions: DemoLoader = (date) => {
  const origin = (process.env.BUSINESS_OPS_OS_URL ?? process.env.PLATFORM_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return fetchInternal(`${origin}/ops/api/internal/v1/demo-sessions?date=${encodeURIComponent(date)}`, opsDemoSessionsForDayV1Schema, { caller: 'academic', timeoutMs: 3000 });
};

async function sessionFor(db: Database, actor: Actor, sessionId: string) {
  const scope = await resolveScope(db, actor, 'academic:attendance:record');
  const [session] = await db.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as never));
  if (!session) throw new NotFoundError('Session not found.');
  await assertSessionAccess(db, scope, session);
  return { scope, session };
}

/** Demo students Ops has on the session's date that are not yet on this roster. */
export async function demoCandidates(db: Database, actor: Actor, sessionId: string, load: DemoLoader = loadOpsDemoSessions) {
  const { session } = await sessionFor(db, actor, sessionId);
  const source = await load(session.date);
  if (source.status === 'unavailable') return source;
  const added = new Set((await demoAttendeesOf(db, session.id)).map((d) => d.opsDemoSessionId));
  return { ...source, data: { items: source.data.items.filter((i) => !added.has(i.demoSessionId)) } };
}

export async function addDemoAttendee(db: Database, actor: Actor, input: { sessionId: string; opsDemoSessionId: string }, load: DemoLoader = loadOpsDemoSessions) {
  const { scope, session } = await sessionFor(db, actor, input.sessionId);
  if (session.status === 'cancelled' || session.status === 'rescheduled') throw new ValidationError(`The session was ${session.status}; add demo students to the replacement.`);
  const source = await load(session.date);
  if (source.status === 'unavailable') throw new ConflictError(`Business Ops unavailable (${source.reason}); try again later.`);
  const item = source.data.items.find((i) => i.demoSessionId === input.opsDemoSessionId);
  if (!item) throw new ValidationError('Business Ops has no such demo session on this class date.');
  return withTransaction(db, async (tx) => {
    const locked = await lockSession(tx, session.id);
    await assertSessionAccess(tx, scope, locked);
    const [row] = await tx
      .insert(academicSessionDemoAttendees)
      .values({ sessionId: session.id, opsDemoSessionId: item.demoSessionId, coreStudentId: item.coreStudentId as StudentIdentityId, displayName: item.displayName, demoDayNumber: item.dayNumber, isSample: item.isSample, addedByUserId: actor.user.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError(`${item.displayName} is already on this class.`);
    await audit(tx, actor, { action: 'demo_attendee.added', entityType: 'class_session', entityId: session.id, after: row, metadata: { opsDemoSessionId: item.demoSessionId, dayNumber: item.dayNumber } });
    return row;
  });
}

/** Remove a demo student added by mistake; a recorded mark is corrected, never removed. */
export async function removeDemoAttendee(db: Database, actor: Actor, attendeeId: string, reason: string) {
  const scope = await resolveScope(db, actor, 'academic:attendance:record');
  return withTransaction(db, async (tx) => {
    // Session row first, then the attendee (same lock order as recordAttendance / markRemainingPresent).
    const [ref] = await tx.select({ sessionId: academicSessionDemoAttendees.sessionId }).from(academicSessionDemoAttendees).where(eq(academicSessionDemoAttendees.id, attendeeId as AcademicDemoAttendeeId));
    if (!ref) throw new NotFoundError('Demo attendee not found.');
    const session = await lockSession(tx, ref.sessionId);
    await assertSessionAccess(tx, scope, session);
    const [row] = await tx.select().from(academicSessionDemoAttendees).where(eq(academicSessionDemoAttendees.id, attendeeId as AcademicDemoAttendeeId)).for('update');
    if (!row) throw new NotFoundError('Demo attendee not found.');
    if (row.status !== 'not_recorded') throw new ConflictError('Attendance is already recorded for this demo student; correct the mark instead of removing them.');
    await tx.delete(academicSessionDemoAttendees).where(eq(academicSessionDemoAttendees.id, row.id));
    await audit(tx, actor, { action: 'demo_attendee.removed', entityType: 'class_session', entityId: row.sessionId, before: row, metadata: { reason } });
    return { id: row.id, removed: true };
  });
}

/** Contract `AcademicDemoAttendanceV1` for Ops: marks per Ops demo session; teachers = actual teachers once delivered, else none. */
export async function demoAttendanceFeed(db: Database, opsDemoSessionIds: readonly string[]): Promise<AcademicDemoAttendanceV1> {
  const rows = await db.select().from(academicSessionDemoAttendees).where(inArray(academicSessionDemoAttendees.opsDemoSessionId, [...opsDemoSessionIds]));
  const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
  const actual = sessionIds.length
    ? await db
        .select({ sessionId: academicSessionTeachers.sessionId, staffId: academicSessionTeachers.staffId, name: staffMembers.fullName })
        .from(academicSessionTeachers)
        .innerJoin(staffMembers, eq(staffMembers.id, academicSessionTeachers.staffId))
        .where(and(inArray(academicSessionTeachers.sessionId, sessionIds), eq(academicSessionTeachers.participation, 'actual'), isNull(academicSessionTeachers.removedAt)))
    : [];
  return academicDemoAttendanceV1Schema.parse({
    items: rows.map((r) => {
      const teachers = actual.filter((a) => a.sessionId === r.sessionId);
      return {
        opsDemoSessionId: r.opsDemoSessionId,
        academicSessionId: r.sessionId,
        status: r.status,
        recordedAt: r.recordedAt?.toISOString() ?? null,
        teacherStaffIds: teachers.map((t) => t.staffId),
        teacherNames: teachers.map((t) => t.name),
      };
    }),
  });
}
