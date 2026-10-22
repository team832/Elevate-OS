import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicClassRecords, academicClassSessions, academicSessionTeachers, auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/class-records/route';
import { PATCH as updateRoute } from '../../src/app/api/v1/class-records/[id]/route';
import { POST as requestCorrectionRoute } from '../../src/app/api/v1/class-records/[id]/request-correction/route';
import { GET as exceptionsRoute } from '../../src/app/api/v1/class-records/exceptions/route';
import { GET as coverageRoute } from '../../src/app/api/v1/batches/[id]/coverage/route';
import { POST as createPlanRoute } from '../../src/app/api/v1/plans/route';
import { POST as addItemsRoute } from '../../src/app/api/v1/plans/[id]/items/route';
import { POST as requestPlanRoute } from '../../src/app/api/v1/plans/[id]/approval/route';
import { POST as decidePlanRoute } from '../../src/app/api/v1/plans/[id]/approval/decision/route';
import { createSessions, verifyClassRecord } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let s: { notDelivered: string; delivered: string; deliveredNoLog: string; wrongChapter: string };

type Rec = { id: string; state: string; version: number; correctsRecordId: string | null; replacedBy: string | null };
const base = { completion: 'completed', actualMinutes: 70, activity: 'main' } as const;
const create = (user: typeof u.teacher, json: Record<string, unknown>) => callRoute<Rec>(createRoute, authedRequest(user, '/academic/api/v1/class-records', { json: { chapterId: w.ch1.id, ...base, ...json } }));
const update = (user: typeof u.teacher, id: string, json: Record<string, unknown>) =>
  callRoute<Rec>(updateRoute, authedRequest(user, `/academic/api/v1/class-records/${id}`, { method: 'PATCH', json: { chapterId: w.ch1.id, ...base, ...json } }), { id });
const deliver = (ids: string[]) => ctx.db.update(academicClassSessions).set({ status: 'held', deliveredAt: new Date(), deliveredByUserId: u.coordinator.id }).where(inArray(academicClassSessions.id, ids as never[]));

describe('teaching log: draft → submitted (R12: delivery is separate)', () => {
  it('a draft saves without touching the session; submit is blocked until the class is marked delivered', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-08', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-09', startTime: '09:00', durationMinutes: 75 },
      { batchId: w.batch.id, teacherStaffId: w.teacherStaff, plannedChapterId: w.ch1.id, sessionType: 'teaching', date: '2026-09-10', startTime: '09:00', durationMinutes: 75 },
    ]);
    const [a, b, c, d] = sessions.map((x) => x.id as string) as [string, string, string, string];
    s = { notDelivered: a, delivered: b, deliveredNoLog: c, wrongChapter: d };
    await deliver([b, c, d]);

    expect((await callRoute(createRoute, buildRequest('/academic/api/v1/class-records', { json: {} }))).status).toBe(401);
    expect((await create(u.auditor, { sessionId: a })).status).toBe(403);
    expect((await create(u.teacher2, { sessionId: a })).status).toBe(404); // not their session
    expect((await create(u.teacher, { sessionId: a, activity: undefined })).status).toBe(400); // no default activity
    const draft = await create(u.teacher, { sessionId: a, homework: 'Exercise 2 (fictional)', homeworkDueOn: '2026-09-09' });
    expect(draft.status).toBe(201);
    expect(draft.data).toMatchObject({ state: 'draft', version: 1 });
    const [session] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, a as never));
    expect(session).toMatchObject({ status: 'scheduled', deliveredAt: null });

    const blocked = await update(u.teacher, draft.data!.id, { version: 1, submit: true });
    expect(blocked.status).toBe(400);
    expect(blocked.error?.message).toMatch(/Mark the class delivered/);
    expect((await create(u.teacher, { sessionId: a })).status).toBe(409); // a draft already exists
  });

  it('drafts are private to their author; a stale version is refused', async () => {
    const [draft] = await ctx.db.select().from(academicClassRecords).where(eq(academicClassRecords.sessionId, s.notDelivered as never));
    const list = (user: typeof u.teacher) => callRoute<Rec[]>(listRoute, authedRequest(user, '/academic/api/v1/class-records?state=draft'));
    expect((await list(u.teacher)).data!.map((r) => r.id)).toEqual([draft!.id]);
    expect((await list(u.coordinator)).data).toEqual([]);
    expect((await update(u.coordinator, draft!.id, { version: 1 })).status).toBe(404);
    expect((await update(u.teacher, draft!.id, { version: 1, notes: 'First edit (fictional)' })).data!.version).toBe(2);
    const stale = await update(u.teacher, draft!.id, { version: 1, notes: 'Second tab (fictional)' });
    expect(stale.status).toBe(409);
    expect(stale.error?.message).toMatch(/changed since you opened it/);
  });

  it('submitting a delivered session writes only class-record audit rows: no session, HR or payroll change (test 10)', async () => {
    const created = await create(u.teacher, { sessionId: s.delivered, submit: true, difficulties: 'Signs in equations (fictional)' });
    expect(created.status).toBe(201);
    expect(created.data!.state).toBe('submitted');
    const actions = await ctx.db.select({ action: auditEvents.action, module: auditEvents.module }).from(auditEvents).where(eq(auditEvents.entityId, created.data!.id));
    expect(actions).toEqual([{ action: 'class_record.submitted', module: 'academic' }]);
    const [session] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, s.delivered as never));
    expect(session!.version).toBe(1);
    expect((await update(u.teacher, created.data!.id, { version: 1 })).status).toBe(409); // submitted logs are not editable
  });

  it('coordinator requests a correction: the original is kept, the teacher fixes the new draft and resubmits', async () => {
    const [submitted] = await ctx.db.select().from(academicClassRecords).where(eq(academicClassRecords.sessionId, s.delivered as never));
    const id = submitted!.id;
    const req = (user: typeof u.teacher, json: unknown) => callRoute<{ original: Rec; draft: Rec }>(requestCorrectionRoute, authedRequest(user, `/academic/api/v1/class-records/${id}/request-correction`, { json }), { id });
    expect((await req(u.teacher, { reason: 'x' })).status).toBe(403);
    expect((await req(u.coordinator, {})).status).toBe(400);
    const res = await req(u.coordinator, { reason: 'Minutes look wrong (fictional)' });
    expect(res.status).toBe(201);
    expect(res.data!.original.state).toBe('superseded');
    expect(res.data!.draft).toMatchObject({ state: 'draft', correctsRecordId: id });
    const coordView = await callRoute<Rec[]>(listRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records?batchId=${w.batch.id}&from=2026-09-08&to=2026-09-08`));
    expect(coordView.data!.map((r) => [r.state, r.replacedBy])).toEqual([['superseded', 'draft']]);
    const resubmitted = await update(u.teacher, res.data!.draft.id, { version: 1, actualMinutes: 60, submit: true });
    expect(resubmitted.data).toMatchObject({ state: 'submitted', version: 2 });
    await expect(verifyClassRecord(ctx.db, actor(u.teacher), res.data!.draft.id)).rejects.toMatchObject({ status: 403 }); // service re-checks the permission
    await verifyClassRecord(ctx.db, actor(u.coordinator), res.data!.draft.id);
    expect((await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'class_record.correction_requested')))).length).toBe(1);
  });

  it('lists delivered sessions without a submitted log and planned ≠ logged chapters', async () => {
    await create(u.teacher, { sessionId: s.wrongChapter, chapterId: w.ch2.id, submit: true });
    const res = await callRoute<{ missingLogs: { id: string }[]; discrepancies: { id: string; loggedChapters: string[] }[] }>(
      exceptionsRoute,
      authedRequest(u.coordinator, '/academic/api/v1/class-records/exceptions?from=2026-09-01&to=2026-09-30'),
    );
    expect(res.status).toBe(200);
    expect(res.data!.missingLogs.map((x) => x.id)).toEqual([s.deliveredNoLog]); // the undelivered draft session is not "missing"
    expect(res.data!.discrepancies).toEqual([expect.objectContaining({ id: s.wrongChapter, loggedChapters: ['Q-02'] })]);
    const other = await callRoute<{ missingLogs: unknown[] }>(exceptionsRoute, authedRequest(u.teacher2, '/academic/api/v1/class-records/exceptions?from=2026-09-01&to=2026-09-30'));
    expect(other.data!.missingLogs).toEqual([]); // own scope
  });

  it('a substitute logs the class as its teacher; the planned teacher keeps access; a correction goes back to the log’s teacher', async () => {
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-12', startTime: '09:00', durationMinutes: 75 }]);
    const id = sessions[0]!.id;
    await deliver([id]);
    await ctx.db.insert(academicSessionTeachers).values({ sessionId: id, staffId: w.teacher2Staff, role: 'substitute', participation: 'actual', replacesStaffId: w.teacherStaff, reason: 'Planned teacher unavailable (fictional)', authorisedByUserId: u.coordinator.id });
    const log = await create(u.teacher2, { sessionId: id, chapterId: w.ch2.id, submit: true });
    expect(log.status).toBe(201);
    const [row] = await ctx.db.select().from(academicClassRecords).where(eq(academicClassRecords.id, log.data!.id as never));
    expect(row!.teacherStaffId).toBe(w.teacher2Staff);
    expect((await create(u.teacher, { sessionId: id, chapterId: w.ch1.id })).status).toBe(201); // planned teacher still allowed
    expect((await callRoute<Rec[]>(listRoute, authedRequest(u.teacher2, '/academic/api/v1/class-records?from=2026-09-12&to=2026-09-12'))).data!.map((r) => r.id)).toEqual([log.data!.id]);
    const sent = await callRoute<{ draft: { recordedByUserId: string } }>(requestCorrectionRoute, authedRequest(u.coordinator, `/academic/api/v1/class-records/${log.data!.id}/request-correction`, { json: { reason: 'Check minutes (fictional)' } }), { id: log.data!.id });
    expect(sent.data!.draft.recordedByUserId).toBe(u.teacher2.id);
  });

  it('a revision log adds evidence, not coverage, to a taught chapter; no mastery field (tests 11, 12)', async () => {
    const post = <T,>(route: typeof createPlanRoute, path: string, json: unknown, user = u.coordinator, id?: string) => callRoute<T>(route, authedRequest(user, path, { json }), id ? { id } : {});
    const plan = await post<{ id: string }>(createPlanRoute, '/academic/api/v1/plans', { courseId: w.course.id, code: uniq('PLAN-'), title: 'Plan (fictional)', countsStatus: 'locked', datesStatus: 'unknown' });
    await post(addItemsRoute, `/academic/api/v1/plans/${plan.data!.id}/items`, { items: [{ chapterId: w.ch1.id, lessonCode: 'L-1', sessionType: 'teaching', plannedMinutes: 150 }] }, u.coordinator, plan.data!.id);
    await post(requestPlanRoute, `/academic/api/v1/plans/${plan.data!.id}/approval`, { targetStatus: 'locked' }, u.coordinator, plan.data!.id);
    expect((await post(decidePlanRoute, `/academic/api/v1/plans/${plan.data!.id}/approval/decision`, { decision: 'approved' }, u.coordinator2, plan.data!.id)).status).toBe(200);
    type Cov = { coverage: { chapters: { code: string; taught: string; evidence: Record<string, number> }[]; course: { chaptersTaught: number } } };
    const coverage = async () => (await callRoute<Cov>(coverageRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/coverage`), { id: w.batch.id })).data!;
    const before = await coverage();
    expect(before.coverage.chapters.find((c) => c.code === 'Q-01')).toMatchObject({ taught: 'completed', evidence: {} });
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [{ batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-13', startTime: '09:00', durationMinutes: 75 }]);
    await deliver([sessions[0]!.id]);
    await create(u.teacher, { sessionId: sessions[0]!.id, chapterId: w.ch1.id, activity: 'revision', submit: true });
    const after = await coverage();
    expect(after.coverage.chapters.find((c) => c.code === 'Q-01')).toMatchObject({ taught: 'completed', evidence: { revision: 1 } });
    expect(after.coverage.course.chaptersTaught).toBe(before.coverage.course.chaptersTaught);
    expect(JSON.stringify(after)).not.toMatch(/mastery|score/i);
  });
});
