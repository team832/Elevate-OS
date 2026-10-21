/**
 * Private student data (owner brief §7; students may be minors): guardians and
 * contact preferences. Reading needs `ops:student_private:read` (own scope = a
 * case's counsellor or lead owner); writing guardians `ops:guardians:write`.
 * Exactly one live guardian is primary (the first by default; making another
 * primary moves the flag). The audit trail keeps masked contacts only (KYC history).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { scopeFor, type Permission } from '@elevate/authorization';
import {
  opsAdmissions,
  opsContactPreferences,
  opsGuardians,
  opsLeads,
  students,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { AdmissionId, LeadId, StudentIdentityId } from '@elevate/shared-types';
import { normaliseEmail, normalisePhone, PHONE_ERROR_MESSAGES } from '../domain';
import { maskEmail } from '../domain/kyc';
import { maskPhone } from '../domain/student-lifecycle';
import type { ContactPreferencesInput } from './admissions-schemas';
import {
  accessScope,
  assertScope,
  clean,
  staffIdForUser,
  type AccessScope,
  type Actor,
} from './context';
import { fieldError, opsAudit } from './ops-common';
import type { GuardianInput, GuardianPatch } from './students-schemas';

type Owners = readonly (string | null)[];

/** True when the caller may see private fields of a record owned by `owners`. */
async function canSeePrivate(db: Database, actor: Actor, owners: Owners) {
  const scope = scopeFor(actor, 'ops:student_private:read');
  if (scope === 'all') return true;
  if (scope !== 'own') return false;
  const staffId = await staffIdForUser(db, actor.id);
  return Boolean(staffId && owners.includes(staffId));
}

/** Write scope over `owners` plus the private-data check (403 with `message`). */
async function assertPrivateAccess(
  db: Database,
  actor: Actor,
  access: AccessScope,
  owners: Owners,
  what: string,
  message: string,
) {
  assertScope(access, owners, what);
  if (!(await canSeePrivate(db, actor, owners))) throw new ForbiddenError(message);
}

/** The profile's private data: contact preferences and guardians, or nothing when restricted. */
export async function privateDataOf(
  db: Database,
  actor: Actor,
  owners: Owners,
  leadId: LeadId,
  identityId: StudentIdentityId | null,
) {
  if (!(await canSeePrivate(db, actor, owners)))
    return { visible: false, prefs: undefined, guardians: 'hidden' as const };
  const [[prefs], guardians] = await Promise.all([
    db.select().from(opsContactPreferences).where(eq(opsContactPreferences.leadId, leadId)),
    identityId
      ? db
          .select()
          .from(opsGuardians)
          .where(eq(opsGuardians.studentId, identityId))
          .orderBy(asc(opsGuardians.archivedAt), asc(opsGuardians.createdAt))
      : ('hidden' as const),
  ]);
  return { visible: true, prefs, guardians };
}

/**
 * The cases of an identity and the access check for it (own scope = any of its cases) plus the
 * private-data check: KYC reads pass `ops:student_private:read`, writes the default.
 */
export async function identityAccess(
  db: Database,
  actor: Actor,
  identityId: string,
  permission: Permission = 'ops:guardians:write',
) {
  const access = await accessScope(db, actor, permission);
  const rows = await db
    .select({
      counsellor: opsAdmissions.counsellorStaffId,
      owner: opsLeads.ownerStaffId,
      leadId: opsLeads.id,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsAdmissions.studentId, identityId as StudentIdentityId));
  if (!rows.length) throw new NotFoundError('Student not found.');
  const owners = rows.flatMap((r) => [r.counsellor, r.owner]);
  await assertPrivateAccess(
    db,
    actor,
    access,
    owners,
    'students',
    'Guardian and identity details need ops:student_private:read.',
  );
  return rows[0]!.leadId;
}

function guardianContacts(input: Pick<GuardianInput, 'phone' | 'email'>) {
  const out: { phone?: string | null; email?: string | null } = {};
  const issue = (path: string, message: string) =>
    new ValidationError(message, { details: [{ location: 'body', path: [path], message }] });
  if (input.phone !== undefined) {
    if (!input.phone) out.phone = null;
    else {
      const p = normalisePhone(input.phone);
      if (!p.ok) throw issue('phone', PHONE_ERROR_MESSAGES[p.reason]);
      out.phone = p.e164;
    }
  }
  if (input.email !== undefined) {
    if (!input.email) out.email = null;
    else {
      const e = normaliseEmail(input.email);
      if (!e.ok) throw issue('email', 'Not a valid email address.');
      out.email = e.email;
    }
  }
  return out;
}

type Guardian = typeof opsGuardians.$inferSelect;

/** Guardian facts the audit trail (KYC history) keeps: contacts masked, no address text. */
const auditFacts = (g: Guardian) => ({
  guardianId: g.id,
  fullName: g.fullName,
  relationship: g.relationship,
  phone: maskPhone(g.phone),
  email: maskEmail(g.email),
  address: g.address ? 'recorded' : null,
  isPrimary: g.isPrimary,
  isEmergency: g.isEmergency,
  consentStatus: g.consentStatus,
  archived: Boolean(g.archivedAt),
});

/**
 * Live guardians of the student, locked so the primary flag moves atomically. The student row is
 * locked first, so two first-guardian adds at once queue instead of both seeing no guardian.
 */
const liveGuardians = async (tx: Database, identityId: string) => {
  await tx
    .select({ id: students.id })
    .from(students)
    .where(eq(students.id, identityId as StudentIdentityId))
    .for('update');
  return tx
    .select()
    .from(opsGuardians)
    .where(
      and(
        eq(opsGuardians.studentId, identityId as StudentIdentityId),
        isNull(opsGuardians.archivedAt),
      ),
    )
    .for('update');
};

/** Clear the primary flag of the other live guardians; returns their ids for the audit row. */
async function clearPrimary(tx: Database, others: readonly Guardian[]) {
  const demoted = others.filter((g) => g.isPrimary).map((g) => g.id);
  for (const id of demoted)
    await tx.update(opsGuardians).set({ isPrimary: false }).where(eq(opsGuardians.id, id));
  return demoted;
}

/** POST /students/{id}/guardians */
export async function addGuardian(
  db: Database,
  actor: Actor,
  identityId: string,
  input: GuardianInput,
  requestId?: string,
) {
  const leadId = await identityAccess(db, actor, identityId);
  const contacts = guardianContacts(input);
  return withTransaction(db, async (tx) => {
    const live = await liveGuardians(tx, identityId);
    const isPrimary = input.isPrimary || !live.some((g) => g.isPrimary);
    const demotedGuardianIds = isPrimary ? await clearPrimary(tx, live) : [];
    const [row] = await tx
      .insert(opsGuardians)
      .values({
        studentId: identityId as StudentIdentityId,
        leadId,
        fullName: input.fullName,
        relationship: input.relationship,
        ...contacts,
        address: clean(input.address),
        isPrimary,
        isEmergency: input.isEmergency ?? false,
        preferredContact: input.preferredContact ?? null,
        consentStatus: input.consentStatus,
        consentRecordedAt: input.consentStatus === 'not_recorded' ? null : new Date(),
        notes: clean(input.notes),
        createdBy: actor.id,
      })
      .returning();
    await opsAudit('student')(
      tx,
      actor,
      identityId,
      'guardian.added',
      { after: { ...auditFacts(row!), demotedGuardianIds } },
      requestId,
    );
    return row!;
  });
}

/**
 * PATCH /students/{id}/guardians/{guardianId} — edit or archive (never deleted). The primary
 * flag only moves: set it on another guardian; the primary is archived only when it is the last.
 */
export async function updateGuardian(
  db: Database,
  actor: Actor,
  identityId: string,
  guardianId: string,
  input: GuardianPatch,
  requestId?: string,
) {
  await identityAccess(db, actor, identityId);
  const { archived, phone, email, isPrimary, ...rest } = input;
  return withTransaction(db, async (tx) => {
    const live = await liveGuardians(tx, identityId);
    const [before] = await tx
      .select()
      .from(opsGuardians)
      .where(
        and(
          eq(opsGuardians.id, guardianId as never),
          eq(opsGuardians.studentId, identityId as StudentIdentityId),
        ),
      )
      .for('update');
    if (!before) throw new NotFoundError('Guardian not found.');
    const others = live.filter((g) => g.id !== before.id);
    const archiving = archived ?? Boolean(before.archivedAt);
    if (archiving && isPrimary)
      throw fieldError('isPrimary', 'An archived guardian cannot be primary.');
    if (archived && before.isPrimary && !before.archivedAt && others.length)
      throw fieldError('archived', 'Make another guardian primary before archiving this one.');
    if (isPrimary === false && before.isPrimary && !archiving)
      throw fieldError('isPrimary', 'Make another guardian primary instead.');
    // Archived guardians are never primary; a live one is primary when asked, when it already
    // was, or when no other live guardian is (exactly one live primary).
    const primary =
      !archiving && Boolean(isPrimary || before.isPrimary || !others.some((g) => g.isPrimary));
    const demotedGuardianIds = primary ? await clearPrimary(tx, others) : [];
    const consentChanged = rest.consentStatus && rest.consentStatus !== before.consentStatus;
    const [after] = await tx
      .update(opsGuardians)
      .set({
        ...rest,
        isPrimary: primary,
        address: rest.address === undefined ? undefined : clean(rest.address),
        notes: rest.notes === undefined ? undefined : clean(rest.notes),
        ...guardianContacts({ phone, email }),
        ...(consentChanged ? { consentRecordedAt: new Date() } : {}),
        ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
        updatedBy: actor.id,
      })
      .where(eq(opsGuardians.id, before.id))
      .returning();
    await opsAudit('student')(
      tx,
      actor,
      identityId,
      'guardian.updated',
      {
        before: auditFacts(before),
        after: { ...auditFacts(after!), fields: Object.keys(input), demotedGuardianIds },
      },
      requestId,
    );
    return after!;
  });
}

/** PUT /admissions/{id}/contact-preferences — consent and communication preferences (private). */
export async function recordContactPreferences(
  db: Database,
  actor: Actor,
  admissionId: string,
  input: ContactPreferencesInput,
  requestId?: string,
) {
  const write = await accessScope(db, actor, 'ops:admissions:write');
  await accessScope(db, actor, 'ops:student_private:read');
  if (input.consentStatus !== 'given' && input.allowedChannels.length > 0)
    throw new ValidationError('Without consent no contact channel can be allowed.', {
      details: [
        {
          location: 'body',
          path: ['allowedChannels'],
          message: 'Must be empty unless consent is given',
        },
      ],
    });
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ a: opsAdmissions, ownerStaffId: opsLeads.ownerStaffId })
      .from(opsAdmissions)
      .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
      .where(eq(opsAdmissions.id, admissionId as AdmissionId))
      .limit(1);
    if (!row) throw new NotFoundError('Admission not found.');
    await assertPrivateAccess(
      tx,
      actor,
      write,
      [row.a.counsellorStaffId, row.ownerStaffId],
      'admissions',
      'You may not record private details for this student.',
    );
    const [before] = await tx
      .select()
      .from(opsContactPreferences)
      .where(eq(opsContactPreferences.leadId, row.a.leadId));
    const values = {
      leadId: row.a.leadId,
      consentStatus: input.consentStatus,
      consentBy: input.consentBy,
      allowedChannels: [...new Set(input.allowedChannels)],
      preferredContact: input.preferredContact ?? null,
      note: clean(input.note),
      recordedBy: actor.id,
      recordedAt: new Date(),
    };
    const [after] = await tx
      .insert(opsContactPreferences)
      .values(values)
      .onConflictDoUpdate({ target: opsContactPreferences.leadId, set: values })
      .returning();
    // Consent facts only — never contact details.
    await opsAudit('lead')(
      tx,
      actor,
      row.a.leadId,
      'contact_preferences.recorded',
      {
        before: before
          ? { consentStatus: before.consentStatus, allowedChannels: before.allowedChannels }
          : null,
        after: { consentStatus: values.consentStatus, allowedChannels: values.allowedChannels },
        metadata: { leadId: row.a.leadId, admissionId: row.a.id },
      },
      requestId,
    );
    return after;
  });
}
