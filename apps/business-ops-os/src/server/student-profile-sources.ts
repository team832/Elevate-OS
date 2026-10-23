/**
 * Reads behind the student profile (split from ./student-profile): resolving an id to its cases,
 * the audit timeline, Academic's enrolment replies, programme names and the primary guardian.
 */
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditEvents,
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsGuardians,
  opsLeads,
  programmes,
  users,
  type Database,
} from '@elevate/database';
import { NotFoundError } from '@elevate/shared-contracts';
import type {
  AdmissionId,
  IntegrationEventId,
  ProgrammeId,
  StudentIdentityId,
} from '@elevate/shared-types';
import { stripPrivateKeys } from '../domain/students';
import { caseState } from '../domain/student-lifecycle';
import { ENROLMENT_REPLIES_CONSUMER } from './enrolment';
import { KYC_ACTIONS } from './kyc';

/** Population order used to pick the case a profile opens on. */
const POPULATION_RANK = { active: 0, on_hold: 1, in_admission: 2, former: 3 } as const;

/** Resolve a canonical student id (or an admission id from older links) to its cases. */
export async function resolveStudent(db: Database, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError('Student not found.');
  const cases = () =>
    db
      .select({ a: opsAdmissions, lead: opsLeads })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId));
  const byIdentity = await cases()
    .where(eq(opsAdmissions.studentId, id as StudentIdentityId))
    .orderBy(desc(opsAdmissions.admittedAt));
  if (byIdentity.length) {
    const rank = (c: (typeof byIdentity)[number]) => POPULATION_RANK[caseState(c.a).population];
    const primary = [...byIdentity].sort((x, y) => rank(x) - rank(y))[0]!;
    return { primary, cases: byIdentity };
  }
  const [row] = await cases()
    .where(eq(opsAdmissions.id, id as AdmissionId))
    .limit(1);
  if (!row) throw new NotFoundError('Student not found.');
  // Opened by one case (list rows, older links): that case leads, the student's other cases come along.
  const all = row.a.studentId
    ? await cases()
        .where(eq(opsAdmissions.studentId, row.a.studentId))
        .orderBy(desc(opsAdmissions.admittedAt))
    : [row];
  return { primary: row, cases: all };
}

/** Audit events of the student's cases and identity, newest first (private keys removed). */
export async function timelineOf(
  db: Database,
  identityId: string | null,
  admissionIds: readonly string[],
) {
  const rows = await db
    .select({ e: auditEvents, actorName: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      or(
        and(
          eq(auditEvents.entityType, 'admission'),
          inArray(auditEvents.entityId, [...admissionIds]),
        ),
        identityId
          ? and(eq(auditEvents.entityType, 'student'), eq(auditEvents.entityId, identityId))
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(100);
  // KYC payloads (masked contacts, document references) are served only by the KYC history.
  const kyc = (action: string) => (KYC_ACTIONS as readonly string[]).includes(action);
  return rows.map(({ e, actorName }) => ({
    id: e.id,
    at: e.at,
    action: e.action,
    actorName: actorName ?? (e.actorType === 'user' ? 'Unknown user' : 'System'),
    entityId: e.entityId,
    before: kyc(e.action) ? null : stripPrivateKeys(e.before),
    after: kyc(e.action) ? null : stripPrivateKeys(e.after),
  }));
}

/** Replies Academic sent for the current request, and whether Ops applied them. */
export async function repliesOf(db: Database, requestEventId: IntegrationEventId | null) {
  if (!requestEventId) return [];
  return db
    .select({
      id: integrationEvents.id,
      type: integrationEvents.type,
      occurredAt: integrationEvents.occurredAt,
      opsStatus: eventDeliveries.status,
      opsError: eventDeliveries.lastError,
    })
    .from(integrationEvents)
    .leftJoin(
      eventDeliveries,
      and(
        eq(eventDeliveries.eventId, integrationEvents.id),
        eq(eventDeliveries.consumer, ENROLMENT_REPLIES_CONSUMER),
      ),
    )
    .where(
      and(
        eq(integrationEvents.correlationId, requestEventId),
        inArray(integrationEvents.type, [
          'academic.enrolment.confirmed',
          'academic.enrolment.rejected',
        ]),
      ),
    );
}

/** Code and name of the programmes of these cases, by id. */
export async function programmesOf(db: Database, ids: readonly (ProgrammeId | null)[]) {
  const rows = await db
    .select({ id: programmes.id, code: programmes.code, name: programmes.name })
    .from(programmes)
    .where(
      inArray(
        programmes.id,
        ids.filter((p): p is ProgrammeId => Boolean(p)),
      ),
    );
  return new Map(rows.map((p) => [p.id as string, p]));
}

/** The student's current primary guardian (header contact). */
export const primaryGuardianOf = (db: Database, identityId: StudentIdentityId) =>
  db
    .select({
      phone: opsGuardians.phone,
      relationship: opsGuardians.relationship,
      fullName: opsGuardians.fullName,
    })
    .from(opsGuardians)
    .where(
      and(
        eq(opsGuardians.studentId, identityId),
        eq(opsGuardians.isPrimary, true),
        isNull(opsGuardians.archivedAt),
      ),
    )
    .then((r) => r[0] ?? null);
