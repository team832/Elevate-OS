/**
 * Classroom attendance (ACD-014, brief §10). The roster comes from batch placements covering
 * the session date (R13) plus anyone already marked (the roster used is preserved) and the
 * session's demo attendees. No row = "not recorded" — never present, absent or zero. Nothing
 * defaults to present: "mark all remaining present" is a separate, explicit action. Changing a
 * recorded mark needs a reason, kept in the audit trail. Recording attendance does not mark
 * the session delivered (R12).
 */
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatchPlacements,
  academicClassSessions,
  academicEnrolments,
  academicSessionDemoAttendees,
  academicStudents,
  auditEvents,
  users,
  type AcademicSessionId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { audit, resolveScope, todayIst, type Actor } from '../context';
import type { attendanceBody } from '../schemas';
import { assertLoggable, assertSessionAccess, lockSession } from './session-guards';

type SessionRef = { id: string; batchId: string; date: string };

/** Students expected in a session: placed in its batch on the session date, plus anyone already marked there. */
export async function rosterFor(db: Database, session: SessionRef) {
  const student = { studentId: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName, isSample: academicStudents.isSample };
  const placed = await db
    .select(student)
    .from(academicBatchPlacements)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(and(eq(academicBatchPlacements.batchId, session.batchId as BatchId), lte(academicBatchPlacements.startDate, session.date), or(isNull(academicBatchPlacements.endDate), gte(academicBatchPlacements.endDate, session.date))));
  const marked = await db.select(student).from(academicAttendance).innerJoin(academicStudents, eq(academicStudents.id, academicAttendance.studentId)).where(eq(academicAttendance.sessionId, session.id as AcademicSessionId));
  const byId = new Map(marked.map((r) => [r.studentId as string, { ...r, onPlacement: false }]));
  for (const r of placed) byId.set(r.studentId, { ...r, onPlacement: true });
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Counts per state; "notRecorded" is its own number, never folded into absent or present. */
export function countMarks(statuses: readonly (string | null)[]) {
  const counts = { present: 0, late: 0, partial: 0, absent: 0, excused: 0, notRecorded: 0 };
  for (const s of statuses) {
    if (s && s !== 'not_recorded') counts[s as Exclude<keyof typeof counts, 'notRecorded'>] += 1;
    else counts.notRecorded += 1;
  }
  return counts;
}

/** Audit trail of a session (delivery, attendance, substitutes, demo attendees), newest first, with reasons. */
export async function sessionHistory(db: Database, sessionId: string) {
  const rows = await db
    .select({ at: auditEvents.at, action: auditEvents.action, metadata: auditEvents.metadata, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.entityType, 'class_session'), eq(auditEvents.entityId, sessionId)))
    .orderBy(desc(auditEvents.at))
    .limit(200);
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as { reason?: string; changes?: { name?: string; from: string; to: string }[] };
    return { at: r.at, action: r.action, actorName: r.actorName, reason: m.reason ?? null, changes: m.changes ?? [] };
  });
}

export async function demoAttendeesOf(db: Database, sessionId: string) {
  return db.select().from(academicSessionDemoAttendees).where(eq(academicSessionDemoAttendees.sessionId, sessionId as AcademicSessionId)).orderBy(asc(academicSessionDemoAttendees.displayName));
}

export async function getSessionAttendance(db: Database, actor: Actor, sessionId: string) {
  const scope = await resolveScope(db, actor, 'academic:attendance:read');
  const [session] = await db.select().from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as AcademicSessionId));
  if (!session) throw new NotFoundError('Session not found.');
  await assertSessionAccess(db, scope, session);
  const roster = await rosterFor(db, session);
  const marks = await db.select().from(academicAttendance).where(eq(academicAttendance.sessionId, session.id));
  const byStudent = new Map(marks.map((m) => [m.studentId as string, m]));
  const demoAttendees = await demoAttendeesOf(db, session.id);
  const rows = roster.map((r) => ({ ...r, mark: byStudent.get(r.studentId) ?? null }));
  const counts = countMarks(rows.map((r) => r.mark?.status ?? null));
  return {
    session,
    roster: rows,
    demoAttendees,
    counts,
    demoCounts: countMarks(demoAttendees.map((d) => d.status)),
    recorded: marks.length,
    notRecorded: counts.notRecorded,
    history: (await sessionHistory(db, session.id)).filter((h) => h.action.startsWith('attendance.')),
  };
}

export async function recordAttendance(db: Database, actor: Actor, sessionId: string, body: z.input<typeof attendanceBody>, now = new Date()) {
  const input = { marks: body.marks ?? [], demoMarks: body.demoMarks ?? [], reason: body.reason };
  const scope = await resolveScope(db, actor, 'academic:attendance:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, sessionId);
    await assertSessionAccess(tx, scope, session);
    assertLoggable(session, todayIst(now));
    const roster = new Map((await rosterFor(tx, session)).map((r) => [r.studentId as string, r]));
    const ids = input.marks.map((m) => m.studentId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('A student appears twice in the attendance list.');
    const outsiders = ids.filter((id) => !roster.has(id));
    if (outsiders.length > 0) throw new ValidationError('Some students are not placed in this batch on the session date.', { details: { studentIds: outsiders } });
    const existing = new Map((await tx.select().from(academicAttendance).where(eq(academicAttendance.sessionId, session.id))).map((m) => [m.studentId as string, m]));
    const demos = new Map((await demoAttendeesOf(tx, session.id)).map((d) => [d.id as string, d]));
    if (new Set(input.demoMarks.map((m) => m.attendeeId)).size !== input.demoMarks.length) throw new ValidationError('A demo student appears twice in the attendance list.');
    const unknownDemos = input.demoMarks.filter((m) => !demos.has(m.attendeeId)).map((m) => m.attendeeId);
    if (unknownDemos.length > 0) throw new ValidationError('Some demo attendees are not on this session.', { details: { attendeeIds: unknownDemos } });

    const fresh = input.marks.filter((m) => !existing.has(m.studentId));
    const freshDemo = input.demoMarks.filter((m) => demos.get(m.attendeeId)!.status === 'not_recorded');
    // `note` left out keeps the saved note. A changed status or minutes needs a reason; a note-only change is saved and audited without one.
    const change = <M extends { status: string; note?: string }>(m: M, ref: Record<string, string>, name: string, saved: { status: string; note: string | null; minutesPresent?: number | null }, minutes?: number | null) => {
      const note = m.note === undefined ? saved.note : m.note;
      const markChanged = saved.status !== m.status || (minutes !== undefined && saved.minutesPresent !== minutes);
      return markChanged || note !== saved.note ? [{ mark: m, note, change: { ...ref, name, from: saved.status, to: m.status, noteFrom: saved.note, noteTo: note, ...(markChanged ? {} : { noteOnly: true }) } }] : [];
    };
    const changed = input.marks.flatMap((m) => {
      const e = existing.get(m.studentId);
      return e ? change(m, { studentId: m.studentId }, roster.get(m.studentId)!.fullName, e, m.minutesPresent ?? null) : [];
    });
    const changedDemo = input.demoMarks.flatMap((m) => {
      const d = demos.get(m.attendeeId)!;
      return d.status === 'not_recorded' ? [] : change(m, { attendeeId: m.attendeeId }, d.displayName, d);
    });
    const changes = [...changed, ...changedDemo].map((c) => c.change);
    if (changes.some((c) => !('noteOnly' in c)) && !input.reason) throw new ValidationError('Changing a recorded mark needs a reason.', { details: { changes } });

    const writes = [...fresh.map((mark) => ({ mark, note: mark.note ?? null })), ...changed];
    for (const { mark: m, note } of writes) {
      const values = { status: m.status, minutesPresent: m.minutesPresent ?? null, note, recordedByUserId: actor.user.id };
      await tx
        .insert(academicAttendance)
        .values({ sessionId: session.id, studentId: m.studentId as StudentId, ...values })
        .onConflictDoUpdate({ target: [academicAttendance.sessionId, academicAttendance.studentId], set: { ...values, recordedAt: now } });
    }
    for (const { mark: m, note } of [...freshDemo.map((mark) => ({ mark, note: mark.note ?? null })), ...changedDemo]) {
      await tx
        .update(academicSessionDemoAttendees)
        .set({ status: m.status, note, recordedByUserId: actor.user.id, recordedAt: now })
        .where(eq(academicSessionDemoAttendees.id, m.attendeeId as never));
    }
    if (fresh.length + freshDemo.length > 0) {
      await audit(tx, actor, {
        action: 'attendance.recorded',
        entityType: 'class_session',
        entityId: session.id,
        after: [...fresh.map(({ studentId, status, note }) => ({ studentId, status, note: note ?? null })), ...freshDemo.map(({ attendeeId, status, note }) => ({ attendeeId, status, note: note ?? null }))],
      });
    }
    if (changes.length > 0) {
      const side = (status: 'from' | 'to', note: 'noteFrom' | 'noteTo') => changes.map((c) => ({ studentId: 'studentId' in c ? c.studentId : undefined, attendeeId: 'attendeeId' in c ? c.attendeeId : undefined, name: c.name, status: c[status], note: c[note] }));
      await audit(tx, actor, { action: 'attendance.corrected', entityType: 'class_session', entityId: session.id, before: side('from', 'noteFrom'), after: side('to', 'noteTo'), metadata: { reason: input.reason ?? null, changes } });
    }
    const recorded = (await tx.select({ id: academicAttendance.id }).from(academicAttendance).where(eq(academicAttendance.sessionId, session.id))).length;
    return { sessionId: session.id, recorded, rosterSize: roster.size, changed: changes.length };
  });
}

/** Explicit bulk action: mark every still-unrecorded placed student and demo attendee present. Never touches recorded marks. */
export async function markRemainingPresent(db: Database, actor: Actor, sessionId: string, now = new Date()) {
  const scope = await resolveScope(db, actor, 'academic:attendance:record');
  return withTransaction(db, async (tx) => {
    const session = await lockSession(tx, sessionId);
    await assertSessionAccess(tx, scope, session);
    assertLoggable(session, todayIst(now));
    const marked = new Set((await tx.select({ studentId: academicAttendance.studentId }).from(academicAttendance).where(eq(academicAttendance.sessionId, session.id))).map((m) => m.studentId as string));
    const students = (await rosterFor(tx, session)).filter((r) => r.onPlacement && !marked.has(r.studentId)).map((r) => r.studentId);
    const attendees = (await demoAttendeesOf(tx, session.id)).filter((d) => d.status === 'not_recorded').map((d) => d.id);
    if (students.length > 0) {
      await tx.insert(academicAttendance).values(students.map((studentId) => ({ sessionId: session.id, studentId, status: 'present' as const, recordedByUserId: actor.user.id, recordedAt: now })));
    }
    for (const id of attendees) {
      await tx.update(academicSessionDemoAttendees).set({ status: 'present', recordedByUserId: actor.user.id, recordedAt: now }).where(eq(academicSessionDemoAttendees.id, id));
    }
    if (students.length + attendees.length > 0) {
      await audit(tx, actor, { action: 'attendance.bulk_present', entityType: 'class_session', entityId: session.id, metadata: { studentIds: students, attendeeIds: attendees } });
    }
    return { sessionId: session.id, marked: students.length + attendees.length };
  });
}

/** Attendance rows for sessions in a window (summary, progress). */
export async function attendanceBetween(db: Database, from: string, to: string) {
  return db
    .select({ sessionId: academicAttendance.sessionId, studentId: academicAttendance.studentId, status: academicAttendance.status, batchId: academicClassSessions.batchId })
    .from(academicAttendance)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicAttendance.sessionId))
    .where(and(gte(academicClassSessions.date, from), lte(academicClassSessions.date, to)));
}
