/**
 * Portal access from the student record (F4-13): who may give it (ops:guardians:write, own scope,
 * private-data check), guardian consent for a minor (approved wording, who, when, version), the
 * login (role only, @portal.invalid), setup slips (8 characters, HMAC only, one live code, never
 * audited), switching off and on, and a parent's login shared by linked siblings. Fictional data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { hashSetupCode, normaliseSetupCode } from '@elevate/authentication';
import {
  auditEvents,
  opsAdmissions,
  opsGuardians,
  opsLeads,
  opsSettings,
  opsStudentSiblings,
  portalAccounts,
  portalSetupCodes,
  sessions,
  students,
  userRoles,
  users,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  testSessionSecret,
  type TestUser,
} from '@elevate/testing';
import { createSession, validatePortalSession } from '@elevate/authentication';
import { updateGuardian } from '../../src/server/guardians';
import {
  GET as readAccess,
  POST as giveAccess,
} from '../../src/app/api/v1/students/[id]/portal-access/route';
import { PATCH as switchAccess } from '../../src/app/api/v1/portal-access/[id]/route';
import { POST as issueCode } from '../../src/app/api/v1/portal-access/[id]/code/route';
import { PORTAL_SETTING_DEFINITIONS } from '../../src/domain/policies-portal';
import { pendingCase, post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let counsellor: StaffUser;
let other: StaffUser;
let teacher: TestUser;
type Slip = { login: string; code: string; expiresAt: string; portalUrl: string; kind: string };

/** A student on `counsellor`'s case with one guardian; `dob` null = not recorded. */
async function student(dob: string | null, name = 'Asha Example (fictional)', owner = counsellor) {
  const c = await pendingCase(owner);
  const [s] = await ctx.db.insert(students).values({ fullName: name }).returning();
  await ctx.db
    .update(opsAdmissions)
    .set({ studentId: s!.id })
    .where(eq(opsAdmissions.id, c.admissionId as never));
  await ctx.db
    .update(opsLeads)
    .set({ dateOfBirth: dob as never })
    .where(eq(opsLeads.id, c.leadId as never));
  const [g] = await ctx.db
    .insert(opsGuardians)
    .values({
      studentId: s!.id,
      fullName: 'Meera Example (fictional)',
      relationship: 'mother',
      createdBy: owner.id,
    })
    .returning();
  return { id: s!.id as string, guardianId: g!.id as string, leadId: c.leadId as string };
}

const give = (user: { token: string }, id: string, body: unknown) =>
  callRoute<{ id: string; login: string }>(giveAccess, post(user, body), { id });
const slip = (user: { token: string }, id: string) =>
  callRoute<Slip>(issueCode, authedRequest(user, '/ops/api/v1/x', { method: 'POST' }), { id });
const setEnabled = (user: { token: string }, id: string, enabled: boolean) =>
  callRoute(
    switchAccess,
    authedRequest(user, '/ops/api/v1/x', { method: 'PATCH', json: { enabled } }),
    { id },
  );
const approveConsentText = () =>
  ctx.db
    .insert(opsSettings)
    .values({
      key: 'portal.consent_text',
      value: PORTAL_SETTING_DEFINITIONS['portal.consent_text'].defaultValue,
      decisionState: 'approved',
    })
    .onConflictDoNothing();

/** Proposed setting portal.guardian_access_to_adults (default off), set as the owner would. */
const guardiansOfAdults = (allowed: boolean) =>
  ctx.db
    .insert(opsSettings)
    .values({
      key: 'portal.guardian_access_to_adults',
      value: { allowed },
      decisionState: 'proposed',
    })
    .onConflictDoUpdate({ target: opsSettings.key, set: { value: { allowed } } });

beforeAll(async () => {
  await setupReference(ctx.db);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Portal Counsellor' });
  other = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Other Counsellor' });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
});

describe('giving portal access', () => {
  it('401 signed out, 403 for a teacher and for a counsellor not on the case, 400 for a bad body', async () => {
    const s = await student('2000-01-01');
    const body = { kind: 'student' };
    expect(
      (await callRoute(giveAccess, buildRequest('/x', { json: body }), { id: s.id })).status,
    ).toBe(401);
    expect((await give(teacher, s.id, body)).status).toBe(403);
    expect((await give(other, s.id, body)).status).toBe(403);
    expect((await give(counsellor, s.id, { kind: 'teacher' })).status).toBe(400);
    expect((await give(counsellor, s.id, { kind: 'guardian' })).error?.details).toEqual([
      expect.objectContaining({ path: ['guardianId'] }),
    ]);
  });

  it('an adult student gets a <login>@portal.invalid login holding only the student role; a second live one is refused', async () => {
    const s = await student('2000-01-01');
    const res = await give(counsellor, s.id, { kind: 'student' });
    expect(res.status).toBe(201);
    expect(res.data!.login).toMatch(/^asha\.\d{4}$/);
    const [account] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, res.data!.id as never));
    expect(account).toMatchObject({
      kind: 'student',
      guardianId: null,
      consentGivenAt: null,
      disabledAt: null,
    });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, account!.userId));
    expect(u).toMatchObject({
      email: `${res.data!.login}@portal.invalid`,
      passwordHash: null,
      status: 'active',
    });
    const roles = await ctx.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, u!.id));
    expect(roles).toEqual([{ role: 'student' }]);
    expect((await give(counsellor, s.id, { kind: 'student' })).status).toBe(409);
    const list = await callRoute<{ accounts: { login: string }[]; minor: boolean }>(
      readAccess,
      authedRequest(counsellor, '/x'),
      { id: s.id },
    );
    expect(list.data).toMatchObject({ minor: false, accounts: [{ login: res.data!.login }] });
    expect((await callRoute(readAccess, authedRequest(other, '/x'), { id: s.id })).status).toBe(
      403,
    );
  });

  it('a minor (or no date of birth) needs approved consent wording, then who, when and a confirmation', async () => {
    const minor = await student('2012-05-01');
    const unknown = await student(null);
    for (const s of [minor, unknown])
      expect((await give(counsellor, s.id, { kind: 'student' })).status).toBe(409); // wording not approved
    await approveConsentText();
    const missing = await give(counsellor, minor.id, { kind: 'student', consentConfirmed: false });
    expect(missing.status).toBe(400);
    expect(missing.error?.details).toEqual([
      expect.objectContaining({ path: ['consentGuardianId'] }),
    ]);
    const later = {
      kind: 'student',
      consentGuardianId: minor.guardianId,
      consentGivenOn: '2099-01-01',
      consentConfirmed: true,
    };
    expect((await give(counsellor, minor.id, later)).error?.details).toEqual([
      expect.objectContaining({ path: ['consentGivenOn'] }),
    ]);
    const unconfirmed = { ...later, consentGivenOn: '2026-11-01', consentConfirmed: false };
    expect((await give(counsellor, minor.id, unconfirmed)).error?.details).toEqual([
      expect.objectContaining({ path: ['consentConfirmed'] }),
    ]);
    const ok = await give(counsellor, minor.id, { ...unconfirmed, consentConfirmed: true });
    expect(ok.status).toBe(201);
    const [a] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, ok.data!.id as never));
    expect(a).toMatchObject({
      consentGuardianId: minor.guardianId,
      consentTextVersion: PORTAL_SETTING_DEFINITIONS['portal.consent_text'].defaultValue.version,
      consentRecordedBy: counsellor.id,
    });
    expect(a!.consentGivenAt?.toISOString()).toBe('2026-10-31T18:30:00.000Z'); // 1 Nov 2026 IST
  });
});

describe('setup slips and switching access', () => {
  beforeAll(() => guardiansOfAdults(true));
  it('a slip carries an 8-character code shown once: only its HMAC is stored, never audited; a new slip replaces it', async () => {
    const s = await student('2000-01-01');
    const { data } = await give(counsellor, s.id, { kind: 'guardian', guardianId: s.guardianId });
    const first = await slip(counsellor, data!.id);
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ login: data!.login, kind: 'guardian' });
    expect(first.data!.code).toMatch(/^[A-Z2-9]{4} [A-Z2-9]{4}$/);
    expect(first.data!.portalUrl).toMatch(/\/portal$/);
    expect(new Date(first.data!.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      6.9 * 86_400_000,
    );
    expect((await slip(other, data!.id)).status).toBe(403);
    const second = await slip(counsellor, data!.id);
    const [account] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, data!.id as never));
    const codes = await ctx.db
      .select()
      .from(portalSetupCodes)
      .where(eq(portalSetupCodes.userId, account!.userId));
    const live = codes.filter((c) => !c.revokedAt && !c.usedAt);
    expect(live.map((c) => c.codeHash)).toEqual([
      hashSetupCode(normaliseSetupCode(second.data!.code)),
    ]);
    expect(
      codes.find((c) => c.codeHash === hashSetupCode(normaliseSetupCode(first.data!.code)))
        ?.revokedAt,
    ).not.toBeNull();
    const audits = JSON.stringify(
      await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, s.id)),
    );
    expect(audits).toContain('portal.code_issued');
    for (const code of [first.data!.code, second.data!.code]) {
      expect(audits).not.toContain(code);
      expect(audits).not.toContain(normaliseSetupCode(code));
    }
  });

  it('switching off ends the sessions and the live code; switching on again; a clashing re-enable is refused', async () => {
    const s = await student('2000-01-01');
    const { data } = await give(counsellor, s.id, { kind: 'student' });
    await slip(counsellor, data!.id);
    const [a] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, data!.id as never));
    const session = await createSession(ctx.db, { userId: a!.userId, secret: testSessionSecret() });
    expect((await setEnabled(teacher, data!.id, false)).status).toBe(403);
    expect((await setEnabled(counsellor, data!.id, false)).status).toBe(200);
    const [after] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, data!.id as never));
    expect(after).toMatchObject({ disabledBy: counsellor.id });
    const [ended] = await ctx.db.select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(ended!.revokedAt).not.toBeNull();
    const live = await ctx.db
      .select()
      .from(portalSetupCodes)
      .where(and(eq(portalSetupCodes.userId, a!.userId)));
    expect(live.every((c) => c.revokedAt !== null)).toBe(true);
    expect((await slip(counsellor, data!.id)).status).toBe(409);
    const replacement = await give(counsellor, s.id, { kind: 'student' });
    expect(replacement.status).toBe(201);
    expect((await setEnabled(counsellor, data!.id, true)).status).toBe(409);
    expect((await setEnabled(counsellor, replacement.data!.id, false)).status).toBe(200);
    expect((await setEnabled(counsellor, data!.id, true)).status).toBe(200);
  });

  it('a parent’s login takes a second child only when the two students are linked as siblings', async () => {
    const x = await student('2000-01-01', 'Kabir Example (fictional)');
    const y = await student('2001-01-01', 'Zoya Example (fictional)');
    const first = await give(counsellor, x.id, { kind: 'guardian', guardianId: x.guardianId });
    const [account] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, first.data!.id as never));
    const join = { kind: 'guardian', guardianId: y.guardianId, joinUserId: account!.userId };
    expect((await give(counsellor, y.id, join)).error?.details).toEqual([
      expect.objectContaining({ path: ['joinUserId'] }),
    ]);
    const [a, b] = [x.id, y.id].sort();
    await ctx.db
      .insert(opsStudentSiblings)
      .values({ studentId: a as never, siblingStudentId: b as never, createdBy: counsellor.id });
    const joined = await give(counsellor, y.id, join);
    expect(joined.status).toBe(201);
    expect(joined.data!.login).toBe(first.data!.login);
    const links = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.userId, account!.userId));
    expect(links.map((l) => l.studentId).sort()).toEqual([a, b]);
  });
});

describe('review round 1 (REV-W4)', () => {
  it('C1: archiving a guardian switches their portal access off and ends the session (audited)', async () => {
    await guardiansOfAdults(true);
    const s = await student('2000-01-01');
    const given = await give(counsellor, s.id, { kind: 'guardian', guardianId: s.guardianId });
    const [acc] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, given.data!.id as never));
    const session = await createSession(ctx.db, {
      userId: acc!.userId,
      secret: testSessionSecret(),
    });
    await updateGuardian(ctx.db, counsellor, s.id, s.guardianId, { archived: true } as never);
    const [after] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, acc!.id));
    expect(after).toMatchObject({ disabledBy: counsellor.id });
    expect(await validatePortalSession(ctx.db, session.token, testSessionSecret())).toBeNull();
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, s.id), eq(auditEvents.action, 'portal.access_disabled')));
    expect(audit).toHaveLength(1);
  });

  it('M3: a guardian login for a student aged 18 or over is refused while the setting is off', async () => {
    await guardiansOfAdults(false);
    const s = await student('2000-01-01');
    const refused = await give(counsellor, s.id, { kind: 'guardian', guardianId: s.guardianId });
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toMatch(/18 or over/);
    const read = await callRoute<{ guardianAccessToAdults: boolean }>(
      readAccess,
      authedRequest(counsellor, '/x'),
      { id: s.id },
    );
    expect(read.data!.guardianAccessToAdults).toBe(false);
    expect((await give(counsellor, s.id, { kind: 'student' })).status).toBe(201);
    await guardiansOfAdults(true);
    expect(
      (await give(counsellor, s.id, { kind: 'guardian', guardianId: s.guardianId })).status,
    ).toBe(201);
  });

  it('M2: two different dates of birth on the student’s enquiries are refused, not guessed', async () => {
    const s = await student('2000-01-01');
    const c = await pendingCase(counsellor);
    await ctx.db
      .update(opsAdmissions)
      .set({ studentId: s.id as never })
      .where(eq(opsAdmissions.id, c.admissionId as never));
    await ctx.db
      .update(opsLeads)
      .set({ dateOfBirth: '2012-01-01' as never })
      .where(eq(opsLeads.id, c.leadId as never));
    const res = await give(counsellor, s.id, { kind: 'student' });
    expect(res.status).toBe(409);
    expect(res.error?.message).toMatch(/different dates of birth/);
  });

  it('M6: a slip or switch-off for a parent login shared by siblings needs scope over every child', async () => {
    await guardiansOfAdults(true);
    const manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Portal Manager' });
    const x = await student('2000-01-01', 'Kabir Example (fictional)');
    const y = await student('2001-01-01', 'Zoya Example (fictional)', other);
    const [a, b] = [x.id, y.id].sort();
    await ctx.db
      .insert(opsStudentSiblings)
      .values({ studentId: a as never, siblingStudentId: b as never, createdBy: manager.id });
    const first = await give(counsellor, x.id, { kind: 'guardian', guardianId: x.guardianId });
    const [acc] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, first.data!.id as never));
    const joined = await give(other, y.id, {
      kind: 'guardian',
      guardianId: y.guardianId,
      joinUserId: acc!.userId,
    });
    expect(joined.status).toBe(201);
    expect((await slip(other, joined.data!.id)).status).toBe(403);
    expect((await slip(counsellor, first.data!.id)).status).toBe(403);
    expect((await setEnabled(other, joined.data!.id, false)).status).toBe(403);
    expect((await slip(manager, joined.data!.id)).status).toBe(201);
  });
});

describe('review round 2 (FR-D)', () => {
  it('an archived guardian’s portal access cannot be switched back on', async () => {
    await guardiansOfAdults(true);
    const s = await student('2000-01-01');
    const { data } = await give(counsellor, s.id, { kind: 'guardian', guardianId: s.guardianId });
    await updateGuardian(ctx.db, counsellor, s.id, s.guardianId, { archived: true } as never);
    const res = await setEnabled(counsellor, data!.id, true);
    expect(res.status).toBe(409);
    expect(res.error?.message).toMatch(/guardian is archived/);
    const [a] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, data!.id as never));
    expect(a!.disabledAt).not.toBeNull();
  });

  it('a slip and a switch-off at the same moment never leave a live code on a switched-off login', async () => {
    const s = await student('2000-01-01');
    const { data } = await give(counsellor, s.id, { kind: 'student' });
    const [a] = await ctx.db
      .select()
      .from(portalAccounts)
      .where(eq(portalAccounts.id, data!.id as never));
    const [printed] = await Promise.all([
      slip(counsellor, data!.id),
      setEnabled(counsellor, data!.id, false),
    ]);
    expect([201, 409]).toContain(printed.status);
    const live = await ctx.db
      .select()
      .from(portalSetupCodes)
      .where(
        and(
          eq(portalSetupCodes.userId, a!.userId),
          isNull(portalSetupCodes.usedAt),
          isNull(portalSetupCodes.revokedAt),
        ),
      );
    expect(live).toEqual([]);
    // Once off, a slip is refused inside its transaction.
    expect((await slip(counsellor, data!.id)).status).toBe(409);
  });
});
