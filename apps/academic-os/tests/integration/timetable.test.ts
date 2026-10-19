import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicClassSessions, notifications } from '@elevate/database';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { GET as listSessionsRoute, POST as createSessionsRoute } from '../../src/app/api/v1/sessions/route';
import { POST as cancelRoute } from '../../src/app/api/v1/sessions/[id]/cancel/route';
import { POST as rescheduleRoute } from '../../src/app/api/v1/sessions/[id]/reschedule/route';
import { POST as checkRoute } from '../../src/app/api/v1/timetable/check/route';
import { POST as exclusionRoute } from '../../src/app/api/v1/exclusions/route';
import { POST as ruleRoute } from '../../src/app/api/v1/calendar-rules/route';
import { GET as feasibilityRoute } from '../../src/app/api/v1/batches/[id]/feasibility/route';
import { GET as listBatchesRoute } from '../../src/app/api/v1/batches/route';
import { GET as listAssignmentsRoute, POST as assignRoute } from '../../src/app/api/v1/assignments/route';
import { GET as staffRoute } from '../../src/app/api/v1/staff/route';
import { createPlan, addPlanItems, requestPlanStatusChange, decidePlanStatusChange } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;

const session = (over: Record<string, unknown> = {}) => ({
  batchId: w.batch.id,
  teacherStaffId: w.teacherStaff,
  subjectId: w.quant.id,
  sessionType: 'teaching',
  date: '2026-09-14',
  startTime: '09:00',
  durationMinutes: 75,
  ...over,
});
const schedule = (sessions: unknown[], user = u.coordinator) =>
  callRoute<{ sessions: { id: string }[]; warnings: unknown[] }>(createSessionsRoute, authedRequest(user, '/academic/api/v1/sessions', { json: { sessions } }));

describe('scheduling sessions', () => {
  it('401/403/400 and 201 for a clean session; back-to-back is fine', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    expect((await callRoute(createSessionsRoute, buildRequest('/academic/api/v1/sessions', { json: { sessions: [] } }))).status).toBe(401);
    expect((await schedule([session()], u.teacher)).status).toBe(403);
    expect((await schedule([session({ startTime: '9am' })])).status).toBe(400);
    const res = await schedule([session(), session({ startTime: '10:15', teacherStaffId: w.teacher2Staff, subjectId: w.verbal.id })]);
    expect(res.status).toBe(201);
    expect(res.data!.sessions).toHaveLength(2);
  });

  it('refuses hard conflicts with 409 and the conflict list (teacher/batch overlap, holiday, duration)', async () => {
    const overlap = await schedule([session({ startTime: '09:30', batchId: w.batch.id })]);
    expect(overlap.status).toBe(409);
    const codes = (overlap.error!.details as { hard: { code: string }[] }).hard.map((c) => c.code).sort();
    // 09:30–10:45 overlaps the 09:00 class (same teacher and batch) and the 10:15 class (same batch)
    expect(codes).toEqual(['BATCH_OVERLAP', 'BATCH_OVERLAP', 'TEACHER_OVERLAP']);
    const ex = await callRoute(exclusionRoute, authedRequest(u.coordinator, '/academic/api/v1/exclusions', { json: { kind: 'holiday', label: 'Holiday (fictional)', date: '2026-09-15', status: 'confirmed' } }));
    expect(ex.status).toBe(201);
    const onHoliday = await schedule([session({ date: '2026-09-15' })]);
    expect((onHoliday.error!.details as { hard: { code: string }[] }).hard.map((c) => c.code)).toEqual(['ON_EXCLUSION']);
    const wrongLength = await schedule([session({ date: '2026-09-16', durationMinutes: 60 })]);
    expect((wrongLength.error!.details as { hard: { code: string }[] }).hard.map((c) => c.code)).toEqual(['DURATION_MISMATCH']);
    // test sessions are not bound to the class length
    expect((await schedule([session({ date: '2026-09-16', durationMinutes: 45, sessionType: 'test' })])).status).toBe(201);
  });

  it('the check route reports feasible / infeasible without writing anything', async () => {
    const res = await callRoute<{ verdict: string; hard: unknown[] }>(
      checkRoute,
      authedRequest(u.teacher, '/academic/api/v1/timetable/check', { json: { from: '2026-09-14', to: '2026-09-20', candidates: [session({ startTime: '09:30' })] } }),
    );
    expect(res.status).toBe(200);
    expect(res.data!.verdict).toBe('infeasible');
    expect(JSON.stringify(res.data)).not.toMatch(/optimal/i);
    const clean = await callRoute<{ verdict: string }>(checkRoute, authedRequest(u.coordinator, '/academic/api/v1/timetable/check', { json: { from: '2026-09-14', to: '2026-09-20', batchId: w.batch.id } }));
    expect(clean.data!.verdict).toBe('feasible');
  });

  it('teachers only see the sessions they teach', async () => {
    const mine = await callRoute<{ teacherStaffId: string }[]>(listSessionsRoute, authedRequest(u.teacher, '/academic/api/v1/sessions'));
    expect(mine.data!.length).toBeGreaterThan(0);
    expect(mine.data!.every((s) => s.teacherStaffId === w.teacherStaff)).toBe(true);
    const all = await callRoute<unknown[]>(listSessionsRoute, authedRequest(u.coordinator, '/academic/api/v1/sessions'));
    expect(all.data!.length).toBeGreaterThan(mine.data!.length);
    expect((await callRoute(listSessionsRoute, authedRequest(u.counsellor, '/academic/api/v1/sessions'))).status).toBe(403);
    const batches = await callRoute<{ id: string }[]>(listBatchesRoute, authedRequest(u.teacher, '/academic/api/v1/batches'));
    expect(batches.data!.map((b) => b.id)).toEqual([w.batch.id]);
  });
});

describe('teacher assignments (ACD-003)', () => {
  it('only the coordinator assigns; subjects must belong to the course; teachers read their own assignments', async () => {
    const staff = await callRoute<{ id: string; fullName: string }[]>(staffRoute, authedRequest(u.coordinator, '/academic/api/v1/staff'));
    expect(staff.data!.map((s) => s.id)).toEqual(expect.arrayContaining([w.teacherStaff, w.teacher2Staff]));
    expect((await callRoute(staffRoute, authedRequest(u.teacher, '/academic/api/v1/staff'))).status).toBe(403);
    const body = { batchId: w.batch.id, subjectId: w.verbal.id, staffMemberId: w.teacherStaff, employmentType: 'part_time' };
    expect((await callRoute(assignRoute, authedRequest(u.teacher, '/academic/api/v1/assignments', { json: body }))).status).toBe(403);
    const other = await world(ctx.db, u);
    expect((await callRoute(assignRoute, authedRequest(u.coordinator, '/academic/api/v1/assignments', { json: { ...body, subjectId: other.quant.id } }))).status).toBe(400);
    expect((await callRoute(assignRoute, authedRequest(u.coordinator, '/academic/api/v1/assignments', { json: body }))).status).toBe(201);
    expect((await callRoute(assignRoute, authedRequest(u.coordinator, '/academic/api/v1/assignments', { json: body }))).status).toBe(409); // already active
    const mine = await callRoute<{ staffMemberId: string }[]>(listAssignmentsRoute, authedRequest(u.teacher, '/academic/api/v1/assignments'));
    expect(mine.data!.every((a) => a.staffMemberId === w.teacherStaff)).toBe(true);
    const all = await callRoute<unknown[]>(listAssignmentsRoute, authedRequest(u.auditor, '/academic/api/v1/assignments'));
    expect(all.data!.length).toBeGreaterThan(mine.data!.length);
  });
});

describe('cancellation and rescheduling', () => {
  it('cancel needs a reason, keeps the row, notifies the teacher; only scheduled sessions can be cancelled', async () => {
    const { data } = await schedule([session({ date: '2026-09-21' })]);
    const id = data!.sessions[0]!.id;
    expect((await callRoute(cancelRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/cancel`, { json: { reason: '' } }), { id })).status).toBe(400);
    const ok = await callRoute<{ status: string; statusReason: string }>(cancelRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/cancel`, { json: { reason: 'Teacher unwell (fictional)' } }), { id });
    expect(ok.data).toMatchObject({ status: 'cancelled', statusReason: 'Teacher unwell (fictional)' });
    expect((await callRoute(cancelRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/cancel`, { json: { reason: 'again' } }), { id })).status).toBe(409);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, u.teacher.id));
    expect(notes.some((n) => n.kind === 'class_session.cancelled')).toBe(true);
  });

  it('reschedule keeps the original as rescheduled and links the replacement; a conflicting slot changes nothing', async () => {
    const { data } = await schedule([session({ date: '2026-09-22' })]);
    const id = data!.sessions[0]!.id;
    const clash = await callRoute(rescheduleRoute, authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/reschedule`, { json: { date: '2026-09-14', startTime: '09:00', reason: 'Room clash (fictional)' } }), { id });
    expect(clash.status).toBe(409);
    const [stillScheduled] = await ctx.db.select().from(academicClassSessions).where(eq(academicClassSessions.id, id as never));
    expect(stillScheduled!.status).toBe('scheduled');
    const ok = await callRoute<{ original: { status: string }; replacement: { rescheduledFromSessionId: string; date: string } }>(
      rescheduleRoute,
      authedRequest(u.coordinator, `/academic/api/v1/sessions/${id}/reschedule`, { json: { date: '2026-09-23', startTime: '11:00', reason: 'Room clash (fictional)' } }),
      { id },
    );
    expect(ok.status).toBe(201);
    expect(ok.data).toMatchObject({ original: { status: 'rescheduled' }, replacement: { rescheduledFromSessionId: id, date: '2026-09-23' } });
  });
});

describe('capacity feasibility route', () => {
  it('reports not_assessed without a plan, then feasible/infeasible against the plan', async () => {
    const coord = actor(u.coordinator);
    const rules = [
      { label: 'Mon–Fri × 2', periodStart: '2026-11-02', periodEnd: '2026-11-08', weekdays: [1, 2, 3, 4, 5], slotsPerDay: 2 },
      { label: 'Tue extra', periodStart: '2026-11-02', periodEnd: '2026-11-08', weekdays: [2], slotsPerDay: 1, kind: 'extra' },
    ];
    for (const r of rules) expect((await callRoute(ruleRoute, authedRequest(u.coordinator, '/academic/api/v1/calendar-rules', { json: { batchId: w.batch.id, ...r } }))).status).toBe(201);
    await callRoute(exclusionRoute, authedRequest(u.coordinator, '/academic/api/v1/exclusions', { json: { batchId: w.batch.id, kind: 'holiday', label: 'Allowance (fictional)', periodStart: '2026-11-02', periodEnd: '2026-11-08', days: 1, slotsPerDay: 2, status: 'locked' } }));
    const none = await callRoute<{ result: { verdict: string; grossSlots: number; netSlots: number } }>(feasibilityRoute, authedRequest(u.coordinator, `/academic/api/v1/batches/${w.batch.id}/feasibility`), { id: w.batch.id });
    expect(none.data!.result).toMatchObject({ verdict: 'not_assessed', grossSlots: 11, netSlots: 9 });
    const plan = await createPlan(ctx.db, coord, { courseId: w.course.id, code: uniq('CAP-'), title: 'Cap plan', copyItems: false, countsStatus: 'locked', datesStatus: 'provisional' });
    await addPlanItems(ctx.db, coord, plan.id, { items: [{ chapterId: w.ch1.id, lessonCode: 'C1', sessionType: 'teaching', plannedClasses: 10 }] });
    await requestPlanStatusChange(ctx.db, coord, plan.id, { targetStatus: 'locked' });
    await decidePlanStatusChange(ctx.db, actor(u.coordinator2), plan.id, { decision: 'approved' });
    const res = await callRoute<{ result: { verdict: string; headroom: number; reasons: string[]; caveat: string } }>(feasibilityRoute, authedRequest(u.teacher, `/academic/api/v1/batches/${w.batch.id}/feasibility`), { id: w.batch.id });
    expect(res.data!.result).toMatchObject({ verdict: 'infeasible', headroom: -1 });
    expect(res.data!.result.caveat).toMatch(/do not prove/);
    expect((await callRoute(feasibilityRoute, authedRequest(u.marketing, `/academic/api/v1/batches/${w.batch.id}/feasibility`), { id: w.batch.id })).status).toBe(403);
  });
});
