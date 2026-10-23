/**
 * Events, webinars and their messages (owner brief §12), on `ops.appointments` (types `event`,
 * `webinar`). Scheduling resolves the audience ONCE into participant rows (`audience_snapshot`,
 * name kept); later additions and removals are explicit rows, and editing the filter never
 * rewrites them. Scheduling sends nothing: a message is drafted with a preview, then sent only
 * by an explicit action holding `ops:event_messages:send`, through the messaging adapter
 * (no provider → `simulated`, never `sent`). Contacts are read only to count and send; they
 * never leave ./events-messages.ts. Algorithms: A-EVT-1 (audience), A-EVT-2 (reach), A-EVT-3 (send).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  opsAppointmentChanges,
  opsAppointmentParticipants as participants,
  opsAppointments as appointments,
  opsGuardians,
  students,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import {
  APPOINTMENT_TYPE_LABELS,
  BLOCKING_STATUSES,
  DEFAULT_OFFLINE_LOCATION,
} from '../domain/appointments';
import { fmtDateTime } from '../ui/format';
import { assertFree, MEETINGS, ownStaff } from './appointments';
import type { EventEdit, EventInput, ParticipantChange } from './appointments-schemas';
import { accessScope, activeStaff, userIdsForStaff, type Actor } from './context';
import {
  assertEligible,
  audienceStudents,
  eligibleOrThrow,
  lockEvent,
  participantRows,
  registeredCount,
} from './events-audience';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import { notifyHosted } from './task-links';

export { draftEventMessage, sendEventMessage } from './events-messages';

const audit = opsAudit('appointment');

/** POST /appointments/events — schedule, snapshot the audience, notify the owner in-app only. */
export async function scheduleEvent(
  db: Database,
  actor: Actor,
  input: EventInput,
  requestId?: string,
) {
  const settings = await loadSettings(db);
  const rule = settings['appointments.scheduling'].value;
  const eligibility = settings['events.eligibility'].value;
  eligibleOrThrow(input.audience, eligibility.populations);
  const startsAt = new Date(input.startsAt);
  const minutes = input.durationMinutes ?? rule.defaultDurationMinutes;
  const slot = { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
  return withTransaction(db, async (tx) => {
    const access = await accessScope(tx, actor, 'ops:appointments:manage');
    const organiser = await ownStaff(tx, actor, access);
    const ownerId = input.staffId ?? organiser;
    if (!ownerId) throw fieldError('staffId', 'Choose who runs the event.');
    const owner = await activeStaff(tx, ownerId, 'staffId');
    await assertFree(tx, [owner.id], slot, rule);
    const chosen = [...new Set(input.participantStudentIds)] as StudentIdentityId[];
    const named = chosen.length
      ? await tx
          .select({ studentId: students.id, fullName: students.fullName })
          .from(students)
          .where(inArray(students.id, chosen))
      : [];
    if (named.length !== chosen.length)
      throw fieldError('participantStudentIds', 'A chosen student does not exist.');
    await assertEligible(tx, chosen, eligibility.populations, access, 'participantStudentIds');
    const notifyUsers = (await userIdsForStaff(tx, [owner.id])).filter((u) => u !== actor.id);
    const [row] = await tx
      .insert(appointments)
      .values({
        type: input.type,
        title: input.title,
        organiserStaffId: organiser,
        staffId: owner.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        timezone: input.timezone,
        mode: input.mode,
        onlineLink: input.onlineLink ?? null,
        location: input.location ?? (input.mode === 'offline' ? DEFAULT_OFFLINE_LOCATION : null),
        capacity: input.capacity ?? null,
        audience: input.audience,
        purpose: input.purpose ?? null,
        status: 'scheduled',
        reminderStatus: notifyUsers.length ? 'sent_in_app' : 'not_applicable',
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error('event insert returned no row');
    await tx.insert(participants).values({
      appointmentId: row.id,
      kind: 'staff',
      staffId: owner.id,
      role: 'owner',
      nameSnapshot: owner.fullName,
      addedBy: actor.id,
    });
    const { people, withoutIdentity } = await audienceStudents(
      tx,
      input.audience,
      eligibility.populations,
      access,
    );
    const picked = new Set(named.map((n) => n.studentId));
    const snapshot = await participantRows(
      tx,
      actor,
      row.id,
      people.filter((p) => !picked.has(p.studentId)),
      'audience_snapshot',
      eligibility.includeGuardians,
    );
    const manual = await participantRows(
      tx,
      actor,
      row.id,
      named,
      'manual',
      eligibility.includeGuardians,
    );
    await notifyHosted(tx, actor, notifyUsers, MEETINGS, `/meetings?open=${row.id}`, {
      kind: 'appointment.scheduled',
      title: `${APPOINTMENT_TYPE_LABELS[row.type]} scheduled: ${row.title}`,
      body: `${fmtDateTime(row.startsAt)}. Nothing has been sent to participants; messages go out only from “Preview message”.`,
      entityType: 'appointment',
      entityId: row.id,
    });
    await audit(
      tx,
      actor,
      row.id,
      'event.scheduled',
      { after: row, metadata: { snapshot, manual, withoutIdentity } },
      requestId,
    );
    return { ...row, participantsAdded: snapshot + manual, withoutIdentity };
  });
}

const EDIT_FIELDS = [
  'type',
  'title',
  'onlineLink',
  'location',
  'capacity',
  'purpose',
  'audience',
] as const;

/** PATCH /appointments/{id} `edit` — details and filter; the participant list is never rewritten. */
export async function editEvent(
  db: Database,
  actor: Actor,
  id: string,
  edit: EventEdit,
  requestId?: string,
) {
  const eligibility = (await loadSettings(db))['events.eligibility'].value;
  if (edit.audience) eligibleOrThrow(edit.audience, eligibility.populations);
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const changed = EDIT_FIELDS.filter(
      (f) => edit[f] !== undefined && JSON.stringify(edit[f]) !== JSON.stringify(row[f]),
    );
    if (!changed.length) return row;
    if (edit.capacity && edit.capacity < (await registeredCount(tx, row.id)))
      throw fieldError('capacity', 'More people are already registered than this capacity.');
    const [after] = await tx
      .update(appointments)
      .set(Object.fromEntries(changed.map((f) => [f, edit[f]])))
      .where(eq(appointments.id, row.id))
      .returning();
    const text = (v: unknown) =>
      v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    await tx.insert(opsAppointmentChanges).values(
      changed.map((f) => ({
        appointmentId: row.id,
        field: f,
        previousValue: text(row[f]),
        newValue: text(edit[f]),
        actorUserId: actor.id,
      })),
    );
    await audit(tx, actor, row.id, 'event.edited', { before: row, after }, requestId);
    return after;
  });
}

/** POST /appointments/{id}/participants — an explicit addition (kept apart from the snapshot). */
export async function addParticipant(
  db: Database,
  actor: Actor,
  id: string,
  studentId: string,
  requestId?: string,
) {
  const eligibility = (await loadSettings(db))['events.eligibility'].value;
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    if (!(BLOCKING_STATUSES as readonly string[]).includes(row.status))
      throw new InvalidStateTransitionError(`A ${row.status} event takes no new participants.`);
    const student = await rowById(tx, students, studentId, 'Student');
    await assertEligible(
      tx,
      [student.id],
      eligibility.populations,
      await accessScope(tx, actor, 'ops:appointments:manage'),
      'studentId',
    );
    const [already] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.appointmentId, row.id),
          eq(participants.studentId, student.id),
          isNull(participants.removedAt),
        ),
      );
    if (already) throw new ConflictError(`${student.fullName} is already a participant.`);
    const added = await participantRows(
      tx,
      actor,
      row.id,
      [{ studentId: student.id, fullName: student.fullName }],
      'manual',
      eligibility.includeGuardians,
    );
    await audit(
      tx,
      actor,
      row.id,
      'event.participant_added',
      { metadata: { studentId: student.id, rows: added } },
      requestId,
    );
    return { added };
  });
}

/** PATCH /appointments/{id}/participants — remove (kept, with who and why), registration, attendance. */
export async function changeParticipant(
  db: Database,
  actor: Actor,
  id: string,
  change: ParticipantChange,
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const [p] = await tx
      .select()
      .from(participants)
      .where(
        and(eq(participants.id, change.participantId), eq(participants.appointmentId, row.id)),
      );
    if (!p) throw fieldError('participantId', 'Not a participant of this event.');
    if (p.removedAt) throw new ConflictError('This participant was already removed.');
    const patch: Partial<typeof participants.$inferInsert> = {};
    if (change.action === 'remove')
      Object.assign(patch, {
        removedAt: new Date(),
        removedBy: actor.id,
        removedReason: change.reason,
      });
    else {
      if (change.attendance && change.attendance !== 'not_recorded' && row.startsAt > new Date())
        throw fieldError('attendance', 'Record attendance once the event has started.');
      if (
        change.registrationStatus === 'registered' &&
        p.registrationStatus !== 'registered' &&
        row.capacity !== null &&
        (await registeredCount(tx, row.id)) >= row.capacity
      )
        throw new ConflictError(`The event is full (capacity ${row.capacity}).`);
      Object.assign(patch, {
        ...(change.registrationStatus ? { registrationStatus: change.registrationStatus } : {}),
        ...(change.attendance ? { attendance: change.attendance } : {}),
      });
    }
    if (!Object.keys(patch).length) return p;
    const [after] = await tx
      .update(participants)
      .set(patch)
      .where(eq(participants.id, p.id))
      .returning();
    // A removed student's guardians were invited through them: remove them too (kept, with why).
    const guardiansRemoved =
      change.action === 'remove' && p.studentId
        ? await tx
            .update(participants)
            .set({ ...patch, removedReason: `Student removed: ${change.reason}` })
            .where(
              and(
                eq(participants.appointmentId, row.id),
                isNull(participants.removedAt),
                inArray(
                  participants.guardianId,
                  tx
                    .select({ id: opsGuardians.id })
                    .from(opsGuardians)
                    .where(eq(opsGuardians.studentId, p.studentId)),
                ),
              ),
            )
            .returning({ id: participants.id })
        : [];
    await audit(
      tx,
      actor,
      row.id,
      `event.participant_${change.action === 'remove' ? 'removed' : 'updated'}`,
      { before: p, after, metadata: { guardiansRemoved: guardiansRemoved.length } },
      requestId,
    );
    return after;
  });
}
