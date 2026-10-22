/**
 * Teacher reviews read from Academic OS (owner answer 1, 21 Oct 2026; R4), Ops acknowledgements,
 * the demo-sessions internal route and Academic marks on linked demo classes (owner answer 3,
 * R5), and teacher operations views (brief 2 §7–8). Academic is a stubbed fetch. Fictional data.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsEodReports,
  opsStaffSubjectCapabilities,
  opsStaffTasks,
  students,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as ack } from '../../src/app/api/v1/review-acks/route';
import { GET as demoSessionsRoute } from '../../src/app/api/internal/v1/demo-sessions/route';
import { POST as sessionAction } from '../../src/app/api/v1/demos/[id]/sessions/[sessionId]/route';
import { istToday } from '../../src/domain';
import { reviewsAuthored, studentReviews } from '../../src/server/academic-reviews';
import { previewConversion } from '../../src/server/conversion';
import { getDemo, listDemos, syncDemosFromAcademic } from '../../src/server/demos';
import { getTeacherProfile, listTeachers } from '../../src/server/teachers';
import { demoListQuery } from '../../src/server/demos-schemas';
import { pendingCase } from './admissions-fixtures';
import { review, reviewsPayload, stubAcademic } from './academic-stub';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const SENTINEL = 'SENTINEL-INTERNAL-REMARK-5521';
let manager: StaffUser;
let counsellor: StaffUser;
let stranger: StaffUser;
let teacher: StaffUser;
let otherTeacher: StaffUser;
let finance: StaffUser;
let studentId: string;
let demoId: string;
let sessionIds: string[];
let reviews: ReturnType<typeof review>[];

afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  stranger = await staffUser(ctx.db, ['admissions_counsellor']);
  teacher = await staffUser(ctx.db, ['teacher'], {
    name: 'Sample Review Teacher',
    managerId: manager.staffId,
  });
  otherTeacher = await staffUser(ctx.db, ['teacher'], {
    name: 'Sample Other Teacher',
    managerId: counsellor.staffId,
  });
  finance = await staffUser(ctx.db, ['finance_officer']);
  const [s] = await ctx.db
    .insert(students)
    .values({ fullName: 'Sample Reviewed Student' })
    .returning();
  studentId = s!.id;
  const { leadId, admissionId } = await pendingCase(counsellor, { counselledOnly: true });
  await ctx.db
    .update(opsAdmissions)
    .set({ studentId: studentId as never })
    .where(eq(opsAdmissions.id, admissionId as never));
  const [demo] = await ctx.db
    .insert(opsDemos)
    .values({
      admissionId: admissionId as never,
      leadId: leadId as never,
      feeTermsState: 'not_discussed',
      plannedSessionCount: 2,
      createdBy: manager.id,
    })
    .returning();
  demoId = demo!.id;
  const rows = await ctx.db
    .insert(opsDemoSessions)
    .values(
      ['2026-09-20T04:30:00Z', '2026-09-21T04:30:00Z'].map((at, i) => ({
        demoId: demo!.id,
        sessionNumber: i + 1,
        dayNumber: i + 1,
        startsAt: new Date(at),
        subject: 'Quant',
        teacherStaffId: teacher.staffId,
      })),
    )
    .returning();
  sessionIds = rows.sort((a, b) => a.sessionNumber - b.sessionNumber).map((r) => r.id);
  const base = { coreStudentId: studentId as never, studentName: 'Sample Reviewed Student' };
  const key = crypto.randomUUID();
  reviews = [
    review({ ...base, authorStaffId: teacher.staffId as never, reviewKey: key, superseded: true }),
    review({
      ...base,
      authorStaffId: teacher.staffId as never,
      reviewKey: key,
      version: 2,
      academicConcerns: SENTINEL,
      visibility: 'shareable',
      strengths: 'Careful working',
    }),
    review({
      ...base,
      authorStaffId: otherTeacher.staffId as never,
      status: 'withdrawn',
      withdrawnAt: '2026-09-20T05:00:00.000Z' as never,
    }),
    review({
      ...base,
      authorStaffId: otherTeacher.staffId as never,
      reviewType: 'demo_session',
      sessionDate: '2026-09-20' as never,
      periodFrom: null,
      periodTo: null,
    }),
  ];
});

const academicUp = () =>
  stubAcademic({
    reviews: (url: URL) =>
      reviewsPayload(
        reviews.filter((r) =>
          url.searchParams.get('coreStudentId')
            ? r.coreStudentId === url.searchParams.get('coreStudentId')
            : r.authorStaffId === url.searchParams.get('authorStaffId'),
        ),
        url.searchParams.get('coreStudentId'),
      ),
    'demo-attendance': { items: [] },
  });
const keys = (r: Awaited<ReturnType<typeof studentReviews>>) =>
  r.status === 'available' ? r.reviews.map((x) => `${x.authorStaffId}:v${x.version}`) : r.status;

describe('reading submitted reviews from Academic (R4)', () => {
  it('needs ops:feedback:read before Academic is called; withdrawn reviews are hidden, edits kept and marked', async () => {
    const fetch = academicUp();
    await expect(studentReviews(ctx.db, finance, studentId)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const all = await studentReviews(ctx.db, manager, studentId);
    expect(keys(all)).toEqual([
      `${teacher.staffId}:v1`,
      `${teacher.staffId}:v2`,
      `${otherTeacher.staffId}:v1`,
    ]);
    expect(all.status === 'available' && all.reviews.map((r) => r.superseded)).toEqual([
      true,
      false,
      false,
    ]);
    expect(fetch.mock.calls[0]![0].toString()).toContain(
      `/academic/api/internal/v1/reviews?coreStudentId=${studentId}`,
    );
  });

  it.each([
    ['the counsellor of the student sees every review', () => counsellor, 3],
    ['another counsellor sees none', () => stranger, 0],
    ['a teacher sees only the reviews they wrote', () => teacher, 2],
  ])('own scope: %s', async (_n, who, count) => {
    academicUp();
    const r = await studentReviews(ctx.db, who(), studentId);
    expect(r.status === 'available' && r.reviews.length).toBe(count);
  });

  it('Academic down is "source unavailable", never an empty list', async () => {
    stubAcademic({});
    expect(await studentReviews(ctx.db, manager, studentId)).toMatchObject({
      status: 'unavailable',
      reason: 'Could not reach the source',
    });
  });

  it('reviews authored: by author, filtered to the reader’s students', async () => {
    academicUp();
    const own = await reviewsAuthored(ctx.db, teacher, teacher.staffId);
    expect(own.status === 'available' && own.reviews.length).toBe(2);
    const other = await reviewsAuthored(ctx.db, otherTeacher, teacher.staffId);
    expect(other.status === 'available' && other.reviews.length).toBe(0);
    const strangerView = await reviewsAuthored(ctx.db, stranger, teacher.staffId);
    expect(strangerView.status === 'available' && strangerView.reviews.length).toBe(0);
  });
});

describe('POST /ops/api/v1/review-acks', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    coreStudentId: studentId,
    reviewKey: reviews[1]!.reviewKey,
    version: 2,
    ...over,
  });
  const send = (user: TestUser | null, json: unknown) =>
    callRoute<{ id: string; followUp: string | null }>(
      ack,
      user
        ? authedRequest(user, '/ops/api/v1/review-acks', { method: 'POST', json })
        : buildRequest('/ops/api/v1/review-acks', { method: 'POST', json }),
    );

  it('401 / 403 (permission and own scope) / 400', async () => {
    academicUp();
    expect((await send(null, body())).status).toBe(401);
    expect((await send(teacher, body())).status).toBe(403);
    expect((await send(stranger, body())).status).toBe(403);
    expect((await send(counsellor, body({ followUpOn: '2026-11-01' }))).status).toBe(400);
  });

  it('refuses unknown, withdrawn and superseded versions, and Academic being down', async () => {
    academicUp();
    expect((await send(counsellor, body({ reviewKey: crypto.randomUUID() }))).status).toBe(404);
    expect(
      (await send(counsellor, body({ reviewKey: reviews[2]!.reviewKey, version: 1 }))).status,
    ).toBe(404);
    expect((await send(counsellor, body({ version: 1 }))).status).toBe(409);
    stubAcademic({});
    expect((await send(counsellor, body())).status).toBe(409);
  });

  it('records Ops’ own follow-up once per person and version, audited; shown under the review', async () => {
    academicUp();
    const res = await send(
      counsellor,
      body({ followUp: 'Call the guardian', followUpOn: '2026-11-01' }),
    );
    expect(res.status).toBe(201);
    expect((await send(counsellor, body())).status).toBe(409);
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'feedback.review_acknowledged'),
          eq(auditEvents.entityId, res.data!.id),
        ),
      );
    expect(audit).toBeTruthy();
    const read = await studentReviews(ctx.db, manager, studentId);
    const v2 = read.status === 'available' ? read.reviews.find((r) => r.version === 2) : null;
    expect(v2?.acknowledgements).toEqual([
      expect.objectContaining({ followUp: 'Call the guardian', followUpOn: '2026-11-01' }),
    ]);
    expect(v2?.academicConcerns).toBe(SENTINEL); // the teacher's words are untouched
    // Without ops:feedback:acknowledge a reader sees that it was acknowledged, not Ops' notes.
    const byTeacher = await studentReviews(ctx.db, teacher, studentId);
    const seen =
      byTeacher.status === 'available' ? byTeacher.reviews.find((r) => r.version === 2) : null;
    expect(seen?.acknowledgements).toEqual([
      expect.objectContaining({ followUp: null, followUpOn: null, note: null }),
    ]);
  });
});

describe('GET /ops/api/internal/v1/demo-sessions (R5)', () => {
  const call = (query: string, caller = 'academic', token = process.env.INTERNAL_SERVICE_TOKEN!) =>
    callRoute<{ items: Record<string, unknown>[] }>(
      demoSessionsRoute,
      buildRequest(`/ops/api/internal/v1/demo-sessions${query}`, {
        headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': caller },
      }),
    );

  it('serves only Academic with the service token; 400 without a valid date', async () => {
    expect(
      (await call('?date=2026-09-20', 'academic', 'wrong-token-0000000000000000000')).status,
    ).toBe(401);
    expect((await call('?date=2026-09-20', 'marketing')).status).toBe(403);
    expect((await call('?date=20-10-2026')).status).toBe(400);
  });

  it('returns the IST day’s classes with minimal fields only', async () => {
    const res = await call('?date=2026-09-20');
    expect(res.status).toBe(200);
    expect(res.data!.items).toEqual([
      {
        demoSessionId: sessionIds[0],
        coreStudentId: studentId,
        displayName: expect.any(String),
        dayNumber: 1,
        subject: 'Quant',
        startsAt: '2026-09-20T04:30:00.000Z',
        isSample: false,
      },
    ]);
  });
});

describe('linked demo classes: the teacher marks in Academic (owner answer 3)', () => {
  const linked = (status: string) =>
    stubAcademic({
      reviews: (url: URL) => reviewsPayload(reviews, url.searchParams.get('coreStudentId')),
      'demo-attendance': {
        items: [
          {
            opsDemoSessionId: sessionIds[0],
            academicSessionId: crypto.randomUUID(),
            status,
            recordedAt: status === 'not_recorded' ? null : '2026-09-20T05:00:00.000Z',
            teacherStaffIds: [otherTeacher.staffId],
            teacherNames: ['Sample Other Teacher'],
          },
        ],
      },
    });

  it('shows Academic’s mark and actual teacher; the review grid follows them', async () => {
    linked('present');
    const d = await getDemo(ctx.db, manager, demoId);
    const s1 = d.sessions.find((s) => s.id === sessionIds[0])!;
    expect(s1).toMatchObject({ attendance: 'present', teacherName: 'Sample Other Teacher' });
    expect(s1.academic).toMatchObject({ status: 'present' });
    expect(d.sessions.find((s) => s.id === sessionIds[1])!.academic).toBeNull();
    expect(d.feedback[0]!.teachers).toEqual([
      expect.objectContaining({ staffId: otherTeacher.staffId, state: 'submitted' }),
    ]);
  });

  it('refuses the counsellor’s mark on a linked class (409); an unlinked class still takes it', async () => {
    linked('not_recorded');
    const mark = (sessionId: string) =>
      callRoute(
        sessionAction,
        authedRequest(counsellor, '/ops/api/v1/x', {
          method: 'POST',
          json: { action: 'attendance', attendance: 'present' },
        }),
        { id: demoId, sessionId },
      );
    expect((await mark(sessionIds[0]!)).status).toBe(409);
    expect((await mark(sessionIds[1]!)).status).toBe(200);
    expect((await mark(sessionIds[1]!)).status).toBe(400); // a recorded value needs a reason
    // R15 (amended): the link Ops saw is recorded on its own row.
    const [seen] = await ctx.db
      .select()
      .from(opsDemoSessions)
      .where(eq(opsDemoSessions.id, sessionIds[0] as never));
    expect(seen!.academicSessionRef).toBeTruthy();
    stubAcademic({});
    // Academic unreachable: an unlinked class stays counsellor-marked…
    const fix = { action: 'attendance', attendance: 'late', reason: 'Register checked again' };
    const unlinked = await callRoute(
      sessionAction,
      authedRequest(counsellor, '/ops/api/v1/x', { method: 'POST', json: fix }),
      { id: demoId, sessionId: sessionIds[1]! },
    );
    expect(unlinked.status).toBe(200);
    // …a known-linked one waits.
    const waiting = await mark(sessionIds[0]!);
    expect(waiting.status).toBe(409);
    expect(JSON.stringify(waiting.error)).toContain('Waiting for Academic OS');
  });

  it('the demo list and the job read the same marks; the job finishes the demo, and waits while Academic is down', async () => {
    linked('present');
    const all = [];
    for (const view of ['current', 'upcoming', 'previous'])
      all.push(...(await listDemos(ctx.db, manager, demoListQuery.parse({ view }))).rows);
    const row = all.find((r) => r.demo.id === demoId)!;
    expect(row.sessions.find((x) => x.id === sessionIds[0])).toMatchObject({
      attendance: 'present',
      academic: expect.objectContaining({ status: 'present' }),
    });
    stubAcademic({});
    expect(await syncDemosFromAcademic(ctx.db, manager)).toMatchObject({ synced: 0 });
    const [waiting] = await ctx.db
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.id, demoId as never));
    expect(waiting!.completedAt).toBeNull();
    linked('present');
    expect((await syncDemosFromAcademic(ctx.db, manager)).synced).toBeGreaterThanOrEqual(1);
    const [done] = await ctx.db
      .select()
      .from(opsDemos)
      .where(eq(opsDemos.id, demoId as never));
    expect(done!.completedAt).not.toBeNull();
    await expect(syncDemosFromAcademic(ctx.db, counsellor)).rejects.toThrow();
  });

  it('asks Academic only about classes that have started, and never before the access check', async () => {
    await ctx.db.insert(opsDemoSessions).values({
      demoId: demoId as never,
      sessionNumber: 3,
      dayNumber: 3,
      startsAt: new Date(Date.now() + 7 * 86_400_000),
      subject: 'Quant',
      teacherStaffId: teacher.staffId,
    });
    const fetch = linked('present');
    await getDemo(ctx.db, manager, demoId);
    const asked = fetch.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith('/demo-attendance'))
      .flatMap((u) => u.searchParams.get('ids')!.split(','));
    expect(asked.sort()).toEqual([...sessionIds].sort());
    fetch.mockClear();
    await expect(previewConversion(ctx.db, stranger, demoId)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('Academic down: review states say "source unavailable", never pending', async () => {
    stubAcademic({});
    const d = await getDemo(ctx.db, manager, demoId);
    expect(d.academicMarks.status).toBe('unavailable');
    expect(d.reviews).toMatchObject({ status: 'unavailable' });
    // Neither "pending" nor "no review expected" can be known without Academic's marks and reviews.
    expect(new Set(d.feedback.flatMap((x) => x.teachers.map((t) => t.state)))).toEqual(
      new Set(['unknown']),
    );
  });
});

describe('teacher operations (brief 2 §7–8)', () => {
  const activity = (staffId: string) => ({
    contract: 'academic.teacher_activity',
    version: 1,
    generatedAt: '2026-10-21T05:00:00.000Z',
    staffId,
    window: { from: '2026-10-21', to: '2026-10-21' },
    assignments: [
      {
        batchCode: 'SAMPLE-CLAT',
        subjectName: 'Quant',
        role: 'primary',
        startDate: null,
        endDate: null,
      },
    ],
    sessions: Object.fromEntries(
      ['planned', 'delivered', 'cancelled', 'substituted'].map((k, i) => [
        k,
        {
          status: 'ok',
          value: i + 1,
          definition: 'test',
          window: { from: '2026-10-21', to: '2026-10-21' },
          unit: 'count',
        },
      ]),
    ),
    ...Object.fromEntries(
      ['logsPending', 'attendancePending', 'markingPending'].map((k) => [
        k,
        {
          status: 'missing',
          value: null,
          reason: 'Not tracked (test)',
          definition: 'test',
          window: { from: '2026-10-21', to: '2026-10-21' },
          unit: 'count',
        },
      ]),
    ),
    reviews: {
      submitted: {
        status: 'ok',
        value: 2,
        definition: 'test',
        window: { from: '2026-10-21', to: '2026-10-21' },
        unit: 'count',
      },
      draft: {
        status: 'ok',
        value: 0,
        definition: 'test',
        window: { from: '2026-10-21', to: '2026-10-21' },
        unit: 'count',
      },
    },
    unavailability: [],
  });

  beforeAll(async () => {
    const today = istToday(new Date());
    await ctx.db.insert(opsStaffTasks).values([
      {
        staffId: teacher.staffId,
        title: 'Sample overdue task',
        dueOn: '2026-01-01' as never,
        createdBy: teacher.id,
      },
      {
        staffId: teacher.staffId,
        title: 'Sample open task',
        dueOn: '2099-01-01' as never,
        createdBy: teacher.id,
      },
      {
        staffId: teacher.staffId,
        title: 'Sample done task',
        dueOn: '2026-01-01' as never,
        status: 'done',
        progressPercent: 100,
        completedAt: new Date(),
        createdBy: teacher.id,
      },
    ] as never);
    await ctx.db.insert(opsEodReports).values({
      staffId: teacher.staffId,
      reportDate: today as never,
      snapshot: {},
      createdBy: teacher.id,
    } as never);
    await ctx.db.insert(opsStaffSubjectCapabilities).values([
      { staffId: teacher.staffId, subject: 'Quant', sourceNote: 'test' },
      { staffId: otherTeacher.staffId, subject: 'Logic', sourceNote: 'test' },
    ] as never);
  });

  const row = async (user: TestUser, staffId: string) =>
    (await listTeachers(ctx.db, user, { withActivity: true })).teachers.find(
      (t) => t.id === staffId,
    );

  it('directory: Academic today per teacher; tasks and EOD only within the reader’s reach', async () => {
    stubAcademic({ activity: (url: URL) => activity(url.pathname.split('/').at(-2)!) });
    const forManager = await row(manager, teacher.staffId);
    expect(forManager).toMatchObject({
      manager: manager.displayName,
      tasks: { open: 2, overdue: 1, eodToday: 'draft' },
    });
    expect(forManager!.academicToday).toMatchObject({ status: 'available' });
    const other = await row(manager, otherTeacher.staffId);
    expect(other!.tasks).toEqual({ open: 0, overdue: 0, eodToday: 'not_started' });
    // A coordinator reads teachers but not other people's tasks: counts are withheld, not zero.
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    expect((await row(coordinator, teacher.staffId))!.tasks).toBeNull();
    // Own scope: yourself, and the staff who report to you — not anyone else.
    expect((await row(teacher, teacher.staffId))!.tasks).toMatchObject({ open: 2 });
    expect((await row(counsellor, otherTeacher.staffId))!.tasks).toMatchObject({ open: 0 });
    expect((await row(counsellor, teacher.staffId))!.tasks).toBeNull();
  });

  it('directory: Academic down is per teacher "unavailable", never zero', async () => {
    stubAcademic({});
    expect((await row(manager, teacher.staffId))!.academicToday).toMatchObject({
      status: 'unavailable',
    });
  });

  it('profile: Academic activity and assignments, reviews authored, EOD history; no private notes', async () => {
    stubAcademic({
      activity: (url: URL) => activity(url.pathname.split('/').at(-2)!),
      reviews: (url: URL) =>
        reviewsPayload(
          reviews.filter((r) => r.authorStaffId === url.searchParams.get('authorStaffId')),
        ),
      'demo-attendance': { items: [] },
    });
    const p = await getTeacherProfile(ctx.db, manager, teacher.staffId);
    expect(p.activity).toMatchObject({ status: 'available' });
    expect(p.reviewsAuthored).toMatchObject({ status: 'available' });
    expect(p.eods).toHaveLength(1);
    expect(p.tasks).toMatchObject({ open: 2, overdue: 1 });
    expect(JSON.stringify(p)).not.toMatch(/salary|"notes"/i);
    await expect(getTeacherProfile(ctx.db, teacher, otherTeacher.staffId)).rejects.toThrow();
  });
});
