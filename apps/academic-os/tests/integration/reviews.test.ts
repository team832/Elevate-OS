import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  academicBatchPlacements,
  academicSessionDemoAttendees,
  academicStudents,
  academicTeacherAssignments,
  academicTeacherReviews,
  auditEvents,
  students as coreStudents,
} from '@elevate/database';
import { academicStudentReviewsV1Schema, type AcademicStudentReviewsV1 } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/reviews/route';
import { GET as getRoute, PATCH as updateRoute } from '../../src/app/api/v1/reviews/[id]/route';
import { POST as reviseRoute } from '../../src/app/api/v1/reviews/[id]/revise/route';
import { POST as withdrawRoute } from '../../src/app/api/v1/reviews/[id]/withdraw/route';
import { GET as studentReviewsRoute } from '../../src/app/api/v1/students/[id]/reviews/route';
import { GET as internalRoute } from '../../src/app/api/internal/v1/reviews/route';
import { createSessions, createStudent, enrolManually } from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let student: string; // academic student id
let core: string; // its core student id
let demoCore: string;
let demoSession: string; // ops demo session id
let reviewId: string;

type Review = { id: string; reviewKey: string; version: number; status: string; supersedesId: string | null };
type User = Users['teacher'];
const create = (user: User, json: Record<string, unknown>) => callRoute<Review>(createRoute, authedRequest(user, '/academic/api/v1/reviews', { json }));
/** Sends the draft's current `updatedAt` (as the form does) unless the test overrides it. */
async function patch(user: User, id: string, json: Record<string, unknown>) {
  const [row] = await ctx.db.select({ updatedAt: academicTeacherReviews.updatedAt }).from(academicTeacherReviews).where(eq(academicTeacherReviews.id, id as never));
  return callRoute<Review>(updateRoute, authedRequest(user, `/academic/api/v1/reviews/${id}`, { method: 'PATCH', json: { updatedAt: row?.updatedAt.toISOString(), ...json } }), { id });
}
const list = (user: User, query = '') => callRoute<Review[]>(listRoute, authedRequest(user, `/academic/api/v1/reviews${query}`));
const internal = (query: string, caller = 'ops', token = process.env.INTERNAL_SERVICE_TOKEN!) =>
  callRoute<AcademicStudentReviewsV1>(internalRoute, buildRequest(`/academic/api/internal/v1/reviews${query}`, { headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': caller } }));
const period = { periodFrom: '2026-09-01', periodTo: '2026-09-30' };
const periodic = { reviewType: 'periodic_progress', ...period };

describe('teacher reviews (owner answer 1, brief §13)', () => {
  it('a teacher drafts a review only for a student currently placed in an assigned batch', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    const s = await createStudent(ctx.db, coord, { fullName: 'Sample Asha Student' });
    const enrolment = await enrolManually(ctx.db, coord, { studentId: s.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    // R13: one open placement per enrolment (A1's enrolment service may already create it).
    await ctx.db.insert(academicBatchPlacements).values({ enrolmentId: enrolment.id, batchId: w.batch.id, startDate: '2026-09-01', placedByUserId: u.coordinator.id }).onConflictDoNothing();
    const [c] = await ctx.db.insert(coreStudents).values({ fullName: 'Sample Asha Student' }).returning();
    await ctx.db.update(academicStudents).set({ coreStudentId: c!.id }).where(eq(academicStudents.id, s.id as never));
    student = s.id;
    core = c!.id;

    const unplaced = await createStudent(ctx.db, coord, { fullName: 'Sample Ravi Student' });
    expect((await callRoute(createRoute, buildRequest('/academic/api/v1/reviews', { json: {} }))).status).toBe(401);
    expect((await create(u.counsellor, { ...periodic, academicStudentId: student })).status).toBe(403);
    expect((await create(u.teacher, { ...periodic })).status).toBe(400); // no student
    expect((await create(u.teacher, { ...periodic, academicStudentId: unplaced.id })).status).toBe(404);
    expect((await create(u.teacher, { ...periodic, academicStudentId: student, rating: 4 })).status).toBe(400); // no rating fields
    const { sessions } = await createSessions(ctx.db, coord, [{ batchId: w.batch.id, teacherStaffId: w.teacher2Staff, sessionType: 'teaching', date: '2026-09-14', startTime: '09:00', durationMinutes: 75 }]);
    expect((await create(u.teacher, { ...periodic, academicStudentId: student, sessionId: sessions[0]!.id })).status).toBe(400); // not their class
    const other = await world(ctx.db, u);
    expect((await create(u.teacher, { ...periodic, academicStudentId: student, subjectId: other.quant.id })).status).toBe(400); // not the student's course
    expect((await callRoute(studentReviewsRoute, authedRequest(u.teacher, `/academic/api/v1/students/${unplaced.id}/reviews`), { id: unplaced.id })).status).toBe(404);
    const draft = await create(u.teacher, { ...periodic, academicStudentId: student, strengths: 'Explains steps clearly (fictional)' });
    expect(draft.status).toBe(201);
    expect(draft.data).toMatchObject({ status: 'draft', version: 1 });
    reviewId = draft.data!.id;
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, reviewId), eq(auditEvents.action, 'teacher_review.draft_saved')));
    expect(audit).toHaveLength(1);
  });

  it('drafts are visible only to their author (test 13)', async () => {
    expect((await list(u.teacher)).data!.map((r) => r.id)).toEqual([reviewId]);
    expect((await list(u.coordinator)).data).toEqual([]);
    expect((await list(u.teacher2)).data).toEqual([]);
    expect((await callRoute(getRoute, authedRequest(u.coordinator, `/academic/api/v1/reviews/${reviewId}`), { id: reviewId })).status).toBe(404);
    expect((await internal(`?coreStudentId=${core}`)).data!.reviews).toEqual([]);
    const pending = await callRoute<{ pending: boolean }>(studentReviewsRoute, authedRequest(u.coordinator, `/academic/api/v1/students/${student}/reviews`), { id: student });
    expect(pending.data!.pending).toBe(true); // pending, never negative
  });

  it('submit needs written evidence; a submitted version is never edited', async () => {
    expect((await patch(u.teacher, reviewId, { ...period, strengths: '', submit: true })).status).toBe(400);
    expect((await patch(u.teacher2, reviewId, { ...period, submit: true })).status).toBe(404);
    const stale = await patch(u.teacher, reviewId, { ...period, updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect(stale.error?.message).toMatch(/changed since you opened it/);
    const submitted = await patch(u.teacher, reviewId, { ...period, strengths: 'Explains steps clearly (fictional)', suggestedAction: 'More word problems (fictional)', submit: true });
    expect(submitted.status).toBe(200);
    expect(submitted.data!.status).toBe('submitted');
    expect((await patch(u.teacher, reviewId, { ...period, strengths: 'Changed' })).status).toBe(409);
    const seen = await internal(`?coreStudentId=${core}`);
    expect(seen.status).toBe(200);
    expect(academicStudentReviewsV1Schema.safeParse(seen.data).success).toBe(true);
    expect(seen.data!.student).toEqual({ coreStudentId: core, academicStudentId: student });
    expect(seen.data!.reviews).toEqual([expect.objectContaining({ version: 1, status: 'submitted', superseded: false, studentName: 'Sample Asha Student', visibility: 'internal', sourcePath: `/academic/reviews/${reviewId}`, opsDemoSessionId: null })]);
    expect((await callRoute<{ pending: boolean }>(studentReviewsRoute, authedRequest(u.coordinator, `/academic/api/v1/students/${student}/reviews`), { id: student })).data!.pending).toBe(false);
  });

  it('a revision is a new version; Ops gets the latest; a stale version cannot overwrite a newer one (test 14)', async () => {
    const revise = (id: string) => callRoute<Review>(reviseRoute, authedRequest(u.teacher, `/academic/api/v1/reviews/${id}/revise`, { method: 'POST' }), { id });
    const v2 = await revise(reviewId);
    expect(v2.status).toBe(201);
    expect(v2.data).toMatchObject({ version: 2, status: 'draft', supersedesId: reviewId });
    expect((await revise(reviewId)).status).toBe(409); // one draft per review
    expect(await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, v2.data!.id), eq(auditEvents.action, 'teacher_review.revision_started')))).toHaveLength(1);
    await patch(u.teacher, v2.data!.id, { ...period, strengths: 'Now also checks answers (fictional)', submit: true });
    const seen = (await internal(`?coreStudentId=${core}`)).data!.reviews;
    expect(seen.map((r) => [r.version, r.superseded])).toEqual([[2, false], [1, true]]);

    const v3 = await revise(v2.data!.id);
    // A newer version lands first (another device): the stale draft must not overwrite it.
    const [row] = await ctx.db.select().from(academicTeacherReviews).where(eq(academicTeacherReviews.id, v2.data!.id as never));
    const { id: _id, createdAt: _c, updatedAt: _u, ...content } = row!;
    await ctx.db.insert(academicTeacherReviews).values({ ...content, version: 4, supersedesId: row!.id, submittedAt: new Date() });
    expect((await patch(u.teacher, v3.data!.id, { ...period, strengths: 'Stale (fictional)', submit: true })).status).toBe(409);
  });

  it('read access follows current scope; the author keeps their own reviews after reassignment', async () => {
    const other = await create(u.teacher2, { ...periodic, academicStudentId: student, areasForSupport: 'Reading speed (fictional)', submit: true });
    expect(other.status).toBe(201);
    expect((await list(u.teacher, `?academicStudentId=${student}`)).data!.some((r) => r.id === other.data!.id)).toBe(true);
    await ctx.db.update(academicTeacherAssignments).set({ status: 'ended' }).where(eq(academicTeacherAssignments.staffMemberId, w.teacherStaff));
    const after = (await list(u.teacher)).data!;
    expect(after.some((r) => r.id === other.data!.id)).toBe(false);
    expect(after.some((r) => r.id === reviewId)).toBe(true);
    expect((await create(u.teacher, { ...periodic, academicStudentId: student })).status).toBe(404);
    const byAuthor = await internal(`?authorStaffId=${w.teacher2Staff}`);
    expect(byAuthor.data!.student).toBeNull();
    expect(byAuthor.data!.reviews).toEqual([expect.objectContaining({ coreStudentId: core, academicStudentId: student, status: 'submitted' })]);
    await ctx.db.update(academicTeacherAssignments).set({ status: 'active' }).where(eq(academicTeacherAssignments.staffMemberId, w.teacherStaff));
  });

  it('withdrawal propagates on the next read without its content', async () => {
    const latest = (await internal(`?coreStudentId=${core}&authorStaffId=${w.teacherStaff}`)).data!.reviews[0]!;
    const [row] = await ctx.db.select().from(academicTeacherReviews).where(and(eq(academicTeacherReviews.reviewKey, latest.reviewKey as never), eq(academicTeacherReviews.version, 4)));
    const withdraw = (json: unknown) => callRoute<Review>(withdrawRoute, authedRequest(u.teacher, `/academic/api/v1/reviews/${row!.id}/withdraw`, { json }), { id: row!.id });
    expect((await withdraw({})).status).toBe(400);
    expect((await withdraw({ reason: 'Written for the wrong student (fictional)' })).status).toBe(200);
    const seen = (await internal(`?coreStudentId=${core}&authorStaffId=${w.teacherStaff}`)).data!.reviews;
    expect(seen.every((r) => r.status === 'withdrawn' && r.withdrawnAt && r.strengths === null && r.suggestedAction === null)).toBe(true);
    expect(seen.map((r) => r.version)).toEqual([4, 2, 1]); // the v3 draft never leaves Academic
    expect(seen.some((r) => r.superseded)).toBe(false); // superseded only by a later SUBMITTED version
    expect(await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, row!.id), eq(auditEvents.action, 'teacher_review.withdrawn')))).toHaveLength(1);
    // Another teacher of the same student never reads withdrawn text (list or detail).
    expect((await list(u.teacher2, `?academicStudentId=${student}`)).data!.some((r) => r.reviewKey === latest.reviewKey)).toBe(false);
    expect((await callRoute(getRoute, authedRequest(u.teacher2, `/academic/api/v1/reviews/${row!.id}`), { id: row!.id })).status).toBe(404);
  });

  it('a demo review is allowed only to the teacher of that demo class', async () => {
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-15', startTime: '09:00', durationMinutes: 75 }]);
    const [c] = await ctx.db.insert(coreStudents).values({ fullName: 'Sample Demo Student' }).returning();
    demoCore = c!.id;
    demoSession = randomUUID();
    await ctx.db.insert(academicSessionDemoAttendees).values({ sessionId: sessions[0]!.id, opsDemoSessionId: demoSession, coreStudentId: c!.id, displayName: 'Sample Demo Student', demoDayNumber: 1, addedByUserId: u.coordinator.id });
    const body = { reviewType: 'demo_session', coreStudentId: demoCore, opsDemoSessionId: demoSession, strengths: 'Asked good questions (fictional)', visibility: 'shareable', submit: true };
    expect((await create(u.teacher2, body)).status).toBe(404);
    expect((await create(u.teacher, { ...body, opsDemoSessionId: undefined })).status).toBe(400);
    expect((await create(u.teacher, body)).status).toBe(201);
    const seen = (await internal(`?coreStudentId=${demoCore}`)).data!;
    expect(seen.reviews).toEqual([expect.objectContaining({ reviewType: 'demo_session', visibility: 'shareable', sessionDate: '2026-09-15', opsDemoSessionId: demoSession, studentName: 'Sample Demo Student' })]);
  });

  it('a coordinator with a staff record may review any student', async () => {
    await staffFor(ctx.db, u.coordinator, 'Sample Coordinator');
    const res = await create(u.coordinator, { reviewType: 'support_referral', academicStudentId: student, suggestedAction: 'Meet the counsellor (fictional)', submit: true });
    expect(res.status).toBe(201);
    expect(res.data!.status).toBe('submitted');
  });

  it('no non-staff caller gets reviews: internal route is ops-only, staff routes need academic:reviews:read (test 15)', async () => {
    expect((await callRoute(internalRoute, buildRequest(`/academic/api/internal/v1/reviews?coreStudentId=${core}`))).status).toBe(401);
    expect((await internal(`?coreStudentId=${core}`, 'ops', 'test-only-wrong-token')).status).toBe(401);
    expect((await internal(`?coreStudentId=${core}`, 'marketing')).status).toBe(403);
    expect((await internal(`?coreStudentId=${core}`, 'platform')).status).toBe(403);
    expect((await internal('')).status).toBe(400);
    const nobody = await createTestUser(ctx.db, { roles: ['admissions_counsellor'] });
    expect((await list(nobody)).status).toBe(403);
    expect((await callRoute(studentReviewsRoute, authedRequest(u.marketing, `/academic/api/v1/students/${student}/reviews`), { id: student })).status).toBe(403);
  });
});
