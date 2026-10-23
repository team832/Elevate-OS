/**
 * Demo classes: add a class to a demo day (extra days only through "Extra demo days") and record
 * attendance, reschedule / cancel, mock status, teacher and substitute (history kept). Re-exported
 * by demos.ts; rules in domain/demos.ts.
 */
import { and, eq } from 'drizzle-orm';
import { opsDemos, opsDemoSessions, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  checkAttendance,
  checkDayDate,
  checkExtraDay,
  checkMock,
  checkSessionChange,
  checkTeacherChange,
  demoDays,
} from '../domain/demos';
import { fmtDateTime } from '../ui/format';
import { assertCounsellorMayMark } from './academic-summary';
import { activeStaff, notFound, type Actor } from './context';
import {
  assertTeacherFree,
  auditDemo,
  logChanges,
  must,
  notifyTeachers,
  syncDemo,
} from './demos-common';
import { lockDemo, marksForDemo } from './demos-read';
import type { AddSessionInput, SessionAction } from './demos-schemas';
import { loadSettings } from './settings';

type Session = typeof opsDemoSessions.$inferSelect;

/**
 * Add a class to demo day `dayNumber` of an open demo. A day beyond the booked day count is
 * refused unless "Extra demo days" allows it (with a reason); the student's classes must not
 * overlap and the teacher must be free.
 */
export async function addDemoSession(
  db: Database,
  actor: Actor,
  demoId: string,
  input: AddSessionInput,
  requestId?: string,
) {
  const teacher = input.teacherStaffId
    ? await activeStaff(db, input.teacherStaffId, 'teacherStaffId')
    : null;
  await lockDemo(db, actor, demoId); // permission before Academic is asked
  const marks = await marksForDemo(db, demoId);
  return withTransaction(db, async (tx) => {
    const { demo, admission } = await lockDemo(tx, actor, demoId);
    if (demo.outcome !== 'open')
      throw new InvalidStateTransitionError(`This demo is closed (${demo.outcome}).`);
    const settings = await loadSettings(tx);
    const existing = await tx
      .select()
      .from(opsDemoSessions)
      .where(eq(opsDemoSessions.demoId, demo.id));
    must(
      checkExtraDay(
        input.dayNumber,
        demo.plannedDayCount,
        settings['admissions.demo.extension'].value,
        input.reason,
        Math.max(...existing.map((s) => s.dayNumber)),
      ),
    );
    if (existing.length >= 30) throw new ValidationError('A demo has at most 30 classes.');
    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt
      ? new Date(input.endsAt)
      : new Date(
          +startsAt + settings['appointments.scheduling'].value.defaultDurationMinutes * 60_000,
        );
    if (endsAt <= startsAt) throw new ValidationError('The class must end after it starts.');
    must(
      checkDayDate(demoDays(existing, demo.plannedDayCount), input.dayNumber, istToday(startsAt)),
    );
    if (
      existing.some(
        (s) =>
          s.attendance !== 'cancelled' &&
          s.startsAt < endsAt &&
          (s.endsAt ?? s.startsAt) > startsAt,
      )
    )
      throw new ValidationError('Classes must not overlap.');
    const teacherStaffId = (teacher?.id ?? null) as StaffMemberId | null;
    await assertTeacherFree(tx, settings, { teacherStaffId, startsAt, endsAt });
    const [row] = await tx
      .insert(opsDemoSessions)
      .values({
        demoId: demo.id,
        sessionNumber: Math.max(0, ...existing.map((s) => s.sessionNumber)) + 1,
        dayNumber: input.dayNumber,
        startsAt,
        endsAt,
        subject: input.subject,
        programmeId: demo.programmeId,
        teacherStaffId,
        teacherNotifiedAt: teacher?.userId ? new Date() : null,
        updatedBy: actor.id,
      })
      .returning();
    await tx
      .update(opsDemos)
      .set({ plannedSessionCount: existing.length + 1 })
      .where(eq(opsDemos.id, demo.id));
    if (teacher)
      await notifyTeachers(
        tx,
        [teacher.id],
        demo.id,
        `Demo class: ${row!.subject}, ${fmtDateTime(startsAt)}.`,
      );
    await syncDemo(tx, actor, demo, admission, marks, requestId);
    await auditDemo(
      tx,
      actor,
      demo,
      'demo_session.added',
      { after: row, metadata: { dayNumber: input.dayNumber, reason: input.reason ?? null } },
      requestId,
    );
    return row!;
  });
}

function sessionPatch(
  session: Session,
  input: SessionAction,
  actor: Actor,
  now: Date,
  teacher: { id: StaffMemberId; userId: UserId | null } | null,
): Partial<typeof opsDemoSessions.$inferInsert> {
  switch (input.action) {
    case 'attendance': {
      must(checkAttendance(session, input.attendance, input.reason, now));
      const reset = input.attendance === 'scheduled';
      return {
        attendance: input.attendance,
        recordedAt: reset ? null : now,
        recordedBy: reset ? null : actor.id,
        notes: input.notes ?? session.notes,
      };
    }
    case 'reschedule': {
      must(checkSessionChange(session, 'reschedule', input.reason));
      const startsAt = new Date(input.startsAt);
      const length = session.endsAt ? +session.endsAt - +session.startsAt : null;
      const endsAt = input.endsAt
        ? new Date(input.endsAt)
        : length
          ? new Date(+startsAt + length)
          : null;
      if (endsAt && endsAt <= startsAt)
        throw new ValidationError('The session must end after it starts.');
      return {
        startsAt,
        endsAt,
        attendance: 'rescheduled',
        recordedAt: null,
        recordedBy: null,
        exceptionReason: input.reason,
      };
    }
    case 'cancel':
      must(checkSessionChange(session, 'cancel', input.reason));
      return { attendance: 'cancelled', exceptionReason: input.reason };
    case 'mock':
      must(checkMock(input.mockStatus, input.mockAttemptRef));
      return { mockStatus: input.mockStatus, mockAttemptRef: input.mockAttemptRef ?? null };
    case 'assign':
      must(checkTeacherChange(session, input.reason));
      return {
        teacherStaffId: teacher?.id ?? null,
        isSubstitute: input.isSubstitute ?? session.isSubstitute,
        subject: input.subject,
        teacherNotifiedAt: teacher?.userId ? now : null,
      };
  }
}

/** Record or correct attendance, reschedule, cancel, mock status, teacher/substitute/subject (audited, history kept). */
export async function updateDemoSession(
  db: Database,
  actor: Actor,
  demoId: string,
  sessionId: string,
  input: SessionAction,
  requestId?: string,
  now = new Date(),
) {
  await lockDemo(db, actor, demoId); // permission and scope before Academic is asked
  const marks = await marksForDemo(db, demoId);
  if (input.action === 'attendance') {
    // Read after marksForDemo, which records a newly seen link.
    const [known] = await db
      .select({ id: opsDemoSessions.id, academicSessionRef: opsDemoSessions.academicSessionRef })
      .from(opsDemoSessions)
      .where(eq(opsDemoSessions.id, sessionId as Session['id']));
    if (known) assertCounsellorMayMark(marks, known);
  }
  const teacher =
    input.action === 'assign' && input.teacherStaffId
      ? await activeStaff(db, input.teacherStaffId, 'teacherStaffId')
      : null;
  return withTransaction(db, async (tx) => {
    const { demo, admission } = await lockDemo(tx, actor, demoId);
    const [session] = await tx
      .select()
      .from(opsDemoSessions)
      .where(
        and(
          eq(opsDemoSessions.id, sessionId as Session['id']),
          eq(opsDemoSessions.demoId, demo.id),
        ),
      )
      .for('update');
    if (!session) notFound('Demo session');
    if (demo.outcome !== 'open' && !['attendance', 'mock'].includes(input.action))
      throw new InvalidStateTransitionError(
        `This demo is closed (${demo.outcome}); only attendance and mock records can still be corrected.`,
      );
    const settings = await loadSettings(tx);
    /** Patch one class, check its teacher is free, write it and append its history. */
    const apply = async (target: Session, change: SessionAction) => {
      const patch = sessionPatch(target, change, actor, now, teacher);
      if (
        change.action === 'reschedule' ||
        (change.action === 'assign' && patch.teacherStaffId !== target.teacherStaffId)
      )
        await assertTeacherFree(tx, settings, { ...target, ...patch });
      const [row] = await tx
        .update(opsDemoSessions)
        .set({ ...patch, updatedBy: actor.id })
        .where(eq(opsDemoSessions.id, target.id))
        .returning();
      await logChanges(tx, target, row!, actor, 'reason' in change ? change.reason : null);
      return row!;
    };
    if (input.action === 'reschedule') {
      const all = await tx
        .select()
        .from(opsDemoSessions)
        .where(eq(opsDemoSessions.demoId, demo.id));
      const day = input.wholeDay
        ? all.filter((s) => s.dayNumber === session.dayNumber && s.attendance !== 'cancelled')
        : [session];
      must(
        checkDayDate(
          demoDays(all, demo.plannedDayCount),
          session.dayNumber,
          istToday(new Date(input.startsAt)),
          day.map((s) => s.id),
        ),
      );
      // A whole-day move shifts the day's other classes by the same amount (each logged).
      const shift = +new Date(input.startsAt) - +session.startsAt;
      for (const other of day.filter((s) => s.id !== session.id))
        await apply(other, {
          ...input,
          startsAt: new Date(+other.startsAt + shift).toISOString() as never,
          endsAt: null,
        });
    }
    const after = await apply(session, input);
    if (teacher && teacher.id !== session.teacherStaffId)
      await notifyTeachers(
        tx,
        [teacher.id],
        demo.id,
        `Demo class: ${after.subject}, ${fmtDateTime(after.startsAt)}.`,
      );
    await syncDemo(tx, actor, demo, admission, marks, requestId);
    await auditDemo(
      tx,
      actor,
      demo,
      `demo_session.${input.action}`,
      { before: session, after, metadata: { sessionNumber: session.sessionNumber } },
      requestId,
    );
    return after!;
  });
}
