/**
 * AI help on reports and the student page (D-111): progress and teacher report comments, the
 * student summary, and the marketing facts in a monthly report draft. The AI provider, Academic
 * OS and Marketing OS are simulated through fetch; no real service is called. Fictional people
 * only: the real-looking names prove that names never leave Elevate OS.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  departments,
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsReportExports,
  opsTeacherReportExports,
  staffMembers,
  students,
} from '@elevate/database';
import { metric, type MarketingMonthlySnapshotV1 } from '@elevate/shared-contracts';
import { toIsoDateTime, type IsoDate } from '@elevate/shared-types';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import * as studentReportRoute from '../../src/app/api/v1/ai/student-report/route';
import * as studentSummaryRoute from '../../src/app/api/v1/ai/student-summary/route';
import * as teacherReportRoute from '../../src/app/api/v1/ai/teacher-report/route';
import { POST as makeStudentReport } from '../../src/app/api/v1/students/[id]/report/route';
import { POST as makeTeacherReport } from '../../src/app/api/v1/teachers/[id]/report/route';
import { draftReport } from '../../src/server/ai-drafts';
import { progressReportPdf } from '../../src/server/pdf/progress-report';
import { teacherReportPdf } from '../../src/server/pdf/teacher-report';
import { updateSetting } from '../../src/server/settings';
import { pendingCase } from './admissions-fixtures';
import { review, reviewsPayload } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const KEY = 'test-only-groq-key-654321';
const ADMISSION_NUMBER = '9907';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const SECRETS = [
  'Kavya',
  'Malhotra',
  'Meera',
  'Kulkarni',
  '98290',
  'example.test',
  ADMISSION_NUMBER,
  'SAMPLE-B7',
  'Sample Quant Teacher',
  KEY,
];
type Items = { items: { name: string; label: string; value: string }[] };

let manager: StaffUser;
let teacher: StaffUser;
let marketer: StaffUser;
let coordinator: TestUser;
let studentId: string;
let academicUp = true;
const sent: string[] = [];
const academicStudentId = crypto.randomUUID();

const summary = () => ({
  contract: 'academic.student_summary',
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  studentId: academicStudentId,
  window: PERIOD,
  enrolments: [],
  // No rate from Academic: it must go out as "Not recorded", never a figure.
  attendance: { held: 10, present: 7, partial: 0, late: 1, absent: 1, excused: 0 },
  results: [
    ['2026-09-05', 18],
    ['2026-09-20', null],
  ].map(([heldOn, score]) => ({
    assessmentId: crypto.randomUUID(),
    code: 'SAMPLE-B7',
    subject: 'Quant',
    examType: 'sectional',
    heldOn,
    state: score === null ? 'absent' : 'scored',
    score,
    maxScore: 30,
    percentile: null,
    rank: null,
    cohort: { label: 'Sample batch', scored: 1 },
    resultVersion: 1,
  })),
});
const m = (value: number | null) => ({
  status: value === null ? 'missing' : 'ok',
  value,
  ...(value === null ? { reason: 'not tracked (test)' } : {}),
  definition: 'test definition',
  window: PERIOD,
  unit: 'count',
});
const activity = (url: URL) => ({
  contract: 'academic.teacher_activity',
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  staffId: url.pathname.split('/').at(-2),
  window: PERIOD,
  assignments: [],
  sessions: { planned: m(20), delivered: m(18), cancelled: m(1), substituted: m(0) },
  logsPending: m(3),
  attendancePending: m(0),
  markingPending: m(null),
  reviews: { submitted: m(2), draft: m(0) },
  unavailability: [],
});
const meta = { definition: 'Sample definition', window: PERIOD, unit: 'count' } as const;
const marketing: MarketingMonthlySnapshotV1 = {
  version: 1,
  cutoffAt: toIsoDateTime(),
  isSample: true,
  targets: [],
  funnel: [
    {
      key: 'lead_stages',
      label: 'Leads by stage reached',
      count: metric.missing('Not connected', meta),
    },
  ],
  callOutcomes: [],
  campaigns: [],
  content: {
    planned: metric.ok(3, meta),
    approved: metric.ok(2, meta),
    published: metric.ok(1, meta),
  },
  optimisation: [],
};

const answer = (obj: unknown) => () =>
  Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(obj) } }],
  });

// Every draft's keys: each route reads its own and ignores the rest.
const reply = answer({
  comment: 'Sample comment.',
  summary: 'Sample summary.',
  notes: 'None recorded.',
  nextDayPlan: 'Sample plan.',
});

/** One router for every outgoing call: the AI provider, Academic OS and Marketing OS. */
async function route(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  if (url.origin === 'https://ai.test') {
    const { messages } = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    sent.push(messages.map((x) => x.content).join('\n'));
    return reply();
  }
  if (url.pathname.includes('/marketing/api/internal/v1/reports/monthly'))
    return Response.json({ data: marketing });
  if (!academicUp) throw new TypeError('fetch failed');
  if (/\/students\/[^/]+\/summary/.test(url.pathname)) return Response.json({ data: summary() });
  if (/\/teachers\/[^/]+\/activity/.test(url.pathname))
    return Response.json({ data: activity(url) });
  if (url.pathname.endsWith('/reviews')) {
    const core = url.searchParams.get('coreStudentId');
    const author = url.searchParams.get('authorStaffId');
    const r = review({
      authorStaffId: teacher.staffId as never,
      authorName: 'Sample Quant Teacher',
      coreStudentId: studentId as never,
      visibility: 'shareable',
      sessionDate: '2026-09-10' as never,
      strengths: `Kavya Malhotra solves Quant fast. Meera ma'am says call 98290 12345 or kavya.m@example.test, adm ${ADMISSION_NUMBER}.`,
    });
    return Response.json({
      data: reviewsPayload(core === studentId || author === teacher.staffId ? [r] : [], core),
    });
  }
  throw new TypeError('fetch failed');
}

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Quant Teacher' });
  await staffUser(ctx.db, ['teacher'], { name: 'Meera Kulkarni' });
  marketer = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  const counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  const [s] = await ctx.db.insert(students).values({ fullName: 'Kavya Malhotra' }).returning();
  studentId = s!.id;
  const { admissionId } = await pendingCase(counsellor, {
    programmeCode: 'CLAT',
    counselledOnly: true,
    name: 'Kavya Malhotra',
    extra: { studentEmail: 'kavya.m@example.test' },
  });
  await ctx.db
    .update(opsAdmissions)
    .set({
      studentId: studentId as never,
      admittedAt: new Date('2026-08-20T05:00:00Z'),
      admissionNumber: ADMISSION_NUMBER,
      academicStudentId: academicStudentId as never,
    })
    .where(eq(opsAdmissions.id, admissionId as never));
  const [plan] = await ctx.db
    .insert(opsFeePlans)
    .values({
      admissionId,
      studentId,
      label: 'test-only agreement',
      totalPaise: 100_000_00,
      createdBy: manager.id,
    } as never)
    .returning();
  await ctx.db.insert(opsFeeInstalments).values(
    (
      [
        [1, '2026-01-10', 50_000_00],
        [2, '2099-01-10', 25_000_00],
        [3, '2099-04-10', 25_000_00],
      ] as const
    ).map(([sequence, dueDate, amountPaise]) => ({
      planId: plan!.id,
      sequence,
      dueDate,
      amountPaise,
    })),
  );
  const [dept] = await ctx.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'MARKETING_GROWTH'));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: dept!.id })
    .where(eq(staffMembers.id, marketer.staffId));
  vi.stubEnv('GROQ_API_KEY', KEY);
  vi.stubEnv('GROQ_MODEL', 'test-model');
  vi.stubEnv('GROQ_BASE_URL', 'https://ai.test/v1');
  vi.stubGlobal('fetch', vi.fn(route));
});
afterEach(() => {
  sent.length = 0;
});

const post = (r: { POST: Parameters<typeof callRoute>[0] }, who: TestUser | null, json: unknown) =>
  callRoute<Items>(
    r.POST,
    who
      ? authedRequest(who, '/ops/api/v1/ai/x', { method: 'POST', json })
      : buildRequest('/ops/api/v1/ai/x', { method: 'POST', json }),
  );

/** [route, body, AI feature switch, what the draft fills, wording when Academic OS is down] */
const ROUTES = [
  [
    'student-report',
    studentReportRoute,
    () => ({ studentId, audience: 'guardian', ...PERIOD }),
    'reportDraft',
    'comment',
    'Attendance: not available for this period.',
  ],
  [
    'teacher-report',
    teacherReportRoute,
    () => ({ staffId: teacher.staffId, ...PERIOD }),
    'reportDraft',
    'comment',
    'Class delivery: not available for this period',
  ],
  [
    'student-summary',
    studentSummaryRoute,
    () => ({ studentId }),
    'studentSummary',
    'summary',
    'Academic OS: source unavailable',
  ],
] as const;

describe.each(ROUTES)('AI %s (D-111)', (_name, r, body, feature, field, downText) => {
  it('401 signed out, 403 without the permission, 400 on a bad body; nothing sent', async () => {
    expect((await post(r, null, body())).status).toBe(401);
    expect((await post(r, teacher, body())).status).toBe(403);
    expect(
      (await post(r, manager, { ...body(), from: 'soon', studentId: 'x', staffId: 'x' })).status,
    ).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('drafts with the fake provider; no names, contacts, admission numbers, codes or the key go out', async () => {
    const res = await post(r, manager, body());
    expect(res.status).toBe(200);
    expect(res.data!.items).toEqual([
      expect.objectContaining({ name: field, value: expect.stringMatching(/^Sample/) }),
    ]);
    expect(sent).toHaveLength(1);
    for (const secret of SECRETS) expect(sent[0]).not.toContain(secret);
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it('Academic OS down: still drafts, and the facts say "not available", never 0', async () => {
    academicUp = false;
    const res = await post(r, manager, body());
    academicUp = true;
    expect(res.status).toBe(200);
    expect(sent[0]).toContain(downText);
  });

  it('AI not set up, helper switched off (409) and the daily limit (429): plain words, nothing sent', async () => {
    vi.stubEnv('GROQ_MODEL', '');
    const off = await post(r, manager, body());
    vi.stubEnv('GROQ_MODEL', 'test-model');
    expect([off.status, off.error?.message]).toEqual([409, 'AI drafting is not set up.']);
    const all = {
      feedbackSummary: true,
      reportDraft: true,
      taskBrief: true,
      csvMapping: true,
      scoreSheet: true,
      studentSummary: true,
    };
    await updateSetting(ctx.db, manager, {
      key: 'ai.features',
      value: { ...all, [feature]: false },
    });
    const disabled = await post(r, manager, body());
    await updateSetting(ctx.db, manager, { key: 'ai.features', value: all });
    expect([disabled.status, disabled.error?.message]).toEqual([
      409,
      'This AI draft helper is turned off in settings.',
    ]);
    expect(sent).toHaveLength(0);
    const director = await createTestUser(ctx.db, { roles: ['director'] });
    await updateSetting(ctx.db, manager, { key: 'ai.daily_limit_per_user', value: { limit: 1 } });
    const statuses = [
      (await post(r, director, body())).status,
      (await post(r, director, body())).status,
    ];
    await updateSetting(ctx.db, manager, { key: 'ai.daily_limit_per_user', value: { limit: 50 } });
    expect(statuses).toEqual([200, 429]);
  });
});

describe('what each draft is built from', () => {
  it('progress report (PTM kind): the summary facts with missing data in words, teachers’ notes inside <data>', async () => {
    await post(studentReportRoute, manager, { studentId, audience: 'guardian', ...PERIOD });
    for (const fact of [
      'Attendance rate: Not recorded',
      'not attempted (not counted as zero)',
      '<data>',
      'solves Quant fast',
    ])
      expect(sent[0]).toContain(fact);
    expect(sent[0]).toContain('The family reads it');
  });

  it('student summary: status, fee instalments (counts and amounts), Academic facts and reviews', async () => {
    await post(studentSummaryRoute, manager, { studentId });
    for (const fact of [
      'Admission status:',
      'tuition ₹1,00,000.00',
      '0 paid, 2 due, 1 overdue (₹50,000.00 overdue)',
      'Attendance rate: Not recorded',
      'absent (not counted as zero)',
      'Latest shareable teacher reviews',
    ])
      expect(sent[0]).toContain(fact);
  });

  it('student summary: a reader without fee access gets fees "not included", never figures', async () => {
    expect((await post(studentSummaryRoute, coordinator, { studentId })).status).toBe(200);
    expect(sent[0]).toContain('Fees: not included (no fee permission)');
    expect(sent[0]).not.toContain('₹');
  });

  it('monthly marketing report draft: the marketing facts go out, missing as "Not available"', async () => {
    await draftReport(ctx.db, marketer, {
      periodKind: 'month',
      reportDate: '2026-09-15' as IsoDate,
    });
    expect(sent[0]).toContain('Leads by stage reached: Not available (Not connected)');
    expect(sent[0]).toContain('Content owned: 3 planned · 2 approved · 1 published');
  });

  it('the comment a person saves is stored in the snapshot and printed as written', async () => {
    const comment = 'Edited by a person.';
    const json = { ...PERIOD, comment };
    const made = await callRoute<{ referenceCode: string }>(
      makeTeacherReport,
      authedRequest(manager, '/ops/api/v1/x', { method: 'POST', json }),
      { id: teacher.staffId },
    );
    const [t] = await ctx.db
      .select()
      .from(opsTeacherReportExports)
      .where(eq(opsTeacherReportExports.referenceCode, made.data!.referenceCode));
    expect((await teacherReportPdf(t!.snapshot as never, t!)).lines).toContain(comment);
    const student = await callRoute<{ id: string }>(
      makeStudentReport,
      authedRequest(manager, '/ops/api/v1/x', { method: 'POST', json }),
      { id: studentId },
    );
    const [p] = await ctx.db
      .select()
      .from(opsReportExports)
      .where(eq(opsReportExports.id, student.data!.id as never));
    expect(p!.templateVersion).toBe('progress-report/3');
    expect((await progressReportPdf(p!.snapshot as never, p!)).lines).toContain(comment);
  });
});
