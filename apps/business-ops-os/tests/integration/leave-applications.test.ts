/**
 * Leave applications through the real routes (owner decision 31 Oct 2026): own scope, who decides,
 * overlap, the leave record and attendance, cancelling, notices with links that open, stale edits,
 * HR's staff scope and a login with no staff record.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import { auditEvents, notifications, opsLeaveApplications, opsLeaveRecords } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { addDays, istToday } from '../../src/domain/dates';
import { POST as recordRoute } from '../../src/app/api/v1/attendance/leave/route';
import { POST as cancelRecordRoute } from '../../src/app/api/v1/attendance/leave/[id]/route';
import { POST as cancelRoute } from '../../src/app/api/v1/attendance/leave-applications/[id]/cancel/route';
import { POST as decideRoute } from '../../src/app/api/v1/attendance/leave-applications/[id]/route';
import { GET as listRoute, POST as applyRoute } from '../../src/app/api/v1/attendance/leave-applications/route';
import { hrAttendanceCounts } from '../../src/server/attendance-hr';
import { attendanceSetup } from '../../src/server/attendance-lists';
import { updateHrSetting } from '../../src/server/hr-settings';
import { openNotification } from '../../src/server/notification-open';
import { workRoutes } from '../../src/work';
import { attendanceWorld, D1, D2, D3 } from './attendance-fixture';
import { staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const LEAVE = 'api/v1/attendance/leave-applications';
const today = istToday(new Date());
const home = (u: TestUser) =>
  u.roles.includes('teacher')
    ? '/academic'
    : u.roles.includes('marketing_contributor')
      ? '/marketing'
      : '/ops';

type Row = {
  id: string;
  staffId: string;
  status: string;
  version: number;
  decisionNote: string | null;
  leaveRecordId: string | null;
  cancelReason: string | null;
};
type List = {
  items: (Row & { staffName: string })[];
  total: number;
  counts: Record<'pending' | 'approved' | 'rejected' | 'cancelled', number>;
};

const apply = (u: TestUser, json: unknown, base = home(u)) =>
  callRoute<Row>(applyRoute, authedRequest(u, `${base}/${LEAVE}`, { method: 'POST', json }));
const list = (u: TestUser, query = '') =>
  callRoute<List>(listRoute, authedRequest(u, `${home(u)}/${LEAVE}${query}`));
const decide = (u: TestUser, id: string, json: unknown) =>
  callRoute<Row>(decideRoute, authedRequest(u, `/ops/${LEAVE}/${id}`, { method: 'POST', json }), {
    id,
  });
const cancel = (u: TestUser, id: string, json: unknown) =>
  callRoute<Row>(
    cancelRoute,
    authedRequest(u, `${home(u)}/${LEAVE}/${id}/cancel`, { method: 'POST', json }),
    { id },
  );

/** Unused dates, so no test trips over another's overlap. */
let next = 5;
const days = (length = 0) => {
  const fromDate = addDays(today, next);
  next += length + 2;
  return { fromDate, toDate: addDays(fromDate, length) };
};
const form = (o: Record<string, unknown> = {}) => ({
  kind: 'Casual',
  reason: 'Family function',
  ...days(),
  ...o,
});
const approve = (u: TestUser, r: Row) => decide(u, r.id, { decision: 'approved', version: r.version });
/** An application waiting for a decision. */
const pending = async (u: TestUser, o: Record<string, unknown> = {}) => {
  const r = await apply(u, form(o));
  expect(r.status).toBe(201);
  return r.data!;
};
const approved = async (u: TestUser, by: TestUser, o: Record<string, unknown> = {}) => {
  const r = await approve(by, await pending(u, o));
  expect(r.status).toBe(200);
  return r.data!;
};
const row = async (id: string) =>
  (await ctx.db.select().from(opsLeaveApplications).where(eq(opsLeaveApplications.id, id)))[0]!;
const notices = (kind: string) =>
  ctx.db.select().from(notifications).where(eq(notifications.kind, kind));

let w: Awaited<ReturnType<typeof attendanceWorld>>;
let marketing: StaffUser;
let director: StaffUser;
let auditor: StaffUser;
let coordinator: StaffUser;
let noStaff: TestUser;

beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
  marketing = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director' });
  auditor = await staffUser(ctx.db, ['auditor'], { name: 'Sample Auditor' });
  coordinator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
  noStaff = await createTestUser(ctx.db, { roles: ['teacher'], displayName: 'Sample No Record' });
});

// Academic OS is not running in these tests: the class check reads "could not be reached".
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('applying', () => {
  it('401 signed out', async () => {
    const r = await callRoute(applyRoute, buildRequest(`/ops/${LEAVE}`, { method: 'POST', json: form() }));
    expect(r.status).toBe(401);
  });

  it.each([
    ['no reason', { reason: undefined }],
    ['a blank reason', { reason: '   ' }],
    ['a reason too short to mean anything', { reason: 'x' }],
    ['the last day before the first', { fromDate: addDays(today, 500), toDate: addDays(today, 499) }],
    ['not a date', { fromDate: 'soon' }],
    ['a type not in the setting', { kind: 'Sabbatical' }],
    ['a mistyped year', { fromDate: addDays(today, 3650), toDate: addDays(today, 3650) }],
    ["someone else's name on it", { staffId: '00000000-0000-4000-8000-000000000001' }],
  ])('400 for %s', async (_label, change) => {
    expect((await apply(w.teacher, form(change))).status).toBe(400);
  });

  it('each person applies in their own workspace; nobody names someone else', async () => {
    for (const u of [w.teacher, marketing, w.office, w.finance, w.hr, w.opsMgr, director]) {
      const mine = await pending(u);
      expect(mine).toMatchObject({ staffId: u.staffId, status: 'pending', version: 1 });
    }
  });

  it.each([
    ['a teacher through Ops', () => w.teacher, '/ops'],
    ['a marketer through Academic', () => marketing, '/academic'],
    ['finance through Marketing', () => w.finance, '/marketing'],
  ])('403 for %s', async (_label, who, base) => {
    expect((await apply(who(), form(), base)).status).toBe(403);
  });

  it('an auditor reads only, so cannot apply', async () => {
    expect((await apply(auditor, form())).status).toBe(403);
  });

  it('past-dated sick leave is accepted', async () => {
    const r = await apply(w.teacher2, form({ kind: 'Sick', fromDate: D1, toDate: D1 }));
    expect(r.status).toBe(201);
    await decide(w.hr, r.data!.id, { decision: 'rejected', note: 'Clearing the day', version: 1 });
  });

  it('a login with no staff record gets a plain message, and an empty list', async () => {
    const r = await apply(noStaff, form());
    expect(r.status).toBe(400);
    expect(r.error!.message).toMatch(/not linked to a staff record/);
    expect((await list(noStaff)).data).toMatchObject({ items: [], total: 0 });
  });
});

describe('overlapping dates', () => {
  it.each([
    ['the same days', 0, 4],
    ['days inside', 1, 2],
    ['over the first day', -2, 0],
    ['over the last day', 4, 6],
    ['all around', -1, 5],
  ])('%s are refused while pending and once approved', async (_label, start, end) => {
    const { fromDate } = days(10);
    const base = addDays(fromDate, 3);
    const first = await pending(w.teacher2, { fromDate: base, toDate: addDays(base, 4) });
    const clash = { fromDate: addDays(base, start), toDate: addDays(base, end) };
    const refused = await apply(w.teacher2, form(clash));
    expect(refused.status).toBe(409);
    expect(refused.error!.message).toMatch(/already have/);
    expect((await approve(w.hr, first)).status).toBe(200);
    expect((await apply(w.teacher2, form(clash))).status).toBe(409);
  });

  it('the days either side, another person, and rejected or cancelled dates stay free', async () => {
    const { fromDate } = days(20);
    const base = addDays(fromDate, 5);
    const one = { fromDate: base, toDate: base };
    await pending(w.teacher2, one);
    for (const d of [addDays(base, -1), addDays(base, 1)])
      expect((await apply(w.teacher2, form({ fromDate: d, toDate: d }))).status).toBe(201);
    expect((await apply(w.teacher, form(one))).status).toBe(201);

    const free = days();
    const rejected = await pending(w.teacher2, free);
    await decide(w.hr, rejected.id, { decision: 'rejected', note: 'Exam week', version: 1 });
    const again = await pending(w.teacher2, free);
    expect((await cancel(w.teacher2, again.id, { version: 1 })).status).toBe(200);
    expect((await apply(w.teacher2, form(free))).status).toBe(201);
  });

  it('two applications at the same moment make one', async () => {
    const same = form();
    const results = await Promise.all([apply(w.office, same), apply(w.office, same)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

describe('own scope', () => {
  it("A cannot read or cancel B's", async () => {
    const b = await pending(w.teacher);
    expect((await list(w.teacher2, `?staffId=${w.teacher.staffId}`)).status).toBe(404);
    const mine = (await list(w.teacher2)).data!;
    expect(mine.items.every((i) => i.staffId === w.teacher2.staffId)).toBe(true);
    expect(mine.items.map((i) => i.id)).not.toContain(b.id);
    expect((await cancel(w.teacher2, b.id, { version: 1 })).status).toBe(404);
    expect((await row(b.id)).status).toBe('pending');
  });

  it.each([
    ['a teacher', () => w.teacher2],
    ['a director', () => director],
    ['an auditor', () => auditor],
    ['a counsellor', () => w.office],
  ])('%s cannot decide (403)', async (_label, who) => {
    const a = await pending(w.teacher);
    expect((await approve(who(), a)).status).toBe(403);
    expect((await row(a.id)).status).toBe('pending');
  });

  it('a platform administrator has no way in', async () => {
    expect((await list(w.outsider)).status).toBe(403);
    expect((await apply(w.outsider, form())).status).toBe(403);
  });
});

describe('HR scope', () => {
  it('HR-only managers neither see nor decide staff outside their departments; an operations manager does', async () => {
    const a = await pending(w.finance);
    const hrList = await list(w.hr, `?staffId=${w.finance.staffId}`);
    expect(hrList.data).toMatchObject({ items: [], total: 0 });
    expect((await list(w.hr)).data!.items.map((i) => i.id)).not.toContain(a.id);
    expect((await approve(w.hr, a)).status).toBe(404);
    expect((await list(w.opsMgr, `?staffId=${w.finance.staffId}`)).data!.total).toBeGreaterThan(0);
    expect((await approve(w.opsMgr, a)).status).toBe(200);
    expect((await approve(w.hr, a)).status).toBe(404); // scope before status: no leak
  });
});

describe('deciding', () => {
  it('nobody decides their own application', async () => {
    const own = await pending(w.hr2);
    expect((await approve(w.hr2, own)).status).toBe(403);
    expect((await decide(w.hr2, own.id, { decision: 'rejected', note: 'No thanks', version: 1 })).status).toBe(403);
    expect((await row(own.id)).status).toBe('pending');
    expect((await approve(w.hr, own)).status).toBe(200);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { note: '   ' }],
    ['too short a reason', { note: 'x' }],
  ])('rejecting with %s is refused', async (_label, note) => {
    const a = await pending(w.teacher);
    expect((await decide(w.hr, a.id, { decision: 'rejected', version: 1, ...note })).status).toBe(400);
    expect((await row(a.id)).status).toBe('pending');
  });

  it('rejecting keeps the reason and writes no leave', async () => {
    const a = await pending(w.teacher);
    const before = await ctx.db.select().from(opsLeaveRecords);
    const r = await decide(w.hr, a.id, { decision: 'rejected', note: 'Exam week', version: 1 });
    expect(r.data).toMatchObject({ status: 'rejected', decisionNote: 'Exam week', leaveRecordId: null, version: 2 });
    expect(await ctx.db.select().from(opsLeaveRecords)).toHaveLength(before.length);
  });

  it('approving writes the leave record and attendance shows it; cancelling removes it', async () => {
    expect((await w.day(w.office.staffId, D3)).status).toBe('unmarked');
    const a = await approved(w.office, w.hr, { fromDate: D3, toDate: D3, kind: 'Sick' });
    expect(a).toMatchObject({ status: 'approved', version: 2 });
    const [record] = await ctx.db
      .select()
      .from(opsLeaveRecords)
      .where(eq(opsLeaveRecords.id, a.leaveRecordId!));
    expect(record).toMatchObject({
      staffId: w.office.staffId,
      fromDate: D3,
      toDate: D3,
      kind: 'Sick',
      status: 'approved',
      approvedBy: w.hr.id,
    });
    expect((await w.day(w.office.staffId, D3)).status).toBe('on_leave');
    const c = await cancel(w.hr, a.id, { reason: 'Came in after all', version: a.version });
    expect(c.status).toBe(200);
    expect(c.data).toMatchObject({ status: 'cancelled', cancelReason: 'Came in after all', version: 3 });
    expect((await w.day(w.office.staffId, D3)).status).toBe('unmarked');
  });

  it('a stale decision is refused and nothing changes', async () => {
    const a = await pending(w.teacher);
    const r = await decide(w.hr, a.id, { decision: 'approved', version: a.version + 1 });
    expect(r.status).toBe(409);
    expect(r.error!.message).toMatch(/changed/);
    expect((await row(a.id)).status).toBe('pending');
  });

  it('a second decision is refused', async () => {
    const a = await approved(w.teacher, w.hr);
    expect((await decide(w.hr2, a.id, { decision: 'rejected', note: 'Too late', version: 2 })).status).toBe(409);
  });

  it('an unknown id answers 404, a bad one 400', async () => {
    expect((await decide(w.hr, '00000000-0000-4000-8000-000000000009', { decision: 'approved', version: 1 })).status).toBe(404);
    expect((await decide(w.hr, 'nope', { decision: 'approved', version: 1 })).status).toBe(400);
  });

  it('the setting hr.leave_approver decides who may approve, and who is told', async () => {
    const set = (who: string[]) =>
      updateHrSetting(ctx.db, w.opsMgr, { key: 'hr.leave_approver', value: { who } });
    await set(['operations_manager']);
    const a = await pending(w.teacher);
    expect((await approve(w.hr, a)).status).toBe(403);
    const told = (await notices('leave.applied')).filter((n) => n.entityId === a.id);
    expect(told.map((n) => n.userId)).toEqual([w.opsMgr.id]);
    await set(['hr_manager', 'operations_manager']);
    expect((await approve(w.hr, a)).status).toBe(200);
  });

  it('the setting hr.leave_types decides the types offered', async () => {
    const set = (types: string[]) =>
      updateHrSetting(ctx.db, w.opsMgr, { key: 'hr.leave_types', value: { types } });
    await set(['Casual', 'Study']);
    expect((await apply(w.teacher, form({ kind: 'Study' }))).status).toBe(201);
    expect((await apply(w.teacher, form({ kind: 'Sick' }))).status).toBe(400);
    await set(['Casual', 'Sick', 'Earned', 'Unpaid']);
  });
});

describe('cancelling', () => {
  it('the applicant may cancel while pending, no reason needed', async () => {
    const a = await pending(w.teacher);
    const r = await cancel(w.teacher, a.id, { version: 1 });
    expect(r.data).toMatchObject({ status: 'cancelled', version: 2, leaveRecordId: null });
    expect((await cancel(w.teacher, a.id, { version: 2 })).status).toBe(409);
  });

  it('a stale cancel is refused', async () => {
    const a = await pending(w.teacher);
    expect((await cancel(w.teacher, a.id, { version: 5 })).status).toBe(409);
    expect((await row(a.id)).status).toBe('pending');
  });

  it('HR rejects a pending application; it does not cancel it', async () => {
    const a = await pending(w.teacher);
    expect((await cancel(w.hr, a.id, { reason: 'Not needed', version: 1 })).status).toBe(409);
  });

  it('approved leave: the applicant is refused, HR needs a reason, HR cannot cancel their own', async () => {
    const a = await approved(w.teacher, w.hr);
    const refused = await cancel(w.teacher, a.id, { version: a.version, reason: 'Plans changed' });
    expect(refused.status).toBe(403);
    expect(refused.error!.message).toMatch(/Ask HR/);
    expect((await cancel(w.hr, a.id, { version: a.version })).status).toBe(400);
    expect((await cancel(w.hr, a.id, { version: a.version, reason: ' x ' })).status).toBe(400);
    const own = await approved(w.hr2, w.hr);
    expect((await cancel(w.hr2, own.id, { version: own.version, reason: 'Plans changed' })).status).toBe(403);
    const ok = await cancel(w.hr, a.id, { version: a.version, reason: 'Plans changed' });
    expect(ok.data).toMatchObject({ status: 'cancelled', cancelReason: 'Plans changed' });
    expect((await row(a.id)).leaveRecordId).toBe(a.leaveRecordId);
    const [record] = await ctx.db
      .select()
      .from(opsLeaveRecords)
      .where(eq(opsLeaveRecords.id, a.leaveRecordId!));
    expect(record!.status).toBe('cancelled');
  });

  it.each([
    ['the application', (r: Row) => cancel(w.opsMgr, r.id, { version: r.version, reason: 'Plans changed' })],
    ['its leave record directly', (r: Row) =>
      callRoute(
        cancelRecordRoute,
        authedRequest(w.opsMgr, `/ops/api/v1/attendance/leave/${r.leaveRecordId}`, {
          method: 'POST',
          json: { reason: 'Plans changed' },
        }),
        { id: r.leaveRecordId! },
      )],
  ])('hr.leave_approver also governs cancelling through %s', async (_label, cancelIt) => {
    const a = await approved(w.teacher, w.hr);
    const set = (who: string[]) =>
      updateHrSetting(ctx.db, w.opsMgr, { key: 'hr.leave_approver', value: { who } });
    await set(['hr_manager']);
    try {
      expect((await cancelIt(a)).status).toBe(403);
      expect(await row(a.id)).toMatchObject({ status: 'approved', version: a.version });
      const [record] = await ctx.db
        .select()
        .from(opsLeaveRecords)
        .where(eq(opsLeaveRecords.id, a.leaveRecordId!));
      expect(record!.status).toBe('approved');
    } finally {
      await set(['hr_manager', 'operations_manager']);
    }
    expect((await cancelIt(a)).status).toBe(200);
  });

  it('leave HR recorded directly, with no application, stays outside that setting', async () => {
    const r = await callRoute<{ id: string }>(
      recordRoute,
      authedRequest(w.opsMgr, '/ops/api/v1/attendance/leave', {
        method: 'POST',
        json: { staffId: w.finance.staffId, kind: 'Casual', ...days() },
      }),
    );
    expect(r.status).toBe(201);
    await updateHrSetting(ctx.db, w.opsMgr, { key: 'hr.leave_approver', value: { who: ['hr_manager'] } });
    try {
      const cancelled = await callRoute(
        cancelRecordRoute,
        authedRequest(w.opsMgr, `/ops/api/v1/attendance/leave/${r.data!.id}`, {
          method: 'POST',
          json: { reason: 'Recorded in error' },
        }),
        { id: r.data!.id },
      );
      expect(cancelled.status).toBe(200);
    } finally {
      await updateHrSetting(ctx.db, w.opsMgr, {
        key: 'hr.leave_approver',
        value: { who: ['hr_manager', 'operations_manager'] },
      });
    }
  });

  it('cancelling the leave record directly closes its application and tells the applicant', async () => {
    const a = await approved(w.teacher, w.hr);
    const id = a.leaveRecordId!;
    const r = await callRoute(
      cancelRecordRoute,
      authedRequest(w.hr, `/ops/api/v1/attendance/leave/${id}`, {
        method: 'POST',
        json: { reason: 'Recorded in error' },
      }),
      { id },
    );
    expect(r.status).toBe(200);
    expect(await row(a.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Recorded in error',
      cancelledBy: w.hr.id,
      version: 3,
    });
    const told = (await notices('leave.cancelled')).filter((n) => n.entityId === a.id);
    expect(told.map((n) => n.userId)).toEqual([w.teacher.id]);
    expect(told[0]!.link).toBe('/academic/my-attendance?view=leave');
  });
});

describe('notices', () => {
  it('a new application reaches only people who can decide it, with a link that opens', async () => {
    const a = await pending(w.teacher);
    const told = (await notices('leave.applied')).filter((n) => n.entityId === a.id);
    expect(told.map((n) => n.userId).sort()).toEqual([w.hr.id, w.hr2.id, w.opsMgr.id].sort());
    for (const n of told) {
      expect(n.link).toBe('/ops/hr/attendance?tab=leave');
      expect(n.title).toContain('Sample Teacher One');
      expect(`${n.title} ${n.body ?? ''}`).not.toContain('Family function');
    }
    for (const u of [w.hr, w.hr2, w.opsMgr]) {
      const n = told.find((x) => x.userId === u.id)!;
      expect(await openNotification(ctx.db, u, n.id)).toEqual({ href: n.link });
    }
  });

  it('an application from outside HR scope reaches only the operations manager; your own never reaches you', async () => {
    const a = await pending(w.finance);
    const told = (await notices('leave.applied')).filter((n) => n.entityId === a.id);
    expect(told.map((n) => n.userId)).toEqual([w.opsMgr.id]);
    const own = await pending(w.hr);
    const toldOwn = (await notices('leave.applied')).filter((n) => n.entityId === own.id);
    expect(toldOwn.map((n) => n.userId).sort()).toEqual([w.hr2.id, w.opsMgr.id].sort());
  });

  it.each([
    ['approved', () => w.teacher, '/academic/my-attendance?view=leave', () => ({ decision: 'approved' })],
    ['approved', () => marketing, '/marketing/my-attendance?view=leave', () => ({ decision: 'approved' })],
    ['approved', () => w.office, '/ops/my-attendance?view=leave', () => ({ decision: 'approved' })],
    ['rejected', () => w.teacher, '/academic/my-attendance?view=leave', () => ({ decision: 'rejected', note: 'Exam week' })],
  ])('%s: back to the applicant in their own workspace (%#)', async (kind, who, link, body) => {
    const a = await pending(who());
    expect((await decide(w.opsMgr, a.id, { ...body(), version: 1 })).status).toBe(200);
    const told = (await notices(`leave.${kind}`)).filter((n) => n.entityId === a.id);
    expect(told.map((n) => n.userId)).toEqual([who().id]);
    expect(told[0]!.link).toBe(link);
    expect(await openNotification(ctx.db, who(), told[0]!.id)).toEqual({ href: link });
    if (kind === 'rejected') expect(told[0]!.body).toBe('Exam week');
  });
});

describe("a teacher's classes (flag only)", () => {
  const activity = (planned: number | null, reason = 'No teaching assignments') =>
    vi.fn(async (url: string) =>
      Response.json({
        data: {
          contract: 'academic.teacher_activity',
          version: 1,
          generatedAt: new Date().toISOString(),
          staffId: new URL(url).pathname.split('/').at(-2),
          window: { from: today, to: today },
          assignments: [],
          sessions: Object.fromEntries(
            ['planned', 'delivered', 'cancelled', 'substituted'].map((k) => [
              k,
              planned === null
                ? { status: 'missing', value: null, reason, definition: 'Sample', window: { from: today, to: today }, unit: 'count' }
                : { status: 'ok', value: k === 'planned' ? planned : 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
            ]),
          ),
          logsPending: { status: 'ok', value: 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
          attendancePending: { status: 'ok', value: 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
          markingPending: { status: 'ok', value: 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
          reviews: {
            submitted: { status: 'ok', value: 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
            draft: { status: 'ok', value: 0, definition: 'Sample', window: { from: today, to: today }, unit: 'count' },
          },
          unavailability: [],
        },
      }),
    );
  const flags = async (id: string) =>
    (await notices('leave.classes_flagged')).filter((n) => n.entityId === id);

  it('classes in those dates: the coordinator is told how many; nothing about why, nothing reassigned', async () => {
    const fetch = activity(3);
    vi.stubGlobal('fetch', fetch);
    const a = await approved(w.teacher, w.hr, { kind: 'Sick', reason: 'Private medical reason' });
    expect(String(fetch.mock.calls[0]![0])).toContain(`/teachers/${w.teacher.staffId}/activity?from=`);
    const [n, ...rest] = await flags(a.id);
    expect(rest).toEqual([]);
    expect(n!.userId).toBe(coordinator.id);
    expect(n!.title).toContain('3 classes');
    expect(n!.title).toContain('Sample Teacher One');
    expect(n!.link).toBe(`/academic/teachers/${w.teacher.staffId}`);
    expect(`${n!.title} ${n!.body}`).not.toMatch(/Sick|medical/);
    expect(n!.body).toMatch(/Nothing was reassigned/);
    expect(await openNotification(ctx.db, coordinator, n!.id)).toEqual({ href: n!.link });
    expect(can(coordinator, 'academic:assignments:read')).toBe(true); // that page's gate
  });

  it('Academic cannot be reached: the approval stands and the coordinator is asked to check', async () => {
    const a = await approved(w.teacher, w.hr);
    expect(a.status).toBe('approved');
    const [n] = await flags(a.id);
    expect(n!.title).toContain('check their classes');
    expect(n!.body).toMatch(/did not give a count/);
  });

  it('Academic answers with no count: missing is not zero, so the coordinator is asked to check', async () => {
    vi.stubGlobal('fetch', activity(null, 'Sample source not ready'));
    const a = await approved(w.teacher, w.hr);
    const [n] = await flags(a.id);
    expect(n!.title).toContain('check their classes');
    expect(n!.body).toMatch(/did not give a count/);
  });

  it.each([
    ['a count of 0', 0],
    ['Academic saying no teaching assignments', null],
  ])('no classes planned (%s): no notice', async (_, planned) => {
    vi.stubGlobal('fetch', activity(planned));
    const a = await approved(w.teacher, w.hr);
    expect(await flags(a.id)).toEqual([]);
  });

  it('leave wholly in the past is not checked; someone who does not teach is not checked', async () => {
    const fetch = activity(2);
    vi.stubGlobal('fetch', fetch);
    const past = await approved(w.teacher, w.hr, { fromDate: D2, toDate: D2, kind: 'Sick' });
    const office = await approved(w.office, w.hr);
    expect(fetch).not.toHaveBeenCalled();
    expect(await flags(past.id)).toEqual([]);
    expect(await flags(office.id)).toEqual([]);
  });

  it('leave running into the future counts classes from today', async () => {
    const fetch = activity(1);
    vi.stubGlobal('fetch', fetch);
    await approved(w.teacher2, w.hr, { fromDate: addDays(today, -40), toDate: addDays(today, 2), kind: 'Sick' });
    expect(String(fetch.mock.calls[0]![0])).toContain(`from=${today}&to=${addDays(today, 2)}`);
  });
});

describe('lists', () => {
  it('tabs count what the lists hold, and the HR tile equals its list', async () => {
    const { data } = await list(w.opsMgr, '');
    const counts = data!.counts;
    expect(data!.total).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    for (const status of ['pending', 'approved', 'rejected', 'cancelled'] as const) {
      const r = await list(w.opsMgr, `?status=${status}`);
      expect(r.data!.total).toBe(counts[status]);
      expect(r.data!.items.every((i) => i.status === status)).toBe(true);
    }
    for (const u of [w.opsMgr, w.hr]) {
      const tile = (await hrAttendanceCounts(ctx.db, u)).find((c) => c.key === 'attendance_leave_pending')!;
      expect(tile.value).toBe((await list(u, '?status=pending')).data!.total);
      expect(tile.href).toBe('/ops/hr/attendance?tab=leave');
    }
    expect(await hrAttendanceCounts(ctx.db, w.teacher)).toEqual([]);
  });

  it('one person, as HR: their whole history', async () => {
    const { items } = (await list(w.hr, `?staffId=${w.teacher.staffId}`)).data!;
    expect(new Set(items.map((i) => i.staffId))).toEqual(new Set([w.teacher.staffId]));
    expect(new Set(items.map((i) => i.status)).size).toBeGreaterThan(1);
  });

  it.each([
    ['status', '?status=nope'],
    ['page', '?page=0'],
    ['staffId', '?staffId=nope'],
  ])('400 for a bad %s', async (_label, query) => {
    expect((await list(w.hr, query)).status).toBe(400);
  });
});

describe('why someone is on leave: their own row, or holders of ops:attendance:manage (Proposed)', () => {
  const WHY = 'Fever; doctor advised rest';
  const NOTE = 'Exam week, sorry';
  const GONE = 'Came back on the second day';
  const FIELDS = ['reason', 'decisionNote', 'cancelReason'];
  let rejected: Row;
  let cancelled: Row;
  let directorOwn: Row;

  beforeAll(async () => {
    rejected = await pending(w.teacher, { kind: 'Sick', reason: WHY });
    await decide(w.hr, rejected.id, { decision: 'rejected', note: NOTE, version: 1 });
    const a = await approved(w.teacher, w.hr, { kind: 'Sick', reason: WHY });
    cancelled = (await cancel(w.hr, a.id, { reason: GONE, version: a.version })).data!;
    directorOwn = await approved(director, w.opsMgr, { kind: 'Sick', reason: WHY });
  });

  const READERS: [string, () => TestUser, boolean][] = [
    ['the person themselves', () => w.teacher, true],
    ['an HR manager', () => w.hr, true],
    ['an operations manager', () => w.opsMgr, true],
    ['a director', () => director, false],
    ['an auditor', () => auditor, false],
  ];

  it.each(READERS)('GET list as %s', async (_label, who, sees) => {
    const res = await callRoute<List>(
      listRoute,
      authedRequest(who(), `${home(who())}/${LEAVE}?staffId=${w.teacher.staffId}`),
    );
    const mine = res.data!.items.filter((i) => [rejected.id, cancelled.id].includes(i.id));
    expect(mine).toHaveLength(2);
    for (const item of mine)
      for (const f of FIELDS) expect(f in item).toBe(sees && (item as never)[f] !== undefined);
    for (const text of [WHY, NOTE, GONE])
      expect(JSON.stringify(res.data).includes(text)).toBe(sees);
  });

  it.each(READERS.slice(1))('the record-leave list (attendanceSetup) as %s', async (_label, who, sees) => {
    const setup = await attendanceSetup(ctx.db, who());
    const theirs = setup.leave.filter((l) => l.staffId === w.teacher.staffId);
    expect(theirs.length).toBeGreaterThan(0);
    for (const l of theirs) expect('reason' in l).toBe(sees);
    const other = JSON.stringify(setup.leave.filter((l) => l.staffId !== director.staffId));
    expect(other.includes(WHY)).toBe(sees);
  });

  it('out of the audit trail, HR still has the words for cancelling recorded leave: on the record, HR only', async () => {
    const direct = await callRoute<{ id: string }>(
      recordRoute,
      authedRequest(w.hr, '/ops/api/v1/attendance/leave', {
        method: 'POST',
        json: { staffId: w.teacher2.staffId, kind: 'Casual', reason: 'Wedding', ...days() },
      }),
    );
    const bare = await callRoute<{ id: string }>(
      recordRoute,
      authedRequest(w.hr, '/ops/api/v1/attendance/leave', {
        method: 'POST',
        json: { staffId: w.teacher2.staffId, kind: 'Casual', ...days() },
      }),
    );
    for (const id of [direct.data!.id, bare.data!.id])
      await callRoute(
        cancelRecordRoute,
        authedRequest(w.hr, `/ops/api/v1/attendance/leave/${id}`, {
          method: 'POST',
          json: { reason: 'Entered by mistake' },
        }),
        { id },
      );
    const read = async (u: TestUser, id: string) =>
      (await attendanceSetup(ctx.db, u)).leave.find((l) => l.id === id)!;
    expect((await read(w.hr, direct.data!.id)).reason).toBe('Wedding. Cancelled: Entered by mistake');
    expect((await read(w.hr, bare.data!.id)).reason).toBe('Cancelled: Entered by mistake');
    expect('reason' in (await read(director, direct.data!.id))).toBe(false);
  });

  it('a director still reads their own row, in the list and the record-leave list', async () => {
    const res = await list(director, `?staffId=${director.staffId}`);
    expect(res.data!.items.find((i) => i.id === directorOwn.id)).toMatchObject({ reason: WHY });
    const setup = await attendanceSetup(ctx.db, director);
    expect(setup.leave.find((l) => l.id === directorOwn.leaveRecordId)).toMatchObject({ reason: WHY });
  });

  it('audit keeps ids, dates, type and status, never the words: applications and leave records', async () => {
    const direct = await callRoute<{ id: string }>(
      recordRoute,
      authedRequest(w.hr, '/ops/api/v1/attendance/leave', {
        method: 'POST',
        json: { staffId: w.teacher2.staffId, kind: 'Sick', reason: WHY, ...days() },
      }),
    );
    await callRoute(
      cancelRecordRoute,
      authedRequest(w.hr, `/ops/api/v1/attendance/leave/${direct.data!.id}`, {
        method: 'POST',
        json: { reason: GONE },
      }),
      { id: direct.data!.id },
    );
    const ids = [
      rejected.id,
      cancelled.id,
      cancelled.leaveRecordId!,
      directorOwn.id,
      directorOwn.leaveRecordId!,
      direct.data!.id,
    ];
    const rows = await ctx.db.select().from(auditEvents).where(inArray(auditEvents.entityId, ids));
    expect(rows.map((r) => r.action).sort()).toEqual(
      [
        'leave.applied',
        'leave.rejected',
        'leave.applied',
        'leave.approved',
        'leave.cancelled',
        'leave.applied',
        'leave.approved',
        'attendance.leave_recorded',
        'attendance.leave_recorded',
        'attendance.leave_recorded',
        'attendance.leave_cancelled',
        'attendance.leave_cancelled',
      ].sort(),
    );
    for (const r of rows) {
      const stored = JSON.stringify([r.before, r.after, r.metadata]);
      for (const text of [WHY, NOTE, GONE]) expect(stored).not.toContain(text);
      for (const f of FIELDS) expect(stored).not.toContain(`"${f}"`);
      expect(stored).toContain('"fromDate"');
      expect(stored).toContain('"kind":"Sick"');
      expect(stored).toContain('"status"');
    }
  });
});

describe('through the Academic and Marketing mounts', () => {
  it.each([
    ['Academic', () => w.teacher, '/academic'],
    ['Marketing', () => marketing, '/marketing'],
  ])('%s hosts the same handlers: apply, list, cancel', async (_label, who, base) => {
    const u = who();
    const routes = workRoutes['attendance/leave-applications'];
    const sent = await callRoute<Row>(
      routes.POST,
      authedRequest(u, `${base}/${LEAVE}`, { method: 'POST', json: form() }),
    );
    expect(sent.status).toBe(201);
    const id = sent.data!.id;
    const mine = await callRoute<List>(routes.GET, authedRequest(u, `${base}/${LEAVE}`));
    expect(mine.data!.items.map((i) => i.id)).toContain(id);
    const gone = await callRoute<Row>(
      workRoutes['attendance/leave-applications/[id]/cancel'].POST,
      authedRequest(u, `${base}/${LEAVE}/${id}/cancel`, { method: 'POST', json: { version: 1 } }),
      { id },
    );
    expect(gone.data!.status).toBe('cancelled');
  });
});

it('every state change is audited, and the application id is on each', async () => {
  const a = await pending(w.teacher);
  await approve(w.hr, a);
  await cancel(w.hr, a.id, { version: 2, reason: 'Plans changed' });
  const b = await pending(w.teacher);
  await decide(w.hr, b.id, { decision: 'rejected', note: 'Exam week', version: 1 });
  const c = await pending(w.teacher);
  await cancel(w.teacher, c.id, { version: 1 });
  const rows = await ctx.db
    .select({ action: auditEvents.action, entityId: auditEvents.entityId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, 'leave_application'),
        inArray(auditEvents.entityId, [a.id, b.id, c.id]),
      ),
    );
  const of = (id: string) => rows.filter((r) => r.entityId === id).map((r) => r.action).sort();
  expect(of(a.id)).toEqual(['leave.applied', 'leave.approved', 'leave.cancelled']);
  expect(of(b.id)).toEqual(['leave.applied', 'leave.rejected']);
  expect(of(c.id)).toEqual(['leave.applied', 'leave.cancelled']);
});
