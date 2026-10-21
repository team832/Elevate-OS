/**
 * Demo students (owner brief 21 Oct 2026 §5): book a demo of N demo days with one or more
 * classes each, add a class to a day (extra days only through "Extra demo days"), attendance
 * with correction history, reschedule / cancel, teacher and substitute, mock status, KYC,
 * checklist and outcome. Reads: ./demos-read.ts (re-exported); KYC: ./demos-intake.ts. Rules:
 * domain/demos.ts and docs/parts/admissions-demos.md. Permissions: ops:leads:read /
 * ops:leads:write (counsellors: own scope = demo or case counsellor, or lead owner).
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  opsChecklistEntries,
  opsDemos,
  opsDemoSessionChanges,
  opsDemoSessions,
  type Database,
} from '@elevate/database';
import { notify } from '@elevate/notifications';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday, type ResolvedSettings } from '../domain';
import {
  checkAttendance,
  checkChecklistEntry,
  checkDayDate,
  checkDemoPlan,
  checkExtraDay,
  checkMock,
  checkOutcome,
  checkSessionChange,
  checkTeacherChange,
  closingAttendance,
  DEMO_BOOKABLE_STATUSES,
  demoAttendanceStatus,
  demoDays,
  REOPENING_OUTCOMES,
} from '../domain/demos';
import { fmtDateTime } from '../ui/format';
import { lockAccessible } from './admissions';
import { assertFree } from './appointments';
import { applyDemoKyc } from './demos-intake';
import { lockDemo } from './demos-read';
import {
  accessScope,
  activeStaff,
  notFound,
  programmeByCode,
  userIdsForStaff,
  type Actor,
} from './context';
import type {
  AddSessionInput,
  checklistBody,
  CreateDemoInput,
  demoActionBody,
  SessionAction,
} from './demos-schemas';
import { createRuleFollowUp } from './follow-ups';
import { opsAudit, rowById, type AuditData } from './ops-common';
import { applyTransition, ensureStudentIdentity, type AdmissionRow } from './pipeline';
import { loadSettings } from './settings';

export * from './demos-read';

type Demo = typeof opsDemos.$inferSelect;
type Session = typeof opsDemoSessions.$inferSelect;

const audit = opsAudit('demo');
/** Every demo audit row carries the lead id. */
const auditDemo = (
  tx: Database,
  actor: Actor,
  demo: Pick<Demo, 'id' | 'leadId'>,
  action: string,
  data: AuditData,
  requestId?: string,
) =>
  audit(
    tx,
    actor,
    demo.id,
    action,
    { ...data, metadata: { leadId: demo.leadId, ...data.metadata } },
    requestId,
  );

const must = (check: { ok: true } | { ok: false; message: string }) => {
  if (!check.ok) throw new ValidationError(check.message);
};

// --- booking -----------------------------------------------------------------------------------

/** A teacher's demo class takes the appointments' per-staff lock and must not clash with their other bookings. */
function assertTeacherFree(
  tx: Database,
  settings: ResolvedSettings,
  s: { id?: string; teacherStaffId: string | null; startsAt: Date; endsAt: Date | null },
) {
  if (!s.teacherStaffId) return;
  const rule = settings['appointments.scheduling'].value;
  const endsAt = s.endsAt ?? new Date(+s.startsAt + rule.defaultDurationMinutes * 60_000);
  return assertFree(tx, [s.teacherStaffId as StaffMemberId], { ...s, endsAt }, rule, s.id);
}

async function notifyTeachers(
  tx: Database,
  staffIds: readonly (string | null)[],
  demoId: string,
  body: string,
) {
  const userIds = await userIdsForStaff(tx, staffIds);
  if (userIds.length)
    await notify(tx, {
      userIds,
      module: 'ops',
      kind: 'demo.booked',
      title: 'Demo class booked',
      body,
      link: `/ops/admissions/demos/${demoId}`,
      entityType: 'demo',
      entityId: demoId,
    });
}

export async function createDemo(
  db: Database,
  actor: Actor,
  input: CreateDemoInput,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  const count = settings['admissions.demo.day_count'];
  const timed = input.sessions
    .map((s) => {
      const startsAt = new Date(s.startsAt);
      const endsAt = s.endsAt
        ? new Date(s.endsAt)
        : new Date(+startsAt + input.durationMinutes * 60_000);
      return { ...s, startsAt, endsAt, teacherStaffId: s.teacherStaffId ?? null };
    })
    .sort((a, b) => +a.startsAt - +b.startsAt);
  // Without day numbers, classes on the same IST date form one demo day.
  const dates = [...new Set(timed.map((s) => istToday(s.startsAt)))];
  const sessions = timed.map((s) => ({
    ...s,
    dayNumber: s.dayNumber ?? dates.indexOf(istToday(s.startsAt)) + 1,
  }));
  const problems = checkDemoPlan(sessions, count.value.count, settings['demo.limits'].value);
  if (problems.length)
    throw new ValidationError(problems.join(' '), {
      details: problems.map((message) => ({ location: 'body', path: ['sessions'], message })),
    });
  const teachers = new Map<string, UserId | null>();
  for (const s of sessions)
    if (s.teacherStaffId && !teachers.has(s.teacherStaffId))
      teachers.set(s.teacherStaffId, (await activeStaff(db, s.teacherStaffId, 'sessions')).userId);
  if (input.counsellorStaffId) await activeStaff(db, input.counsellorStaffId, 'counsellorStaffId');
  const programme = input.programmeCode ? await programmeByCode(db, input.programmeCode) : null;
  return withTransaction(db, async (tx) => {
    const access = await accessScope(tx, actor, 'ops:leads:write');
    const admission = await lockAccessible(tx, access, input.admissionId);
    if (!DEMO_BOOKABLE_STATUSES.some((s) => s === admission.status))
      throw new InvalidStateTransitionError(
        'A demo is booked after counselling (status Counselled).',
      );
    const [open] = await tx
      .select({ id: opsDemos.id })
      .from(opsDemos)
      .where(and(eq(opsDemos.admissionId, admission.id), eq(opsDemos.outcome, 'open')));
    if (open)
      throw new ConflictError(
        'This student already has an open demo. Record its outcome before booking another.',
      );
    for (const s of sessions) await assertTeacherFree(tx, settings, s);
    // The demo student uses the canonical identity from booking (brief §3); never merged.
    const identity = await ensureStudentIdentity(tx, admission.id);
    const fee = settings['demo.fee'];
    const [demo] = await tx
      .insert(opsDemos)
      .values({
        admissionId: admission.id,
        leadId: admission.leadId,
        feeAmountPaise: Math.round(fee.value.amountInr * 100),
        feeTermsState: fee.decisionState,
        notes: input.notes?.trim() || null,
        programmeId: programme?.id ?? admission.programmeId,
        counsellorStaffId:
          (input.counsellorStaffId as StaffMemberId | null | undefined) ??
          admission.counsellorStaffId ??
          (access.scope === 'own' ? access.staffId : null),
        plannedSessionCount: sessions.length,
        plannedDayCount: count.value.count,
        createdBy: actor.id,
      })
      .returning();
    const now = new Date();
    const rows = await tx
      .insert(opsDemoSessions)
      .values(
        sessions.map((s, i) => ({
          demoId: demo!.id,
          sessionNumber: i + 1,
          dayNumber: s.dayNumber,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          subject: s.subject,
          programmeId: demo!.programmeId,
          teacherStaffId: s.teacherStaffId as StaffMemberId | null,
          teacherNotifiedAt: s.teacherStaffId && teachers.get(s.teacherStaffId) ? now : null,
          updatedBy: actor.id,
        })),
      )
      .returning();
    if (input.kyc) await applyDemoKyc(tx, actor, demo!, input.kyc, requestId);
    await notifyTeachers(
      tx,
      [...teachers.keys()],
      demo!.id,
      `Separate demo classes (not the main batch): ${rows.map((s) => `${s.subject}, ${fmtDateTime(s.startsAt)}`).join('; ')}.`,
    );
    if (admission.status === 'counselled')
      await applyTransition(tx, {
        admission,
        to: 'demo_scheduled',
        actorUserId: actor.id,
        reason: 'Demo booked',
        requestId,
        settings,
      });
    await auditDemo(
      tx,
      actor,
      demo!,
      'demo.booked',
      {
        after: { ...demo, sessions: rows },
        metadata: {
          dayCount: count.value.count,
          dayCountState: count.decisionState,
          studentId: identity.studentId,
          identity: identity.identity,
          feeState: fee.decisionState,
        },
      },
      requestId,
    );
    return { ...demo!, sessions: rows };
  });
}

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
    await syncDemo(tx, actor, demo, admission, requestId);
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

// --- changes -----------------------------------------------------------------------------------

/** Session fields whose every change is kept in ops.demo_session_changes. */
const TRACKED = [
  ['attendance', (s: Session) => s.attendance],
  ['schedule', (s: Session) => s.startsAt.toISOString()],
  [
    'mock',
    (s: Session) => (s.mockAttemptRef ? `${s.mockStatus} (${s.mockAttemptRef})` : s.mockStatus),
  ],
  ['teacher', (s: Session) => s.teacherStaffId],
  // The role is its own history row; `teacher` is the field the schema allows (OPS_DEMO_SESSION_FIELDS).
  ['teacher', (s: Session) => (s.isSubstitute ? 'Substitute' : 'Planned teacher')],
] as const;

async function logChanges(
  tx: Database,
  before: Session,
  after: Session,
  actor: Actor,
  reason?: string | null,
) {
  const rows = TRACKED.map(([field, get]) => ({
    field,
    previousValue: get(before),
    newValue: get(after),
  }))
    .filter((r) => r.previousValue !== r.newValue)
    .map((r) => ({
      ...r,
      sessionId: before.id,
      reason: reason?.trim() || null,
      actorUserId: actor.id,
    }));
  if (rows.length) await tx.insert(opsDemoSessionChanges).values(rows);
}

/**
 * After a session change: stamp `completed_at` once every session has a final
 * attendance; when an open demo becomes fully attended, move the case
 * demo_scheduled → demo_attended and add the demo follow-up (A-05).
 */
async function syncDemo(
  tx: Database,
  actor: Actor,
  demo: Demo,
  admission: AdmissionRow,
  requestId?: string,
) {
  const sessions = await tx
    .select()
    .from(opsDemoSessions)
    .where(eq(opsDemoSessions.demoId, demo.id));
  const status = demoAttendanceStatus(demo.outcome, sessions);
  const finished = status === 'attended' || status === 'missed';
  await tx
    .update(opsDemos)
    .set({ completedAt: finished ? (demo.completedAt ?? new Date()) : null })
    .where(eq(opsDemos.id, demo.id));
  if (demo.outcome !== 'open' || status !== 'attended') return;
  if (admission.status !== 'demo_scheduled') return;
  const settings = await loadSettings(tx);
  await applyTransition(tx, {
    admission,
    to: 'demo_attended',
    actorUserId: actor.id,
    reason: 'All demo classes recorded',
    requestId,
    settings,
  });
  await createRuleFollowUp(tx, {
    trigger: 'demo_attended',
    eventAt: new Date(),
    leadId: admission.leadId,
    admissionId: admission.id,
    ownerStaffId: admission.counsellorStaffId ?? demo.counsellorStaffId,
    settings,
    createdBy: actor.id,
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
    await syncDemo(tx, actor, demo, admission, requestId);
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

/** Close the demo with a manual outcome and a reason (D-6), or update its KYC (brief §5). */
export async function updateDemo(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof demoActionBody>,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const { demo, admission } = await lockDemo(tx, actor, id);
    if (input.action === 'kyc') {
      const { action, ...kyc } = input;
      await applyDemoKyc(tx, actor, demo, kyc, requestId);
      return rowById(tx, opsDemos, demo.id, 'Demo');
    }
    must(checkOutcome(demo.outcome, input.reason));
    const reason = input.reason!.trim();
    const pending = await tx
      .select()
      .from(opsDemoSessions)
      .where(
        and(
          eq(opsDemoSessions.demoId, demo.id),
          inArray(opsDemoSessions.attendance, ['scheduled', 'rescheduled']),
        ),
      );
    const now = new Date();
    for (const s of pending) {
      const [after] = await tx
        .update(opsDemoSessions)
        .set({
          attendance: closingAttendance(s, now),
          exceptionReason: `Demo closed (${input.outcome}): ${reason}`,
          updatedBy: actor.id,
        })
        .where(eq(opsDemoSessions.id, s.id))
        .returning();
      await logChanges(tx, s, after!, actor, reason);
    }
    const [after] = await tx
      .update(opsDemos)
      .set({ outcome: input.outcome, outcomeReason: reason, outcomeAt: now, outcomeBy: actor.id })
      .where(eq(opsDemos.id, demo.id))
      .returning();
    if (admission.status === 'demo_scheduled' && REOPENING_OUTCOMES.includes(input.outcome))
      await applyTransition(tx, {
        admission,
        to: 'counselled',
        actorUserId: actor.id,
        reason: `Demo closed (${input.outcome}): ${reason}`,
        requestId,
        settings: await loadSettings(tx),
      });
    await syncDemo(tx, actor, after!, admission, requestId);
    await auditDemo(tx, actor, demo, 'demo.outcome_set', { before: demo, after }, requestId);
    return after!;
  });
}

/** Append a checklist entry (D-7: latest wins; waived needs a reason; derived items are read-only). */
export async function setDemoChecklistItem(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof checklistBody>,
  requestId?: string,
) {
  must(checkChecklistEntry(input));
  return withTransaction(db, async (tx) => {
    const { demo } = await lockDemo(tx, actor, id);
    const [entry] = await tx
      .insert(opsChecklistEntries)
      .values({
        subjectType: 'demo',
        subjectId: demo.id,
        itemKey: input.itemKey,
        status: input.status,
        reason: input.reason?.trim() || null,
        actorUserId: actor.id,
      })
      .returning();
    await auditDemo(tx, actor, demo, 'demo.checklist_set', { after: entry }, requestId);
    return entry!;
  });
}
