/**
 * Events, webinars and their messages (owner brief §12), on `ops.appointments` (types `event`,
 * `webinar`). Scheduling resolves the audience ONCE into participant rows (`audience_snapshot`,
 * name kept); later additions and removals are explicit rows, and editing the filter never
 * rewrites them. Scheduling sends nothing: a message is drafted with a preview, then sent only
 * by an explicit action holding `ops:event_messages:send`, through the messaging adapter
 * (no provider → `simulated`, never `sent`). Contacts are read only to count and send; they
 * never leave this file. Algorithms: A-EVT-1 (audience), A-EVT-2 (reach), A-EVT-3 (send).
 */
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointmentChanges,
  opsAppointmentParticipants as participants,
  opsAppointments as appointments,
  opsContactPreferences,
  opsEventMessages,
  opsGuardians,
  opsLeads,
  programmes,
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
  isGroupType,
  messageStatus,
  reachable,
  type MessageChannel,
} from '../domain/appointments';
import { ACTIVE_CASE_STATUSES } from '../domain/student-lifecycle';
import { fmtDateTime } from '../ui/format';
import { getMessagingAdapter } from './adapters/messaging';
import { assertFree, MEETINGS, ownStaff } from './appointments';
import type {
  EventAudience,
  EventEdit,
  EventInput,
  ParticipantChange,
} from './appointments-schemas';
import {
  accessScope,
  activeStaff,
  assertScope,
  userIdsForStaff,
  type AccessScope,
  type Actor,
} from './context';
import { fieldError, opsAudit, rowById } from './ops-common';
import { loadSettings } from './settings';
import { notifyHosted } from './task-links';
import { activeCase, noOtherCase, ownCase, pastCase } from './students';

const audit = opsAudit('appointment');
type Row = typeof appointments.$inferSelect;
type Tx = Database;
const PRE_DEMO = ['new', 'contacted', 'counselling_scheduled', 'counselled'] as const;

/** The event (locked), refusing one-to-one appointments and records outside the actor's scope. */
async function lockEvent(tx: Tx, actor: Actor, id: string) {
  const row = await rowById(tx, appointments, id, 'Event', true);
  if (!isGroupType(row.type))
    throw new InvalidStateTransitionError('Only events and webinars have an audience.');
  assertScope(
    await accessScope(tx, actor, 'ops:appointments:manage'),
    [row.staffId, row.organiserStaffId],
    'events',
  );
  return row;
}

/**
 * Cases in any of these populations (lead, demo, active, past: the directory rules on the case
 * itself, so a multi-programme student matches on any case) and inside the actor's scope: an
 * own-scope user reaches only students whose case they counsel or whose lead they own.
 */
const inPopulations = (tx: Tx, populations: readonly string[], access: AccessScope) =>
  and(
    or(
      ...populations.map(
        (p) =>
          ({
            lead: inArray(opsAdmissions.status, [...PRE_DEMO]),
            demo: inArray(opsAdmissions.status, ['demo_scheduled', 'demo_attended']),
            active: inArray(opsAdmissions.status, [...ACTIVE_CASE_STATUSES]),
            past: and(pastCase(), noOtherCase(tx, activeCase)),
          })[p],
      ),
    ),
    ownCase(tx, access),
  );

/** Students named by hand follow the same `events.eligibility` rule as the audience. */
async function assertEligible(
  tx: Tx,
  ids: readonly StudentIdentityId[],
  eligible: readonly string[],
  access: AccessScope,
  path: string,
) {
  if (!ids.length) return;
  const ok = await tx
    .selectDistinct({ id: opsAdmissions.studentId })
    .from(opsAdmissions)
    .where(and(inArray(opsAdmissions.studentId, [...ids]), inPopulations(tx, eligible, access)));
  const outside = ids.length - ok.length;
  if (outside)
    throw fieldError(
      path,
      `${outside === 1 ? 'This student is' : `${outside} chosen students are`} not in the groups allowed by setting “Event and webinar audience” (${eligible.join(', ')}).`,
    );
}

const hasFilter = (a: EventAudience) =>
  a.populations.length + a.programmeCodes.length + a.stages.length + a.batchIds.length > 0;

/**
 * A-EVT-1: canonical students matching the audience (every filter must match the same case).
 * Cases without a student identity yet (e.g. a lead) cannot be participants and are counted.
 */
async function audienceStudents(
  tx: Tx,
  a: EventAudience,
  eligible: readonly string[],
  access: AccessScope,
) {
  if (!hasFilter(a)) return { people: [], withoutIdentity: 0 };
  const rows = await tx
    .select({ studentId: opsAdmissions.studentId, fullName: students.fullName })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .leftJoin(students, eq(students.id, opsAdmissions.studentId))
    .where(
      and(
        inPopulations(tx, a.populations.length ? a.populations : eligible, access),
        a.programmeCodes.length ? inArray(programmes.code, a.programmeCodes) : undefined,
        a.stages.length ? inArray(opsLeads.currentStage, a.stages) : undefined,
        a.batchIds.length
          ? or(
              inArray(opsAdmissions.enrolledBatchId, a.batchIds as never[]),
              inArray(opsAdmissions.intendedBatchId, a.batchIds as never[]),
            )
          : undefined,
      ),
    );
  const people = new Map(rows.filter((r) => r.studentId).map((r) => [r.studentId!, r.fullName!]));
  return {
    people: [...people].map(([studentId, fullName]) => ({ studentId, fullName })),
    withoutIdentity: rows.filter((r) => !r.studentId).length,
  };
}

/** Participant rows for students (and their live guardians when the setting includes them). */
async function participantRows(
  tx: Tx,
  actor: Actor,
  appointmentId: Row['id'],
  people: readonly { studentId: StudentIdentityId; fullName: string }[],
  addedVia: 'audience_snapshot' | 'manual',
  includeGuardians: boolean,
) {
  const ids = people.map((p) => p.studentId);
  // Guardians already live on the event are not added twice.
  const guardians =
    includeGuardians && ids.length
      ? await tx
          .select()
          .from(opsGuardians)
          .where(
            and(
              inArray(opsGuardians.studentId, ids),
              isNull(opsGuardians.archivedAt),
              notInArray(
                opsGuardians.id,
                tx
                  .select({ id: participants.guardianId })
                  .from(participants)
                  .where(
                    and(
                      eq(participants.appointmentId, appointmentId),
                      isNull(participants.removedAt),
                      isNotNull(participants.guardianId),
                    ),
                  ),
              ),
            ),
          )
      : [];
  const base = {
    appointmentId,
    addedVia,
    addedBy: actor.id,
    registrationStatus: 'invited' as const,
  };
  const values = [
    ...people.map((p) => ({
      ...base,
      kind: 'student' as const,
      studentId: p.studentId,
      role: 'student',
      nameSnapshot: p.fullName,
    })),
    ...guardians.map((g) => ({
      ...base,
      kind: 'guardian' as const,
      guardianId: g.id,
      role: g.relationship,
      nameSnapshot: g.fullName,
    })),
  ];
  if (values.length) await tx.insert(participants).values(values);
  return values.length;
}

const eligibleOrThrow = (a: EventAudience, eligible: readonly string[]) => {
  const bad = a.populations.filter((p) => !eligible.includes(p));
  if (bad.length)
    throw fieldError(
      'audience.populations',
      `Not allowed by setting “Event and webinar audience”: ${bad.join(', ')}.`,
    );
};

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

async function registeredCount(tx: Tx, appointmentId: Row['id']) {
  const rows = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.appointmentId, appointmentId),
        eq(participants.registrationStatus, 'registered'),
        isNull(participants.removedAt),
      ),
    );
  return rows.length;
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

/**
 * Contacts of the event's current participants on one channel, with consent applied (A-EVT-2).
 * Declined and removed participants are skipped. Contacts never leave the server.
 */
async function recipients(tx: Tx, appointmentId: Row['id'], channel: MessageChannel) {
  const rows = await tx
    .select({ p: participants, g: opsGuardians })
    .from(participants)
    .leftJoin(opsGuardians, eq(opsGuardians.id, participants.guardianId))
    .where(
      and(
        eq(participants.appointmentId, appointmentId),
        inArray(participants.kind, ['student', 'guardian']),
        isNull(participants.removedAt),
        or(
          isNull(participants.registrationStatus),
          ne(participants.registrationStatus, 'declined'),
        ),
      ),
    );
  const studentOf = (r: (typeof rows)[number]) => (r.p.studentId ?? r.g?.studentId)!;
  const ids = [...new Set(rows.map(studentOf))];
  const leads = ids.length
    ? await tx
        .select({ studentId: opsAdmissions.studentId, lead: opsLeads, pref: opsContactPreferences })
        .from(opsAdmissions)
        .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
        .leftJoin(opsContactPreferences, eq(opsContactPreferences.leadId, opsLeads.id))
        .where(and(inArray(opsAdmissions.studentId, ids), isNotNull(opsAdmissions.studentId)))
    : [];
  const field = channel === 'email' ? 'Email' : 'Phone';
  const out: string[] = [];
  for (const r of rows) {
    const mine = leads.filter((l) => l.studentId === studentOf(r));
    const contact = r.g
      ? r.g[channel === 'email' ? 'email' : 'phone']
      : (mine.map((l) => l.lead[`student${field}`]).find(Boolean) ?? null);
    const ok = reachable(channel, {
      contact,
      preferences: mine.flatMap((l) => (l.pref ? [l.pref] : [])),
      ...(r.g ? { guardianConsent: r.g.consentStatus } : {}),
    });
    if (ok && contact) out.push(contact);
  }
  return { to: [...new Set(out)], unreachable: rows.length - out.length };
}

const NOT_CONNECTED =
  'No messaging provider is connected: sending will be recorded as “Simulated — not sent”.';

/** POST /appointments/{id}/messages — saves a draft and returns its preview; sends nothing. */
export async function draftEventMessage(
  db: Database,
  actor: Actor,
  id: string,
  input: { channel: MessageChannel; body: string },
  requestId?: string,
) {
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const { to, unreachable } = await recipients(tx, row.id, input.channel);
    const [message] = await tx
      .insert(opsEventMessages)
      .values({
        appointmentId: row.id,
        channel: input.channel,
        body: input.body,
        // Reach at preview time; replaced by the count at send time.
        recipientCount: to.length,
        createdBy: actor.id,
      })
      .returning();
    await audit(
      tx,
      actor,
      row.id,
      'event.message_drafted',
      {
        metadata: {
          messageId: message!.id,
          channel: input.channel,
          reachable: to.length,
          unreachable,
        },
      },
      requestId,
    );
    const adapter = getMessagingAdapter();
    return {
      ...message!,
      preview: {
        reachable: to.length,
        unreachable,
        providerConnected: adapter.connected,
        notice: adapter.connected ? null : NOT_CONNECTED,
      },
    };
  });
}

/** POST /appointments/{id}/messages/{messageId} — the explicit send (ops:event_messages:send). */
export async function sendEventMessage(
  db: Database,
  actor: Actor,
  id: string,
  messageId: string,
  requestId?: string,
) {
  await accessScope(db, actor, 'ops:event_messages:send');
  return withTransaction(db, async (tx) => {
    const row = await lockEvent(tx, actor, id);
    const message = await rowById(tx, opsEventMessages, messageId, 'Message', true);
    if (message.appointmentId !== row.id)
      throw fieldError('messageId', 'Not a message of this event.');
    if (message.status !== 'draft')
      throw new ConflictError('This message was already sent or simulated.');
    const { to } = await recipients(tx, row.id, message.channel as MessageChannel);
    // shortcut: provider call inside the transaction; move it to the outbox before a real provider is connected (a crash after sending would allow a re-send).
    const { providerRef } = await getMessagingAdapter().send({
      channel: message.channel as MessageChannel,
      body: message.body,
      to,
    });
    const status = messageStatus(providerRef);
    const [after] = await tx
      .update(opsEventMessages)
      .set({ status, providerRef, recipientCount: to.length, sentBy: actor.id, sentAt: new Date() })
      .where(eq(opsEventMessages.id, message.id))
      .returning();
    await audit(
      tx,
      actor,
      row.id,
      `event.message_${status}`,
      { metadata: { messageId: message.id, channel: message.channel, recipients: to.length } },
      requestId,
    );
    return after!;
  });
}
