/**
 * Teacher reviews (single store, scope, own scope, pending/draft/submitted, revisions) and
 * reviewed student reports (audiences, snapshot immutability, PDF) — acceptance 4, 5, 17, 18, 21.
 * Academic OS is simulated by stubbing fetch with a contract payload. Fictional data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  auditEvents,
  opsAdmissions,
  opsDemoSessions,
  opsDemos,
  opsReportExports,
  students,
} from '@elevate/database';
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as writeReview } from '../../src/app/api/v1/feedback/about-students/route';
import { PATCH as editReview } from '../../src/app/api/v1/feedback/about-students/[id]/route';
import {
  GET as openReport,
  POST as makeReport,
} from '../../src/app/api/v1/students/[id]/report/route';
import { POST as moveReport } from '../../src/app/api/v1/students/[id]/report/[reportId]/status/route';
import { GET as reportPdf } from '../../src/app/api/v1/students/[id]/report/[reportId]/pdf/route';
import { academicEvidence } from '../../src/server/academic-summary';
import { demoFeedbackByDay, demoReviewsDue } from '../../src/server/feedback';
import { progressReportPdf } from '../../src/server/pdf/progress-report';
import type { ReportSnapshot } from '../../src/server/student-report';
import { pendingCase } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const SENTINEL = 'SENTINEL-RAW-REMARK-7731';
let manager: StaffUser;
let manager2: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let otherTeacher: StaffUser;
let auditor: TestUser;
let studentId: string;
let otherStudentId: string;
let demoId: string;
let sessionIds: string[];
const academicStudentId = crypto.randomUUID();
const enrolmentId = crypto.randomUUID();

const req = (user: TestUser, path: string, method = 'GET', json?: unknown) =>
  authedRequest(user, path, { method, json });
const review = (user: TestUser, over: Record<string, unknown> = {}) =>
  callRoute<{ id: string; version: number; status: string }>(
    writeReview,
    req(user, '/ops/api/v1/feedback/about-students', 'POST', {
      studentId,
      subject: 'Quant',
      observedOn: '2026-09-15',
      observations: 'Observed in class.',
      ...over,
    }),
  );
const report = (user: TestUser, body: Record<string, unknown>) =>
  callRoute<{ id: string; referenceCode: string; fields: string[]; status: string }>(
    makeReport,
    req(user, '/ops/api/v1/x', 'POST', { from: '2026-09-01', to: '2026-09-30', ...body }),
    { id: studentId },
  );
type View = {
  view: ReportSnapshot | null;
  fields: string[];
  export: {
    status: string;
    reviewedBy: string | null;
    finalisedBy: string | null;
    at: Date;
    referenceCode: string;
    templateVersion: string | null;
  };
};
const open = (user: TestUser, ref: string) =>
  callRoute<View>(openReport, req(user, `/ops/api/v1/x?ref=${ref}`), { id: studentId });
const move = (user: TestUser, ref: string, to: 'reviewed' | 'final') =>
  callRoute<{ status: string }>(moveReport, req(user, '/ops/api/v1/x', 'POST', { to }), {
    id: studentId,
    reportId: ref,
  });

/** What Academic OS answers (contract academic.student_summary v1). */
function summary(over: Partial<AcademicStudentSummaryV1> = {}): AcademicStudentSummaryV1 {
  return {
    contract: 'academic.student_summary',
    version: 1,
    generatedAt: '2026-10-01T00:00:00.000Z' as never,
    studentId: academicStudentId as never,
    window: { from: '2026-09-01' as never, to: '2026-09-30' as never },
    enrolments: [
      {
        enrolmentId: enrolmentId as never,
        programmeCode: 'CLAT' as never,
        batchId: null,
        batchName: 'Sample CLAT batch',
        status: 'active',
        teachers: [{ staffId: teacher.staffId, subject: 'Quant' }],
      },
    ],
    attendance: { held: 10, present: 7, partial: 0, late: 1, absent: 1, excused: 0 },
    results: [
      {
        assessmentId: crypto.randomUUID(),
        code: 'CT-1',
        subject: 'Quant',
        examType: 'sectional',
        heldOn: '2026-09-05' as never,
        state: 'scored',
        score: 18,
        maxScore: 30,
        percentile: 55,
        rank: 9,
        cohort: { label: 'Sample CLAT batch', scored: 20 },
        resultVersion: 1,
      },
      {
        assessmentId: crypto.randomUUID(),
        code: 'CT-2',
        subject: 'Quant',
        examType: 'sectional',
        heldOn: '2026-09-20' as never,
        state: 'absent',
        score: null,
        maxScore: 30,
        percentile: null,
        rank: null,
        cohort: { label: 'Sample CLAT batch', scored: 19 },
        resultVersion: 1,
      },
    ],
    ...over,
  };
}
const academicUp = (payload = summary()) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: payload })),
  );
const academicDown = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  );
afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  manager2 = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Quant Teacher' });
  otherTeacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Other Teacher' });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  const [s, o] = await ctx.db
    .insert(students)
    .values([{ fullName: 'Sample Report Student' }, { fullName: 'Sample Other Student' }])
    .returning();
  studentId = s!.id;
  otherStudentId = o!.id;
  const { leadId, admissionId } = await pendingCase(counsellor, {
    programmeCode: 'CLAT',
    counselledOnly: true,
  });
  await ctx.db
    .update(opsAdmissions)
    .set({
      studentId: studentId as never,
      admittedAt: new Date('2026-08-20T05:00:00Z'),
      admissionNumber: '901',
      academicStudentId: academicStudentId as never,
      enrolmentId: enrolmentId as never,
    })
    .where(eq(opsAdmissions.id, admissionId as never));
  const [demo] = await ctx.db
    .insert(opsDemos)
    .values({
      admissionId: admissionId as never,
      leadId: leadId as never,
      feeTermsState: 'not_discussed',
      plannedSessionCount: 3,
      createdBy: manager.id,
    })
    .returning();
  demoId = demo!.id;
  const recorded = { recordedAt: new Date('2026-09-02T06:00:00Z'), recordedBy: manager.id };
  const rows = await ctx.db
    .insert(opsDemoSessions)
    .values([
      {
        demoId: demo!.id,
        sessionNumber: 1,
        dayNumber: 1,
        startsAt: new Date('2026-09-01T04:30:00Z'),
        subject: 'Quant',
        teacherStaffId: teacher.staffId,
        attendance: 'present',
        ...recorded,
      },
      {
        demoId: demo!.id,
        sessionNumber: 2,
        dayNumber: 2,
        startsAt: new Date('2026-09-02T04:30:00Z'),
        subject: 'Quant',
        teacherStaffId: otherTeacher.staffId,
        isSubstitute: true,
        attendance: 'absent',
        ...recorded,
      },
      {
        demoId: demo!.id,
        sessionNumber: 3,
        dayNumber: 3,
        startsAt: new Date('2026-09-03T04:30:00Z'),
        subject: 'Quant',
        teacherStaffId: teacher.staffId,
      },
    ])
    .returning();
  sessionIds = rows.sort((a, b) => a.sessionNumber - b.sessionNumber).map((r) => r.id);
});

describe('teacher reviews of a demo (acceptance 4)', () => {
  const states = async (user: TestUser) =>
    (await demoFeedbackByDay(ctx.db, user, demoId)).map((d) => [
      d.dayNumber,
      d.teachers.map((t) => `${t.teacherName}:${t.state}${t.isSubstitute ? ':substitute' : ''}`),
    ]);

  it('a taught, attended class with no review is pending; absent or not-yet-held classes are not due', async () => {
    expect(await states(manager)).toEqual([
      [1, ['Sample Quant Teacher:pending']],
      [2, ['Sample Other Teacher:not_due:substitute']],
      [3, ['Sample Quant Teacher:not_due']],
    ]);
    expect(
      (await demoReviewsDue(ctx.db, teacher, teacher.staffId)).map((r) => r.sessionId),
    ).toEqual([sessionIds[0]]);
    expect(await demoReviewsDue(ctx.db, teacher, otherTeacher.staffId)).toEqual([]);
  });

  it('own-scope readers see review states only for demos they run or teach', async () => {
    expect(await states(otherTeacher)).toHaveLength(3); // taught day 2 as a substitute
    expect(await states(counsellor)).toHaveLength(3);
    const strangers = await Promise.all(
      (['teacher', 'admissions_counsellor'] as const).map((role) => staffUser(ctx.db, [role])),
    );
    for (const user of strangers)
      await expect(demoFeedbackByDay(ctx.db, user, demoId)).rejects.toThrow(
        /demos you run or teach/,
      );
  });

  it('only the class teacher reviews a demo class, and only this student’s class', async () => {
    const scope = { scope: 'demo_session', demoSessionId: sessionIds[0] };
    expect((await review(otherTeacher, scope)).status).toBe(403);
    expect((await review(manager, { ...scope, teacherStaffId: otherTeacher.staffId })).status).toBe(
      403,
    );
    expect((await review(teacher, { ...scope, studentId: otherStudentId })).status).toBe(400);
    expect((await review(teacher, { scope: 'demo_session' })).status).toBe(400);
    expect((await review(teacher, { scope: 'general', demoSessionId: sessionIds[0] })).status).toBe(
      400,
    );
  });

  it('draft → submitted → revision keeps authorship and versions; states follow', async () => {
    const draft = await review(teacher, { scope: 'demo_session', demoSessionId: sessionIds[0] });
    expect(draft.status).toBe(201);
    expect(draft.data).toMatchObject({ status: 'draft', version: 1 });
    expect((await states(manager))[0]).toEqual([1, ['Sample Quant Teacher:draft']]);
    const edit = (status: string, observations: string) =>
      callRoute<{ id: string; version: number; status: string }>(
        editReview,
        req(teacher, '/ops/api/v1/x', 'PATCH', {
          subject: 'Quant',
          observedOn: '2026-09-01',
          observations,
          status,
        }),
        { id: draft.data!.id },
      );
    expect((await edit('final', 'Submitted text.')).data).toMatchObject({
      status: 'final',
      version: 1,
    });
    expect((await states(manager))[0]).toEqual([1, ['Sample Quant Teacher:submitted']]);
    const v2 = await edit('final', 'Corrected text.');
    expect(v2.data).toMatchObject({ version: 2, status: 'final' });
    expect((await states(manager))[0]).toEqual([1, ['Sample Quant Teacher:submitted']]);
    const [byManager] = await demoFeedbackByDay(ctx.db, manager, demoId);
    expect(byManager!.teachers[0]!.reviewIds).toEqual([v2.data!.id]);
    const [byCounsellor] = await demoFeedbackByDay(ctx.db, counsellor, demoId);
    expect(byCounsellor!.teachers[0]).toMatchObject({ state: 'submitted', reviewIds: [] });
    await expect(demoFeedbackByDay(ctx.db, auditor, demoId)).resolves.toHaveLength(3); // read-only roles see states
    expect(await demoReviewsDue(ctx.db, teacher, teacher.staffId)).toEqual([]);
  });

  it('an enrolment review by a teacher needs Academic to list them; it fails closed when Academic is down', async () => {
    const scope = { scope: 'enrolment', enrolmentId };
    academicDown();
    expect((await review(teacher, scope)).status).toBe(403);
    academicUp();
    expect((await review(otherTeacher, scope)).status).toBe(403);
    expect(
      (await review(teacher, { scope: 'enrolment', enrolmentId: crypto.randomUUID() })).status,
    ).toBe(400);
    expect((await review(teacher, scope)).status).toBe(201);
  });
});

describe('student reports (acceptance 5, 17, 21)', () => {
  let guardianRef: string;
  let before: ReportSnapshot;

  it('setup: one shareable and one internal submitted review, both carrying the raw-remark sentinel', async () => {
    for (const [visibility, strengths] of [
      ['shareable', 'Clear reasoning in class'],
      ['internal', `${SENTINEL} internal strengths`],
    ] as const)
      expect(
        (
          await review(teacher, {
            status: 'final',
            visibility,
            observations: `${SENTINEL} often misses homework`,
            strengths,
            areasToImprove: visibility === 'shareable' ? 'Ratios' : SENTINEL,
            actionPlan: visibility === 'shareable' ? 'Short daily practice set' : SENTINEL,
          })
        ).status,
      ).toBe(201);
  });

  it('a guardian report never carries raw reviews (API payload and PDF text); facts and gaps stay honest', async () => {
    academicUp();
    const made = await report(manager, { audience: 'guardian', acknowledgement: true });
    expect(made.status).toBe(201);
    expect(made.data!.fields).toEqual([
      'overview',
      'programmes',
      'results',
      'attendance',
      'summary',
    ]);
    guardianRef = made.data!.referenceCode;
    const got = await open(manager, guardianRef);
    expect(JSON.stringify(got.data)).not.toContain(SENTINEL);
    const [row] = await ctx.db
      .select()
      .from(opsReportExports)
      .where(eq(opsReportExports.referenceCode, guardianRef));
    expect(JSON.stringify(row!.snapshot)).not.toContain(SENTINEL);
    const s = got.data!.view!;
    expect(s.feedback).toBeUndefined();
    expect(s.summary).toEqual({
      evidence: [
        'Attendance: 8 of 9 recorded classes attended (88.9%); 0 excused, 1 not recorded.',
        'Results: 1 assessment scored, 1 missed (absent, not counted as zero).',
        'Trend — Quant sectional: insufficient data (1 scored result).',
      ],
      strengths: ['Quant: Clear reasoning in class'],
      areas: ['Quant: Ratios'],
      nextSteps: ['Quant: Short daily practice set'],
    });
    expect(s.academic).toMatchObject({
      status: 'available',
      results: [
        {
          score: 18,
          percent: 60,
          comparison: 'Percentile 55, rank 9 of 20 scored in Sample CLAT batch',
        },
        { score: null, percent: null, comparison: 'Absent — not scored, not compared' },
      ],
    });
    const pdf = await progressReportPdf(s, got.data!.export);
    const text = pdf.lines.join('\n');
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain('Proposed next step — not yet agreed with the teacher');
    expect(text).toContain('18 / 30 (60%)');
    expect(text).toContain('Absent');
    expect(text).toContain('Acknowledgement');
    const res = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: studentId, reportId: guardianRef }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(
      (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount(),
    ).toBeGreaterThanOrEqual(1);
    before = s;
  });

  it('an internal report holds the raw reviews for staff who may read feedback, and hides them from those who may not', async () => {
    academicUp();
    const made = await report(manager, { audience: 'internal' });
    const s = (await open(manager, made.data!.referenceCode)).data!.view!;
    expect(s.feedback!.map((f) => f.observations)).toContain(`${SENTINEL} often misses homework`);
    expect(s.summary).toBeUndefined();
    const forCounsellor = await open(counsellor, made.data!.referenceCode);
    expect(forCounsellor.data!.fields).not.toContain('feedback');
    expect(JSON.stringify(forCounsellor.data)).not.toContain(SENTINEL);
  });

  it('audiences not enabled are refused; a student fee statement appears only when asked for', async () => {
    expect((await report(manager, { audience: 'student' })).status).toBe(400);
    const withFees = await report(manager, {
      audience: 'guardian',
      sections: { overview: true, fees: true, feedback: true },
    });
    expect(withFees.data!.fields).toEqual(['overview', 'fees']);
  });

  it('draft → reviewed (someone else) → final; final is immutable even after the records change', async () => {
    expect((await move(manager, guardianRef, 'final')).status).toBe(409); // review first
    expect((await move(manager, guardianRef, 'reviewed')).status).toBe(403); // own report
    expect((await move(counsellor, guardianRef, 'reviewed')).status).toBe(403);
    expect((await move(manager2, guardianRef, 'reviewed')).status).toBe(200);
    expect((await move(counsellor, guardianRef, 'final')).status).toBe(403);
    expect((await move(manager, guardianRef, 'final')).status).toBe(200);
    expect((await move(manager2, guardianRef, 'final')).status).toBe(409);
    // Records change after finalisation: a new review and different Academic figures.
    await review(teacher, { status: 'final', visibility: 'shareable', strengths: 'LATER-CHANGE' });
    academicUp(
      summary({ attendance: { held: 1, present: 0, partial: 0, late: 0, absent: 1, excused: 0 } }),
    );
    const after = await open(manager, guardianRef);
    expect(after.data!.view).toEqual(before);
    expect(after.data!.export).toMatchObject({
      status: 'final',
      reviewedBy: manager2.id,
      finalisedBy: manager.id,
      templateVersion: 'progress-report/1',
    });
    const actions = (
      await ctx.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.module, 'ops'), eq(auditEvents.entityType, 'student_report')))
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'student.report_reviewed',
        'student.report_finalised',
        'student.report_downloaded',
      ]),
    );
  });

  it('Academic unavailable: the snapshot says so with the time checked; nothing becomes zero', async () => {
    academicDown();
    const made = await report(manager, { audience: 'guardian' });
    const s = (await open(manager, made.data!.referenceCode)).data!.view!;
    expect(s.academic).toMatchObject({
      status: 'unavailable',
      reason: 'Could not reach the source',
    });
    expect(s.summary!.evidence).toEqual([
      'Attendance: not available for this period.',
      'Results: not available for this period.',
    ]);
    expect(await academicEvidence(ctx.db, null)).toEqual({ status: 'not_enrolled' });
  });

  it('a pre-snapshot (legacy) report opens without content and cannot be printed or moved', async () => {
    const [row] = await ctx.db
      .insert(opsReportExports)
      .values({
        studentId: studentId as never,
        requestedBy: manager.id,
        periodFrom: '2026-01-01' as never,
        periodTo: '2026-01-31' as never,
        fieldsIncluded: ['overview'],
        referenceCode: 'SR-LEGACY0001',
        status: 'final',
        snapshot: { legacy: true },
        finalisedBy: manager.id,
        finalisedAt: new Date(),
      })
      .returning();
    expect((await open(manager, row!.referenceCode)).data).toMatchObject({
      view: null,
      fields: ['overview'],
    });
    const res = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: studentId, reportId: row!.referenceCode }),
    });
    expect(res.status).toBe(400);
    expect((await move(manager2, row!.referenceCode, 'reviewed')).status).toBe(409);
  });
});
