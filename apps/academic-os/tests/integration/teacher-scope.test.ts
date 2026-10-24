/**
 * Brief §5 and §16: teacher scope by assignment facts (batch, subject, academic year, dates; union of
 * several; pending opens nothing), what a teacher's student payloads leave out, the assessment counts
 * on My day and in `academic.teacher_activity`, and student reviews (subject-scoped, draft → published).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  academicAssessmentBatches,
  academicAssessmentRoster,
  academicAssessments,
  academicAttempts,
  academicEnrolments,
  academicResultRuns,
  academicResults,
  academicStudents,
  academicTeacherAssignments,
  academicTeacherReviews,
  students as coreStudents,
  type Database,
} from '@elevate/database';
import type { AcademicStudentReviewsV1 } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
} from '@elevate/testing';
import { GET as listRoute } from '../../src/app/api/v1/students/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import { GET as reportRoute } from '../../src/app/api/v1/reports/[kind]/route';
import { GET as reviewsRoute, POST as createReviewRoute } from '../../src/app/api/v1/reviews/route';
import { PATCH as updateReviewRoute } from '../../src/app/api/v1/reviews/[id]/route';
import { GET as internalReviewsRoute } from '../../src/app/api/internal/v1/reviews/route';
import StudentPage from '../../src/app/students/[id]/page';
import {
  createAssignment,
  createBatch,
  createStudent,
  enrolManually,
  getStudentProgress,
  resolveScope,
  teacherActivity,
  teacherDay,
} from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const as = vi.hoisted(() => ({ user: null as AuthenticatedUser | null, db: null as unknown }));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({
  ...(await original<object>()),
  getDb: () => as.db as Database,
}));

const ctx = setupTestDatabase();
let u: Users;
let A: World; // teacher: Quant, teacher2: Verbal
let B: World; // other teachers
const ids: Record<string, string> = {};
const now = new Date('2026-10-23T04:30:00Z');
/** Brief §5 allow-lists: anything else (contacts, guardian, Ops references, city, school board, manual reason) is absent, not null. */
const STUDENT_KEYS = [
  'id',
  'code',
  'fullName',
  'preferredName',
  'currentStage',
  'status',
  'isSample',
  'contactsHidden',
  'batches',
];
const ENROLMENT_KEYS = [
  'id',
  'programmeId',
  'courseId',
  'batchId',
  'status',
  'startDate',
  'academicYear',
  'lateJoiner',
  'source',
  'batchCode',
  'courseCode',
  'programmeCode',
];
const outside = (row: Record<string, unknown>, keys: string[]) =>
  Object.keys(row).filter((k) => !keys.includes(k));

type Row = Record<string, unknown>;
const get = <T>(
  route: typeof listRoute,
  user: Users['teacher'],
  path: string,
  params?: Record<string, string>,
) => callRoute<T>(route, authedRequest(user, `/academic/api/v1/${path}`), params);
const internal = (query: string) =>
  callRoute<AcademicStudentReviewsV1>(
    internalReviewsRoute,
    buildRequest(`/academic/api/internal/v1/reviews${query}`, {
      headers: {
        authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
        'x-elevate-caller': 'ops',
      },
    }),
  );
const review = (user: Users['teacher'], json: Row) =>
  callRoute<Row>(createReviewRoute, authedRequest(user, '/academic/api/v1/reviews', { json }));
const reviewIds = async (user: Users['teacher']) =>
  ((await get<Row[]>(reviewsRoute, user, 'reviews')).data ?? []).map((r) => r.id);

describe('teacher scope (brief §5)', () => {
  it('a Quant teacher of batch A sees batch A students only, with no contact, guardian, KYC or fee fields', async () => {
    as.db = ctx.db; // routes and pages call getDb()
    u = await users(ctx.db);
    A = await world(ctx.db, u);
    const other = () => createTestUser(ctx.db, { roles: ['teacher'] });
    B = await world(ctx.db, u, { teacher: await other(), teacher2: await other() });
    const coord = actor(u.coordinator);
    const private_ = {
      email: 'sample-a@example.test',
      dateOfBirth: '2009-01-01',
      guardianName: 'Sample Guardian',
      guardianRelationship: 'mother' as const,
      guardianEmail: 'guardian-a@example.test',
    };
    const sa = await createStudent(ctx.db, coord, { fullName: 'Sample Asha A', ...private_ });
    const sb = await createStudent(ctx.db, coord, { fullName: 'Sample Bilal B' });
    const enrolment = await enrolManually(ctx.db, coord, {
      studentId: sa.id,
      batchId: A.batch.id,
      startDate: '2026-09-01',
      reason: 'Sample manual reason',
    });
    // An admitted student: Ops references, city and school board filled (fictional).
    const [core] = await ctx.db
      .insert(coreStudents)
      .values({ fullName: 'Sample Asha A' })
      .returning();
    const refs = { sourceAdmissionId: crypto.randomUUID(), sourceLeadId: crypto.randomUUID() };
    await ctx.db
      .update(academicStudents)
      .set({
        ...refs,
        coreStudentId: core!.id,
        city: 'Sample City Sikar',
        schoolBoard: 'Sample Board CBSE',
      })
      .where(eq(academicStudents.id, sa.id as never));
    await ctx.db
      .update(academicEnrolments)
      .set(refs)
      .where(eq(academicEnrolments.id, enrolment.id));
    const secrets = [
      ...Object.values(refs),
      core!.id,
      'Sample City Sikar',
      'Sample Board CBSE',
      'Sample manual reason',
      'sample-a@example.test',
      'guardian-a@example.test',
      'Sample Guardian',
      '2009-01-01',
    ];
    await enrolManually(ctx.db, coord, {
      studentId: sb.id,
      batchId: B.batch.id,
      startDate: '2026-09-01',
      reason: 'Test (fictional)',
    });
    Object.assign(ids, { sa: sa.id, sb: sb.id });

    const scope = await resolveScope(ctx.db, actor(u.teacher), 'academic:students:read');
    expect(scope).toMatchObject({
      kind: 'own',
      batchIds: [A.batch.id],
      assignments: [{ batchId: A.batch.id, subjectId: A.quant.id, academicYear: null }],
    });
    const list = await get<Row[]>(listRoute, u.teacher, 'students');
    expect(list.data!.map((s) => s.id)).toEqual([sa.id]);
    expect((await get(studentRoute, u.teacher, `students/${sb.id}`, { id: sb.id })).status).toBe(
      404,
    );
    const one = await get<{ student: Row; enrolments: Row[] }>(
      studentRoute,
      u.teacher,
      `students/${sa.id}`,
      { id: sa.id },
    );
    const day = await teacherDay(ctx.db, actor(u.teacher), now);
    if (day.kind !== 'teacher') throw new Error('expected a teacher view');
    expect(day.students).toEqual([
      { id: sa.id, code: sa.code, fullName: 'Sample Asha A', isSample: false },
    ]);
    for (const student of [list.data![0]!, one.data!.student, ...day.students])
      expect(outside(student, STUDENT_KEYS)).toEqual([]);
    expect(one.data!.enrolments).toHaveLength(1);
    for (const e of one.data!.enrolments) expect(outside(e, ENROLMENT_KEYS)).toEqual([]);

    as.user = u.teacher;
    const page = JSON.stringify(await StudentPage({ params: Promise.resolve({ id: sa.id }) }));
    expect(page).toContain('Sample Asha A');
    const json = JSON.stringify([list.data, one.data, day]);
    for (const secret of secrets)
      for (const text of [json, page]) expect(text).not.toContain(secret);
    // The coordinator (students:write) still gets the full record.
    const full = await get<{ student: Row }>(studentRoute, u.coordinator, `students/${sa.id}`, {
      id: sa.id,
    });
    expect(full.data!.student).toMatchObject({
      city: 'Sample City Sikar',
      sourceLeadId: refs.sourceLeadId,
    });
  });

  it('read-only roles (director, auditor) keep the full record with contacts nulled; the director sees the Ops link', async () => {
    type Rec = { student: Row; enrolments: Row[] };
    const coordinator = (
      await get<Rec>(studentRoute, u.coordinator, `students/${ids.sa}`, { id: ids.sa! })
    ).data!;
    const contacts = {
      dateOfBirth: null,
      email: null,
      phone: null,
      guardianName: null,
      guardianRelationship: null,
      guardianEmail: null,
      guardianPhone: null,
      contactsHidden: true,
    };
    for (const user of [u.director, u.auditor]) {
      const rec = (await get<Rec>(studentRoute, user, `students/${ids.sa}`, { id: ids.sa! })).data!;
      expect(Object.keys(rec.student).sort()).toEqual(Object.keys(coordinator.student).sort());
      expect(rec.student).toMatchObject({
        ...contacts,
        city: 'Sample City Sikar',
        schoolBoard: 'Sample Board CBSE',
      });
      expect(rec.student.coreStudentId).toBeTruthy();
      expect(Object.keys(rec.enrolments[0]!).sort()).toEqual(
        Object.keys(coordinator.enrolments[0]!).sort(),
      );
    }
    as.user = u.director;
    expect(
      JSON.stringify(await StudentPage({ params: Promise.resolve({ id: ids.sa! }) })),
    ).toContain('Admission, KYC and fees in Business Ops');
  });

  it('no unrestricted student export: another batch’s CSV is 404; the own-batch CSV carries no private fields', async () => {
    const csv = (batchId: string) =>
      callRoute(
        reportRoute,
        authedRequest(
          u.teacher,
          `/academic/api/v1/reports/attendance?batchId=${batchId}&format=csv`,
        ),
        { kind: 'attendance' },
      );
    expect((await csv(B.batch.id)).status).toBe(404);
    const own = await reportRoute(
      authedRequest(
        u.teacher,
        `/academic/api/v1/reports/attendance?batchId=${A.batch.id}&format=csv`,
      ),
      { params: Promise.resolve({ kind: 'attendance' }) },
    );
    expect(own.status).toBe(200);
    expect(await own.text()).not.toMatch(/example\.test|Sample Guardian|2009-01-01/);
  });

  it('a pending assignment opens nothing; several assignments open their union', async () => {
    const coord = actor(u.coordinator);
    const students = async () =>
      ((await get<Row[]>(listRoute, u.teacher, 'students')).data ?? []).map((s) => s.id);
    await createAssignment(ctx.db, coord, {
      subjectId: B.verbal.id,
      staffMemberId: A.teacherStaff,
    } as never);
    expect(await students()).toEqual([ids.sa]);
    const added = await createAssignment(ctx.db, coord, {
      batchId: B.batch.id,
      subjectId: B.quant.id,
      staffMemberId: A.teacherStaff,
    } as never);
    expect((await students()).sort()).toEqual([ids.sa, ids.sb].sort());
    await ctx.db
      .delete(academicTeacherAssignments)
      .where(eq(academicTeacherAssignments.id, added.id));
  });
});

describe('student reviews (brief §16)', () => {
  const content = {
    periodFrom: '2026-10-01',
    periodTo: '2026-10-20',
    observationOn: '2026-10-20',
    strengths: 'Solves linear equations accurately.',
    areasForSupport: 'Word problems: sets up the equation late.',
    suggestedAction: 'Five word problems a day for two weeks.',
    followUpOn: '2026-11-05',
    visibility: 'internal',
  };
  const body = { reviewType: 'periodic_progress', ...content };

  it('a teacher names only a batch and subject they teach; others’ reviews of another subject stay hidden', async () => {
    const refused = [
      [{ subjectId: A.verbal.id }, 'subject you teach'],
      [{ batchId: B.batch.id }, 'batch you teach'],
    ] as const;
    for (const [extra, message] of refused) {
      const res = await review(u.teacher, { ...body, academicStudentId: ids.sa, ...extra });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.data ?? res.error)).toContain(message);
    }
    const verbal = await review(u.teacher2, {
      ...body,
      academicStudentId: ids.sa,
      subjectId: A.verbal.id,
      batchId: A.batch.id,
      submit: true,
    });
    expect(verbal.status).toBe(201);
    expect(await reviewIds(u.teacher)).not.toContain(verbal.data!.id);
    expect(await reviewIds(u.coordinator)).toContain(verbal.data!.id);
    ids.verbalReview = verbal.data!.id as string;
  });

  it('subject scope is per (batch, subject) pair: teaching Verbal in another batch opens neither writing nor reading Verbal here', async () => {
    const coord = actor(u.coordinator);
    const a2 = await createBatch(ctx.db, coord, {
      code: `B2-${Date.now()}`,
      name: 'Sample second batch',
      courseId: A.course.id,
      startDate: '2026-09-01',
      status: 'active',
    } as never);
    const pair = await createAssignment(ctx.db, coord, {
      batchId: a2.id,
      subjectId: A.verbal.id,
      staffMemberId: A.teacherStaff,
    } as never);
    const res = await review(u.teacher, {
      ...body,
      academicStudentId: ids.sa,
      subjectId: A.verbal.id,
    });
    expect(res.status).toBe(400);
    expect(await reviewIds(u.teacher)).not.toContain(ids.verbalReview);
    await ctx.db
      .delete(academicTeacherAssignments)
      .where(eq(academicTeacherAssignments.id, pair.id));
  });

  it('draft is invisible to Ops; published carries observation date and batch to Ops; another teacher cannot edit it', async () => {
    const draft = await review(u.teacher, {
      ...body,
      academicStudentId: ids.sa,
      subjectId: A.quant.id,
      batchId: A.batch.id,
    });
    expect(draft.status).toBe(201);
    const id = draft.data!.id as string;
    const ops = async () =>
      (await internal(`?coreStudentId=${await coreIdOf(ids.sa!)}`)).data!.reviews;
    expect(await ops()).toEqual([expect.objectContaining({ subjectName: 'Verbal' })]); // teacher2's published one only

    const [row] = await ctx.db
      .select({ updatedAt: academicTeacherReviews.updatedAt })
      .from(academicTeacherReviews)
      .where(eq(academicTeacherReviews.id, id as never));
    const patch = (user: Users['teacher'], json: Row) =>
      callRoute<Row>(
        updateReviewRoute,
        authedRequest(user, `/academic/api/v1/reviews/${id}`, {
          method: 'PATCH',
          json: { ...content, updatedAt: row!.updatedAt.toISOString(), ...json },
        }),
        { id },
      );
    expect((await patch(u.teacher2, { strengths: 'Changed by someone else' })).status).toBe(404);
    expect((await patch(u.teacher, { submit: true })).status).toBe(200);
    expect(await ops()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectName: 'Quant',
          observationOn: '2026-10-20',
          batchId: A.batch.id,
          strengths: body.strengths,
          followUpOn: '2026-11-05',
        }),
      ]),
    );
  });
});

async function coreIdOf(studentId: string) {
  const [s] = await ctx.db
    .select({ core: academicStudents.coreStudentId })
    .from(academicStudents)
    .where(eq(academicStudents.id, studentId as never));
  if (s?.core) return s.core;
  const [c] = await ctx.db.insert(coreStudents).values({ fullName: 'Sample Asha A' }).returning();
  await ctx.db
    .update(academicStudents)
    .set({ coreStudentId: c!.id })
    .where(eq(academicStudents.id, studentId as never));
  return c!.id;
}

describe('assigned assessments (brief §16, §21)', () => {
  it('counts assigned / completed / awaiting marking / published over the teacher’s batch, subject and year; My day and Ops agree', async () => {
    await ctx.db
      .update(academicTeacherAssignments)
      .set({ academicYear: '2026-27' })
      .where(
        and(
          eq(academicTeacherAssignments.staffMemberId, A.teacherStaff),
          eq(academicTeacherAssignments.batchId, A.batch.id),
        ),
      );
    const base = {
      kind: 'chapter_test' as const,
      batchId: A.batch.id,
      subjectId: A.quant.id,
      scheduledDate: '2026-10-10',
    };
    const rows: Array<[key: string, values: Partial<typeof academicAssessments.$inferInsert>]> = [
      [
        'marking',
        {
          status: 'conducted',
          responsibleTeacherStaffId: A.teacherStaff,
          academicYear: '2026-27',
          rosterSnapshotAt: now,
        },
      ],
      ['legacyUpcoming', { status: 'scheduled', scheduledDate: '2026-12-01' }],
      ['undated', { status: 'draft', scheduledDate: null }],
      [
        'multiBatch',
        {
          status: 'finalised',
          batchId: B.batch.id,
          subjectId: null,
          publishedAt: now,
          publishedByUserId: u.coordinator.id,
        },
      ],
      ['otherSubject', { status: 'conducted', subjectId: A.verbal.id }],
      ['otherBatch', { status: 'conducted', batchId: B.batch.id, subjectId: B.quant.id }],
      ['otherTeacher', { status: 'conducted', responsibleTeacherStaffId: A.teacher2Staff }],
      ['otherYear', { status: 'conducted', academicYear: '2025-26' }],
      ['cancelled', { status: 'cancelled' }],
    ];
    for (const [key, values] of rows) {
      const [a] = await ctx.db
        .insert(academicAssessments)
        .values({
          ...base,
          code: `T-${key}-${Date.now()}`,
          title: `Sample ${key}`,
          ...values,
        } as never)
        .returning();
      ids[key] = a!.id;
    }
    await ctx.db.insert(academicAssessmentBatches).values(
      [B.batch.id, A.batch.id].map((batchId) => ({
        assessmentId: ids.multiBatch!,
        batchId,
      })) as never,
    );
    await ctx.db.insert(academicAssessmentRoster).values({
      assessmentId: ids.marking!,
      studentId: ids.sa!,
      batchId: A.batch.id,
      displayNameSnapshot: 'Sample Asha A',
      attendance: 'present',
      marksState: 'imported',
      score: '10',
    } as never);

    const day = await teacherDay(ctx.db, actor(u.teacher), now);
    if (day.kind !== 'teacher') throw new Error('expected a teacher view');
    expect(day.assessmentCounts).toEqual({
      assigned: 4,
      completed: 2,
      awaitingMarking: 1,
      published: 1,
      awaitingReview: 1,
    });
    expect(day.assessmentsToMark.map((a) => a.id)).toEqual([ids.marking]);
    expect(day.resultsToReview.map((a) => a.id)).toEqual([ids.marking]);

    const activity = await teacherActivity(
      ctx.db,
      A.teacherStaff,
      { from: '2026-09-01', to: '2026-12-31' },
      now,
    );
    const values = Object.fromEntries(
      ['assigned', 'completed', 'awaitingMarking', 'published'].map((k) => [
        k,
        (activity.assessments as Record<string, { value: number | null }>)[k]!.value,
      ]),
    );
    expect(values).toEqual({ assigned: 4, completed: 2, awaitingMarking: 1, published: 1 });
    const narrow = await teacherActivity(
      ctx.db,
      A.teacherStaff,
      { from: '2026-10-01', to: '2026-10-31' },
      now,
    );
    expect(narrow.assessments?.assigned?.value).toBe(3); // the December one is outside the window; the undated one still counts
  });

  it('marked counts roster rows the teacher verified, not only per-question attempts', async () => {
    const october = { from: '2026-10-01', to: '2026-10-31' };
    const marked = async () =>
      (await teacherActivity(ctx.db, A.teacherStaff, october, now)).assessments?.marked;
    expect(await marked()).toMatchObject({ status: 'ok', value: 0 });
    await ctx.db
      .update(academicAssessmentRoster)
      .set({
        marksState: 'verified',
        verifiedAt: new Date('2026-10-12T05:00:00Z'),
        verifiedByUserId: u.teacher.id,
      } as never)
      .where(eq(academicAssessmentRoster.assessmentId, ids.marking as never));
    expect(await marked()).toMatchObject({ status: 'ok', value: 1 });
    expect(
      (await teacherActivity(ctx.db, A.teacherStaff, { from: '2026-11-01', to: '2026-11-30' }, now))
        .assessments?.marked,
    ).toMatchObject({ value: 0 });
  });

  it('no assignment open today: the counts are not available (null), never zeros', async () => {
    const lone = await createTestUser(ctx.db, { roles: ['teacher'] });
    await staffFor(ctx.db, lone, 'Sample Lone Teacher');
    const day = await teacherDay(ctx.db, actor(lone), now);
    if (day.kind !== 'teacher') throw new Error('expected a teacher view');
    expect(day.assessmentCounts).toBeNull();
  });

  it('a student’s progress shows a teacher only results of assessments in their batch and subject', async () => {
    const [run] = await ctx.db
      .insert(academicResultRuns)
      .values({
        assessmentId: ids.otherSubject!,
        version: 1,
        status: 'final',
        ruleSnapshot: {},
        studentsScored: 1,
        studentsAbsent: 0,
        finalisedByUserId: u.coordinator.id,
      } as never)
      .returning();
    const [run2] = await ctx.db
      .insert(academicResultRuns)
      .values({
        assessmentId: ids.otherTeacher!,
        version: 1,
        status: 'final',
        ruleSnapshot: {},
        studentsScored: 1,
        studentsAbsent: 0,
        finalisedByUserId: u.coordinator.id,
      } as never)
      .returning();
    for (const [r, assessmentId] of [
      [run!, ids.otherSubject!],
      [run2!, ids.otherTeacher!],
    ] as const) {
      const [attempt] = await ctx.db
        .insert(academicAttempts)
        .values({
          assessmentId,
          studentId: ids.sa!,
          status: 'submitted',
          manualScore: '10',
          enteredByUserId: u.coordinator.id,
        } as never)
        .returning();
      await ctx.db.insert(academicResults).values({
        runId: r.id,
        assessmentId,
        attemptId: attempt!.id,
        studentId: ids.sa!,
        totalScore: '10',
        maxScore: '20',
        sectionScores: {},
      } as never);
    }
    const seen = async (user: Users['teacher']) =>
      (await getStudentProgress(ctx.db, actor(user), ids.sa!, now)).batches.flatMap((b) =>
        b.results.map((r) => r.assessmentId),
      );
    expect(await seen(u.teacher)).toEqual([ids.otherTeacher]); // Quant: in scope; Verbal: another subject
    expect((await seen(u.coordinator)).sort()).toEqual([ids.otherSubject, ids.otherTeacher].sort());
  });
});
