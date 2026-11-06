/**
 * D-134 across both modules, on their real code: Business Ops approves a teacher's leave, its call
 * reaches Academic's real hr-leave route (fetch is wired to that handler and nothing else answers),
 * the teacher's classes in those dates need cover, and cancelling the leave clears them.
 * The platform app sits outside the module-import rule (see enrolment-handoff.test.ts). Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { notifications, programmes, staffMembers } from '@elevate/database';
import { addDays, type IsoDate, type RoleKey, type StaffMemberId } from '@elevate/shared-types';
import { authedRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  createAssignment,
  createBatch,
  createCourse,
  createSessions,
  createSubject,
  todayIst,
  uncoveredSessions,
} from '@elevate/academic-os/server';
import { applyForLeave, cancelLeaveApplication, decideLeave } from '@elevate/business-ops-os/server';
import { POST as hrLeaveRoute } from '../../../academic-os/src/app/api/internal/v1/teacher-unavailability/hr-leave/route';
import { POST as resendRoute } from '../../../business-ops-os/src/app/api/v1/attendance/leave/[id]/send-to-academic/route';

const ctx = setupTestDatabase();
let academicUp = true;
const HR_LEAVE = '/academic/api/internal/v1/teacher-unavailability/hr-leave';
const academic = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (!academicUp || url.pathname !== HR_LEAVE) throw new TypeError('fetch failed');
  return hrLeaveRoute(new Request(url, init), { params: Promise.resolve({}) });
});
const today = todayIst() as IsoDate;
const [from, to] = [addDays(today, 20), addDays(today, 21)];
let teacher: TestUser;
let coordinator: TestUser;
let opsManager: TestUser;

const withStaff = async (roles: RoleKey[], name: string) => {
  const user = await createTestUser(ctx.db, { roles, displayName: name });
  const [staff] = await ctx.db.insert(staffMembers).values({ userId: user.id, fullName: name }).returning();
  return { user, staffId: staff!.id as StaffMemberId };
};
const needCover = async () =>
  (await uncoveredSessions(ctx.db, { user: coordinator, requestId: 'test' }, { from: today, to: addDays(today, 30) })).map((s) => s.date);
const told = (kind: string) =>
  ctx.db.select().from(notifications).where(and(eq(notifications.kind, kind), eq(notifications.userId, coordinator.id)));

beforeAll(async () => {
  vi.stubGlobal('fetch', academic);
  await ctx.db.insert(programmes).values({ code: 'PLEAVE1', name: 'Sample programme (fictional)', status: 'active' });
  const t = await withStaff(['teacher'], 'Sample Leave Teacher (fictional)');
  teacher = t.user;
  coordinator = (await withStaff(['academic_coordinator'], 'Sample Coordinator (fictional)')).user;
  opsManager = (await withStaff(['operations_manager'], 'Sample Ops Manager (fictional)')).user;
  const coord = { user: coordinator, requestId: 'test' };
  const course = await createCourse(ctx.db, coord, { programmeCode: 'PLEAVE1', code: 'C-LEAVE', familyCode: 'F-LEAVE', version: 1, name: 'Sample course (fictional)', classMinutes: 75, classMinutesStatus: 'locked', status: 'active' });
  const subject = await createSubject(ctx.db, coord, course.id, { code: 'QUANT', name: 'Quant', sortOrder: 0 });
  const batch = await createBatch(ctx.db, coord, { code: 'B-LEAVE', name: 'Sample batch (fictional)', courseId: course.id, startDate: '2026-09-01', status: 'active' });
  await createAssignment(ctx.db, coord, { batchId: batch.id, subjectId: subject.id, staffMemberId: t.staffId });
  await createSessions(ctx.db, coord, [from, to, addDays(today, 23)].map((date) => ({ batchId: batch.id, subjectId: subject.id, teacherStaffId: t.staffId, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 })));
});
afterAll(() => vi.unstubAllGlobals());

describe('approved HR leave → Academic needs cover → cancelled → cleared', () => {
  it("runs through both modules' real code", async () => {
    expect(await needCover()).toEqual([]);
    const applied = await applyForLeave(ctx.db, teacher, { kind: 'Casual', fromDate: from, toDate: to, reason: 'Family function (fictional)' });
    const approved = await decideLeave(ctx.db, opsManager, applied.id, { decision: 'approved', version: applied.version });
    expect(academic).toHaveBeenCalledTimes(1);
    expect(await needCover()).toEqual([from, to]);
    const [flagged] = await told('leave.classes_flagged');
    expect(flagged!.title).toContain('2 classes need cover');
    expect(flagged!.body).toMatch(/Academic OS lists them/);

    await cancelLeaveApplication(ctx.db, opsManager, applied.id, { reason: 'Plans changed (fictional)', version: approved.version });
    expect(await needCover()).toEqual([]);
    expect((await told('leave.classes_unflagged'))[0]!.body).toMatch(/no longer need cover/);
  });

  it('a cancel that never reached Academic: Send to Academic again clears the cover (REV-4 P1)', async () => {
    const applied = await applyForLeave(ctx.db, teacher, { kind: 'Casual', fromDate: from, toDate: to, reason: 'Family visit (fictional)' });
    const approved = await decideLeave(ctx.db, opsManager, applied.id, { decision: 'approved', version: applied.version });
    expect(await needCover()).toEqual([from, to]);
    academicUp = false;
    await cancelLeaveApplication(ctx.db, opsManager, applied.id, { reason: 'Plans changed (fictional)', version: approved.version });
    academicUp = true;
    expect(await needCover()).toEqual([from, to]);
    const [check] = await told('leave.classes_check');
    expect(check!.body).toMatch(/Send to Academic again/);
    const id = approved.leaveRecordId!;
    const again = await callRoute(resendRoute, authedRequest(opsManager, `/ops/api/v1/attendance/leave/${id}/send-to-academic`, { method: 'POST' }), { id });
    expect(again.data).toEqual({ recordId: expect.any(String), active: false, classes: 2 });
    expect(await needCover()).toEqual([]);
  });
});
