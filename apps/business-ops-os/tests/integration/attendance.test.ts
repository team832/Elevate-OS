/**
 * Staff attendance under HR (owner brief 23 Oct 2026 §12, §14, scenario 10): own scope by session,
 * HR department scope, manual punches, nobody recording their own attendance, HR decisions that
 * survive recomputation, holidays and leave, and attendance kept apart from class delivery.
 * Corrections, imports and HR Overview figures: attendance-corrections.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, departments, opsHolidays, staffMembers } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as listRoute } from '../../src/app/api/v1/attendance/route';
import { POST as punchRoute } from '../../src/app/api/v1/attendance/punches/route';
import { POST as decisionRoute } from '../../src/app/api/v1/attendance/decisions/route';
import { POST as scheduleRoute } from '../../src/app/api/v1/attendance/schedules/route';
import { POST as assignRoute } from '../../src/app/api/v1/attendance/schedule-assignments/route';
import { POST as holidayRoute } from '../../src/app/api/v1/attendance/holidays/route';
import { POST as leaveRoute } from '../../src/app/api/v1/attendance/leave/route';
import { POST as cancelLeaveRoute } from '../../src/app/api/v1/attendance/leave/[id]/route';
import { POST as holidayDecisionRoute } from '../../src/app/api/v1/attendance/holidays/[id]/route';
import { GET as correctionsList } from '../../src/app/api/v1/attendance/corrections/route';
import { attendanceSummary } from '../../src/server/attendance-hr';
import { stubAcademic } from './academic-stub';
import { at, attendanceWorld, D1, D2, D3, get, PATTERN, post } from './attendance-fixture';
import { staffUser } from './fixtures';

const ctx = setupTestDatabase();

let w: Awaited<ReturnType<typeof attendanceWorld>>;
beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
});

afterEach(() => vi.unstubAllGlobals());

describe('access', () => {
  it('401 signed out, 403 without attendance access, 400 for a bad date', async () => {
    expect((await callRoute(listRoute, buildRequest('/ops/api/v1/attendance'))).status).toBe(401);
    expect((await get(w.outsider)).status).toBe(403);
    expect((await get(w.hr, '?from=yesterday')).status).toBe(400);
    const p = await post(punchRoute, w.teacher, '/punches', {
      staffId: w.teacher.staffId,
      at: at(D1, '09:00'),
      direction: 'in',
    });
    expect(p.status).toBe(403); // staff cannot enter punches
  });

  it("a w.teacher sees only their own days; another teacher's id in the URL → 404", async () => {
    const mine = await get(w.teacher, `?from=${D1}&to=${D3}`);
    expect(mine.status).toBe(200);
    expect(new Set(mine.data!.items.map((r) => r.staff.id))).toEqual(new Set([w.teacher.staffId]));
    expect((await get(w.teacher, `?staffId=${w.teacher2.staffId}`)).status).toBe(404);
    const theirs = await callRoute(
      correctionsList,
      authedRequest(
        w.teacher,
        `/academic/api/v1/attendance/corrections?staffId=${w.teacher2.staffId}`,
      ),
    );
    expect(theirs.status).toBe(404);
  });

  it("staff outside HR's department scope are invisible to HR (404)", async () => {
    expect((await get(w.hr, `?staffId=${w.finance.staffId}`)).status).toBe(404);
    const list = await get(w.hr, `?from=${D1}&to=${D1}`);
    expect(list.data!.items.map((r) => r.staff.id)).not.toContain(w.finance.staffId);
    const punch = await post(punchRoute, w.hr, '/punches', {
      staffId: w.finance.staffId,
      at: at(D1, '09:00'),
      direction: 'in',
    });
    expect(punch.status).toBe(404);
  });

  it('the department scope binds HR-only managers, never others and never your own record', async () => {
    // Operations managers (and directors, auditors) see everyone.
    expect((await get(w.opsMgr, `?staffId=${w.finance.staffId}`)).status).toBe(200);
    // An HR-only manager in Human Resources (outside the scope) still sees their own days.
    const hr3 = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR officer' });
    const [hrDept] = await ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, 'HUMAN_RESOURCES'));
    await ctx.db
      .update(staffMembers)
      .set({ departmentId: hrDept!.id })
      .where(eq(staffMembers.id, hr3.staffId));
    expect((await get(hr3, `?staffId=${hr3.staffId}`)).status).toBe(200);
    const mine = await callRoute(
      correctionsList,
      authedRequest(hr3, `/ops/api/v1/attendance/corrections?staffId=${hr3.staffId}`),
    );
    expect(mine.status).toBe(200);
    expect((await get(hr3, `?staffId=${w.finance.staffId}`)).status).toBe(404);
  });

  it('no data is unmarked, never absent', async () => {
    const d = await w.day(w.teacher2.staffId, D1);
    expect(d).toMatchObject({ status: 'unmarked', basis: 'computed', reasons: ['unmarked'] });
  });
});

describe('punches and HR decisions', () => {
  it('records a manual punch once (a duplicate → 409) and audits it', async () => {
    const json = { staffId: w.teacher.staffId, at: at(D1, '09:25'), direction: 'in' };
    const first = await post(punchRoute, w.hr, '/punches', json);
    expect(first.status).toBe(201);
    expect((await post(punchRoute, w.hr, '/punches', json)).status).toBe(409);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, first.data!.id));
    expect(audit.map((a) => a.action)).toEqual(['attendance.punch_recorded']);
    await post(punchRoute, w.hr, '/punches', { ...json, at: at(D1, '17:30'), direction: 'out' });
    expect(await w.day(w.teacher.staffId, D1)).toMatchObject({
      status: 'present',
      lateMinutes: 25,
    });
  });

  it('an HR decision survives recomputation; nobody decides their own day', async () => {
    const decided = await post(decisionRoute, w.hr, '/decisions', {
      staffId: w.teacher2.staffId,
      workDate: D2,
      status: 'absent',
      note: 'Confirmed by phone with the employee',
    });
    expect(decided.status).toBe(200);
    // New raw data arrives later: the decision still stands.
    await post(punchRoute, w.hr, '/punches', {
      staffId: w.teacher2.staffId,
      at: at(D2, '09:00'),
      direction: 'in',
    });
    await post(punchRoute, w.hr, '/punches', {
      staffId: w.teacher2.staffId,
      at: at(D2, '17:00'),
      direction: 'out',
    });
    expect(await w.day(w.teacher2.staffId, D2)).toMatchObject({
      status: 'absent',
      basis: 'hr_decision',
    });
    const own = await post(decisionRoute, w.hr, '/decisions', {
      staffId: w.hr.staffId,
      workDate: D2,
      status: 'present',
      note: 'My own day',
    });
    expect(own.status).toBe(403);
  });

  it('nobody records their own attendance: punch, leave, schedule, decision → 403', async () => {
    const mine = { staffId: w.hr.staffId };
    const tries = [
      post(punchRoute, w.hr, '/punches', { ...mine, at: at(D1, '09:00'), direction: 'in' }),
      post(leaveRoute, w.hr, '/leave', { ...mine, fromDate: D1, toDate: D1, kind: 'Sample leave' }),
      post(assignRoute, w.hr, '/schedule-assignments', { ...mine, scheduleId: null }),
      post(decisionRoute, w.hr, '/decisions', {
        ...mine,
        workDate: D1,
        status: 'present',
        note: 'Mine',
      }),
    ];
    for (const t of await Promise.all(tries)) expect(t.status).toBe(403);
  });

  it('a past day with a check-in and no check-out is unmarked for review, not present', async () => {
    await post(punchRoute, w.hr, '/punches', {
      staffId: w.office.staffId,
      at: at(D2, '09:00'),
      direction: 'in',
    });
    expect(await w.day(w.office.staffId, D2)).toMatchObject({
      status: 'unmarked',
      reasons: ['missing_checkout'],
    });
    expect(await attendanceSummary(ctx.db, w.office.staffId, D2, D2)).toMatchObject({
      present: 0,
      unmarked: 1,
    });
  });

  it('the chart counts every status even when the table is filtered', async () => {
    const list = await get(w.hr, `?from=${D1}&to=${D1}&status=present`);
    expect(list.data!.items.every((r) => r.status === 'present')).toBe(true);
    expect(list.data!.byDate[0]!.counts.unmarked).toBeGreaterThan(0);
  });

  it('only an approved holiday changes the day; holidays can be approved and removed', async () => {
    const added = await post(holidayRoute, w.hr, '/holidays', {
      holidayOn: D3,
      name: 'Sample holiday',
    });
    expect(added.status).toBe(201);
    expect(
      (await post(holidayRoute, w.hr, '/holidays', { holidayOn: D3, name: 'Again' })).status,
    ).toBe(409);
    expect(await w.day(w.teacher2.staffId, D3)).toMatchObject({
      status: 'unmarked',
      proposedHoliday: true,
    });
    const decide = (u: TestUser, action: string, id = added.data!.id) =>
      post(holidayDecisionRoute, u, `/holidays/${id}`, { action }, { id });
    expect((await decide(w.teacher, 'approve')).status).toBe(403);
    expect((await decide(w.hr, 'approve')).status).toBe(200);
    expect(await w.day(w.teacher2.staffId, D3)).toMatchObject({ status: 'holiday', reasons: [] });
    const extra = await post(holidayRoute, w.hr, '/holidays', {
      holidayOn: D2,
      name: 'Sample mistake',
    });
    expect((await decide(w.hr, 'remove', extra.data!.id)).status).toBe(200);
    expect(await w.day(w.teacher.staffId, D2)).toMatchObject({ proposedHoliday: false });
    const [locked] = await ctx.db
      .insert(opsHolidays)
      .values({
        holidayOn: '2026-01-26',
        name: 'Sample locked holiday',
        decisionState: 'locked',
        createdBy: w.hr.id,
      })
      .returning();
    for (const action of ['approve', 'remove'])
      expect((await decide(w.hr, action, locked!.id)).status).toBe(409);
    const [still] = await ctx.db.select().from(opsHolidays).where(eq(opsHolidays.id, locked!.id));
    expect(still?.decisionState).toBe('locked');
  });

  it('leave is entered by HR and can be cancelled with a reason (not your own)', async () => {
    const leave = await post(leaveRoute, w.hr, '/leave', {
      staffId: w.hr2.staffId,
      fromDate: D1,
      toDate: D2,
      kind: 'Sample casual leave',
    });
    expect(leave.status).toBe(201);
    expect(await w.day(w.hr2.staffId, D1)).toMatchObject({ status: 'on_leave' });
    const id = leave.data!.id;
    const cancel = (u: TestUser, json: unknown) =>
      post(cancelLeaveRoute, u, `/leave/${id}`, json, { id });
    expect((await cancel(w.hr2, { reason: 'My own leave' })).status).toBe(403);
    expect((await cancel(w.hr, {})).status).toBe(400);
    expect((await cancel(w.hr, { reason: 'Came to work after all' })).status).toBe(200);
    expect((await cancel(w.hr, { reason: 'Again' })).status).toBe(409);
    expect(await w.day(w.hr2.staffId, D1)).toMatchObject({ status: 'unmarked' });
    const [audit] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audit).toBeDefined();
  });

  it('assignSchedule: a weekly-off-only schedule makes the day weekly off', async () => {
    const off = await post(scheduleRoute, w.hr, '/schedules', {
      name: 'Sample no working days',
      weeklyPattern: Object.fromEntries(Object.keys(PATTERN).map((d) => [d, null])),
    });
    const assigned = await post(assignRoute, w.hr, '/schedule-assignments', {
      staffId: w.office.staffId,
      scheduleId: off.data!.id,
    });
    expect(assigned.status).toBe(200);
    expect(await w.day(w.office.staffId, D1)).toMatchObject({ status: 'weekly_off' });
  });
});

describe('scenario 10: teacher attendance is independent of class delivery', () => {
  it('present with zero delivered classes; a missing teaching log does not make anyone absent', async () => {
    const academic = stubAcademic({
      activity: {
        contract: 'academic.teacher_activity',
        version: 1,
        sessions: { planned: { status: 'ok', value: 3 }, delivered: { status: 'ok', value: 0 } },
        logsPending: { status: 'ok', value: 3 },
      },
    });
    const list = await get(w.hr, `?from=${D1}&to=${D1}`);
    const byStaff = new Map(list.data!.items.map((r) => [r.staff.id, r.status]));
    expect(byStaff.get(w.teacher.staffId)).toBe('present'); // punched in and out; 0 classes delivered
    expect(byStaff.get(w.teacher2.staffId)).toBe('unmarked'); // no punches: unmarked, not absent
    expect(academic).not.toHaveBeenCalled(); // attendance never reads teaching data
    expect(await attendanceSummary(ctx.db, w.teacher.staffId, D1, D1)).toMatchObject({
      present: 1,
      confirmedAbsences: 0,
    });
  });
});
