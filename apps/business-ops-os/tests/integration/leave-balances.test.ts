/**
 * F4-12 leave balances and half days, and F4-10 approval cover for leave, through the real routes:
 * allowances (one person or a role), adjustments, balance maths, the over-balance warning (Proposed)
 * or refusal, half days in attendance and in the D-134 cover sync, and a cover deciding leave.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  notifications,
  opsLeaveApplications,
  staffMembers,
} from '@elevate/database';
import { academicHrLeaveBody, academicHrLeaveV1Schema } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { addDays, istToday } from '../../src/domain/dates';
import { leaveYear } from '../../src/domain/leave-balance';
import { RESEND_TO_ACADEMIC } from '../../src/domain/leave';
import { shownStatus } from '../../src/domain/attendance';
import { POST as adjustRoute } from '../../src/app/api/v1/attendance/leave-adjustments/route';
import {
  GET as sheetRoute,
  POST as allowanceRoute,
} from '../../src/app/api/v1/attendance/leave-allowances/route';
import { POST as recordRoute } from '../../src/app/api/v1/attendance/leave/route';
import { POST as applyRoute, GET as listRoute } from '../../src/app/api/v1/attendance/leave-applications/route';
import { POST as decideRoute } from '../../src/app/api/v1/attendance/leave-applications/[id]/route';
import { createCover } from '../../src/server/approval-cover';
import { attendanceDay } from '../../src/server/attendance';
import { updateHrSetting } from '../../src/server/hr-settings';
import { canDecideLeave } from '../../src/server/leave-applications';
import { allowanceSheet, readBalances } from '../../src/server/leave-balances';
import { AllowancesTab } from '../../src/app/hr/attendance/_components/allowances';
import { exportList } from '../../src/server/list-exports';
import { attendanceWorld } from './attendance-fixture';
import { staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const API = 'api/v1/attendance';
const today = istToday(new Date());
const year = leaveYear(today, 'april');
/** A day inside the current leave year, never more than a year from today. */
const on = (k: number) => addDays(year.start, k);
const base = (u: TestUser) => (u.roles.includes('teacher') ? '/academic' : '/ops');

const post = (route: Parameters<typeof callRoute>[0], u: TestUser, path: string, json: unknown, params = {}) =>
  callRoute<Record<string, unknown> & { id: string; version: number }>(
    route,
    authedRequest(u, `${base(u)}/${API}/${path}`, { method: 'POST', json }),
    params,
  );
const allow = (u: TestUser, json: Record<string, unknown>) =>
  post(allowanceRoute, u, 'leave-allowances', { yearStart: year.start, leaveType: 'Casual', ...json });
const adjust = (u: TestUser, json: Record<string, unknown>) =>
  post(adjustRoute, u, 'leave-adjustments', {
    yearStart: year.start,
    leaveType: 'Casual',
    kind: 'adjustment',
    reason: 'Sample correction',
    ...json,
  });
const apply = (u: TestUser, json: Record<string, unknown>) =>
  post(applyRoute, u, 'leave-applications', { kind: 'Casual', reason: 'Sample reason', ...json });
const decide = (u: TestUser, id: string, decision = 'approved') =>
  post(decideRoute, u, `leave-applications/${id}`, { decision, version: 1, note: 'Sample note' }, { id });
const approve = async (applicant: TestUser, json: Record<string, unknown>, by: TestUser = w.hr) => {
  const a = await apply(applicant, json);
  expect(a.status).toBe(201);
  expect((await decide(by, a.data!.id)).status).toBe(200);
  return a.data!;
};
const balanceOf = async (s: StaffUser, type: string) =>
  (await readBalances(ctx.db, w.hr, s.staffId)).balances.find((b) => b.type === type)!.balance;
const setting = (key: string, value: unknown) => updateHrSetting(ctx.db, w.opsMgr, { key, value });
const RULES = { yearStartMonth: 'april', carryForwardCapDays: 0, overBalance: 'warn' };

let w: Awaited<ReturnType<typeof attendanceWorld>>;
let coordinator: StaffUser;
const fresh = (name: string, roles: Parameters<typeof staffUser>[1] = ['teacher']) =>
  staffUser(ctx.db, roles, { name });

beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
  coordinator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
});
beforeEach(() =>
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); })),
);
afterEach(() => vi.unstubAllGlobals());

describe('setting allowances (ops:attendance:manage, HR scope, never yourself)', () => {
  it('401 signed out', async () => {
    const r = await callRoute(
      allowanceRoute,
      buildRequest(`/ops/${API}/leave-allowances`, { method: 'POST', json: {} }),
    );
    expect(r.status).toBe(401);
  });

  it.each([
    ['a teacher', () => w.teacher, () => ({ staffId: w.teacher2.staffId, days: 5 }), 403],
    ['your own allowance', () => w.hr, () => ({ staffId: w.hr.staffId, days: 5 }), 403],
    ['someone outside HR scope', () => w.hr, () => ({ staffId: w.finance.staffId, days: 5 }), 404],
    ['1.46 days (would round to 1.5)', () => w.hr, () => ({ staffId: w.office.staffId, days: 1.46 }), 400],
    ['an unpaid type', () => w.hr, () => ({ staffId: w.office.staffId, days: 5, leaveType: 'Unpaid' }), 400],
    ['a type not in the setting', () => w.hr, () => ({ staffId: w.office.staffId, days: 5, leaveType: 'Sabbatical' }), 400],
    ['a date that is not a leave year start', () => w.hr, () => ({ staffId: w.office.staffId, days: 5, yearStart: on(1) }), 400],
    ['a role nobody in reach has', () => w.hr, () => ({ role: 'director', days: 5 }), 400],
  ] as const)('refused: %s', async (_, who, json, status) => {
    expect((await allow(who(), json())).status).toBe(status);
  });

  it('by role: everyone with it in HR reach, audited each; the sheet and the download show it', async () => {
    const r = await allow(w.hr, { role: 'teacher', days: 12 });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ set: 2, year: year.label });
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'leave.allowance_set'));
    expect(audits).toHaveLength(2);
    const sheet = await callRoute<{ rows: { staff: { id: string }; balances: Record<string, { state: string }> }[] }>(
      sheetRoute,
      authedRequest(w.hr, `/ops/${API}/leave-allowances?yearStart=${year.start}`),
    );
    const row = (id: string) => sheet.data!.rows.find((x) => x.staff.id === id)!.balances;
    expect(row(w.teacher.staffId).Casual).toMatchObject({ state: 'set', balance: 12 });
    expect(row(w.office.staffId).Casual).toMatchObject({ state: 'not_set' });
    expect(row(w.teacher.staffId).Unpaid).toMatchObject({ state: 'unpaid' });
    const csv = await (await exportList(ctx.db, w.hr, 'leave-allowances', { yearStart: year.start })).text();
    expect(csv).toContain('Casual allowance');
    expect(csv).toMatch(/Sample Office Staff[^\n]*No allowance set/);
  });

  it('the HR tab: a column per type, words for no allowance, the download; forms only for HR', async () => {
    const sheet = await allowanceSheet(ctx.db, w.hr, { yearStart: year.start });
    const html = async (canManage: boolean) =>
      new Response(
        (await prerender(createElement(AllowancesTab, { sheet, canManage, staffOptions: [] }))).prelude,
      ).text();
    const out = await html(true);
    for (const t of ['Casual', 'Sick', 'Earned', 'Unpaid']) expect(out).toContain(`>${t}<`);
    for (const text of ['No allowance set', '12 days left of 12', 'Does not use a balance', 'Set allowance for the role'])
      expect(out).toContain(text);
    expect(out).toContain(`exports/leave-allowances?yearStart=${year.start}`);
    expect(await html(false)).not.toContain('Set allowance');
  });
});

describe('balance = allowance + carried + adjustments − approved (half day 0.5, Unpaid apart)', () => {
  it('adds up through approvals, rejections, half days and an adjustment', async () => {
    const s = await fresh('Sample Balance Teacher');
    expect((await allow(w.hr, { staffId: s.staffId, days: 12 })).status).toBe(200);
    expect((await allow(w.hr, { staffId: s.staffId, days: 10 })).status).toBe(200); // replaces
    await approve(s, { fromDate: on(20), toDate: on(21) });
    await approve(s, { fromDate: on(30), toDate: on(30), dayPart: 'first_half' });
    await approve(s, { kind: 'Unpaid', fromDate: on(40), toDate: on(42) });
    const rejected = await apply(s, { fromDate: on(50), toDate: on(50) });
    expect((await decide(w.hr, rejected.data!.id, 'rejected')).status).toBe(200);
    const adj = await adjust(w.hr, { staffId: s.staffId, days: -1.5, reason: 'Sample private words' });
    expect(adj.status).toBe(201);
    expect(adj.data).toMatchObject({ reason: 'Sample private words' }); // kept on the row
    const [trail] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, adj.data!.id));
    expect(trail).toMatchObject({ action: 'leave.adjustment_added', after: { days: -1.5 } });
    expect(JSON.stringify(trail)).not.toContain('Sample private words'); // FR-B M6
    expect(await balanceOf(s, 'Casual')).toEqual({
      state: 'set',
      allowance: 10,
      carried: 0,
      adjusted: -1.5,
      taken: 2.5,
      balance: 6,
    });
    expect(await balanceOf(s, 'Unpaid')).toEqual({ state: 'unpaid', taken: 3 });
    expect(await balanceOf(s, 'Sick')).toEqual({ state: 'not_set', taken: 0 });
  });

  it.each([
    ['carry-forward at the Proposed cap of 0', { kind: 'carry_forward', days: 1 }, 400, /allows 0 days/],
    ['an adjustment with no allowance set', { days: 1, leaveType: 'Sick' }, 400, /Set a Sick allowance/],
    ['an adjustment of 0.3 days', { days: 0.3 }, 400, /whole or half days/],
    ['an adjustment for yourself', { days: 1, self: true }, 403, /Another HR person/],
  ] as const)('refused: %s', async (_, change, status, message) => {
    const { self, ...json } = change as Record<string, unknown>;
    const r = await adjust(w.hr, { staffId: self ? w.hr.staffId : w.teacher2.staffId, ...json });
    expect(r.status).toBe(status);
    expect(r.error!.message + JSON.stringify(r.error!.details ?? '')).toMatch(message);
  });

  it('carry-forward: within the cap, once a year, no more than was left', async () => {
    const s = await fresh('Sample Carry Teacher');
    const before = leaveYear(addDays(year.start, -1), 'april');
    await post(allowanceRoute, w.hr, 'leave-allowances', { yearStart: before.start, leaveType: 'Casual', staffId: s.staffId, days: 2 });
    await allow(w.hr, { staffId: s.staffId, days: 12 });
    await setting('hr.leave_balances', { ...RULES, carryForwardCapDays: 5 });
    try {
      expect((await adjust(w.hr, { staffId: s.staffId, kind: 'carry_forward', days: 3 })).status).toBe(400);
      expect((await adjust(w.hr, { staffId: s.staffId, kind: 'carry_forward', days: 2 })).status).toBe(201);
      expect((await adjust(w.hr, { staffId: s.staffId, kind: 'carry_forward', days: 0.5 })).status).toBe(409);
      expect(await balanceOf(s, 'Casual')).toMatchObject({ carried: 2, balance: 14 });
    } finally {
      await setting('hr.leave_balances', RULES);
    }
  });
});

describe('over the balance: Proposed warn (HR decides), or refuse', () => {
  it('warns HR on the list and lets HR approve; no allowance never warns', async () => {
    const s = await fresh('Sample Over Teacher');
    await allow(w.hr, { staffId: s.staffId, days: 2 });
    const a = await apply(s, { fromDate: on(60), toDate: on(62) });
    expect(a.status).toBe(201);
    const none = await apply(w.office, { fromDate: on(200), toDate: on(229) });
    expect(none.status).toBe(201);
    const list = await callRoute<{ items: { id: string; overBy: number; balance: { state: string } }[] }>(
      listRoute,
      authedRequest(w.hr, `/ops/${API}/leave-applications?status=pending`),
    );
    const item = (id: string) => list.data!.items.find((i) => i.id === id)!;
    expect(item(a.data!.id)).toMatchObject({ overBy: 1, balance: { state: 'set', balance: 2 } });
    expect(item(none.data!.id)).toMatchObject({ overBy: 0, balance: { state: 'not_set' } });
    expect((await decide(w.hr, a.data!.id)).status).toBe(200);
    expect(await balanceOf(s, 'Casual')).toMatchObject({ balance: -1 });
    await decide(w.hr, none.data!.id, 'rejected');
  });

  it('under "refuse" an application and a direct record past the balance are 409', async () => {
    const s = await fresh('Sample Refuse Teacher');
    await allow(w.hr, { staffId: s.staffId, days: 1 });
    await setting('hr.leave_balances', { ...RULES, overBalance: 'refuse' });
    try {
      const r = await apply(s, { fromDate: on(70), toDate: on(71) });
      expect(r.status).toBe(409);
      expect(r.error!.message).toMatch(/1 day over the Casual balance/);
      const rec = await post(recordRoute, w.hr, 'leave', { staffId: s.staffId, kind: 'Casual', fromDate: on(70), toDate: on(71) });
      expect(rec.status).toBe(409);
      expect((await apply(s, { fromDate: on(70), toDate: on(70) })).status).toBe(201);
      expect((await apply(s, { kind: 'Unpaid', fromDate: on(80), toDate: on(89) })).status).toBe(201);
    } finally {
      await setting('hr.leave_balances', RULES);
    }
  });
});

describe('half-day leave', () => {
  it.each([
    ['an application', () => apply(w.teacher2, { fromDate: on(90), toDate: on(91), dayPart: 'first_half' })],
    ['a direct record', () => post(recordRoute, w.hr, 'leave', { staffId: w.teacher2.staffId, kind: 'Casual', fromDate: on(90), toDate: on(91), dayPart: 'second_half' })],
  ])('over more than one day is refused: %s', async (_, send) => {
    const r = await send();
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.error)).toMatch(/A half day is one day/);
  });

  // FR-B M1: a direct record names a type from the setting, so balances and unpaid days see it.
  it.each([['unpaid'], ['Sample leave'], ['Casual leave']])('a direct record of "%s" is refused', async (kind) => {
    const r = await post(recordRoute, w.hr, 'leave', { staffId: w.teacher2.staffId, kind, fromDate: on(95), toDate: on(95) });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.error)).toMatch(/Choose a leave type from the list/);
  });

  it('the day shows Half day leave; Academic is sent the whole day, and the coordinator is told so', async () => {
    const s = await fresh('Sample Half Day Teacher');
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = academicHrLeaveBody.parse(JSON.parse(String(init.body)));
      return Response.json({
        data: academicHrLeaveV1Schema.parse({ recordId: crypto.randomUUID(), active: body.status === 'approved', classes: 2 }),
      });
    });
    vi.stubGlobal('fetch', fetch);
    const a = await approve(s, { fromDate: today, toDate: today, dayPart: 'second_half' });
    const { day } = await attendanceDay(ctx.db, w.hr, s.staffId, today);
    expect(day).toMatchObject({ status: 'on_leave', leavePart: 'second_half' });
    expect(shownStatus(day!)).toBe('half_day_leave');
    const sent = JSON.parse(String(fetch.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ fromDate: today, toDate: today, status: 'approved' });
    expect(sent).not.toHaveProperty('dayPart');
    const [n] = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.kind, 'leave.classes_flagged'), eq(notifications.userId, coordinator.id)));
    expect(n!.title).toMatch(/second half/);
    expect(n!.body).toMatch(/half-day leave.*every class that day is listed/);
    expect((await ctx.db.select().from(opsLeaveApplications).where(eq(opsLeaveApplications.id, a.id)))[0]!.dayPart).toBe('second_half');
  });
});

describe('approval cover decides leave (F4-10)', () => {
  it('a cover decides what the approver could, on their behalf; never their own or the approver\'s', async () => {
    const s = await fresh('Sample Covered Teacher');
    await setting('hr.leave_approver', { who: ['hr_manager'] });
    try {
      const a = await apply(s, { fromDate: on(120), toDate: on(120) });
      const refused = await decide(w.opsMgr, a.data!.id);
      expect(refused.status).toBe(403);
      expect(refused.error!.message).toMatch(/Who approves leave/);
      expect(await canDecideLeave(ctx.db, w.opsMgr)).toBe(false);

      await createCover(ctx.db, w.hr, { coverStaffId: w.opsMgr.staffId, fromDate: today, toDate: today });
      expect(await canDecideLeave(ctx.db, w.opsMgr)).toBe(true);
      expect((await decide(w.opsMgr, a.data!.id)).status).toBe(200);
      const [row] = await ctx.db.select().from(opsLeaveApplications).where(eq(opsLeaveApplications.id, a.data!.id));
      expect(row).toMatchObject({ status: 'approved', decidedBy: w.opsMgr.id, onBehalfOf: w.hr.id });
      const [told] = await ctx.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.kind, 'leave.approved'), eq(notifications.entityId, a.data!.id)));
      expect(told!.body).toMatch(/approval cover for Sample HR manager/);
      const listed = await callRoute<{ items: { id: string; decidedFor: string | null }[] }>(
        listRoute,
        authedRequest(w.hr, `/ops/${API}/leave-applications?status=approved&staffId=${s.staffId}`),
      );
      expect(listed.data!.items.find((i) => i.id === a.data!.id)!.decidedFor).toBe(
        'Decided by Sample Ops Manager on behalf of Sample HR manager', // FR-B M4
      );

      // FR-D: Academic down; only the approver (not the cover) can use Send to Academic again.
      const t = await fresh('Sample Covered Teacher Today');
      const b = await apply(t, { fromDate: today, toDate: today });
      expect((await decide(w.opsMgr, b.data!.id)).status).toBe(200);
      const leaveId = (await ctx.db.select().from(opsLeaveApplications).where(eq(opsLeaveApplications.id, b.data!.id)))[0]!.leaveRecordId!;
      const checks = await ctx.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.kind, 'leave.classes_check'), eq(notifications.entityId, leaveId)));
      const to = (u: TestUser) => checks.find((n) => n.userId === u.id)?.body ?? null;
      expect(to(w.hr)).toContain(RESEND_TO_ACADEMIC);
      expect(to(w.opsMgr)).toMatch(/Sample HR manager, whom you covered for, is told/);
      expect(to(w.opsMgr)).not.toContain(RESEND_TO_ACADEMIC);
      expect(to(coordinator)).toContain('check their classes');

      const own = await apply(w.opsMgr, { fromDate: on(121), toDate: on(121) });
      expect((await decide(w.opsMgr, own.data!.id)).status).toBe(403);
      const approvers = await apply(w.hr, { fromDate: on(122), toDate: on(122) });
      const r = await decide(w.opsMgr, approvers.data!.id);
      expect(r.status).toBe(403);
      for (const id of [own.data!.id, approvers.data!.id]) await decide(w.hr2, id, 'rejected');
    } finally {
      await setting('hr.leave_approver', { who: ['hr_manager', 'operations_manager'] });
    }
  });

  it("a cover sees the approver's reach, never the approver's own applications (FR-B I-2)", async () => {
    // An operations manager reaches everyone; HR's own scope leaves FINANCE out.
    const away = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Away' });
    const [fin] = await ctx.db.select().from(departments).where(eq(departments.code, 'FINANCE'));
    await ctx.db.update(staffMembers).set({ departmentId: fin!.id }).where(eq(staffMembers.id, away.staffId));
    const theirs = await apply(away, { fromDate: on(130), toDate: on(130), reason: 'Sample private words' });
    const reached = await apply(w.finance, { fromDate: on(131), toDate: on(131) });
    const ids = async (u: TestUser) =>
      (await callRoute<{ items: { id: string }[] }>(listRoute, authedRequest(u, `/ops/${API}/leave-applications?status=pending`)))
        .data!.items.map((i) => i.id);
    expect(await ids(w.hr2)).not.toContain(reached.data!.id); // FINANCE is outside HR's scope
    await createCover(ctx.db, away, { coverStaffId: w.hr2.staffId, fromDate: today, toDate: today });
    const cover = await ids(w.hr2);
    expect(cover).toContain(reached.data!.id);
    expect(cover).not.toContain(theirs.data!.id);
    expect(await ids(away)).toContain(theirs.data!.id); // still the applicant's own
    for (const id of [theirs.data!.id, reached.data!.id]) await decide(w.opsMgr, id, 'rejected');
  });
});
