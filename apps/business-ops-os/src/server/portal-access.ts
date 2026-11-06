/**
 * Portal access from the student record (F4-13). Staff with `ops:guardians:write` (Proposed:
 * reuse, owner question) and the private-data check give a student, or one of the student's
 * guardians, a portal login `<login>@portal.invalid` with role student / guardian and no staff
 * workspace; for a student under 18 (or with no date of birth) a guardian's consent is recorded
 * first: who, when and the consent text version, and only once that wording is approved. A
 * one-time setup code (8 characters, 7 days, one live code per login) is printed on a slip; only
 * its HMAC is stored and the audit never holds it. Access is disabled or re-enabled, never
 * deleted. A guardian login for a student aged 18 or over needs setting
 * `portal.guardian_access_to_adults` (Proposed off). A slip or switch-off acts on a whole login, so
 * it needs scope over every child of that login. Reading the section needs `ops:student_private:read`.
 */
import { randomInt } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { issueSetupCode, portalEmail, PORTAL_EMAIL_DOMAIN } from '@elevate/authentication';
import { appOrigin } from '@elevate/configuration/workspaces';
import {
  opsAdmissions,
  opsGuardians,
  opsLeads,
  opsStudentSiblings,
  portalAccounts,
  portalSetupCodes,
  students,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, isoDateSchema, NotFoundError } from '@elevate/shared-contracts';
import type { StudentIdentityId, UserId } from '@elevate/shared-types';
import { ageOn } from '../domain/applications';
import { istToday } from '../domain/dates';
import type { Actor } from './context';
import { identityAccess } from './guardians';
import { fieldError, inOrder, opsAudit } from './ops-common';
import { switchOffPortalAccounts } from './portal-switch-off';
import { loadSettings } from './settings';

const audit = opsAudit('student');
const sid = (id: string) => id as StudentIdentityId;
const loginOf = (email: string) => email.slice(0, -PORTAL_EMAIL_DOMAIN.length - 1);

export const giveAccessBody = z
  .object({
    kind: z.enum(['student', 'guardian']),
    guardianId: z.uuid().optional(),
    /** A sibling's guardian login that this child is added to (one parent, several children). */
    joinUserId: z.uuid().optional(),
    consentGuardianId: z.uuid().optional(),
    consentGivenOn: isoDateSchema.optional(),
    consentConfirmed: z.boolean().optional(),
  })
  .strict();
export const accessStatusBody = z.object({ enabled: z.boolean() }).strict();

/** The date of birth on the student's enquiries; null = not recorded; two different ones are refused. */
async function dateOfBirth(db: Database, studentId: string) {
  const rows = await db
    .selectDistinct({ dob: opsLeads.dateOfBirth })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(and(eq(opsAdmissions.studentId, sid(studentId)), isNotNull(opsLeads.dateOfBirth)));
  if (rows.length > 1)
    throw new ConflictError(
      'Two different dates of birth are recorded on this student’s enquiries. Correct the enquiry first.',
    );
  return rows[0]?.dob ?? null;
}

/** Under 18 on `today`, or no date of birth recorded. */
async function isMinor(db: Database, studentId: string, today: string) {
  const age = ageOn(await dateOfBirth(db, studentId), today as never);
  return age === null || age < 18;
}

/** For the portal (no permission check): one recorded date of birth makes the student 18 or over today. */
export const isAdultStudent = (db: Database, studentId: string, now = new Date()) =>
  isMinor(db, studentId, istToday(now)).then(
    (minor) => !minor,
    () => false,
  );

const ADULT_GUARDIAN_OFF =
  'A parent or guardian login for a student aged 18 or over is switched off (Settings: “Guardian logins for students aged 18 or over”). The owner decides.';

const liveGuardians = (db: Database, studentId: string) =>
  db
    .select({
      id: opsGuardians.id,
      fullName: opsGuardians.fullName,
      relationship: opsGuardians.relationship,
    })
    .from(opsGuardians)
    .where(and(eq(opsGuardians.studentId, sid(studentId)), isNull(opsGuardians.archivedAt)))
    .orderBy(asc(opsGuardians.createdAt));

/** Live guardian logins of the student's recorded siblings: the only logins a child may join. */
async function joinableLogins(db: Database, studentId: string) {
  const links = await db
    .select({ a: opsStudentSiblings.studentId, b: opsStudentSiblings.siblingStudentId })
    .from(opsStudentSiblings)
    .where(
      or(
        eq(opsStudentSiblings.studentId, sid(studentId)),
        eq(opsStudentSiblings.siblingStudentId, sid(studentId)),
      ),
    );
  const siblings = links.map((l) => (l.a === studentId ? l.b : l.a));
  if (!siblings.length) return [];
  const rows = await db
    .selectDistinct({ userId: users.id, displayName: users.displayName, email: users.email })
    .from(portalAccounts)
    .innerJoin(users, eq(users.id, portalAccounts.userId))
    .where(
      and(
        inArray(portalAccounts.studentId, siblings as StudentIdentityId[]),
        eq(portalAccounts.kind, 'guardian'),
        isNull(portalAccounts.disabledAt),
      ),
    );
  return rows.map((r) => ({ userId: r.userId, label: `${r.displayName} (${loginOf(r.email)})` }));
}

/** The "Portal access" section: logins, their state, guardians, consent rule and settings. */
export async function portalAccessFor(
  db: Database,
  actor: Actor,
  studentId: string,
  now = new Date(),
) {
  await identityAccess(db, actor, studentId, 'ops:student_private:read');
  const [settings, minor, guardians, joinable, accounts] = await inOrder([
    () => loadSettings(db),
    () => isMinor(db, studentId, istToday(now)).catch(() => true),
    liveGuardians(db, studentId),
    () => joinableLogins(db, studentId),
    db
      .select({
        a: portalAccounts,
        email: users.email,
        name: users.displayName,
        password: users.passwordHash,
        guardian: opsGuardians.fullName,
      })
      .from(portalAccounts)
      .innerJoin(users, eq(users.id, portalAccounts.userId))
      .leftJoin(opsGuardians, eq(opsGuardians.id, portalAccounts.guardianId))
      .where(eq(portalAccounts.studentId, sid(studentId)))
      .orderBy(asc(portalAccounts.createdAt)),
  ]);
  const codes = accounts.length
    ? await db
        .select({ userId: portalSetupCodes.userId, expiresAt: portalSetupCodes.expiresAt })
        .from(portalSetupCodes)
        .where(
          and(
            inArray(
              portalSetupCodes.userId,
              accounts.map((r) => r.a.userId),
            ),
            isNull(portalSetupCodes.usedAt),
            isNull(portalSetupCodes.revokedAt),
          ),
        )
    : [];
  const consent = settings['portal.consent_text'];
  return {
    enabled: settings['portal.enabled'].value.enabled,
    consent: { ...consent.value, approved: consent.decisionState === 'approved' },
    guardianAccessToAdults: settings['portal.guardian_access_to_adults'].value.allowed,
    minor,
    guardians,
    joinable,
    accounts: accounts.map(({ a, email, name, password, guardian }) => {
      const code = codes.find((c) => c.userId === a.userId);
      return {
        id: a.id,
        kind: a.kind,
        login: loginOf(email),
        displayName: name,
        guardianName: guardian,
        passwordSet: password !== null,
        liveCodeExpiresAt: code && code.expiresAt > now ? code.expiresAt : null,
        consent: a.consentGivenAt
          ? {
              guardianName: guardians.find((g) => g.id === a.consentGuardianId)?.fullName ?? null,
              version: a.consentTextVersion,
              givenAt: a.consentGivenAt,
            }
          : null,
        createdAt: a.createdAt,
        disabledAt: a.disabledAt,
      };
    }),
  };
}

/** `<first name>.<4 digits>`, lower-case ASCII; checked free before use (the unique index is the guard). */
async function freeLogin(tx: Database, name: string, kind: 'student' | 'guardian') {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .trim()
      .split(/\s+/)[0]
      ?.slice(0, 12) || (kind === 'student' ? 'student' : 'parent');
  for (let i = 0; i < 20; i++) {
    const login = `${base}.${randomInt(1000, 10_000)}`;
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, portalEmail(login)));
    if (!taken) return login;
  }
  throw new ConflictError('No free login name was found. Try again.');
}

/** A live account that would clash with `account` (one live student login per student, one per guardian row). */
const liveClash = (
  tx: Database,
  a: { studentId: string; kind: string; guardianId: string | null; id?: string },
) =>
  tx
    .select({ id: portalAccounts.id })
    .from(portalAccounts)
    .where(
      and(
        isNull(portalAccounts.disabledAt),
        a.id ? ne(portalAccounts.id, a.id as never) : undefined,
        a.kind === 'student'
          ? and(eq(portalAccounts.studentId, sid(a.studentId)), eq(portalAccounts.kind, 'student'))
          : eq(portalAccounts.guardianId, a.guardianId!),
      ),
    )
    .limit(1);

const CLASH_TEXT = {
  student: 'This student already has a portal login that is switched on.',
  guardian: 'This guardian already has a portal login for this student that is switched on.',
};

/** POST /students/{id}/portal-access — create the login (no code yet: "Print a setup slip" issues one). */
export async function givePortalAccess(
  db: Database,
  actor: Actor,
  studentId: string,
  input: z.output<typeof giveAccessBody>,
  requestId?: string,
  now = new Date(),
) {
  await identityAccess(db, actor, studentId);
  return withTransaction(db, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(eq(students.id, sid(studentId)))
      .for('update');
    if (!student) throw new NotFoundError('Student not found.');
    const [settings, guardians, minor] = await inOrder([
      () => loadSettings(tx),
      liveGuardians(tx, studentId),
      () => isMinor(tx, studentId, istToday(now)),
    ]);
    const guardianOf = (id: string | undefined, path: string, message: string) => {
      const g = guardians.find((x) => x.id === id);
      if (!g) throw fieldError(path, message);
      return g;
    };
    if (input.kind === 'student' && (input.guardianId || input.joinUserId))
      throw fieldError(
        'kind',
        'A student login is for the student; choose “A guardian” to give a guardian a login.',
      );
    const guardian =
      input.kind === 'guardian'
        ? guardianOf(input.guardianId, 'guardianId', 'Choose the guardian who gets the login.')
        : null;
    if (guardian && !minor && !settings['portal.guardian_access_to_adults'].value.allowed)
      throw new ConflictError(ADULT_GUARDIAN_OFF);
    let consent = {};
    if (minor) {
      const text = settings['portal.consent_text'];
      if (text.decisionState !== 'approved')
        throw new ConflictError(
          'The consent wording is not approved yet, so a student under 18 (or with no date of birth recorded) cannot get portal access. The owner approves it in Settings.',
        );
      const by = guardianOf(
        input.consentGuardianId,
        'consentGuardianId',
        'Choose the guardian who gave consent.',
      );
      if (!input.consentGivenOn || input.consentGivenOn > istToday(now))
        throw fieldError('consentGivenOn', 'Enter the day the guardian agreed (today or earlier).');
      if (!input.consentConfirmed)
        throw fieldError(
          'consentConfirmed',
          'Confirm that the guardian read and agreed to the consent text.',
        );
      consent = {
        consentGuardianId: by.id,
        consentTextVersion: text.value.version,
        consentGivenAt: new Date(`${input.consentGivenOn}T00:00:00+05:30`),
        consentRecordedBy: actor.id,
      };
    }
    const kind = input.kind;
    if ((await liveClash(tx, { studentId, kind, guardianId: guardian?.id ?? null })).length)
      throw new ConflictError(CLASH_TEXT[kind]);
    let userId: UserId;
    let login: string;
    if (input.joinUserId) {
      const join = (await joinableLogins(tx, studentId)).find((j) => j.userId === input.joinUserId);
      if (!join)
        throw fieldError('joinUserId', 'Only a guardian login of a linked sibling can be used.');
      const [u] = await tx.select().from(users).where(eq(users.id, join.userId));
      userId = u!.id;
      login = loginOf(u!.email);
    } else {
      login = await freeLogin(tx, guardian?.fullName ?? student.fullName, kind);
      const [u] = await tx
        .insert(users)
        .values({ email: portalEmail(login), displayName: guardian?.fullName ?? student.fullName })
        .returning({ id: users.id });
      userId = u!.id;
      await tx.insert(userRoles).values({ userId, role: kind });
    }
    const [account] = await tx
      .insert(portalAccounts)
      .values({
        userId,
        studentId: sid(studentId),
        kind,
        guardianId: guardian?.id ?? null,
        createdBy: actor.id,
        ...consent,
      })
      .returning();
    await audit(
      tx,
      actor,
      studentId,
      'portal.access_given',
      {
        after: { accountId: account!.id, kind, login, guardianId: account!.guardianId, ...consent },
      },
      requestId,
    );
    return { id: account!.id, login };
  });
}

async function accountOrThrow(db: Database, actor: Actor, accountId: string) {
  const [row] = await db
    .select({
      a: portalAccounts,
      email: users.email,
      name: users.displayName,
      student: students.fullName,
    })
    .from(portalAccounts)
    .innerJoin(users, eq(users.id, portalAccounts.userId))
    .innerJoin(students, eq(students.id, portalAccounts.studentId))
    .where(eq(portalAccounts.id, accountId as never));
  if (!row) throw new NotFoundError('Portal access not found.');
  // The action reaches the whole login: every child it shows must be within the caller's scope.
  const children = await db
    .selectDistinct({ id: portalAccounts.studentId })
    .from(portalAccounts)
    .where(
      and(
        eq(portalAccounts.userId, row.a.userId),
        or(isNull(portalAccounts.disabledAt), eq(portalAccounts.id, row.a.id)),
      ),
    );
  for (const c of children) await identityAccess(db, actor, c.id);
  return row;
}

/**
 * POST /portal-access/{id}/code — a new one-time setup code (the old one stops working) and the
 * slip's facts. Not idempotent on purpose: a replay would have to store the code.
 */
export async function issuePortalCode(
  db: Database,
  actor: Actor,
  accountId: string,
  requestId?: string,
  now = new Date(),
) {
  const row = await accountOrThrow(db, actor, accountId);
  return withTransaction(db, async (tx) => {
    // Account row first, as a switch-off locks it: a switch-off at the same moment either comes
    // first (refused here) or after (it revokes this code).
    const [a] = await tx
      .select({ disabledAt: portalAccounts.disabledAt })
      .from(portalAccounts)
      .where(eq(portalAccounts.id, row.a.id))
      .for('update');
    if (a!.disabledAt)
      throw new ConflictError('This access is switched off. Switch it on before printing a slip.');
    await tx.select({ id: users.id }).from(users).where(eq(users.id, row.a.userId)).for('update');
    const { code, expiresAt } = await issueSetupCode(tx, {
      userId: row.a.userId,
      createdBy: actor.id,
      now,
    });
    await audit(
      tx,
      actor,
      row.a.studentId,
      'portal.code_issued',
      { after: { accountId, expiresAt } },
      requestId,
    );
    return {
      login: loginOf(row.email),
      code: `${code.slice(0, 4)} ${code.slice(4)}`,
      expiresAt,
      name: row.name,
      studentName: row.student,
      kind: row.a.kind,
      portalUrl: `${appOrigin('platform')}/portal`,
    };
  });
}

/** PATCH /portal-access/{id} — switch off (sessions and live code end) or back on. */
export async function setPortalAccess(
  db: Database,
  actor: Actor,
  accountId: string,
  enabled: boolean,
  requestId?: string,
) {
  const row = await accountOrThrow(db, actor, accountId);
  return withTransaction(db, async (tx) => {
    if (!enabled) {
      await switchOffPortalAccounts(tx, actor, eq(portalAccounts.id, row.a.id), requestId);
      return { id: row.a.id, enabled };
    }
    const [a] = await tx
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, row.a.id))
      .for('update');
    if (a!.disabledAt === null) return { id: a!.id, enabled };
    if (a!.guardianId) {
      const [g] = await tx
        .select({ archivedAt: opsGuardians.archivedAt })
        .from(opsGuardians)
        .where(eq(opsGuardians.id, a!.guardianId as never));
      if (!g || g.archivedAt)
        throw new ConflictError(
          'This guardian is archived on the student record, so their portal access cannot be switched back on.',
        );
    }
    if ((await liveClash(tx, a!)).length) throw new ConflictError(CLASH_TEXT[a!.kind]);
    if (
      a!.kind === 'guardian' &&
      !(await loadSettings(tx))['portal.guardian_access_to_adults'].value.allowed &&
      (await isAdultStudent(tx, a!.studentId))
    )
      throw new ConflictError(ADULT_GUARDIAN_OFF);
    await tx
      .update(portalAccounts)
      .set({ disabledAt: null, disabledBy: null })
      .where(eq(portalAccounts.id, a!.id));
    await audit(
      tx,
      actor,
      a!.studentId,
      'portal.access_enabled',
      { after: { accountId: a!.id } },
      requestId,
    );
    return { id: a!.id, enabled };
  });
}
