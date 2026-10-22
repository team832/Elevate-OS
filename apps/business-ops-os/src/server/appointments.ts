/**
 * Counselling & meeting appointments (OPS-008, owner brief 20 Oct 2026 §11): schedule,
 * confirm, reschedule, cancel, record the outcome, list. Double-booking is refused inside
 * the transaction (per-staff advisory lock, then the staff member's nearby appointments
 * locked FOR UPDATE and checked with domain/appointments.ts findClash). Student/guardian
 * counselling linked to an admission still drives the admission pipeline.
 * The assigned teacher is notified in-app; no email/SMS is sent ("simulated — not sent").
 * Events and webinars (audience, participants, messages) are ./events; they share these reads.
 */
import { and, asc, count, eq, gte, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointmentChanges,
  opsAppointmentParticipants,
  opsAppointments as appointments,
  opsDemoSessions,
  opsEventMessages,
  opsLeads,
  staffMembers,
  students,
  users,
  type Database,
  type OpsGuardianId,
} from '@elevate/database';
import { scopeFor } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { LeadId, StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import { addDays } from '../domain';
import {
  APPOINTMENT_TYPE_LABELS,
  BLOCKING_STATUSES,
  DEFAULT_OFFLINE_LOCATION,
  PIPELINE_COUNSELLING_TYPES,
  canMoveAppointment,
  findClash,
  type AppointmentStatus,
  type TimeSlot,
} from '../domain/appointments';
import { fmtDateTime, humanise } from '../ui/format';
import { lockAccessible } from './admissions';
import type {
  AppointmentChange,
  AppointmentFilters,
  AppointmentInput,
} from './appointments-schemas';
import {
  accessScope,
  activeStaff,
  assertScope,
  notFound,
  programmeByCode,
  staffIdForUser,
  userIdsForStaff,
  type AccessScope,
  type Actor,
} from './context';
import { createRuleFollowUp } from './follow-ups';
import { fieldError, opsAudit, rowById } from './ops-common';
import { applyTransition } from './pipeline';
import { loadSettings } from './settings';
import { notifyHosted } from './task-links';

/**
 * Meeting notifications open `/meetings` in the recipient's workspace: Ops (schedule and change)
 * or Academic ("My meetings", read-only, D-073).
 */
export const MEETINGS = 'meetings';

type Row = typeof appointments.$inferSelect;
const audit = opsAudit('appointment');
const DAY_MS = 86_400_000;
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

/** Appointment ids where any of `staffIds` takes part (assigned or as a participant). */
export const involving = (db: Database, staffIds: StaffMemberId[]) =>
  or(
    inArray(appointments.staffId, staffIds),
    inArray(
      appointments.id,
      db
        .select({ id: opsAppointmentParticipants.appointmentId })
        .from(opsAppointmentParticipants)
        .where(inArray(opsAppointmentParticipants.staffId, staffIds)),
    ),
  );

/**
 * Refuse a slot that overlaps another blocking appointment or a scheduled demo class of
 * the same staff. Bookings for a staff member are serialised by a transaction-scoped
 * advisory lock, so two concurrent bookings cannot both pass; nearby rows are also
 * locked FOR UPDATE.
 */
export async function assertFree(
  tx: Database,
  staffIds: StaffMemberId[],
  slot: TimeSlot,
  rule: { bufferMinutes: number; defaultDurationMinutes: number },
  excludeId?: string,
) {
  const ids = [...new Set(staffIds)].sort();
  for (const id of ids)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ops.appointments.${id}`}))`);
  const from = new Date(slot.startsAt.getTime() - DAY_MS);
  const to = new Date(slot.endsAt.getTime() + DAY_MS);
  const nearby = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      type: appointments.type,
      staffId: appointments.staffId,
    })
    .from(appointments)
    .where(
      and(
        involving(tx, ids),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
      ),
    )
    .for('update');
  const demos = await tx
    .select({
      id: opsDemoSessions.id,
      startsAt: opsDemoSessions.startsAt,
      endsAt: opsDemoSessions.endsAt,
      staffId: opsDemoSessions.teacherStaffId,
    })
    .from(opsDemoSessions)
    .where(
      and(
        inArray(opsDemoSessions.teacherStaffId, ids),
        inArray(opsDemoSessions.attendance, ['scheduled', 'rescheduled']),
        gte(opsDemoSessions.startsAt, from),
        lt(opsDemoSessions.startsAt, to),
      ),
    );
  const busy = [
    ...nearby.map((a) => ({ ...a, label: APPOINTMENT_TYPE_LABELS[a.type].toLowerCase() })),
    ...demos.map((d) => ({
      ...d,
      endsAt: d.endsAt ?? new Date(d.startsAt.getTime() + rule.defaultDurationMinutes * 60_000),
      status: 'scheduled' as const,
      label: 'demo class',
    })),
  ];
  const clash = findClash({ ...slot, id: excludeId }, busy, rule.bufferMinutes);
  if (!clash) return;
  const [who] = clash.staffId
    ? await tx
        .select({ name: staffMembers.fullName })
        .from(staffMembers)
        .where(eq(staffMembers.id, clash.staffId))
    : [];
  const message = `Clashes with ${who?.name ?? 'another'}'s ${clash.label} ${fmtDateTime(clash.startsAt)} – ${fmtDateTime(clash.endsAt)} (${humanise(clash.status)}).`;
  throw new ConflictError(message, {
    details: [{ location: 'body', path: ['startsAt'], message }],
  });
}

export async function ownStaff(db: Database, actor: Actor, access: AccessScope) {
  const staffId = access.scope === 'own' ? access.staffId : await staffIdForUser(db, actor.id);
  if (access.scope === 'own' && !staffId)
    throw new ForbiddenError('Your login is not linked to a staff record.');
  return staffId;
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

// --- reads ----------------------------------------------------------------------------------

const listColumns = {
  a: appointments,
  staffName: staffMembers.fullName,
  studentName: students.fullName,
  studentSample: students.isSample,
  leadName: opsLeads.studentName,
  // Events: people listed (staff and removed excluded, as on the event page) and the latest message.
  participantCount: sql<number>`(SELECT count(*)::int FROM ${opsAppointmentParticipants} WHERE ${opsAppointmentParticipants.appointmentId} = ${appointments.id} AND ${opsAppointmentParticipants.kind} <> 'staff' AND ${opsAppointmentParticipants.removedAt} IS NULL)`,
  latestMessageStatus: sql<
    (typeof opsEventMessages.$inferSelect)['status'] | null
  >`(SELECT ${opsEventMessages.status} FROM ${opsEventMessages} WHERE ${opsEventMessages.appointmentId} = ${appointments.id} ORDER BY ${opsEventMessages.createdAt} DESC, ${opsEventMessages.id} DESC LIMIT 1)`,
};

const baseSelect = (db: Database) =>
  db
    .select(listColumns)
    .from(appointments)
    .innerJoin(staffMembers, eq(staffMembers.id, appointments.staffId))
    .leftJoin(students, eq(students.id, appointments.studentId))
    .leftJoin(opsLeads, eq(opsLeads.id, appointments.leadId));

const flatten = ({
  a,
  ...r
}: Awaited<ReturnType<ReturnType<typeof baseSelect>['execute']>>[number]) => ({
  ...a,
  ...r,
  personName: a.title ?? r.studentName ?? r.leadName ?? 'Unknown student',
});
export type AppointmentListRow = ReturnType<typeof flatten>;

function ownFilter(db: Database, access: AccessScope): SQL | undefined {
  if (access.scope === 'all') return undefined;
  if (!access.staffId) return sql`false`;
  return or(eq(appointments.organiserStaffId, access.staffId), involving(db, [access.staffId]));
}

/** Appointments whose student or lead name contains `q` (subqueries, so the count query needs no joins). */
function nameMatches(db: Database, q: string) {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return or(
    inArray(
      appointments.studentId,
      db
        .select({ id: students.id })
        .from(students)
        .where(sql`${students.fullName} ILIKE ${like}`),
    ),
    inArray(
      appointments.leadId,
      db
        .select({ id: opsLeads.id })
        .from(opsLeads)
        .where(sql`${opsLeads.studentName} ILIKE ${like}`),
    ),
  );
}

export async function listAppointments(
  db: Database,
  actor: Actor,
  filters: Partial<AppointmentFilters> = {},
  pageSize = 25,
) {
  const access = await accessScope(db, actor, 'ops:appointments:read');
  const where = and(
    ownFilter(db, access),
    filters.type ? eq(appointments.type, filters.type) : undefined,
    filters.status ? eq(appointments.status, filters.status) : undefined,
    filters.staffId ? involving(db, [filters.staffId as StaffMemberId]) : undefined,
    filters.studentId
      ? eq(appointments.studentId, filters.studentId as StudentIdentityId)
      : undefined,
    filters.q ? nameMatches(db, filters.q) : undefined,
    filters.from
      ? gte(appointments.startsAt, new Date(`${filters.from}T00:00:00+05:30`))
      : undefined,
    filters.to
      ? lt(appointments.startsAt, new Date(`${addDays(filters.to, 1)}T00:00:00+05:30`))
      : undefined,
  );
  if (filters.from && filters.to && filters.from > filters.to)
    throw fieldError('to', '"To" must not be before "from".');
  const page = filters.page ?? 1;
  const [rows, [total]] = await Promise.all([
    baseSelect(db)
      .where(where)
      .orderBy(asc(appointments.startsAt), asc(appointments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(appointments).where(where),
  ]);
  return { rows: rows.map(flatten), total: total?.n ?? 0, page, pageSize };
}

/**
 * "My meetings" (D-073): appointments and events the caller takes part in (assigned or as a
 * participant), whatever their scope; null when their login has no staff record.
 */
export async function listMyMeetings(
  db: Database,
  actor: Actor,
  filters: Partial<Pick<AppointmentFilters, 'from' | 'to' | 'page'>>,
  pageSize = 25,
) {
  const staffId = await staffIdForUser(db, actor.id);
  return staffId ? listAppointments(db, actor, { ...filters, staffId }, pageSize) : null;
}

export async function getAppointment(db: Database, actor: Actor, id: string) {
  const access = await accessScope(db, actor, 'ops:appointments:read');
  const [found] = await baseSelect(db).where(eq(appointments.id, id as Row['id']));
  if (!found) notFound('Appointment');
  const row = flatten(found);
  const [participants, messages] = await Promise.all([
    db
      .select({
        p: opsAppointmentParticipants,
        staffName: staffMembers.fullName,
        studentName: students.fullName,
      })
      .from(opsAppointmentParticipants)
      .leftJoin(staffMembers, eq(staffMembers.id, opsAppointmentParticipants.staffId))
      .leftJoin(students, eq(students.id, opsAppointmentParticipants.studentId))
      .where(eq(opsAppointmentParticipants.appointmentId, row.id))
      .orderBy(asc(opsAppointmentParticipants.addedAt)),
    db
      .select()
      .from(opsEventMessages)
      .where(eq(opsEventMessages.appointmentId, row.id))
      .orderBy(asc(opsEventMessages.createdAt)),
  ]);
  assertScope(
    access,
    [row.staffId, row.organiserStaffId, ...participants.map((p) => p.p.staffId)],
    'appointments',
  );
  const changes = await db
    .select({ c: opsAppointmentChanges, actorName: users.displayName })
    .from(opsAppointmentChanges)
    .leftJoin(users, eq(users.id, opsAppointmentChanges.actorUserId))
    .where(eq(opsAppointmentChanges.appointmentId, row.id))
    .orderBy(asc(opsAppointmentChanges.at));
  // Names only, never a contact; a guardian's name needs ops:student_private:read.
  // All-scope only: an own-scope holder may see private data of their own students, not of a cohort.
  const privateData = scopeFor(actor, 'ops:student_private:read') === 'all';
  return {
    ...row,
    participants: participants.map(({ p, staffName, studentName }) => ({
      ...p,
      name:
        p.kind === 'guardian' && !privateData
          ? 'Guardian (restricted)'
          : (p.nameSnapshot ?? staffName ?? studentName ?? 'Not recorded'),
      nameSnapshot: p.kind === 'guardian' && !privateData ? null : p.nameSnapshot,
    })),
    messages,
    changes: changes.map(({ c, actorName }) => ({ ...c, actorName })),
  };
}

/** Student options for the schedule form (canonical identities; names only, no contacts). */
export async function studentPickerOptions(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:appointments:manage');
  const rows = await db
    .select({ id: students.id, fullName: students.fullName, isSample: students.isSample })
    .from(students)
    .orderBy(asc(students.fullName))
    .limit(500);
  return rows.map((s) => ({
    value: s.id,
    label: s.isSample ? `${s.fullName} — sample` : s.fullName,
  }));
}
