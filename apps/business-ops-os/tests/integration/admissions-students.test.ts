import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  notifications,
  opsAdmissionTransitions,
  opsEnrolmentAttempts,
} from '@elevate/database';
import { processEvents, publishEvent, withTransaction } from '@elevate/server-kit';
import { ACADEMIC_CONSUMERS, enrolmentKeys } from '@elevate/shared-contracts';
import { callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listStudents } from '../../src/app/api/v1/students/route';
import { GET as getStudent } from '../../src/app/api/v1/students/[id]/route';
import { GET as getLead } from '../../src/app/api/v1/leads/[id]/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { POST as requestEnrolment } from '../../src/app/api/v1/admissions/[id]/enrolment-request/route';
import { POST as retry } from '../../src/app/api/v1/admissions/[id]/enrolment-retry/route';
import { PUT as prefs } from '../../src/app/api/v1/admissions/[id]/contact-preferences/route';
import { processEnrolmentReplies } from '../../src/server/enrolment';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { admittedCase, get, pendingCase, post, put } from './admissions-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let director: TestUser;
let auditor: TestUser;
let coordinator: TestUser;
let admitted: { leadId: string; admissionId: string };
let pending: { leadId: string; admissionId: string };

type Student = {
  person: Record<string, unknown> & { privateFields: 'visible' | 'hidden' };
  admission: { state: string; statusReasonCode: string | null };
  handoff: { view: { view: string }; retry: { allowed: boolean }; attempts: unknown[] };
  fees: unknown;
};

/** HTTP status of a route call. */
const status = async (
  route: Parameters<typeof callRoute>[0],
  req: Request,
  params?: Record<string, string>,
) => (await callRoute(route, req, params)).status;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  admitted = await admittedCase(
    { counsellor, manager, director },
    { name: 'Directory Student (fictional)' },
  );
  pending = await pendingCase(counsellor, { name: 'Not Yet Admitted (fictional)' });
});

describe('student directory and profile (ops:students:read)', () => {
  it('lists admitted students only, in own scope for counsellors, without private fields', async () => {
    const mine = await callRoute<{ id: string; studentName: string }[]>(
      listStudents,
      get(counsellor),
    );
    expect(mine.status).toBe(200);
    expect(mine.data?.map((s) => s.id)).toContain(admitted.admissionId);
    expect(mine.data?.map((s) => s.id)).not.toContain(pending.admissionId);
    expect(JSON.stringify(mine.data)).not.toMatch(/studentPhone|guardianPhone|\+91/);
    expect((await callRoute<unknown[]>(listStudents, get(colleague))).data).toHaveLength(0);
    expect(await status(listStudents, get(coordinator))).toBe(200);
    const searched = await callRoute<{ id: string }[]>(
      listStudents,
      get(manager, '/ops/api/v1/students?q=Directory&state=admitted&limit=1'),
    );
    expect(searched.data?.map((s) => s.id)).toEqual([admitted.admissionId]);
  });

  it('profile: 404 before admission; 403 out of own scope; private fields only with ops:student_private:read', async () => {
    expect(await status(getStudent, get(manager), { id: pending.admissionId })).toBe(404);
    expect(await status(getStudent, get(colleague), { id: admitted.admissionId })).toBe(403);
    const own = await callRoute<Student>(getStudent, get(counsellor), { id: admitted.admissionId });
    expect(own.data?.person.privateFields).toBe('visible');
    expect(own.data?.person.studentPhone).toMatch(/^\+91/);
    expect(own.data?.fees).not.toBeNull();
    for (const reader of [auditor, director, coordinator]) {
      const r = await callRoute<Student>(getStudent, get(reader), { id: admitted.admissionId });
      expect(r.status).toBe(200);
      expect(r.data?.person.privateFields).toBe('hidden');
      expect(r.data?.person).not.toHaveProperty('studentPhone');
      expect(r.data?.person).not.toHaveProperty('guardianPhone');
      expect(r.data?.person).not.toHaveProperty('consent');
    }
    const coord = await callRoute<Student>(getStudent, get(coordinator), {
      id: admitted.admissionId,
    });
    expect(coord.data?.fees).toBeNull(); // no ops:fees:read
  });
});

describe('lead contact masking (D-028, audit finding)', () => {
  it('auditor and director read the lead without contacts (also in history); owner and manager see them', async () => {
    for (const reader of [auditor, director]) {
      const r = await callRoute<{
        lead: Record<string, unknown>;
        privateVisible: boolean;
        history: { before: unknown; after: unknown }[];
      }>(getLead, get(reader), { id: admitted.leadId });
      expect(r.status).toBe(200);
      expect(r.data?.privateVisible).toBe(false);
      expect(r.data?.lead).not.toHaveProperty('studentPhone');
      expect(r.data?.lead).not.toHaveProperty('guardianName');
      expect(r.data?.lead.studentName).toBe('Directory Student (fictional)');
      expect(JSON.stringify(r.data?.history)).not.toMatch(/\+91|studentPhone|guardianPhone/);
    }
    for (const reader of [counsellor, manager]) {
      const r = await callRoute<{ lead: Record<string, unknown>; privateVisible: boolean }>(
        getLead,
        get(reader),
        { id: admitted.leadId },
      );
      expect(r.data?.privateVisible).toBe(true);
      expect(r.data?.lead.studentPhone).toMatch(/^\+91/);
    }
    expect(await status(getLead, get(colleague), { id: admitted.leadId })).toBe(403);
  });
});

describe('contact consent and preferences (private)', () => {
  it('records consent for own students; no channels without consent; auditor/colleague 403; audit has no contacts', async () => {
    const id = admitted.admissionId;
    const refused = { consentStatus: 'refused', consentBy: 'guardian', allowedChannels: ['sms'] };
    expect(await status(prefs, put(counsellor, refused), { id })).toBe(400);
    const given = {
      consentStatus: 'given',
      consentBy: 'guardian',
      allowedChannels: ['call', 'whatsapp'],
      preferredContact: 'guardian',
    };
    expect(await status(prefs, put(counsellor, given), { id })).toBe(200);
    for (const other of [auditor, colleague])
      expect(
        await status(prefs, put(other, { consentStatus: 'given', consentBy: 'both' }), { id }),
      ).toBe(403);
    const own = await callRoute<Student>(getStudent, get(counsellor), { id });
    expect(own.data?.person.consent).toMatchObject({
      status: 'given',
      allowedChannels: ['call', 'whatsapp'],
    });
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'contact_preferences.recorded'));
    expect(JSON.stringify(audit)).not.toMatch(/\+91|@example\.test/);
  });
});

describe('reason-coded closure (withdrawal)', () => {
  it('validates codes; "withdrawn after admission" only from admitted; the withdrawn student stays in the directory', async () => {
    const p = await pendingCase(counsellor);
    const close = (id: string, body: unknown) =>
      callRoute<{ status: string }>(transition, post(counsellor, body), { id });
    for (const [to, reasonCode] of [
      ['lost', 'nonsense'],
      ['lost', 'duplicate_merged'],
      ['lost', 'withdrawn_after_admission'],
      ['on_hold', 'other'],
    ])
      expect((await close(p.admissionId, { to, reason: 'x', reasonCode })).status).toBe(400);
    const ok = await close(p.admissionId, {
      to: 'lost',
      reason: 'Joined a school-integrated programme (test)',
      reasonCode: 'chose_competitor',
    });
    expect(ok.data?.status).toBe('lost');
    const [row] = await ctx.db
      .select()
      .from(opsAdmissionTransitions)
      .where(
        and(
          eq(opsAdmissionTransitions.admissionId, p.admissionId as never),
          eq(opsAdmissionTransitions.toStatus, 'lost'),
        ),
      );
    expect(row?.reasonCode).toBe('chose_competitor');

    const a = await admittedCase({ counsellor, manager, director });
    expect(
      (
        await close(a.admissionId, {
          to: 'lost',
          reason: 'Family relocated (test)',
          reasonCode: 'withdrawn_after_admission',
        })
      ).status,
    ).toBe(200);
    const s = await callRoute<Student>(getStudent, get(manager), { id: a.admissionId });
    expect(s.data?.admission).toMatchObject({
      state: 'withdrawn',
      statusReasonCode: 'withdrawn_after_admission',
    });
  });
});

describe('handoff retry after a failure that needs a person', () => {
  const failAcademic = (maxAttempts: number) =>
    processEvents(ctx.db, {
      consumer: ACADEMIC_CONSUMERS.enrolmentIntake,
      maxAttempts,
      handlers: {
        'ops.admission.enrolment_requested': async () => {
          throw new Error('Simulated Academic outage (test)');
        },
      },
    });

  it('refuses while Academic retries, allows a reasoned retry once dead, supersedes the old attempt and flags its late reply', async () => {
    const a = await admittedCase({ counsellor, manager, director });
    const first = await callRoute<{ eventId: string }>(requestEnrolment, post(counsellor, {}), {
      id: a.admissionId,
    });
    expect(first.status).toBe(201);
    const id = { id: a.admissionId };
    expect(await status(retry, post(counsellor, { reason: 'Still waiting (test)' }), id)).toBe(409);
    await failAcademic(5); // failed, will retry automatically
    const whileFailed = await callRoute<Student>(getStudent, get(counsellor), {
      id: a.admissionId,
    });
    expect(whileFailed.data?.handoff.view.view).toBe('academic_retrying');
    expect(await status(retry, post(counsellor, { reason: 'Impatient (test)' }), id)).toBe(409);
    await failAcademic(2); // second failure → dead
    const dead = await callRoute<Student>(getStudent, get(counsellor), { id: a.admissionId });
    expect(dead.data?.handoff.view.view).toBe('failed_needs_action');
    expect(dead.data?.handoff.retry.allowed).toBe(true);
    expect(await status(retry, post(counsellor, {}), id)).toBe(400);
    expect(await status(retry, post(colleague, { reason: 'x' }), id)).toBe(403);
    const second = await callRoute<{ attempt: number; eventId: string }>(
      retry,
      post(counsellor, { reason: 'Academic outage resolved (test)' }),
      { id: a.admissionId },
    );
    expect(second.status).toBe(201);
    expect(second.data?.attempt).toBe(2);
    const attempts = await ctx.db
      .select()
      .from(opsEnrolmentAttempts)
      .where(eq(opsEnrolmentAttempts.admissionId, a.admissionId as never));
    expect(attempts.map((x) => [x.attempt, x.kind, x.outcome]).sort()).toEqual([
      [1, 'initial', 'superseded'],
      [2, 'after_failure', 'pending'],
    ]);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'enrolment.handoff_retried'),
          eq(auditEvents.entityId, a.admissionId),
        ),
      );
    expect(audit).toBeDefined();
    // A late confirmation for the superseded attempt is not applied but flagged for a person.
    await withTransaction(ctx.db, (tx) =>
      publishEvent(tx, {
        type: 'academic.enrolment.confirmed',
        version: 1,
        idempotencyKey: enrolmentKeys.reply(first.data!.eventId),
        correlationId: first.data!.eventId,
        payload: {
          requestEventId: first.data!.eventId as never,
          admissionId: a.admissionId as never,
          leadId: a.leadId as never,
          enrolmentId: crypto.randomUUID() as never,
          studentId: crypto.randomUUID() as never,
          existingStudent: false,
          programmeCode: 'IPMAT',
          confirmedAt: new Date().toISOString() as never,
          confirmedByUserId: null,
        },
      }),
    );
    await processEnrolmentReplies(ctx.db);
    const after = await callRoute<Student & { admission: { status?: string } }>(
      getStudent,
      get(manager),
      { id: a.admissionId },
    );
    expect(after.data?.handoff.view.view).toBe('awaiting_pickup');
    const [old] = await ctx.db
      .select()
      .from(opsEnrolmentAttempts)
      .where(eq(opsEnrolmentAttempts.requestEventId, first.data!.eventId as never));
    expect(old?.note).toMatch(/duplicate/i);
    const flags = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, manager.id),
          eq(notifications.kind, 'enrolment.duplicate_risk'),
        ),
      );
    expect(flags).toHaveLength(1);
  });
});
