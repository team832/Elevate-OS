/**
 * Appointment slots: who takes part, the double-booking guard (advisory lock + FOR UPDATE +
 * domain findClash) and the booking staff member. Shared by ./appointments.ts and ./events.ts.
 */
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import {
  opsAppointmentParticipants,
  opsAppointments as appointments,
  opsDemoSessions,
  staffMembers,
  type Database,
} from '@elevate/database';
import { ConflictError, ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import {
  APPOINTMENT_TYPE_LABELS,
  BLOCKING_STATUSES,
  findClash,
  type TimeSlot,
} from '../domain/appointments';
import { fmtDateTime, humanise } from '../ui/format';
import { staffIdForUser, type AccessScope, type Actor } from './context';

/**
 * Meeting notifications open `/meetings` in the recipient's workspace: Ops (schedule and change)
 * or Academic ("My meetings", read-only, D-073).
 */
export const MEETINGS = 'meetings';

const DAY_MS = 86_400_000;

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
