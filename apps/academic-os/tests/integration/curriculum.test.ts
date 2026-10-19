import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as listCoursesRoute, POST as createCourseRoute } from '../../src/app/api/v1/courses/route';
import { POST as createPlanRoute } from '../../src/app/api/v1/plans/route';
import { GET as getPlanRoute } from '../../src/app/api/v1/plans/[id]/route';
import { POST as addItemsRoute } from '../../src/app/api/v1/plans/[id]/items/route';
import { POST as requestRoute } from '../../src/app/api/v1/plans/[id]/approval/route';
import { POST as decideRoute } from '../../src/app/api/v1/plans/[id]/approval/decision/route';
import { GET as coverageRoute } from '../../src/app/api/v1/batches/[id]/coverage/route';
import { GET as conceptBooksRoute } from '../../src/app/api/v1/concept-books/route';
import { createSessions, recordClass, verifyClassRecord } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;

async function newPlan(extra: Record<string, unknown> = {}) {
  const res = await callRoute<{ id: string; status: string; version: number }>(
    createPlanRoute,
    authedRequest(u.coordinator, '/academic/api/v1/plans', { json: { courseId: w.course.id, code: uniq('PLAN-'), title: 'Plan (test)', countsStatus: 'locked', datesStatus: 'provisional', ...extra } }),
  );
  expect(res.status).toBe(201);
  return res.data!;
}
async function addItems(planId: string, items: unknown[], user = u.coordinator) {
  return callRoute(addItemsRoute, authedRequest(user, `/academic/api/v1/plans/${planId}/items`, { json: { items } }), { id: planId });
}
const request = (planId: string, user = u.coordinator, targetStatus = 'locked') =>
  callRoute(requestRoute, authedRequest(user, `/academic/api/v1/plans/${planId}/approval`, { json: { targetStatus } }), { id: planId });
const decide = (planId: string, user: typeof u.coordinator, decision = 'approved', comment?: string) =>
  callRoute<{ plan: { status: string }; superseded: { status: string } | null }>(decideRoute, authedRequest(user, `/academic/api/v1/plans/${planId}/approval/decision`, { json: { decision, comment } }), { id: planId });

describe('courses routes', () => {
  it('401 without a session, 403 for counsellors and teachers writing, 400 on bad input, 201 for the coordinator', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    expect((await callRoute(listCoursesRoute, buildRequest('/academic/api/v1/courses'))).status).toBe(401);
    expect((await callRoute(listCoursesRoute, authedRequest(u.counsellor, '/academic/api/v1/courses'))).status).toBe(403);
    expect((await callRoute(listCoursesRoute, authedRequest(u.teacher, '/academic/api/v1/courses'))).status).toBe(200);
    const body = { programmeCode: w.programmeCode, code: uniq('C-'), familyCode: uniq('F-'), name: 'New course', classMinutes: 60, classMinutesStatus: 'proposed' };
    expect((await callRoute(createCourseRoute, authedRequest(u.teacher, '/academic/api/v1/courses', { json: body }))).status).toBe(403);
    expect((await callRoute(createCourseRoute, authedRequest(u.director, '/academic/api/v1/courses', { json: body }))).status).toBe(403);
    const bad = await callRoute(createCourseRoute, authedRequest(u.coordinator, '/academic/api/v1/courses', { json: { ...body, classMinutes: 5 } }));
    expect(bad.status).toBe(400);
    expect(bad.error?.code).toBe('VALIDATION_FAILED');
    const ok = await callRoute<{ classMinutes: number; classMinutesStatus: string }>(createCourseRoute, authedRequest(u.coordinator, '/academic/api/v1/courses', { json: body }));
    expect(ok.status).toBe(201);
    expect(ok.data).toMatchObject({ classMinutes: 60, classMinutesStatus: 'proposed' });
  });
});

describe('curriculum plan versions and approvals', () => {
  it('a proposed plan is locked only through a core approval by ANOTHER coordinator', async () => {
    const plan = await newPlan();
    expect(plan).toMatchObject({ status: 'proposed', version: 1 });
    expect((await request(plan.id)).status).toBe(400); // no items yet
    const items = await addItems(plan.id, [
      { chapterId: w.ch1.id, lessonCode: 'L-001', sessionType: 'teaching', plannedClasses: 2, plannedDate: '2026-09-07' },
      { chapterId: w.ch2.id, lessonCode: 'L-002', sessionType: 'practice', plannedDate: '2026-09-08' },
    ]);
    expect(items.status).toBe(201);
    expect((await addItems(plan.id, [{ chapterId: w.ch1.id, lessonCode: 'X', sessionType: 'teaching' }], u.teacher)).status).toBe(403);
    expect((await request(plan.id, u.teacher)).status).toBe(403);
    expect((await request(plan.id)).status).toBe(201);
    expect((await request(plan.id)).status).toBe(409); // already pending
    const self = await decide(plan.id, u.coordinator);
    expect(self.status).toBe(403);
    expect((await decide(plan.id, u.director)).status).toBe(403);
    expect((await decide(plan.id, u.coordinator2, 'rejected')).status).toBe(400); // reason required
    const ok = await decide(plan.id, u.coordinator2);
    expect(ok.status).toBe(200);
    expect(ok.data!.plan.status).toBe('locked');
    const detail = await callRoute<{ plan: { status: string; countsStatus: string; datesStatus: string }; totalClasses: number; totalHours: number; approvals: { status: string }[] }>(
      getPlanRoute,
      authedRequest(u.auditor, `/academic/api/v1/plans/${plan.id}`),
      { id: plan.id },
    );
    expect(detail.data).toMatchObject({ plan: { status: 'locked', countsStatus: 'locked', datesStatus: 'provisional' }, totalClasses: 3, totalHours: 3.75 });
    expect(detail.data!.approvals.map((a) => a.status)).toEqual(['approved']);
    // A locked plan is immutable.
    const frozen = await addItems(plan.id, [{ chapterId: w.ch3.id, lessonCode: 'L-003', sessionType: 'teaching' }]);
    expect(frozen.status).toBe(409);
    expect(frozen.error?.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('a new version supersedes the locked plan only when approved; the predecessor is kept as superseded', async () => {
    const v1 = await newPlan();
    await addItems(v1.id, [{ chapterId: w.ch1.id, lessonCode: 'A-1', sessionType: 'teaching', plannedClasses: 4 }]);
    await request(v1.id);
    await decide(v1.id, u.coordinator2);
    const v2 = await newPlan({ supersedesPlanId: v1.id, copyItems: true, changeLog: 'Remove practice (test)' });
    expect(v2.version).toBe(2);
    await addItems(v2.id, [{ chapterId: w.ch3.id, lessonCode: 'A-2', sessionType: 'teaching' }]);
    await request(v2.id, u.coordinator, 'provisional');
    const decided = await decide(v2.id, u.coordinator2);
    expect(decided.data!.plan.status).toBe('provisional');
    expect(decided.data!.superseded!.status).toBe('superseded');
    const old = await callRoute<{ plan: { status: string }; totalClasses: number; supersededBy: { id: string } }>(getPlanRoute, authedRequest(u.coordinator, `/academic/api/v1/plans/${v1.id}`), { id: v1.id });
    expect(old.data).toMatchObject({ plan: { status: 'superseded' }, totalClasses: 4, supersededBy: { id: v2.id } });
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, v1.id), eq(auditEvents.action, 'curriculum_plan.superseded')));
    expect(audit).toHaveLength(1);
    // Superseding a plan of another course is refused.
    const wrong = await callRoute(createPlanRoute, authedRequest(u.coordinator, '/academic/api/v1/plans', { json: { courseId: w.course.id, code: uniq('P-'), title: 'x', supersedesPlanId: v1.id } }));
    expect(wrong.status).toBe(400);
  });
});

describe('coverage (planned vs completed from class records)', () => {
  it('counts only verified minutes; teachers outside the batch get 404', async () => {
    const coord = actor(u.coordinator);
    const { sessions } = await createSessions(ctx.db, coord, [
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-08', startTime: '09:00', durationMinutes: 75 },
    ]);
    const r1 = await recordClass(ctx.db, actor(u.teacher), { sessionId: sessions[0]!.id, chapterId: w.ch1.id, completion: 'completed', actualMinutes: 75, activity: 'main' });
    await recordClass(ctx.db, actor(u.teacher), { sessionId: sessions[1]!.id, chapterId: w.ch1.id, completion: 'partial', actualMinutes: 60, activity: 'main' });
    await verifyClassRecord(ctx.db, coord, r1.id);
    const res = await callRoute<{ plan: { status: string }; coverage: { course: { verifiedMinutes: number; unverifiedMinutes: number; plannedMinutes: number } } }>(
      coverageRoute,
      authedRequest(u.teacher, `/academic/api/v1/batches/${w.batch.id}/coverage?asOf=2026-09-30`),
      { id: w.batch.id },
    );
    expect(res.status).toBe(200);
    expect(res.data!.plan.status).toBe('locked'); // a locked template wins over a provisional one
    expect(res.data!.coverage.course).toMatchObject({ verifiedMinutes: 75, unverifiedMinutes: 60 });
    const outsider = await callRoute(coverageRoute, authedRequest(u.marketing, `/academic/api/v1/batches/${w.batch.id}/coverage`), { id: w.batch.id });
    expect(outsider.status).toBe(403);
    const stranger = await createTestUser(ctx.db, { roles: ['teacher'] });
    const strangerOther = await createTestUser(ctx.db, { roles: ['teacher'] });
    const other = await world(ctx.db, u, { teacher: stranger, teacher2: strangerOther });
    const notMine = await callRoute(coverageRoute, authedRequest(u.teacher, `/academic/api/v1/batches/${other.batch.id}/coverage`), { id: other.batch.id });
    expect(notMine.status).toBe(404);
    const theirs = await callRoute(coverageRoute, authedRequest(stranger, `/academic/api/v1/batches/${other.batch.id}/coverage`), { id: other.batch.id });
    expect(theirs.status).toBe(200);
  });

  it('concept books list is readable by teachers and empty until seeded', async () => {
    const res = await callRoute<{ numberedChapters: number }>(conceptBooksRoute, authedRequest(u.teacher, '/academic/api/v1/concept-books'));
    expect(res.status).toBe(200);
    expect(res.data!.numberedChapters).toBe(0);
  });
});
