/**
 * Counselling & meeting appointments (OPS-008, owner brief 20 Oct 2026 §11): schedule,
 * confirm, reschedule, cancel, record the outcome, list. Double-booking is refused inside
 * the transaction (per-staff advisory lock, then the staff member's nearby appointments
 * locked FOR UPDATE and checked with domain/appointments.ts findClash). Student/guardian
 * counselling linked to an admission still drives the admission pipeline.
 * The assigned teacher is notified in-app; no email/SMS is sent ("simulated — not sent").
 * Events and webinars (audience, participants, messages) are ./events; they share these reads.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointmentChanges,
  opsAppointmentParticipants,
  opsAppointments as appointments,
  opsLeads,
  students,
  type Database,
  type OpsGuardianId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { LeadId, StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import {
  APPOINTMENT_TYPE_LABELS,
  BLOCKING_STATUSES,
  DEFAULT_OFFLINE_LOCATION,
  PIPELINE_COUNSELLING_TYPES,
  canMoveAppointment,
  type AppointmentStatus,
} from '../domain/appointments';
import { fmtDateTime, humanise } from '../ui/format';
import { lockAccessible } from './admissions';
import type { AppointmentChange, AppointmentInput } from './appointments-schemas';
import {
  accessScope,
  activeStaff,
  assertScope,
  programmeByCode,
  userIdsForStaff,
  type Actor,
} from './context';
import { createRuleFollowUp } from './follow-ups';
import { fieldError, opsAudit, rowById } from './ops-common';
import { applyTransition } from './pipeline';
import { loadSettings } from './settings';
import { notifyHosted } from './task-links';
import { assertFree, MEETINGS, ownStaff } from './appointments-slots';

export { assertFree, involving, MEETINGS, ownStaff } from './appointments-slots';
export {
  getAppointment,
  listAppointments,
  listMyMeetings,
  studentPickerOptions,
  type AppointmentListRow,
} from './appointments-read';

type Row = typeof appointments.$inferSelect;
const audit = opsAudit('appointment');
const PIPELINE_ALLOWED = [
  'contacted',
  'counselling_scheduled',
  'counselled',
  'demo_scheduled',
  'demo_attended',
  'admission_pending',
];
/** Status changes (an event's `edit` is server/events.ts editEvent). */
type StatusChange = Exclude<AppointmentChange, { action: 'edit' }>;
const TARGET: Record<StatusChange['action'], AppointmentStatus> = {
  confirm: 'confirmed',
  reschedule: 'rescheduled',
  cancel: 'cancelled',
  complete: 'completed',
};

/** The slot from the given times; without an end, it lasts `lengthMs`. */
function slotOf(startsAt: string, endsAt: string | null | undefined, lengthMs: number) {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + lengthMs);
  if (end <= start) throw fieldError('endsAt', 'The end time must be after the start time.');
  return { startsAt: start, endsAt: end };
}

async function participantStaff(db: Database, appointmentId: string) {
  const rows = await db
    .select({ staffId: opsAppointmentParticipants.staffId })
    .from(opsAppointmentParticipants)
    .where(eq(opsAppointmentParticipants.appointmentId, appointmentId as Row['id']));
  return rows.map((r) => r.staffId).filter((s): s is StaffMemberId => Boolean(s));
}

const isPipeline = (row: Pick<Row, 'type' | 'admissionId'>) =>
  Boolean(row.admissionId) && PIPELINE_COUNSELLING_TYPES.includes(row.type);

export async function scheduleAppointment(
  db: Database,
  actor: Actor,
  input: AppointmentInput,
  requestId?: string,
) {
  const [settings, programme] = await Promise.all([
    loadSettings(db),
    input.programmeCode ? programmeByCode(db, input.programmeCode) : null,
  ]);
  const rule = settings['appointments.scheduling'].value;
  const slot = slotOf(input.startsAt, input.endsAt, rule.defaultDurationMinutes * 60_000);
  return withTransaction(db, async (tx) => {
    const access = await accessScope(tx, actor, 'ops:appointments:manage');
    const organiser = await ownStaff(tx, actor, access);
    let leadId = (input.leadId ?? null) as LeadId | null;
    let studentId = (input.studentId ?? null) as StudentIdentityId | null;
    let staffId = input.staffId ?? null;
    const pipeline = Boolean(input.admissionId) && PIPELINE_COUNSELLING_TYPES.includes(input.type);
    let admission = null;
    if (input.admissionId) {
      admission = pipeline
        ? await lockAccessible(
            tx,
            await accessScope(tx, actor, 'ops:leads:write'),
            input.admissionId,
          )
        : await rowById(tx, opsAdmissions, input.admissionId, 'Admission');
      if (pipeline && !PIPELINE_ALLOWED.includes(admission.status))
        throw new InvalidStateTransitionError(
          admission.status === 'new'
            ? 'Log a successful contact before booking counselling.'
            : `Counselling cannot be booked for an admission that is ${admission.status}.`,
        );
      leadId = admission.leadId;
      studentId ??= admission.studentId;
      staffId ??= admission.counsellorStaffId;
    }
    staffId ??= organiser;
    if (!staffId) throw fieldError('staffId', 'Choose a teacher or counsellor.');
    if (leadId) await rowById(tx, opsLeads, leadId, 'Lead');
    if (studentId) await rowById(tx, students, studentId, 'Student');
    if (!leadId && !studentId) throw fieldError('studentId', 'Choose the student this is about.');
    const staff = await activeStaff(tx, staffId, 'staffId');
    const others = [...new Set(input.otherStaffIds)].filter((s) => s !== staff.id);
    for (const s of others) await activeStaff(tx, s, 'otherStaffIds');
    const staffIds = [staff.id, ...(others as StaffMemberId[])];
    await assertFree(tx, staffIds, slot, rule);

    const notifyUsers = (await userIdsForStaff(tx, staffIds)).filter((u) => u !== actor.id);
    const [row] = await tx
      .insert(appointments)
      .values({
        type: input.type,
        admissionId: admission?.id ?? null,
        leadId,
        studentId,
        demoId: (input.demoId ?? null) as Row['demoId'],
        organiserStaffId: organiser,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        staffId: staff.id,
        mode: input.mode,
        location: input.location ?? (input.mode === 'offline' ? DEFAULT_OFFLINE_LOCATION : null),
        programmeId: programme?.id ?? null,
        subject: input.subject ?? null,
        purpose: input.purpose ?? null,
        status: input.status,
        reminderStatus: notifyUsers.length ? 'sent_in_app' : 'simulated',
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('appointment insert returned no row');
    const teacherRole = ['teacher_academic', 'parent_teacher_meeting', 'demo_review'].includes(
      row.type,
    )
      ? 'teacher'
      : 'counsellor';
    await tx.insert(opsAppointmentParticipants).values([
      { appointmentId: row.id, kind: 'staff', staffId: staff.id, role: teacherRole },
      ...others.map((s) => ({
        appointmentId: row.id,
        kind: 'staff' as const,
        staffId: s as StaffMemberId,
        role: 'staff',
      })),
      ...(studentId
        ? [{ appointmentId: row.id, kind: 'student' as const, studentId, role: 'student' }]
        : []),
      ...input.guardianIds.map((g) => ({
        appointmentId: row.id,
        kind: 'guardian' as const,
        guardianId: g as OpsGuardianId,
        role: 'guardian',
      })),
    ]);
    await notifyHosted(tx, actor, notifyUsers, MEETINGS, `/meetings?open=${row.id}`, {
      kind: 'appointment.scheduled',
      title: `${APPOINTMENT_TYPE_LABELS[row.type]} booked`,
      body: `${fmtDateTime(row.startsAt)}, ${row.mode === 'offline' ? (row.location ?? DEFAULT_OFFLINE_LOCATION) : 'online'}. Email/SMS reminder: simulated — not sent.`,
      entityType: 'appointment',
      entityId: row.id,
    });
    if (pipeline && admission?.status === 'contacted')
      await applyTransition(tx, {
        admission,
        to: 'counselling_scheduled',
        actorUserId: actor.id,
        reason: 'Counselling booked',
        requestId,
        settings,
      });
    await audit(
      tx,
      actor,
      row.id,
      'appointment.scheduled',
      { after: row, metadata: { leadId } },
      requestId,
    );
    return row;
  });
}

export async function changeAppointment(
  db: Database,
  actor: Actor,
  id: string,
  change: StatusChange,
  requestId?: string,
) {
  const [settings, programme] = await Promise.all([
    loadSettings(db),
    change.action === 'complete' && change.recommendedProgrammeCode
      ? programmeByCode(db, change.recommendedProgrammeCode)
      : null,
  ]);
  const rule = settings['appointments.scheduling'].value;
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, appointments, id, 'Appointment', true);
    const access = await accessScope(tx, actor, 'ops:appointments:manage');
    assertScope(access, [row.staffId, row.organiserStaffId], 'appointments');
    const to = TARGET[change.action];
    if (!canMoveAppointment(row.status, to))
      throw new InvalidStateTransitionError(
        `A ${humanise(row.status).toLowerCase()} appointment cannot be ${humanise(to).toLowerCase()}.`,
      );
    const now = new Date();
    const patch: Partial<typeof appointments.$inferInsert> = { status: to };
    const reason = 'reason' in change ? change.reason.trim() : null;
    if ((change.action === 'cancel' || change.action === 'reschedule') && !reason)
      throw fieldError('reason', 'Give a reason.');
    const history: { field: string; previousValue: string; newValue: string }[] = [
      { field: 'status', previousValue: row.status, newValue: to },
    ];
    if (change.action === 'reschedule') {
      const slot = slotOf(
        change.startsAt,
        change.endsAt,
        row.endsAt.getTime() - row.startsAt.getTime() || rule.defaultDurationMinutes * 60_000,
      );
      await assertFree(
        tx,
        [row.staffId, ...(await participantStaff(tx, row.id))],
        slot,
        rule,
        row.id,
      );
      Object.assign(patch, { startsAt: slot.startsAt, endsAt: slot.endsAt });
      history.push(
        {
          field: 'starts_at',
          previousValue: row.startsAt.toISOString(),
          newValue: slot.startsAt.toISOString(),
        },
        {
          field: 'ends_at',
          previousValue: row.endsAt.toISOString(),
          newValue: slot.endsAt.toISOString(),
        },
      );
    } else if (change.action === 'cancel') {
      patch.cancelReason = reason;
    } else if (change.action === 'complete') {
      if (!change.outcome.trim()) throw fieldError('outcome', 'Record the outcome.');
      if (row.startsAt > now)
        throw new InvalidStateTransitionError(
          'Record the outcome after the appointment has started.',
        );
      Object.assign(patch, {
        outcome: change.outcome.trim(),
        objections: change.objections ?? row.objections,
        nextStep: change.nextStep ?? row.nextStep,
        followUpOn: change.followUpOn ?? row.followUpOn,
        recommendedProgrammeId: programme?.id ?? row.recommendedProgrammeId,
        completedAt: now,
      });
      history.push({
        field: 'outcome',
        previousValue: row.outcome ?? '',
        newValue: change.outcome.trim(),
      });
    }
    const [after] = await tx
      .update(appointments)
      .set(patch)
      .where(eq(appointments.id, row.id))
      .returning();
    await tx
      .insert(opsAppointmentChanges)
      .values(history.map((h) => ({ ...h, appointmentId: row.id, reason, actorUserId: actor.id })));
    if (change.action === 'reschedule' || change.action === 'cancel')
      await notifyHosted(
        tx,
        actor,
        await userIdsForStaff(tx, [row.staffId]),
        MEETINGS,
        `/meetings?open=${row.id}`,
        {
          kind: `appointment.${change.action}`,
          title: `${APPOINTMENT_TYPE_LABELS[row.type]} ${change.action === 'cancel' ? 'cancelled' : 'moved'}`,
          body: `${change.action === 'cancel' ? 'Was' : 'Now'} ${fmtDateTime(after?.startsAt)}. Reason: ${reason}. Email/SMS reminder: simulated — not sent.`,
          entityType: 'appointment',
          entityId: row.id,
        },
      );
    if (isPipeline(row))
      await pipelineAfterChange(tx, actor, row, change, programme, now, requestId, settings);
    await audit(
      tx,
      actor,
      row.id,
      `appointment.${change.action}`,
      { before: row, after },
      requestId,
    );
    return after;
  });
}

/** Counselling linked to an admission: completed → counselled (+ follow-up); last one cancelled → contacted. */
async function pipelineAfterChange(
  tx: Database,
  actor: Actor,
  row: Row,
  change: StatusChange,
  programme: { id: Row['programmeId'] } | null,
  now: Date,
  requestId: string | undefined,
  settings: Awaited<ReturnType<typeof loadSettings>>,
) {
  if (change.action !== 'complete' && change.action !== 'cancel') return;
  const admission = await lockAccessible(
    tx,
    await accessScope(tx, actor, 'ops:leads:write'),
    row.admissionId!,
  );
  const transition = { actorUserId: actor.id, requestId, settings };
  if (change.action === 'complete') {
    const current =
      admission.status === 'counselling_scheduled'
        ? await applyTransition(tx, {
            ...transition,
            admission,
            to: 'counselled',
            reason: 'Counselling completed',
          })
        : admission;
    if (programme?.id && !current.programmeId)
      await tx
        .update(opsAdmissions)
        .set({ programmeId: programme.id })
        .where(eq(opsAdmissions.id, current.id));
    await createRuleFollowUp(tx, {
      trigger: 'counselling_completed',
      eventAt: now,
      leadId: current.leadId,
      admissionId: current.id,
      ownerStaffId: current.counsellorStaffId ?? row.staffId,
      settings,
      createdBy: actor.id,
    });
    return;
  }
  if (admission.status !== 'counselling_scheduled') return;
  const [open] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.admissionId, admission.id),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        ne(appointments.id, row.id),
      ),
    )
    .limit(1);
  if (!open)
    await applyTransition(tx, {
      ...transition,
      admission,
      to: 'contacted',
      reason: `Counselling cancelled: ${change.reason}`,
    });
}
