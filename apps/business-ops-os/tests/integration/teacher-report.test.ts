/**
 * Teacher reports (owner brief 22 Oct 2026): permission, scope, stored snapshot, audit rows, PDF,
 * and honest gaps when Academic OS is down. Academic OS is simulated with contract payloads.
 * Fictional data only.
 */
import { writeFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  auditEvents,
  opsEodReports,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  opsStaffTasks,
  opsTeacherReportExports,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  GET as listReports,
  POST as makeReport,
} from '../../src/app/api/v1/teachers/[id]/report/route';
import { GET as reportPdf } from '../../src/app/api/v1/teachers/[id]/report/[reportId]/pdf/route';
import { addDays, istToday } from '../../src/domain/dates';
import { teacherReportPdf } from '../../src/server/pdf/teacher-report';
import type { TeacherReportSnapshot } from '../../src/server/teacher-report';
import { review, reviewsPayload, stubAcademic } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const today = istToday(new Date());
const period = { from: addDays(today, -29), to: today };
let manager: StaffUser;
let director: TestUser;
let teacher: StaffUser;
let otherTeacher: StaffUser;
let coordinator: TestUser;
let auditor: TestUser;

const metric = (value: number | null, reason?: string) => ({
  status: value === null ? 'missing' : 'ok',
  value,
  ...(value === null ? { reason } : {}),
  definition: 'test definition',
  window: period,
  unit: 'count',
});
const activity = (url: URL) => ({
  contract: 'academic.teacher_activity',
  version: 1,
  generatedAt: '2026-10-21T05:00:00.000Z',
  staffId: url.pathname.split('/').at(-2),
  window: { from: url.searchParams.get('from'), to: url.searchParams.get('to') },
  assignments: [
    {
      batchCode: 'SAMPLE-CLAT',
      subjectName: 'Quant',
      role: 'primary',
      startDate: null,
      endDate: null,
    },
  ],
  sessions: {
    planned: metric(20),
    delivered: metric(18),
    cancelled: metric(1),
    substituted: metric(0),
  },
  logsPending: metric(3),
  attendancePending: metric(0),
  markingPending: metric(null, 'not tracked (test)'),
  reviews: { submitted: metric(2), draft: metric(0) },
  unavailability: [],
});
const academicUp = () =>
  stubAcademic({
    activity,
    reviews: (url: URL) =>
      reviewsPayload(
        [
          review({
            authorStaffId: teacher.staffId,
            visibility: 'shareable',
            sessionDate: today as never,
          }),
          review({
            authorStaffId: teacher.staffId,
            visibility: 'internal',
            sessionDate: today as never,
          }),
          review({
            authorStaffId: teacher.staffId,
            visibility: 'shareable',
            sessionDate: '2026-01-01' as never,
          }),
        ].filter((r) => r.authorStaffId === url.searchParams.get('authorStaffId')),
      ),
    'demo-attendance': { items: [] },
  });

const req = (user: TestUser | null, path: string, method = 'GET', json?: unknown) =>
  user ? authedRequest(user, path, { method, json }) : buildRequest(path, { method, json });
type Made = { id: string; referenceCode: string; kind: string };
const generate = (user: TestUser | null, staffId: string, body: object = period) =>
  callRoute<Made>(makeReport, req(user, '/ops/api/v1/x', 'POST', body), { id: staffId });
const audits = (action: string) =>
  ctx.db.select().from(auditEvents).where(eq(auditEvents.action, action));
const storedSnapshot = async (reference: string) =>
  (
    await ctx.db
      .select()
      .from(opsTeacherReportExports)
      .where(eq(opsTeacherReportExports.referenceCode, reference))
  )[0]!;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Quant Teacher' });
  otherTeacher = await staffUser(ctx.db, ['teacher']);
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  await ctx.db.insert(opsStaffProfiles).values({
    staffId: teacher.staffId,
    staffCode: 'DEMO-T99',
    isSample: true,
    sourceNote: 'test',
  });
  await ctx.db
    .insert(opsStaffSubjectCapabilities)
    .values([{ staffId: teacher.staffId, subject: 'Quant', sourceNote: 'test' }] as never);
  await ctx.db.insert(opsStaffTasks).values([
    {
      staffId: teacher.staffId,
      title: 'Sample open task',
      dueOn: '2099-01-01',
      createdBy: teacher.id,
    },
    {
      staffId: teacher.staffId,
      title: 'Sample overdue task',
      dueOn: '2026-01-01',
      createdBy: teacher.id,
    },
  ] as never);
  await ctx.db.insert(opsEodReports).values({
    staffId: teacher.staffId,
    reportDate: addDays(today, -1),
    status: 'submitted',
    submittedAt: new Date(),
    snapshot: {},
    createdBy: teacher.id,
  } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('teacher reports (owner brief 22 Oct 2026)', () => {
  let reference: string;

  it('needs sign-in and ops:teacher_reports:generate; teachers never report on themselves', async () => {
    academicUp();
    expect((await generate(null, teacher.staffId)).status).toBe(401);
    for (const user of [teacher, coordinator, auditor])
      expect((await generate(user, teacher.staffId)).status).toBe(403);
    expect((await generate(manager, crypto.randomUUID())).status).toBe(404);
    expect(
      (await generate(manager, teacher.staffId, { from: period.to, to: period.from })).status,
    ).toBe(400);
  });

  it('stores a permission-cut snapshot with its hash, reference and audit row; no contact data', async () => {
    academicUp();
    const made = await generate(manager, teacher.staffId);
    expect(made.status).toBe(201);
    expect(made.data).toMatchObject({
      kind: 'internal',
      referenceCode: expect.stringMatching(/^TR-[0-9A-Z]{10}$/),
    });
    reference = made.data!.referenceCode;
    const row = await storedSnapshot(reference);
    expect(row.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.templateVersion).toBe('teacher-report/1');
    const s = row.snapshot as TeacherReportSnapshot;
    expect(s.teacher).toMatchObject({
      name: 'Sample Quant Teacher',
      staffCode: 'DEMO-T99',
      subjects: ['Quant'],
      verification: 'Unverified',
      isSample: true,
    });
    expect(
      s.academic.status === 'available' && s.academic.delivery.classes.map((f) => f.value),
    ).toEqual([20, 18, 1]);
    expect(s.academic.status === 'available' && s.academic.delivery.pending[2]!.value).toBeNull();
    // Only the two reviews dated in the period, never their text.
    expect(s.reviews).toEqual({ shareable: 1, internal: 1, latest: today });
    expect(s.feedback).toMatchObject({ approved: 0, scope: 'all moderated states' });
    expect(s.work).toMatchObject({
      status: 'available',
      open: 2,
      overdue: 1,
      eod: { submitted: 1, days: 30 },
    });
    expect(s.workOn).toEqual([
      '3 teaching logs pending',
      '1 classes cancelled',
      '29 calendar days without an EOD report',
    ]);
    expect(JSON.stringify(s)).not.toMatch(/phone|email|@example\.test|"notes"/i);
    expect(await audits('teacher.report_generated')).toMatchObject([{ entityId: teacher.staffId }]);
    expect((await generate(director, teacher.staffId)).status).toBe(201);
  });

  it('lists stored reports newest first, without snapshots', async () => {
    const list = await callRoute<
      { referenceCode: string; generatedBy: string; snapshot?: unknown }[]
    >(listReports, req(manager, '/ops/api/v1/x'), { id: teacher.staffId });
    expect(list.status).toBe(200);
    expect(list.data!.map((r) => r.generatedBy)).toEqual([
      director.displayName,
      manager.displayName,
    ]);
    expect(list.data![1]).toMatchObject({ referenceCode: reference });
    expect('snapshot' in list.data![0]!).toBe(false);
    expect(
      (await callRoute(listReports, req(teacher, '/ops/api/v1/x'), { id: teacher.staffId })).status,
    ).toBe(403);
  });

  it('downloads the stored PDF (audited); unknown references and other teachers are refused', async () => {
    const res = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: teacher.staffId, reportId: reference }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Written beside the unit test's sample so the live snapshot can be looked at too.
    if (process.env.PDF_SAMPLE_OUT)
      writeFileSync(process.env.PDF_SAMPLE_OUT.replace(/\.pdf$/, '-live.pdf'), bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(await audits('teacher.report_downloaded')).toHaveLength(1);
    const wrongTeacher = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: otherTeacher.staffId, reportId: reference }),
    });
    expect(wrongTeacher.status).toBe(404);
    const asTeacher = await reportPdf(req(teacher, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: teacher.staffId, reportId: reference }),
    });
    expect(asTeacher.status).toBe(403);
  });

  it('Academic OS unavailable: the snapshot and PDF say so and carry no delivery figures (never 0)', async () => {
    stubAcademic({});
    const made = await generate(manager, teacher.staffId);
    expect(made.status).toBe(201);
    const row = await storedSnapshot(made.data!.referenceCode);
    const s = row.snapshot as TeacherReportSnapshot;
    expect(s.academic).toMatchObject({ status: 'unavailable', reason: expect.any(String) });
    expect(s.academic).not.toHaveProperty('delivery');
    expect(s.summary[0]).toMatch(
      /^Class delivery: not available for this period \(Academic OS unavailable at .* IST\)\.$/,
    );
    expect(s.reviews).toBeNull();
    const pdf = await teacherReportPdf(s, row);
    expect(pdf.lines.join('\n')).toContain('delivery figures not available.');
    expect(pdf.lines).not.toContain('Classes planned');
  });
});
