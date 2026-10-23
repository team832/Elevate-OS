/**
 * Per-student lookups for the student lists (split from ./students): Academic delivery state,
 * admission numbers, programmes, upcoming meetings and the latest status change.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  eventDeliveries,
  opsAdmissions,
  opsAdmissionTransitions,
  opsAppointments,
  programmes,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { IntegrationEventId, StudentIdentityId } from '@elevate/shared-types';
import { BLOCKING_STATUSES } from '../domain/appointments';
import { COHORT_PROGRAMMES, combinationLabel } from '../domain/catalog';
import { ACADEMIC_INTAKE_CONSUMER } from './admissions';
import { groupBy } from './ops-common';

export async function deliveriesFor(db: Database, eventIds: readonly (string | null)[]) {
  const ids = [...new Set(eventIds.filter((e): e is string => Boolean(e)))] as IntegrationEventId[];
  if (!ids.length)
    return new Map<string, { status: string; attempts: number; lastError: string | null }>();
  const rows = await db
    .select({
      eventId: eventDeliveries.eventId,
      status: eventDeliveries.status,
      attempts: eventDeliveries.attempts,
      lastError: eventDeliveries.lastError,
    })
    .from(eventDeliveries)
    .where(
      and(
        inArray(eventDeliveries.eventId, ids),
        eq(eventDeliveries.consumer, ACADEMIC_INTAKE_CONSUMER),
      ),
    );
  return new Map(rows.map((r) => [r.eventId as string, r]));
}

/** The admission number of each identity (on its numbered case). */
export async function numbersByIdentity(db: Database, ids: readonly (string | null)[]) {
  const unique = uniqueIds(ids);
  if (!unique.length) return new Map<string, string>();
  const rows = await db
    .select({ id: opsAdmissions.studentId, n: opsAdmissions.admissionNumber })
    .from(opsAdmissions)
    .where(and(inArray(opsAdmissions.studentId, unique), isNotNull(opsAdmissions.admissionNumber)))
    .orderBy(asc(opsAdmissions.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (r.id && r.n && !out.has(r.id)) out.set(r.id, r.n);
  return out;
}

export const uniqueIds = (ids: readonly (string | null)[]) =>
  [...new Set(ids.filter((i): i is string => Boolean(i)))] as StudentIdentityId[];

/** Programmes of each identity across all its cases (a cohort and an exam are two cases). */
export async function programmesByIdentity(db: Database, ids: readonly (string | null)[]) {
  const unique = uniqueIds(ids);
  if (!unique.length) return new Map<string, { code: string; name: string }[]>();
  const rows = await db
    .selectDistinct({ id: opsAdmissions.studentId, code: programmes.code, name: programmes.name })
    .from(opsAdmissions)
    .innerJoin(programmes, eq(programmes.id, opsAdmissions.programmeId))
    .where(inArray(opsAdmissions.studentId, unique));
  return groupBy(rows, (r) => r.id);
}

/** The cohort programme of a combination, or `none` (an entrance programme only). */
export const cohortOf = (codes: readonly string[]) =>
  codes.find((c) => (COHORT_PROGRAMMES as readonly string[]).includes(c)) ?? 'none';

export const combinationOf = (progs: readonly { code: string; name: string }[] = []) =>
  progs.length
    ? combinationLabel(
        progs.map((p) => p.code),
        Object.fromEntries(progs.map((p) => [p.code, p.name])),
      )
    : 'Programme not set';

/** Meetings still to happen (proposed, scheduled, confirmed, rescheduled; from now). */
export const upcoming = (now: Date) =>
  and(inArray(opsAppointments.status, [...BLOCKING_STATUSES]), gte(opsAppointments.startsAt, now));

/** Upcoming meetings of each identity: linked to the student or to one of their cases. */
export async function meetingsByIdentity(db: Database, ids: readonly (string | null)[], now: Date) {
  const unique = uniqueIds(ids);
  if (!unique.length)
    return new Map<string, { startsAt: Date; type: string; staffName: string }[]>();
  const rows = await db
    .select({
      studentId: sql<
        string | null
      >`coalesce(${opsAppointments.studentId}, ${opsAdmissions.studentId})`,
      startsAt: opsAppointments.startsAt,
      type: opsAppointments.type,
      staffName: staffMembers.fullName,
    })
    .from(opsAppointments)
    .leftJoin(opsAdmissions, eq(opsAdmissions.id, opsAppointments.admissionId))
    .innerJoin(staffMembers, eq(staffMembers.id, opsAppointments.staffId))
    .where(
      and(
        upcoming(now),
        or(inArray(opsAppointments.studentId, unique), inArray(opsAdmissions.studentId, unique)),
      ),
    )
    .orderBy(asc(opsAppointments.startsAt));
  return groupBy(rows, (r) => r.studentId);
}

/** The latest status change of each case: when, and who recorded it (hold, exit). */
export async function latestChanges(db: Database, admissionIds: readonly string[]) {
  if (!admissionIds.length) return new Map<string, { at: Date; byName: string | null }>();
  const rows = await db
    .select({
      admissionId: opsAdmissionTransitions.admissionId,
      at: opsAdmissionTransitions.at,
      byName: users.displayName,
    })
    .from(opsAdmissionTransitions)
    .leftJoin(users, eq(users.id, opsAdmissionTransitions.actorUserId))
    .where(inArray(opsAdmissionTransitions.admissionId, admissionIds as never[]))
    .orderBy(desc(opsAdmissionTransitions.at));
  const out = new Map<string, { at: Date; byName: string | null }>();
  for (const r of rows) if (!out.has(r.admissionId)) out.set(r.admissionId, r);
  return out;
}
