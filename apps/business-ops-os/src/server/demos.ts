/**
 * Demo students (owner brief 21 Oct 2026 §5): book a demo of N demo days with one or more
 * classes each, add a class to a day (extra days only through "Extra demo days"), attendance
 * with correction history, reschedule / cancel, teacher and substitute, mock status, KYC,
 * checklist and outcome. Reads: ./demos-read.ts and classes: ./demos-sessions.ts (both
 * re-exported); shared write helpers: ./demos-common.ts; KYC: ./demos-intake.ts. Rules:
 * domain/demos.ts and docs/parts/admissions-demos.md. Permissions: ops:leads:read /
 * ops:leads:write (counsellors: own scope = demo or case counsellor, or lead owner).
 */
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { opsChecklistEntries, opsDemos, opsDemoSessions, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import type { z } from 'zod';
import { istToday } from '../domain';
import {
  checkChecklistEntry,
  checkDemoPlan,
  checkOutcome,
  closingAttendance,
  DEMO_BOOKABLE_STATUSES,
  REOPENING_OUTCOMES,
} from '../domain/demos';
import { fmtDateTime } from '../ui/format';
import { lockAccessible } from './admissions';
import { applyDemoKyc } from './demos-intake';
import { lockDemo, marksForDemo } from './demos-read';
import { academicDemoMarks } from './academic-summary';
import { accessScope, activeStaff, programmeByCode, type Actor } from './context';
import {
  assertTeacherFree,
  auditDemo,
  logChanges,
  must,
  notifyTeachers,
  syncDemo,
} from './demos-common';
import type { checklistBody, CreateDemoInput, demoActionBody } from './demos-schemas';
import { rowById } from './ops-common';
import { applyTransition, ensureStudentIdentity } from './pipeline';
import { loadSettings } from './settings';

export * from './demos-read';
export * from './demos-sessions';

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

/** Close the demo with a manual outcome and a reason (D-6), or update its KYC (brief §5). */
export async function updateDemo(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof demoActionBody>,
  requestId?: string,
) {
  if (input.action !== 'kyc') await lockDemo(db, actor, id); // permission before Academic
  const marks = input.action === 'kyc' ? null : await marksForDemo(db, id);
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
    await syncDemo(tx, actor, after!, admission, marks!, requestId);
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

/**
 * Job (R15): open, unfinished demos are synced again with Academic's marks, so a class the
 * teacher marked in Academic moves the case on (demo_attended) without an Ops edit. One batched
 * Academic call for all started classes; nothing moves while Academic cannot be read; idempotent.
 * The actor needs ops:jobs:run and ops:leads:write (all scope — every demo is locked for writing).
 */
export async function syncDemosFromAcademic(
  db: Database,
  actor: Actor,
  requestId?: string,
  now = new Date(),
) {
  await accessScope(db, actor, 'ops:jobs:run');
  if ((await accessScope(db, actor, 'ops:leads:write')).scope !== 'all')
    throw new ForbiddenError('This job needs ops:leads:write for every demo.');
  const classes = await db
    .select({ id: opsDemoSessions.id, demoId: opsDemoSessions.demoId })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .where(
      and(
        eq(opsDemos.outcome, 'open'),
        isNull(opsDemos.completedAt),
        lte(opsDemoSessions.startsAt, now),
      ),
    );
  const marks = await academicDemoMarks(
    db,
    classes.map((c) => c.id),
  );
  const demoIds = [...new Set(classes.filter((c) => marks.marks.has(c.id)).map((c) => c.demoId))];
  for (const id of demoIds)
    await withTransaction(db, async (tx) => {
      const { demo, admission } = await lockDemo(tx, actor, id);
      await syncDemo(tx, actor, demo, admission, marks, requestId);
    });
  return { status: marks.status, synced: demoIds.length };
}
