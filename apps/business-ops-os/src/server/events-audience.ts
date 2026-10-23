/**
 * Event audiences (A-EVT-1) shared by ./events.ts and ./events-messages.ts: the locked event,
 * the `events.eligibility` populations within the actor's scope, and participant rows.
 */
import { and, eq, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import {
  opsAdmissions,
  opsAppointmentParticipants as participants,
  opsAppointments as appointments,
  opsGuardians,
  opsLeads,
  programmes,
  students,
  type Database,
} from '@elevate/database';
import { InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { StudentIdentityId } from '@elevate/shared-types';
import { isGroupType } from '../domain/appointments';
import { ACTIVE_CASE_STATUSES } from '../domain/student-lifecycle';
import type { EventAudience } from './appointments-schemas';
import { accessScope, assertScope, type AccessScope, type Actor } from './context';
import { fieldError, rowById } from './ops-common';
import { activeCase, noOtherCase, ownCase, pastCase } from './students';

export type Row = typeof appointments.$inferSelect;
export type Tx = Database;
const PRE_DEMO = ['new', 'contacted', 'counselling_scheduled', 'counselled'] as const;

/** The event (locked), refusing one-to-one appointments and records outside the actor's scope. */
export async function lockEvent(tx: Tx, actor: Actor, id: string) {
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
export async function assertEligible(
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
export async function audienceStudents(
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
export async function participantRows(
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

export const eligibleOrThrow = (a: EventAudience, eligible: readonly string[]) => {
  const bad = a.populations.filter((p) => !eligible.includes(p));
  if (bad.length)
    throw fieldError(
      'audience.populations',
      `Not allowed by setting “Event and webinar audience”: ${bad.join(', ')}.`,
    );
};

export async function registeredCount(tx: Tx, appointmentId: Row['id']) {
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
