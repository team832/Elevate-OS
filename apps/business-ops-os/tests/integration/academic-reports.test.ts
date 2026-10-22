/**
 * Teacher reviews of a demo read from Academic OS (owner answer 1, 21 Oct 2026: pending /
 * submitted / source unavailable, own scope) and reviewed student reports (audiences, snapshot
 * immutability, PDF) — acceptance 4, 5, 15, 17, 18, 21. Academic OS is simulated by stubbing
 * fetch with contract payloads. Fictional data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import {
  auditEvents,
  opsAdmissions,
  opsDemoSessions,
  opsDemos,
  opsGuardians,
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
import { review as academicReview, reviewsPayload, stubAcademic } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const SENTINEL = 'SENTINEL-RAW-REMARK-7731';
const GUARDIAN_PHONE = '+910000000001';
const none = (text: string, ...forbidden: string[]) => {
  for (const f of forbidden) expect(text).not.toContain(f);
};
let manager: StaffUser;
let manager2: StaffUser;
let counsellor: StaffUser;
let teacher: StaffUser;
let otherTeacher: StaffUser;
let auditor: TestUser;
let studentId: string;
let demoId: string;
let sessionIds: string[];
const academicStudentId = crypto.randomUUID();
const enrolmentId = crypto.randomUUID();

const req = (user: TestUser, path: string, method = 'GET', json?: unknown) =>
  authedRequest(user, path, { method, json });
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
/** Submitted reviews Academic returns for this student (tests push to it). */
const submitted: ReturnType<typeof academicReview>[] = [];
const academicUp = (payload = summary()) =>
  stubAcademic({
    summary: payload,
    reviews: (url: URL) => reviewsPayload(submitted, url.searchParams.get('coreStudentId')),
    'demo-attendance': { items: [] },
  });
const academicDown = () => stubAcademic({});
const quantReview = (over: Partial<ReturnType<typeof academicReview>>) =>
  academicReview({
    authorStaffId: teacher.staffId as never,
    authorName: 'Sample Quant Teacher',
    coreStudentId: studentId as never,
    ...over,
  });
afterEach(() => vi.unstubAllGlobals());
const SEPT_10 = new Date('2026-09-10T06:00:00Z');

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  manager2 = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Quant Teacher' });
  otherTeacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Other Teacher' });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  const [s] = await ctx.db
    .insert(students)
    .values({ fullName: 'Sample Report Student' })
    .returning();
  studentId = s!.id;
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

describe('teacher reviews of a demo, from Academic OS (acceptance 4)', () => {
  const states = async (user: TestUser) =>
    (await demoFeedbackByDay(ctx.db, user, demoId)).days.map((d) => [
      d.dayNumber,
      d.teachers.map((t) => `${t.teacherName}:${t.state}${t.isSubstitute ? ':substitute' : ''}`),
    ]);

  it('a taught, attended class with no submitted review is pending; absent or not-yet-held classes are not due', async () => {
    academicUp();
    expect(await states(manager)).toEqual([
      [1, ['Sample Quant Teacher:pending']],
      [2, ['Sample Other Teacher:not_due:substitute']],
      [3, ['Sample Quant Teacher:not_due']],
    ]);
    const due = await demoReviewsDue(ctx.db, manager, teacher.staffId, SEPT_10);
    // Last 30 days only; not on an Academic roster, so no review link (the coordinator adds it).
    expect(due.rows.map((r) => [r.id, r.onRoster])).toEqual([[sessionIds[0], false]]);
    expect((await demoReviewsDue(ctx.db, manager, teacher.staffId)).rows).toEqual([]);
    // Own scope reaches only the reader's own staff record; teachers hold no Ops feedback right (D-073).
    expect(await demoReviewsDue(ctx.db, counsellor, teacher.staffId, SEPT_10)).toMatchObject({
      shared: false,
      rows: [],
    });
    await expect(demoReviewsDue(ctx.db, teacher, teacher.staffId, SEPT_10)).rejects.toThrow();
  });

  it('own-scope readers see review states only for demos they run', async () => {
    academicUp();
    expect(await states(counsellor)).toHaveLength(3);
    await expect(states(otherTeacher)).rejects.toThrow(/permission/); // not in Business Ops (D-073)
    const stranger = await staffUser(ctx.db, ['admissions_counsellor']);
    await expect(demoFeedbackByDay(ctx.db, stranger, demoId)).rejects.toThrow(
      /demos you run or teach/,
    );
  });

  it('a submitted Academic review of that day by the class teacher makes it submitted; another day or author does not', async () => {
    academicUp();
    const own = quantReview({ reviewType: 'demo_session', sessionDate: '2026-09-01' as never });
    submitted.push(
      quantReview({ reviewType: 'demo_session', sessionDate: '2026-09-03' as never }),
      quantReview({
        reviewType: 'demo_session',
        sessionDate: '2026-09-01' as never,
        authorStaffId: otherTeacher.staffId as never,
      }),
      own,
    );
    expect((await states(manager))[0]).toEqual([1, ['Sample Quant Teacher:submitted']]);
    const [byCounsellor] = (await demoFeedbackByDay(ctx.db, counsellor, demoId)).days;
    expect(byCounsellor!.teachers[0]).toMatchObject({
      state: 'submitted',
      reviewIds: [`${own.reviewKey}:1`],
    });
    await expect(demoFeedbackByDay(ctx.db, auditor, demoId)).resolves.toBeTruthy(); // read-only roles see states
    expect((await demoReviewsDue(ctx.db, manager, teacher.staffId, SEPT_10)).rows).toEqual([]);
    submitted.length = 0;
  });

  it('Academic down: "Source unavailable" instead of pending, on the demo and the teacher list', async () => {
    academicDown();
    expect((await states(manager))[0]).toEqual([1, ['Sample Quant Teacher:unknown']]);
    expect(
      (await demoReviewsDue(ctx.db, manager, teacher.staffId, SEPT_10)).unavailable,
    ).toMatchObject({
      status: 'unavailable',
    });
  });
});

describe('student reports (acceptance 5, 17, 21)', () => {
  let guardianRef: string;
  let before: ReportSnapshot;

  it('setup: a guardian with a phone; one shareable and one internal submitted review, both carrying the raw-remark sentinel', async () => {
    await ctx.db.insert(opsGuardians).values({
      studentId: studentId as never,
      fullName: 'Sample Guardian R',
      relationship: 'mother',
      phone: GUARDIAN_PHONE,
      email: 'sample-guardian-r@example.test',
      consentStatus: 'given',
      createdBy: manager.id,
    });
    submitted.push(
      quantReview({
        visibility: 'shareable',
        strengths: 'Clear reasoning in class',
        areasForSupport: 'Ratios',
        suggestedAction: 'Short daily practice set',
        academicConcerns: `${SENTINEL} often misses homework`,
        homeworkEvidence: SENTINEL,
      }),
      quantReview({
        visibility: 'internal',
        strengths: `${SENTINEL} internal strengths`,
        areasForSupport: SENTINEL,
        suggestedAction: SENTINEL,
      }),
      quantReview({
        status: 'withdrawn',
        withdrawnAt: '2026-09-20T00:00:00.000Z' as never,
        visibility: 'shareable',
        strengths: `${SENTINEL} withdrawn`,
      }),
    );
  });

  it('PTM report: shareable notes only (API payload, stored snapshot and PDF text), affirmative wording, at most 2 pages', async () => {
    academicUp();
    const made = await report(manager, { audience: 'guardian', acknowledgement: true });
    expect(made.status).toBe(201);
    expect(made.data!.fields).toEqual(['overview', 'results', 'attendance', 'feedback', 'summary']);
    guardianRef = made.data!.referenceCode;
    const got = await open(manager, guardianRef);
    none(JSON.stringify(got.data), SENTINEL, GUARDIAN_PHONE);
    const [row] = await ctx.db
      .select()
      .from(opsReportExports)
      .where(eq(opsReportExports.referenceCode, guardianRef));
    none(JSON.stringify(row!.snapshot), SENTINEL, GUARDIAN_PHONE, 'academicConcerns', 'kyc');
    const s = got.data!.view!;
    expect(s).toMatchObject({ kind: 'guardian', tone: 'affirmative' });
    expect(s.kyc).toBeUndefined();
    expect(s.feedback).toEqual([
      expect.objectContaining({ visibility: 'shareable', strengths: 'Clear reasoning in class' }),
    ]);
    expect(s.summary).toEqual({
      evidence: [
        'Attendance rate: Not recorded. 8 of 9 recorded classes attended.',
        'Results: 1 assessment scored, 1 not attempted (not counted as zero).',
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
    const text = pdf.lines.join(' ');
    // Never a guardian phone (the lead's 098… number or the guardian row), an internal remark or a status-history line.
    none(text, SENTINEL, GUARDIAN_PHONE, 'Status changes', 'KYC');
    expect(text).not.toMatch(/098\d{8}/);
    expect(pdf.lines).toEqual(
      expect.arrayContaining([
        'PTM report (for parents)',
        'Where to work on',
        'Next steps',
        'Absent',
        'Acknowledgement',
      ]),
    );
    expect(text).toContain('60% (18/30)');
    const res = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: studentId, reportId: guardianRef }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(
      (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount(),
    ).toBeLessThanOrEqual(2);
    before = s;
  });

  it('internal report: KYC with guardian contacts, every review field (current, not withdrawn), neutral summary', async () => {
    academicUp();
    const made = await report(manager, { audience: 'internal' });
    expect(made.data!.fields).toEqual([
      'overview',
      'kyc',
      'results',
      'attendance',
      'feedback',
      'fees',
      'summary',
    ]);
    const got = await open(manager, made.data!.referenceCode);
    const s = got.data!.view!;
    expect(s.feedback!.map((f) => f.academicConcerns)).toEqual(
      expect.arrayContaining([`${SENTINEL} often misses homework`]),
    );
    expect(s.feedback!.some((f) => f.strengths?.includes('withdrawn'))).toBe(false);
    expect(s.summary!.evidence[1]).toBe(
      'Results: 1 assessment scored, 1 missed (absent, not counted as zero).',
    );
    expect(s.kyc).toMatchObject({
      class: 'class_12',
      guardians: [{ name: 'Sample Guardian R', phone: GUARDIAN_PHONE, consent: 'given' }],
    });
    expect(s.kyc!.documents.map((d) => d.state)).toEqual(Array(5).fill('not_recorded'));
    const pdf = await progressReportPdf(s, got.data!.export);
    expect(pdf.lines).toEqual(
      expect.arrayContaining([
        'KYC and student details (private — internal use only)',
        GUARDIAN_PHONE,
        'Status changes in the period',
        'Areas for improvement',
      ]),
    );
    // The student's counsellor reads reviews and KYC of students they counsel (owner answer 1).
    const forCounsellor = await open(counsellor, made.data!.referenceCode);
    expect(forCounsellor.data!.fields).toEqual(expect.arrayContaining(['feedback', 'kyc']));
  });

  it('403: a counsellor who does not counsel the student can neither generate, open nor print a report', async () => {
    const stranger = await staffUser(ctx.db, ['admissions_counsellor']);
    expect((await report(stranger, { audience: 'guardian' })).status).toBe(403);
    expect((await open(stranger, guardianRef)).status).toBe(403);
    const res = await reportPdf(req(stranger, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: studentId, reportId: guardianRef }),
    });
    expect(res.status).toBe(403);
  });

  it('kinds not enabled are refused; a family fee statement appears only when asked for', async () => {
    expect((await report(manager, { audience: 'student' })).status).toBe(400);
    const withFees = await report(manager, {
      audience: 'guardian',
      sections: { overview: true, fees: true, feedback: true, kyc: true },
    });
    expect(withFees.data!.fields).toEqual(['overview', 'feedback', 'fees']);
  });

  it('draft → reviewed (someone else) → final; final is immutable even after the records change', async () => {
    academicUp();
    expect((await move(manager, guardianRef, 'final')).status).toBe(409); // review first
    expect((await move(manager, guardianRef, 'reviewed')).status).toBe(403); // own report
    expect((await move(counsellor, guardianRef, 'reviewed')).status).toBe(403);
    expect((await move(manager2, guardianRef, 'reviewed')).status).toBe(200);
    expect((await move(counsellor, guardianRef, 'final')).status).toBe(403);
    expect((await move(manager, guardianRef, 'final')).status).toBe(200);
    expect((await move(manager2, guardianRef, 'final')).status).toBe(409);
    // Records change after finalisation: a new review and different Academic figures.
    submitted.push(quantReview({ visibility: 'shareable', strengths: 'LATER-CHANGE' }));
    academicUp(
      summary({ attendance: { held: 1, present: 0, partial: 0, late: 0, absent: 1, excused: 0 } }),
    );
    const after = await open(manager, guardianRef);
    expect(after.data!.view).toEqual(before);
    expect(after.data!.export).toMatchObject({
      status: 'final',
      reviewedBy: manager2.id,
      finalisedBy: manager.id,
      templateVersion: 'progress-report/2',
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

  it('R16: a withdrawn source review blocks a non-final report; a final one only shows a notice', async () => {
    academicUp();
    const draft = await report(manager, { audience: 'internal' });
    const ref = draft.data!.referenceCode;
    const source = submitted[0]!;
    submitted[0] = {
      ...source,
      status: 'withdrawn',
      withdrawnAt: '2026-10-01T00:00:00.000Z' as never,
    };
    const opened = await open(manager, ref);
    expect(opened.data).toMatchObject({
      notice: 'A source review was withdrawn — generate the report again.',
      actions: { review: false, finalise: false },
    });
    expect((await move(manager2, ref, 'reviewed')).status).toBe(409);
    const pdf = await reportPdf(req(manager, '/ops/api/v1/x'), {
      params: Promise.resolve({ id: studentId, reportId: ref }),
    });
    expect(pdf.status).toBe(409);
    const issued = await open(manager, guardianRef);
    expect(issued.data!.view).toEqual(before);
    expect(issued.data).toMatchObject({
      notice: 'A source review was withdrawn after this report was finalised.',
    });
    submitted[0] = source;
    academicDown();
    expect((await move(manager2, ref, 'reviewed')).status).toBe(409); // cannot re-check: waits
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
      'Teacher reviews: not available for this period.',
    ]);
    expect(s.summary!.strengths).toEqual(['Not available for this period.']);
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
