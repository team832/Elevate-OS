/**
 * Students after conversion: lists by population, search (name, number, permitted
 * contact search + audit), lifecycle (hold, resume, exit, reactivate), guardians,
 * student report. Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, opsAppointments, opsExitRecords, opsReportExports } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as listStudents } from '../../src/app/api/v1/students/route';
import { GET as getStudent } from '../../src/app/api/v1/students/[id]/route';
import { POST as addGuardian } from '../../src/app/api/v1/students/[id]/guardians/route';
import { PATCH as editGuardian } from '../../src/app/api/v1/students/[id]/guardians/[guardianId]/route';
import {
  GET as openReport,
  POST as generateReport,
} from '../../src/app/api/v1/students/[id]/report/route';
import { POST as lifecycle } from '../../src/app/api/v1/admissions/[id]/lifecycle/route';
import { processEnrolmentReplies } from '../../src/server/enrolment';
import { studentListSummary } from '../../src/server/students';
import { istToday } from '../../src/domain';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { admit, get, post } from './admissions-fixtures';
import { CONVERT_BODY, convertDemoAs, demoCase } from './conversion-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let manager2: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let director: TestUser;
let auditor: TestUser;

type Row = {
  id: string;
  profileId: string;
  admissionNumber: string | null;
  phoneMasked: string | null;
  population: string;
};
type Profile = {
  identity: { id: string } | null;
  population: string;
  admission: {
    id: string;
    status: string;
    admissionNumber: string | null;
    holdReviewDate: string | null;
  };
  guardians: unknown;
  exitRecords: { exitStatus: string; reactivatedBy: string | null }[];
  timeline: { action: string }[];
};

const phoneOf = new Map<string, string>();
let n = 0;

/** Demo → conversion → admitted → enrolment confirmed by (simulated) Academic OS. */
async function enrolledStudent(programmeCodes = CONVERT_BODY.programmeCodes) {
  n += 1;
  const studentPhone = `+91 97${String(1000000 + n * 7919).padStart(8, '0')}`;
  const c = await demoCase(ctx.db, counsellor, {
    name: `Profile Student ${n}`,
    extra: { studentPhone },
  });
  const converted = await convertDemoAs(counsellor, c.demoId, { ...CONVERT_BODY, programmeCodes });
  expect(converted.status).toBe(201);
  // Confirmation (D-040/D-041) gives the number and publishes the enrolment request.
  const admitted = await admit({ counsellor, manager, director }, c.admissionId);
  const req = { data: { eventId: admitted.eventId } };
  await withTransaction(ctx.db, (tx) =>
    publishEvent(tx, {
      type: 'academic.enrolment.confirmed',
      version: 1,
      idempotencyKey: enrolmentKeys.reply(req.data!.eventId),
      correlationId: req.data!.eventId,
      payload: {
        requestEventId: req.data!.eventId as never,
        admissionId: c.admissionId as never,
        leadId: c.leadId as never,
        enrolmentId: crypto.randomUUID() as never,
        studentId: crypto.randomUUID() as never,
        existingStudent: false,
        programmeCode: 'CLAT',
        confirmedAt: new Date().toISOString() as never,
        confirmedByUserId: null,
      },
    }),
  );
  await processEnrolmentReplies(ctx.db);
  phoneOf.set(c.admissionId, studentPhone);
  return {
    ...c,
    studentId: converted.data!.studentId,
    number: admitted.admissionNumber,
  };
}

const list = (user: { token: string }, qs: string) =>
  callRoute<Row[]>(listStudents, get(user, `/ops/api/v1/students?${qs}`));
const profile = (user: { token: string }, id: string) =>
  callRoute<Profile>(getStudent, get(user), { id });
const act = (user: { token: string }, admissionId: string, body: unknown) =>
  callRoute<{ status: string }>(lifecycle, post(user, body), { id: admissionId });
const today = istToday(new Date());

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  manager2 = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  colleague = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

describe('student lists and profile', () => {
  it('active lists enrolled only; profile opens by canonical id or admission id; 404 before admission', async () => {
    const s = await enrolledStudent();
    const active = await list(manager, 'view=active&limit=200');
    expect(active.status).toBe(200);
    const row = active.data!.find((r) => r.id === s.admissionId)!;
    expect(row).toMatchObject({
      profileId: s.studentId,
      admissionNumber: s.number,
      population: 'active',
    });
    expect((active as { meta?: { total?: number } }).meta?.total).toBe(active.data!.length);
    expect((await profile(manager, s.studentId)).data?.admission.id).toBe(s.admissionId);
    expect((await profile(manager, s.admissionId)).data?.identity?.id).toBe(s.studentId);
    const pending = await demoCase(ctx.db, counsellor);
    expect((await profile(manager, pending.admissionId)).status).toBe(404);
    expect((await profile(colleague, s.studentId)).status).toBe(403);
    expect((await callRoute(listStudents, buildRequest('/ops/api/v1/students'))).status).toBe(401);
  });

  it('search by name and admission number; contact search only with private access, masked and audited', async () => {
    const s = await enrolledStudent();
    const byName = await list(counsellor, `q=${encodeURIComponent(`Profile Student ${n} `)}`);
    expect(byName.data?.map((r) => r.id)).toContain(s.admissionId);
    expect((await list(manager, `q=${s.number}`)).data?.map((r) => r.id)).toEqual([s.admissionId]);
    const raw = phoneOf.get(s.admissionId)!;
    const byPhone = await list(
      counsellor,
      `contact=${encodeURIComponent(raw.replace(/\s/g, '-'))}`,
    );
    expect(byPhone.data?.map((r) => r.id)).toEqual([s.admissionId]);
    expect(byPhone.data?.[0]?.phoneMasked).toMatch(/^\+91 •••• ••\d\d \d\d$/);
    const partial = await list(manager, `contact=${raw.replace(/\D/g, '').slice(-6)}`);
    expect(partial.data?.map((r) => r.id)).toEqual([s.admissionId]);
    expect((await list(director, `contact=${encodeURIComponent(raw)}`)).status).toBe(403);
    expect((await list(manager, 'view=active')).data?.every((r) => r.phoneMasked === null)).toBe(
      true,
    );
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'student.contact_search'),
          eq(auditEvents.actorUserId, counsellor.id),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(raw.replace(/\D/g, ''));
  });
});

describe('active students dashboard', () => {
  it('cohort, counsellor, meeting and fee filters; summary counts match the list; a case opens with all its siblings', async () => {
    const s = await enrolledStudent(['CLASS_12', 'CLAT']);
    const starts = new Date(Date.now() + 86_400_000);
    await ctx.db.insert(opsAppointments).values({
      type: 'parent_teacher_meeting',
      studentId: s.studentId as never,
      staffId: counsellor.staffId,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 1_800_000),
      mode: 'online',
      createdBy: manager.id as never,
    });
    const ids = async (qs: string) =>
      (await list(manager, `view=active&limit=200&${qs}`)).data!.map((r) => r.id);
    const row = (await list(manager, 'view=active&limit=200&cohort=CLASS_12')).data!.find(
      (r) => r.id === s.admissionId,
    ) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({
      cohort: 'CLASS_12',
      combination: expect.stringMatching(/^Class 12 Commerce \+ /),
      nextMeeting: expect.objectContaining({ type: 'parent_teacher_meeting' }),
    });
    expect(await ids('cohort=DROPPER')).not.toContain(s.admissionId);
    expect(await ids('meeting=upcoming')).toContain(s.admissionId);
    expect(await ids(`counsellor=${counsellor.staffId}`)).toContain(s.admissionId);
    expect(await ids(`counsellor=${colleague.staffId}`)).not.toContain(s.admissionId);
    // Confirmation needs an approved fee agreement, so a confirmed student always has one.
    expect(await ids('fee=not_configured')).not.toContain(s.admissionId);
    expect(await ids('fee=paid')).not.toContain(s.admissionId);
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    expect((await list(coordinator, 'view=active&fee=overdue')).status).toBe(403);

    const summary = await studentListSummary(ctx.db, manager, 'active');
    expect(summary.total).toBe((await ids('')).length);
    expect(summary.cohorts.CLASS_12).toBeGreaterThanOrEqual(1);
    expect(summary.meetings).toBeGreaterThanOrEqual(1);
    expect(Object.values(summary.fees!).reduce((a, b) => a + b, 0)).toBe(summary.total);
    expect((await studentListSummary(ctx.db, coordinator, 'active')).fees).toBeNull();

    const byCase = await profile(manager, s.admissionId);
    expect((byCase.data as unknown as { cases: unknown[] }).cases).toHaveLength(2);
    expect(byCase.data?.admission.id).toBe(s.admissionId);
  });
});

describe('lifecycle', () => {
  it('hold (reason + review date) → on hold list; resume → active; illegal and unauthorised changes refused', async () => {
    const s = await enrolledStudent();
    expect((await act(counsellor, s.admissionId, { action: 'hold', reason: 'Exams' })).status).toBe(
      400,
    );
    expect(
      (
        await act(counsellor, s.admissionId, {
          action: 'hold',
          reason: 'Exams',
          reviewDate: '2020-01-01',
        })
      ).status,
    ).toBe(400);
    expect(
      (await act(colleague, s.admissionId, { action: 'hold', reason: 'Exams', reviewDate: today }))
        .status,
    ).toBe(403);
    expect(
      (await act(auditor, s.admissionId, { action: 'hold', reason: 'Exams', reviewDate: today }))
        .status,
    ).toBe(403);
    expect(
      (await act(counsellor, s.admissionId, { action: 'resume', reason: 'Back' })).status,
    ).toBe(409);
    const held = await act(counsellor, s.admissionId, {
      action: 'hold',
      reason: 'Board exams (test)',
      reviewDate: today,
    });
    expect(held.data?.status).toBe('on_hold');
    expect((await list(manager, 'view=on_hold&limit=200')).data?.map((r) => r.id)).toContain(
      s.admissionId,
    );
    expect((await list(manager, 'view=active&limit=200')).data?.map((r) => r.id)).not.toContain(
      s.admissionId,
    );
    expect((await profile(manager, s.studentId)).data?.admission.holdReviewDate).toBe(today);
    expect(
      (await act(counsellor, s.admissionId, { action: 'resume', reason: 'Exams over (test)' })).data
        ?.status,
    ).toBe('enrolled');
    const pending = await demoCase(ctx.db, counsellor);
    expect(
      (
        await act(counsellor, pending.admissionId, {
          action: 'hold',
          reason: 'x y z',
          reviewDate: today,
        })
      ).status,
    ).toBe(409);
  });

  it('exit writes an exit record (former list); reactivation needs permission, an allowing record and another approver', async () => {
    const s = await enrolledStudent();
    const exit = {
      action: 'exit',
      exitStatus: 'withdrawn',
      exitDate: today,
      reason: 'Family relocated (test)',
      guardianFeedback: 'Thanks (test)',
      reactivationAllowed: true,
    };
    expect(
      (await act(counsellor, s.admissionId, { ...exit, exitStatus: 'cancelled_before_enrolment' }))
        .status,
    ).toBe(409);
    expect((await act(manager, s.admissionId, exit)).data?.status).toBe('withdrawn');
    expect((await list(manager, 'view=former&limit=200')).data?.map((r) => r.id)).toContain(
      s.admissionId,
    );
    const [record] = await ctx.db
      .select()
      .from(opsExitRecords)
      .where(eq(opsExitRecords.admissionId, s.admissionId as never));
    expect(record).toMatchObject({
      exitStatus: 'withdrawn',
      recordedBy: manager.id,
      reactivationAllowed: true,
    });
    const reactivate = { action: 'reactivate', reason: 'Family returned (test)' };
    expect((await act(counsellor, s.admissionId, reactivate)).status).toBe(403);
    expect((await act(manager, s.admissionId, reactivate)).status).toBe(403);
    expect((await act(manager2, s.admissionId, reactivate)).data?.status).toBe('admitted');
    const p = await profile(manager, s.studentId);
    expect(p.data?.exitRecords[0]).toMatchObject({
      exitStatus: 'withdrawn',
      reactivatedBy: manager2.id,
    });
    expect(p.data?.timeline.map((t) => t.action)).toEqual(
      expect.arrayContaining(['student.exit_recorded', 'admission.converted']),
    );
  });
});

describe('guardians (restricted)', () => {
  it('only with private access; hidden from others; contacts normalised and kept out of the audit trail', async () => {
    const s = await enrolledStudent();
    const body = {
      fullName: 'Second Guardian',
      relationship: 'mother',
      phone: '098765 01234',
      consentStatus: 'given',
    };
    expect((await callRoute(addGuardian, post(director, body), { id: s.studentId })).status).toBe(
      403,
    );
    expect((await callRoute(addGuardian, post(colleague, body), { id: s.studentId })).status).toBe(
      403,
    );
    expect(
      (
        await callRoute(addGuardian, post(counsellor, { ...body, phone: '12' }), {
          id: s.studentId,
        })
      ).status,
    ).toBe(400);
    const added = await callRoute<{ id: string; phone: string }>(
      addGuardian,
      post(counsellor, body),
      { id: s.studentId },
    );
    expect(added.status).toBe(201);
    expect(added.data?.phone).toBe('+919876501234');
    const archived = await callRoute(
      editGuardian,
      authedRequest(counsellor, '/ops/api/v1/x', { method: 'PATCH', json: { archived: true } }),
      { id: s.studentId, guardianId: added.data!.id },
    );
    expect(archived.status).toBe(200);
    expect(Array.isArray((await profile(counsellor, s.studentId)).data?.guardians)).toBe(true);
    expect((await profile(director, s.studentId)).data?.guardians).toBe('hidden');
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'guardian.added'));
    expect(JSON.stringify(audit)).not.toContain('9876501234');
  });
});

describe('student report', () => {
  it('generation writes an export row + audit with the permitted field groups; reference reopens it', async () => {
    const s = await enrolledStudent();
    const period = { from: '2026-01-01', to: '2026-12-31' };
    // Directors generate student reports since D-079; the read-only auditor still may not.
    expect(
      (await callRoute(generateReport, post(auditor, period), { id: s.studentId })).status,
    ).toBe(403);
    expect(
      (
        await callRoute(generateReport, post(manager, { from: '2026-02-01', to: '2026-01-01' }), {
          id: s.studentId,
        })
      ).status,
    ).toBe(400);
    const r = await callRoute<{ referenceCode: string; fields: string[] }>(
      generateReport,
      post(manager, period),
      { id: s.studentId },
    );
    expect(r.status).toBe(201);
    expect(r.data?.referenceCode).toMatch(/^SR-[0-9A-Z]{10}$/);
    expect(r.data?.fields).toEqual([
      'overview',
      'kyc',
      'results',
      'attendance',
      'feedback',
      'fees',
      'summary',
    ]);
    const [row] = await ctx.db
      .select()
      .from(opsReportExports)
      .where(eq(opsReportExports.referenceCode, r.data!.referenceCode));
    expect(row).toMatchObject({
      requestedBy: manager.id,
      periodFrom: period.from,
      periodTo: period.to,
    });
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'student.report_generated'),
          eq(auditEvents.entityId, s.studentId),
        ),
      );
    expect(audit).toHaveLength(1);
    const reopened = await callRoute<{ fields: string[] }>(
      openReport,
      get(manager, `/ops/api/v1/x?ref=${r.data!.referenceCode}`),
      { id: s.studentId },
    );
    expect(reopened.data?.fields).toEqual(r.data?.fields);
    expect(
      (
        await callRoute(openReport, get(colleague, `/ops/api/v1/x?ref=${r.data!.referenceCode}`), {
          id: s.studentId,
        })
      ).status,
    ).toBe(403);
  });
});
