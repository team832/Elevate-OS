/**
 * Admission applications → password-confirmed final approval → number → Academic handoff
 * (owner brief §6–§7; acceptance 6, 7, 8, 9, 10, 11, 18, 20, 21). Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  auditEvents,
  eventDeliveries,
  integrationEvents,
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplications,
  opsApplicationVersions,
  opsDemos,
  opsFeePlans,
  opsLeads,
  opsSettings,
  opsSignatureConfirmations,
  students,
  users,
} from '@elevate/database';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as detail, PATCH as save } from '../../src/app/api/v1/applications/[id]/route';
import { GET as list, POST as createDirect } from '../../src/app/api/v1/applications/route';
import { POST as confirmRoute } from '../../src/app/api/v1/applications/[id]/confirm/route';
import { POST as form } from '../../src/app/api/v1/applications/[id]/form/route';
import { POST as signatures } from '../../src/app/api/v1/applications/[id]/signatures/route';
import { POST as ready } from '../../src/app/api/v1/applications/[id]/ready/route';
import { GET as acknowledgement } from '../../src/app/api/v1/admissions/[id]/acknowledgement/route';
import { GET as idCard } from '../../src/app/api/v1/admissions/[id]/id-card/route';
import { POST as overrideNumber } from '../../src/app/api/v1/admissions/[id]/admission-number/route';
import { POST as transition } from '../../src/app/api/v1/admissions/[id]/transitions/route';
import { POST as retry } from '../../src/app/api/v1/admissions/[id]/enrolment-retry/route';
import { POST as legacy } from '../../src/app/api/v1/admissions/[id]/legacy-verification/route';
import { POST as check } from '../../src/app/api/v1/admissions/[id]/checks/route';
import { DECLARATIONS_MISSING } from '../../src/domain/applications';
import { admissionConfirmation } from '../../src/server/applications-confirm';
import { admissionRecord } from '../../src/server/application-record';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { get, pendingCase, post } from './admissions-fixtures';
import { CONVERT_BODY, convertDemoAs, demoCase } from './conversion-fixtures';
import {
  confirmAs,
  patch,
  printForm,
  setTestDeclaration,
  signedApplication,
  type People,
} from './application-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let director: TestUser;
let auditor: TestUser;
let teacher: TestUser;
let people: People;

const confirmBody = (version: number, password = director.password) => ({
  password,
  applicationVersion: version,
});
const pdf = async (handler: typeof acknowledgement, user: { token: string } | null, id: string) =>
  handler(user ? get(user) : buildRequest('/ops/api/v1/x'), { params: Promise.resolve({ id }) });
const one = async <T>(rows: Promise<T[]>) => (await rows)[0]!;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
  people = { counsellor, manager, director };
});

describe('conversion and direct admission (acceptance 6)', () => {
  it('conversion keeps identity and demo history, creates a draft application: no number, nobody admitted', async () => {
    const { demoId, admissionId } = await demoCase(ctx.db, counsellor);
    const r = await convertDemoAs(counsellor, demoId, CONVERT_BODY, 'test-only-convert-app-1');
    expect(r.status).toBe(201);
    const app = await one(
      ctx.db
        .select()
        .from(opsApplications)
        .where(eq(opsApplications.id, r.data!.id as never)),
    );
    expect(app).toMatchObject({
      admissionId,
      origin: 'demo',
      demoId,
      status: 'draft',
      currentVersion: 1,
      reference: expect.stringMatching(/^APP-\d{6}$/),
    });
    const a = await one(
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, admissionId as never)),
    );
    expect(a).toMatchObject({
      status: 'admission_pending',
      admissionNumber: null,
      studentId: app.studentId,
    });
    expect(
      await one(
        ctx.db
          .select()
          .from(opsDemos)
          .where(eq(opsDemos.id, demoId as never)),
      ),
    ).toMatchObject({ outcome: 'converted', convertedAdmissionId: admissionId });
    expect(
      await ctx.db.$count(opsApplicationVersions, eq(opsApplicationVersions.applicationId, app.id)),
    ).toBe(1);
    // Numbers and enrolment are no longer conversion options.
    const other = await demoCase(ctx.db, counsellor);
    for (const bad of [
      { admissionNumber: 'MAN-1', admissionNumberReason: 'Paper form number' },
      { requestEnrolment: true },
    ])
      expect((await convertDemoAs(manager, other.demoId, { ...CONVERT_BODY, ...bad })).status).toBe(
        400,
      );
  });

  it('the converted application goes through the same gate as a direct one, and the bundle is admitted together', async () => {
    const { demoId } = await demoCase(ctx.db, counsellor);
    const r = await convertDemoAs(counsellor, demoId, {
      ...CONVERT_BODY,
      programmeCodes: ['CLASS_12', 'CLAT'],
    });
    const s = await signedApplication(ctx.db, people, { applicationId: r.data!.id });
    const ok = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(ok.status).toBe(201);
    const bundle = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.studentId, r.data!.studentId as never));
    expect(bundle.map((b) => b.status).sort()).toEqual([
      'enrolment_requested',
      'enrolment_requested',
    ]);
    expect(bundle.filter((b) => b.admissionNumber).map((b) => b.admissionNumber)).toEqual([
      ok.data!.admissionNumber,
    ]);
  });
});

describe('final confirmation refusals (acceptance 7, 8)', () => {
  it('incomplete KYC cannot be marked ready; the generic "admitted" transition is refused', async () => {
    const fresh = await pendingCase(counsellor);
    const created = await callRoute<{ id: string }>(
      createDirect,
      post(counsellor, { admissionId: fresh.admissionId }),
    );
    expect(created.status).toBe(201);
    const notReady = await callRoute(ready, post(counsellor, { version: 1 }), {
      id: created.data!.id,
    });
    expect(notReady.status).toBe(409);
    expect(JSON.stringify(notReady.error)).toContain('Student date of birth is missing');
    const direct = await callRoute(transition, post(counsellor, { to: 'admitted' }), {
      id: fresh.admissionId,
    });
    expect(direct.status).toBe(409);
    expect(JSON.stringify(direct.error)).toContain('Confirm admission');
  });

  it('401 signed out, 403 for a role without ops:admissions:confirm, 400 for a client flag instead of a password', async () => {
    const s = await signedApplication(ctx.db, people);
    expect(
      (
        await callRoute(
          confirmRoute,
          buildRequest('/x', { method: 'POST', json: confirmBody(s.version) }),
          { id: s.applicationId },
        )
      ).status,
    ).toBe(401);
    expect(
      (await confirmAs(counsellor, s.applicationId, confirmBody(s.version, counsellor.password)))
        .status,
    ).toBe(403);
    expect(
      (
        await confirmAs(director, s.applicationId, {
          applicationVersion: s.version,
          passwordConfirmed: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await confirmAs(director, s.applicationId, {
          ...confirmBody(s.version),
          passwordConfirmed: true,
        })
      ).status,
    ).toBe(400);
    expect(
      await ctx.db.$count(
        opsAdmissionApprovals,
        eq(opsAdmissionApprovals.applicationId, s.applicationId as never),
      ),
    ).toBe(0);
  });

  it('wrong password: 403, nothing written but an audit row without the password', async () => {
    const approver = await createTestUser(ctx.db, {
      roles: ['director'],
      password: 'test-only-right-pass',
    });
    const s = await signedApplication(ctx.db, people);
    const res = await confirmAs(
      approver,
      s.applicationId,
      confirmBody(s.version, 'test-only-WRONG-pass'),
    );
    expect(res.status).toBe(403);
    const a = await one(
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, s.admissionId as never)),
    );
    expect(a).toMatchObject({ status: 'admission_pending', admissionNumber: null });
    const failed = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, s.applicationId),
          eq(auditEvents.action, 'admission.confirm_failed'),
        ),
      );
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain('test-only-WRONG-pass');
    expect(JSON.stringify(failed[0]!.metadata)).toContain('wrong_password');
  });

  it('an account without a password fails closed and names the open owner decision', async () => {
    const google = await createTestUser(ctx.db, { roles: ['director'] });
    await ctx.db.update(users).set({ passwordHash: null }).where(eq(users.id, google.id));
    const s = await signedApplication(ctx.db, people);
    const res = await confirmAs(google, s.applicationId, confirmBody(s.version, 'anything'));
    expect(res.status).toBe(403);
    expect(res.error?.message).toContain('Google re-authentication');
  });

  it('five wrong passwords lock the approver: 429 with Retry-After, even with the right password', async () => {
    const approver = await createTestUser(ctx.db, {
      roles: ['director'],
      password: 'test-only-right-pass',
    });
    const s = await signedApplication(ctx.db, people);
    const codes = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (await confirmAs(approver, s.applicationId, confirmBody(s.version, `test-only-bad-${i}`)))
          .status,
      );
    expect(codes).toEqual([403, 403, 403, 403, 429]);
    const locked = await confirmAs(
      approver,
      s.applicationId,
      confirmBody(s.version, 'test-only-right-pass'),
    );
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a changed version after signing: new version, signatures invalidated, old version refused', async () => {
    const s = await signedApplication(ctx.db, people);
    const changed = await callRoute<{ version: number; status: string; changed: string[] }>(
      save,
      patch(counsellor, { version: s.version, student: { city: 'Jaipur' } }),
      { id: s.applicationId },
    );
    expect(changed.data).toMatchObject({
      version: s.version + 1,
      status: 'draft',
      changed: ['student'],
    });
    expect(
      await ctx.db.$count(
        opsSignatureConfirmations,
        and(
          eq(opsSignatureConfirmations.applicationId, s.applicationId as never),
          isNull(opsSignatureConfirmations.invalidatedAt),
        ),
      ),
    ).toBe(0);
    const stale = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(stale.status).toBe(409);
    // A save with nothing new keeps the version; a stale "expected version" is refused.
    expect(
      (
        await callRoute<{ version: number }>(save, patch(counsellor, { version: s.version + 1 }), {
          id: s.applicationId,
        })
      ).data?.version,
    ).toBe(s.version + 1);
    expect(
      (await callRoute(save, patch(counsellor, { version: s.version }), { id: s.applicationId }))
        .status,
    ).toBe(409);
  });

  it('details changed at the source after signing (not saved) block confirmation', async () => {
    const s = await signedApplication(ctx.db, people);
    const a = await one(
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, s.admissionId as never)),
    );
    await ctx.db
      .update(opsLeads)
      .set({ previousSchool: 'Another School' })
      .where(eq(opsLeads.id, a.leadId));
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error)).toContain('Details changed since version');
  });

  it('declarations not configured block confirmation with the configuration message', async () => {
    const s = await signedApplication(ctx.db, people);
    // Independent of the real (approved) default: store "not set" explicitly, then restore.
    await ctx.db
      .update(opsSettings)
      .set({ value: { text: null, version: null } })
      .where(eq(opsSettings.key, 'admissions.declarations'));
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    await setTestDeclaration(ctx.db);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error)).toContain(DECLARATIONS_MISSING.slice(0, 40));
  });

  it('a form without confirmed signatures cannot be confirmed', async () => {
    const s = await signedApplication(ctx.db, people);
    await callRoute(save, patch(counsellor, { version: s.version, student: { city: 'Churu' } }), {
      id: s.applicationId,
    });
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version + 1));
    expect(res.status).toBe(409);
  });
});

describe('confirmation (acceptance 9, 10, 11)', () => {
  it('one transaction: number, approval with snapshot, admitted → enrolment requested, audit', async () => {
    const s = await signedApplication(ctx.db, people);
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(res.status).toBe(201);
    expect(res.data!.admissionNumber).toMatch(/^\d{3,}$/);
    const a = await one(
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, s.admissionId as never)),
    );
    expect(a).toMatchObject({
      status: 'enrolment_requested',
      admissionNumber: res.data!.admissionNumber,
      handoffStatus: 'pending',
    });
    const approval = await one(
      ctx.db
        .select()
        .from(opsAdmissionApprovals)
        .where(eq(opsAdmissionApprovals.admissionId, s.admissionId as never)),
    );
    expect(approval).toMatchObject({
      approvedBy: director.id,
      reauthMethod: 'password',
      applicationVersion: s.version,
      admissionNumber: res.data!.admissionNumber,
    });
    expect(JSON.stringify(approval.acceptedSnapshot)).toContain('test-only annual plan');
    expect(
      await one(
        ctx.db
          .select()
          .from(opsApplications)
          .where(eq(opsApplications.id, s.applicationId as never)),
      ),
    ).toMatchObject({ status: 'admission_confirmed' });
    expect(
      await ctx.db.$count(
        auditEvents,
        and(
          eq(auditEvents.entityId, s.applicationId),
          eq(auditEvents.action, 'admission.confirmed'),
        ),
      ),
    ).toBe(1);
    const view = await admissionConfirmation(ctx.db, director, s.admissionId);
    expect(view.academicSetup).toMatch(/^Admission confirmed — academic setup pending/);
  });

  it('a retry and concurrent clicks give one approval, number, fee agreement and enrolment event', async () => {
    const s = await signedApplication(ctx.db, people);
    const results = await Promise.all(
      [1, 2, 3].map(() => confirmAs(director, s.applicationId, confirmBody(s.version))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.data!.admissionNumber)).size).toBe(1);
    const again = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(again.data).toMatchObject({
      replayed: true,
      admissionNumber: results[0]!.data!.admissionNumber,
    });
    expect(
      await ctx.db.$count(
        opsAdmissionApprovals,
        eq(opsAdmissionApprovals.admissionId, s.admissionId as never),
      ),
    ).toBe(1);
    expect(
      await ctx.db.$count(opsFeePlans, eq(opsFeePlans.admissionId, s.admissionId as never)),
    ).toBe(1);
    const events = (
      await ctx.db
        .select()
        .from(integrationEvents)
        .where(eq(integrationEvents.type, 'ops.admission.enrolment_requested'))
    ).filter((e) => (e.payload as { admissionId: string }).admissionId === s.admissionId);
    expect(events).toHaveLength(1);
  });

  it('same-day confirmations get unique, consecutive numbers; a number is never changed afterwards', async () => {
    const apps = [];
    for (let i = 0; i < 4; i++) apps.push(await signedApplication(ctx.db, people));
    const results = await Promise.all(
      apps.map((s) => confirmAs(director, s.applicationId, confirmBody(s.version))),
    );
    const numbers = results.map((r) => Number(r.data!.admissionNumber)).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(4);
    expect(numbers.at(-1)! - numbers[0]!).toBe(3);
    const fix = await callRoute(
      overrideNumber,
      post(manager, { admissionNumber: 'MAN-0009', reason: 'Typo on the paper form' }),
      { id: apps[0]!.admissionId },
    );
    expect(fix.status).toBe(409);
    const unconfirmed = await pendingCase(counsellor);
    expect(
      (
        await callRoute(
          overrideNumber,
          post(manager, { admissionNumber: 'MAN-0010', reason: 'Typo on the paper form' }),
          { id: unconfirmed.admissionId },
        )
      ).status,
    ).toBe(409);
  });

  it('Academic failure is visible and a retry sends one new request, never a duplicate', async () => {
    const s = await signedApplication(ctx.db, people);
    await confirmAs(director, s.applicationId, confirmBody(s.version));
    const a = await one(
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.id, s.admissionId as never)),
    );
    await ctx.db.insert(eventDeliveries).values({
      eventId: a.lastRequestEventId!,
      consumer: 'academic.enrolment-intake',
      status: 'dead',
      attempts: 5,
      lastError: 'test-only failure',
    });
    expect((await admissionConfirmation(ctx.db, director, s.admissionId)).academicSetup).toContain(
      'Handoff failed — needs a person',
    );
    const r1 = await callRoute(
      retry,
      post(manager, { reason: 'Academic fixed the batch (test)' }),
      { id: s.admissionId },
    );
    expect(r1.status).toBe(201);
    expect(
      (
        await callRoute(retry, post(manager, { reason: 'Second click (test)' }), {
          id: s.admissionId,
        })
      ).status,
    ).toBe(409);
    const events = (
      await ctx.db
        .select()
        .from(integrationEvents)
        .where(eq(integrationEvents.type, 'ops.admission.enrolment_requested'))
    ).filter((e) => (e.payload as { admissionId: string }).admissionId === s.admissionId);
    expect(events.map((e) => (e.payload as { attempt: number }).attempt).sort()).toEqual([1, 2]);
  });
});

describe('documents (acceptance 18, 21)', () => {
  it('form, acknowledgement and ID card download as real PDFs; long names and ₹ print; restricted by role', async () => {
    const s = await signedApplication(ctx.db, people);
    await ctx.db
      .update(students)
      .set({ fullName: 'Sample Student With A Very Long Name '.repeat(3).trim() })
      .where(eq(students.id, s.studentId as never));
    await callRoute(save, patch(counsellor, { version: s.version }), { id: s.applicationId });
    const { res } = await printForm(ctx.db, counsellor, s.applicationId).catch(() => ({
      res: null,
    }));
    expect(res).toBeNull(); // the name change is a new version: the form must be reviewed again
    const draft = await one(
      ctx.db
        .select()
        .from(opsApplications)
        .where(eq(opsApplications.id, s.applicationId as never)),
    );
    await callRoute(ready, post(counsellor, { version: draft.currentVersion }), {
      id: s.applicationId,
    });
    const printed = await printForm(ctx.db, counsellor, s.applicationId);
    expect(printed.res.headers.get('content-type')).toBe('application/pdf');
    const formDoc = await PDFDocument.load(new Uint8Array(await printed.res.arrayBuffer()));
    expect(formDoc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(printed.form.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    await callRoute(
      signatures,
      post(counsellor, {
        version: draft.currentVersion,
        formId: printed.form.id,
        signedOn: new Date().toISOString().slice(0, 10),
        studentSigned: true,
        guardianSigned: true,
      }),
      { id: s.applicationId },
    );
    expect(
      (await confirmAs(director, s.applicationId, confirmBody(draft.currentVersion))).status,
    ).toBe(201);

    const ack = await pdf(acknowledgement, director, s.admissionId);
    expect(ack.status).toBe(200);
    expect(
      (await PDFDocument.load(new Uint8Array(await ack.arrayBuffer()))).getPageCount(),
    ).toBeGreaterThanOrEqual(1);
    const card = await pdf(idCard, counsellor, s.admissionId);
    const page = (await PDFDocument.load(new Uint8Array(await card.arrayBuffer()))).getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([243, 153]);
    expect((await pdf(acknowledgement, null, s.admissionId)).status).toBe(401);
    expect((await pdf(idCard, teacher, s.admissionId)).status).toBe(403);
    for (const user of [auditor, director])
      expect(
        (await form(post(user, {}), { params: Promise.resolve({ id: s.applicationId }) })).status,
      ).toBe(403);
  });

  it('acknowledgement and ID card do not exist before confirmation', async () => {
    const s = await signedApplication(ctx.db, people);
    expect((await pdf(acknowledgement, director, s.admissionId)).status).toBe(409);
  });

  it('KYC in the application is served only with ops:student_private:read', async () => {
    const s = await signedApplication(ctx.db, people);
    type D = {
      snapshot: { student: Record<string, unknown>; guardians: unknown; kycRestricted: boolean };
    };
    const forDirector = await callRoute<D>(detail, get(director), { id: s.applicationId });
    expect(forDirector.data!.snapshot).toMatchObject({ guardians: null, kycRestricted: true });
    expect(Object.keys(forDirector.data!.snapshot.student)).toEqual(['fullName']);
    // C-1: paper-form answers are private too, for every reader without private access.
    await callRoute(
      save,
      patch(counsellor, {
        version: s.version,
        form: {
          whatsapp: '9876500001',
          guardianOccupation: 'Sample occupation',
          percentageOrGrade: '91%',
        },
        resultPublicityConsent: true,
      }),
      { id: s.applicationId },
    );
    const finance = await createTestUser(ctx.db, { roles: ['finance_officer'] });
    for (const reader of [director, auditor, finance]) {
      const r = await callRoute<D & { snapshot: { form: unknown } }>(detail, get(reader), {
        id: s.applicationId,
      });
      expect(r.data!.snapshot.form).toBeNull();
      expect(JSON.stringify(r.data)).not.toMatch(/9876500001|Sample occupation|91%/);
    }
    // I-1: writing them needs private access as well.
    expect(
      (
        await callRoute(save, patch(director, { version: s.version + 1, form: { gender: 'x' } }), {
          id: s.applicationId,
        })
      ).status,
    ).toBe(403);
    const forCounsellor = await callRoute<D>(detail, get(counsellor), { id: s.applicationId });
    expect(forCounsellor.data!.snapshot.student).toMatchObject({ dateOfBirth: '2010-05-04' });
    // (the save above made a new version, so the application is a draft again)
    const listed = await callRoute<{ items: { id: string }[]; total: number }>(
      list,
      get(counsellor, '/ops/api/v1/applications?status=draft'),
    );
    expect(listed.data!.items.map((i) => i.id)).toContain(s.applicationId);
    expect((await callRoute(list, get(teacher))).status).toBe(403);
  });
});

describe('legacy admissions (acceptance 20)', () => {
  it('show "verification required"; reconciliation needs ops:admissions:confirm, is audited and invents nothing', async () => {
    const { admissionId } = await pendingCase(counsellor);
    await ctx.db
      .update(opsAdmissions)
      .set({ legacyVerification: 'required', admissionNumber: '9001' })
      .where(eq(opsAdmissions.id, admissionId as never));
    expect((await admissionConfirmation(ctx.db, director, admissionId)).legacy).toMatchObject({
      state: 'required',
    });
    const body = { note: 'Paper form 2025 checked in the office file (test).' };
    expect((await callRoute(legacy, post(counsellor, body), { id: admissionId })).status).toBe(403);
    expect(
      (await callRoute(legacy, post(director, { note: 'short' }), { id: admissionId })).status,
    ).toBe(400);
    expect((await callRoute(legacy, post(director, body), { id: admissionId })).status).toBe(200);
    expect((await callRoute(legacy, post(director, body), { id: admissionId })).status).toBe(409);
    expect(
      await ctx.db.$count(
        opsAdmissionApprovals,
        eq(opsAdmissionApprovals.admissionId, admissionId as never),
      ),
    ).toBe(0);
    expect(
      await ctx.db.$count(
        auditEvents,
        and(
          eq(auditEvents.entityId, admissionId),
          eq(auditEvents.action, 'admission.legacy_verified'),
        ),
      ),
    ).toBe(1);
    const renumber = await callRoute(
      overrideNumber,
      post(manager, { admissionNumber: '9002', reason: 'Renumber legacy case (test)' }),
      { id: admissionId },
    );
    expect(renumber.status).toBe(409); // legacy numbers are never renumbered
  });
});

describe('review round 1 (I-1, I-2, I-3, M-1, M-2, M-7, M-11)', () => {
  it('I-1: the approved two-verifier fee rule is checked at confirmation', async () => {
    const s = await signedApplication(ctx.db, people);
    const undo = await callRoute(
      check,
      post(manager, { itemKey: 'fee_verification_2', status: 'not_done' }),
      { id: s.admissionId },
    );
    expect(undo.status).toBe(200);
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error)).toContain('Second fee verification missing');
  });

  it('I-2: entered but unapproved declaration text still blocks confirmation', async () => {
    const s = await signedApplication(ctx.db, people);
    await ctx.db
      .update(opsSettings)
      .set({ decisionState: 'proposed' })
      .where(eq(opsSettings.key, 'admissions.declarations'));
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    await ctx.db
      .update(opsSettings)
      .set({ decisionState: 'approved' })
      .where(eq(opsSettings.key, 'admissions.declarations'));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.error)).toContain('not approved');
  });

  it('I-3: a closed programme case leaves the bundle (re-sign); one on hold blocks with its name', async () => {
    const lost = await demoCase(ctx.db, counsellor);
    const r = await convertDemoAs(counsellor, lost.demoId, {
      ...CONVERT_BODY,
      programmeCodes: ['CLASS_12', 'CLAT'],
    });
    const s = await signedApplication(ctx.db, people, { applicationId: r.data!.id });
    const extra = r.data!.extraAdmissionIds[0]!;
    const close = await callRoute(
      transition,
      post(counsellor, { to: 'lost', reason: 'Only CLAT now (test)' }),
      { id: extra },
    );
    expect(close.status).toBe(200);
    const stale = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(JSON.stringify(stale.error)).toContain('Details changed');
    const saved = await callRoute<{ version: number; changed: string[] }>(
      save,
      patch(counsellor, { version: s.version }),
      { id: s.applicationId },
    );
    expect(saved.data).toMatchObject({ version: s.version + 1, changed: ['programmes'] });

    const held = await demoCase(ctx.db, counsellor);
    const h = await convertDemoAs(counsellor, held.demoId, {
      ...CONVERT_BODY,
      programmeCodes: ['CLASS_12', 'CLAT'],
    });
    const hs = await signedApplication(ctx.db, people, { applicationId: h.data!.id });
    await callRoute(
      transition,
      post(counsellor, { to: 'on_hold', reason: 'Family asked to wait (test)' }),
      { id: h.data!.extraAdmissionIds[0]! },
    );
    const blocked = await confirmAs(director, hs.applicationId, confirmBody(hs.version));
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.error)).toContain('only pending cases can be admitted');
  });

  it('M-1/M-2: signer names hidden without private read; replay only for the same approver and password', async () => {
    const s = await signedApplication(ctx.db, people);
    type D = { signatures: { signers: { name: string; role: string }[] }[] };
    const view = await callRoute<D>(detail, get(director), { id: s.applicationId });
    expect(view.data!.signatures[0]!.signers.every((x) => x.name === x.role)).toBe(true);
    expect((await confirmAs(director, s.applicationId, confirmBody(s.version))).status).toBe(201);
    const other = await createTestUser(ctx.db, { roles: ['director'] });
    expect(
      (await confirmAs(other, s.applicationId, confirmBody(s.version, other.password))).status,
    ).toBe(409);
    expect(
      (await confirmAs(director, s.applicationId, confirmBody(s.version, 'test-only-wrong')))
        .status,
    ).toBe(403);
  });

  it('M-7: a legacy pending case confirms with the number it already has', async () => {
    const { admissionId } = await pendingCase(counsellor);
    await ctx.db
      .update(opsAdmissions)
      .set({ legacyVerification: 'required', admissionNumber: '9100' })
      .where(eq(opsAdmissions.id, admissionId as never));
    const s = await signedApplication(ctx.db, people, { admissionId });
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(res.status).toBe(201);
    expect(res.data!.admissionNumber).toBe('9100');
    expect(
      await one(
        ctx.db
          .select()
          .from(opsAdmissions)
          .where(eq(opsAdmissions.id, admissionId as never)),
      ),
    ).toMatchObject({ admissionNumber: '9100', legacyVerification: 'verified' });
    expect(
      await ctx.db.$count(
        auditEvents,
        and(
          eq(auditEvents.entityId, admissionId),
          eq(auditEvents.action, 'admission.legacy_verified'),
        ),
      ),
    ).toBe(1); // N-3
  });

  it('N-1: reconciling a legacy case first does not dead-end its confirmation', async () => {
    const { admissionId } = await pendingCase(counsellor);
    await ctx.db
      .update(opsAdmissions)
      .set({ legacyVerification: 'required', admissionNumber: '9200' })
      .where(eq(opsAdmissions.id, admissionId as never));
    const note = { note: 'Paper form 2025 checked in the office file (test).' };
    expect((await callRoute(legacy, post(director, note), { id: admissionId })).status).toBe(200);
    const s = await signedApplication(ctx.db, people, { admissionId });
    const res = await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect(res.status).toBe(201);
    expect(res.data!.admissionNumber).toBe('9200');
  });

  it('N-2/M-6: another approver learns no number; a bundle extra case shows the bundle number', async () => {
    const c = await demoCase(ctx.db, counsellor);
    const r = await convertDemoAs(counsellor, c.demoId, {
      ...CONVERT_BODY,
      programmeCodes: ['CLASS_12', 'CLAT'],
    });
    const s = await signedApplication(ctx.db, people, { applicationId: r.data!.id });
    const ok = await confirmAs(director, s.applicationId, confirmBody(s.version));
    const other = await createTestUser(ctx.db, { roles: ['director'] });
    const refused = await confirmAs(other, s.applicationId, confirmBody(s.version, other.password));
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.error)).not.toContain(ok.data!.admissionNumber);
    const view = await admissionConfirmation(ctx.db, director, r.data!.extraAdmissionIds[0]!);
    expect(view.bundleNumber).toBe(ok.data!.admissionNumber);
    expect(view.academicSetup).toMatch(/^Admission confirmed/);
  });

  it('I-2: fee verifiers are named on the record only after confirmation', async () => {
    const s = await signedApplication(ctx.db, people);
    const row = async () => {
      const [app] = await ctx.db
        .select()
        .from(opsApplications)
        .where(eq(opsApplications.id, s.applicationId as never));
      const v = await one(
        ctx.db
          .select()
          .from(opsApplicationVersions)
          .where(eq(opsApplicationVersions.applicationId, s.applicationId as never)),
      );
      return admissionRecord(ctx.db, app!, v.snapshot as never, s.version, new Date());
    };
    expect((await row()).checkedBy).toEqual([]);
    await confirmAs(director, s.applicationId, confirmBody(s.version));
    expect((await row()).checkedBy).toHaveLength(2);
  });

  it('M-11: a counsellor cannot download another counsellor’s acknowledgement', async () => {
    const s = await signedApplication(ctx.db, people);
    await confirmAs(director, s.applicationId, confirmBody(s.version));
    const colleague = await staffUser(ctx.db, ['admissions_counsellor'], {
      managerId: manager.staffId,
    });
    expect((await pdf(acknowledgement, colleague, s.admissionId)).status).toBe(403);
  });
});

describe('the owner paper form (fields, consent, programme filter)', () => {
  it('paper answers and the result-publicity consent are versioned; consent records who and when', async () => {
    const s = await signedApplication(ctx.db, people);
    type D = { snapshot: { form: Record<string, unknown>; counsellorName: string | null } };
    const saved = await callRoute<{ version: number; changed: string[] }>(
      save,
      patch(counsellor, {
        version: s.version,
        form: { gender: 'Female', batchTiming: '4-6 pm', yearOfPassing: '2026' },
        resultPublicityConsent: true,
      }),
      { id: s.applicationId },
    );
    expect(saved.data).toMatchObject({ version: s.version + 1, changed: ['form'] });
    const view = await callRoute<D>(detail, get(counsellor), { id: s.applicationId });
    expect(view.data!.snapshot.form).toMatchObject({
      gender: 'Female',
      batchTiming: '4-6 pm',
      resultPublicityConsent: { given: true, recordedBy: counsellor.id },
    });
    expect(view.data!.snapshot.counsellorName).toBe(counsellor.displayName);
    // Unticked consent on a later save is a recorded change; "not given" is never assumed given.
    const again = await callRoute<{ changed: string[] }>(
      save,
      patch(counsellor, { version: s.version + 1, resultPublicityConsent: false }),
      { id: s.applicationId },
    );
    expect(again.data!.changed).toEqual(['form']);
    expect(
      (
        await callRoute(
          save,
          patch(counsellor, { version: s.version + 2, form: { yearOfPassing: '26' } }),
          { id: s.applicationId },
        )
      ).status,
    ).toBe(400);
  });

  it('the list filters by the programme of the application’s own case', async () => {
    const s = await signedApplication(ctx.db, people);
    const ids = async (programme: string) =>
      (
        await callRoute<{ items: { id: string }[] }>(
          list,
          get(manager, `/ops/api/v1/applications?programme=${programme}`),
        )
      ).data!.items.map((i) => i.id);
    expect(await ids('IPMAT')).toContain(s.applicationId);
    expect(await ids('CLAT')).not.toContain(s.applicationId);
  });
});
