/**
 * Approval cover while away (F4-10) through the real routes: IST dates, overlaps, who may be named,
 * revoking, and a cover deciding requests to HR and fee reductions on the approver's behalf
 * (on_behalf_of recorded), never the approver's own item, the maker still never approving, and the
 * approver never verifying what was posted for them. Fictional people only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  opsFeePlans,
  opsAdmissions,
  opsFeeRecords,
  opsHrRequestEvents,
  staffMembers,
  students,
  userRoles,
  users,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as nameRoute } from '../../src/app/api/v1/approval-cover/route';
import { POST as revokeRoute } from '../../src/app/api/v1/approval-cover/[id]/revoke/route';
import { POST as entryRoute } from '../../src/app/api/v1/fee-plans/[id]/entries/route';
import { POST as feeRoute } from '../../src/app/api/v1/fees/[id]/route';
import { POST as createRequest } from '../../src/app/api/v1/hr-requests/route';
import { GET as getRequestRoute } from '../../src/app/api/v1/hr-requests/[id]/route';
import { POST as requestAction } from '../../src/app/api/v1/hr-requests/[id]/[action]/route';
import { addDays, istToday } from '../../src/domain/dates';
import { activeCoverFor, type CoverKind } from '../../src/server/approval-cover';
import { ATTACHMENT_ACCESS } from '../../src/server/attachment-access';
import { listAdmissionFees } from '../../src/server/fees';
import { applyForLeave } from '../../src/server/leave-applications';
import { updateSetting } from '../../src/server/settings';
import { getHrRequest, hrQueue } from '../../src/server/hr-requests-read';
import { pendingCase, post } from './admissions-fixtures';
import { activePlan } from './application-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const day = (n: number) => addDays(istToday(new Date()), n);
const API = '/ops/api/v1/approval-cover';

let ops: StaffUser; // operations manager in FINANCE: outside HR's default department scope
let hr: StaffUser; // HR manager, HR-scoped; ops's cover today..+2
let hr2: StaffUser; // HR manager covering nobody
let director: StaffUser;
let ops2: StaffUser;
let finance: StaffUser; // makes the first agreement
let finance2: StaffUser; // the director's cover
let finance3: StaffUser; // ops2's cover
let counsellor: StaffUser;
let teacher: StaffUser;

const name = (u: TestUser, json: Record<string, unknown>) =>
  callRoute<{ id: string }>(nameRoute, authedRequest(u, API, { method: 'POST', json }));
const cover = (approver: TestUser, who: StaffUser, from: number, to = from) =>
  name(approver, { coverStaffId: who.staffId, fromDate: day(from), toDate: day(to) });
const revoke = (u: TestUser, id: string) =>
  callRoute(revokeRoute, authedRequest(u, `${API}/${id}/revoke`, { method: 'POST', json: {} }), {
    id,
  });
const send = async (u: TestUser, subject: string) => {
  const r = await callRoute<{ id: string }>(
    createRequest,
    authedRequest(u, '/ops/api/v1/hr-requests', {
      method: 'POST',
      json: { category: 'classes', subject, message: 'Please help (test).' },
    }),
  );
  expect(r.status).toBe(201);
  return r.data!.id;
};
const act = (u: TestUser, id: string, action: string, json = {}) =>
  callRoute(
    requestAction,
    authedRequest(u, `/ops/api/v1/hr-requests/${id}/${action}`, { method: 'POST', json }),
    { id, action },
  );
const open = (u: TestUser, id: string) =>
  callRoute<{ as: string }>(getRequestRoute, authedRequest(u, `/ops/api/v1/hr-requests/${id}`), {
    id,
  });
const queued = async (u: TestUser) =>
  (await hrQueue(ctx.db, u, { view: 'queue', tab: 'new' } as never)).rows.map((r) => r.id);
const inDept = async (s: StaffUser, code: string) => {
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, code));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: d!.id })
    .where(eq(staffMembers.id, s.staffId));
};

beforeAll(async () => {
  await setupReference(ctx.db);
  ops = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Cover' });
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Cover' });
  hr2 = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Two' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director Cover' });
  ops2 = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Two' });
  finance = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Maker' });
  finance2 = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Two' });
  finance3 = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Three' });
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], {
    name: 'Sample Counsellor Cover',
  });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Cover' });
  for (const s of [ops, finance]) await inDept(s, 'FINANCE');
  expect((await cover(ops, hr, 0, 2)).status).toBe(201);
});

describe('naming a cover', () => {
  it('401 signed out', async () => {
    expect((await callRoute(nameRoute, buildRequest(API, { json: {} }))).status).toBe(401);
  });

  it.each([
    ['yourself', () => ops2, () => ops2, 0, 0, 400],
    ['a role the setting does not list', () => ops2, () => teacher, 0, 0, 400],
    ['a start in the past', () => ops2, () => hr2, -1, 0, 400],
    ['a last day before the first', () => ops2, () => hr2, 3, 2, 400],
    ['by someone who approves nothing', () => counsellor, () => hr2, 0, 0, 403],
  ])('refuses %s', async (_n, approver, who, from, to, status) => {
    expect((await cover(approver(), who(), from, to)).status).toBe(status);
  });

  it.each([
    [-1, []],
    [0, ['ops']],
    [2, ['ops']],
    [3, []],
  ])('is active only within its IST dates (day %i)', async (n, expected) => {
    const ids = await activeCoverFor(ctx.db, hr.id, 'hr_request', day(n));
    expect(ids).toEqual(expected.map(() => ops.id));
  });

  it('covers only what the approver approves', async () => {
    const r = await cover(hr2, ops2, 30);
    expect(r.status).toBe(201);
    const on = (kind: CoverKind) => activeCoverFor(ctx.db, ops2.id, kind, day(30));
    expect(await on('hr_request')).toEqual([hr2.id]);
    expect(await on('leave')).toEqual([hr2.id]);
    expect(await on('fee_approval')).toEqual([]);
    expect((await revoke(ops2, r.data!.id)).status).toBe(200); // the cover steps down
  });

  it('refuses an overlapping cover for the same approver; a later one is fine', async () => {
    expect((await cover(ops, finance2, 1, 4)).status).toBe(409);
    const later = await cover(ops, finance2, 3, 4);
    expect(later.status).toBe(201);
    expect((await revoke(ops, later.data!.id)).status).toBe(200);
  });

  it('revoke: only the two people on it (404), audited, once (409), and the cover stops', async () => {
    const r = await cover(ops2, hr2, 10);
    const id = r.data!.id;
    expect((await revoke(teacher, id)).status).toBe(403); // no ops:module:access
    expect((await revoke(counsellor, id)).status).toBe(404);
    expect((await revoke(ops2, id)).status).toBe(200);
    expect((await revoke(ops2, id)).status).toBe(409);
    expect(await activeCoverFor(ctx.db, hr2.id, 'hr_request', day(10))).toEqual([]);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'approval_cover.revoked')));
    expect(audits).toHaveLength(1);
  });
});

describe('requests to HR through a cover', () => {
  it('the cover sees and decides a request outside their own reach, on behalf of the approver', async () => {
    const id = await send(finance, 'Cover request (test)');
    expect(await queued(hr2)).not.toContain(id);
    expect((await act(hr2, id, 'review')).status).toBe(404);
    expect(await queued(hr)).toContain(id);
    expect((await act(hr, id, 'review')).status).toBe(200);
    expect((await act(hr, id, 'resolve', { body: 'Done (test).' })).status).toBe(200);
    const rows = await ctx.db
      .select()
      .from(opsHrRequestEvents)
      .where(eq(opsHrRequestEvents.requestId, id as never));
    expect(rows.map((e) => [e.kind, e.onBehalfOf])).toEqual([
      ['submitted', null],
      ['reviewed', ops.id],
      ['resolved', ops.id],
    ]);
    const view = await getHrRequest(ctx.db, hr, id);
    expect(view.events.map((e) => e.actorName)).toContain(
      'Sample HR Cover on behalf of Sample Ops Cover',
    );
  });

  it("never the approver's own request", async () => {
    const id = await send(ops, 'Own request (test)');
    expect(await queued(hr)).not.toContain(id);
    expect((await act(hr, id, 'review')).status).toBe(404);
  });
});

describe('fee discounts and waivers through a cover', () => {
  let plan1: string;
  let plan2: string;
  let directorCover: string;
  const agreement = async (maker: StaffUser) => {
    const { admissionId } = await pendingCase(counsellor);
    const [s] = await ctx.db
      .insert(students)
      .values({ fullName: `Sample Fee Cover ${admissionId.slice(0, 6)}`, isSample: true })
      .returning();
    await ctx.db
      .update(opsAdmissions)
      .set({ studentId: s!.id })
      .where(eq(opsAdmissions.id, admissionId as never));
    return (await activePlan(ctx.db, director, admissionId, s!.id, maker.id)).id as string;
  };
  const verify = (u: TestUser, id: string) =>
    callRoute(feeRoute, post(u, { action: 'verify' }), { id });
  const reduce = (u: TestUser, planId: string, kind = 'discount') =>
    callRoute<{ id: string }>(
      entryRoute,
      post(u, { kind, amountPaise: 1_000_00, notes: 'Sibling (test)' }),
      { id: planId },
    );

  beforeAll(async () => {
    plan1 = await agreement(finance);
    plan2 = await agreement(ops2);
    const d = await cover(director, finance2, 0);
    expect(d.status).toBe(201);
    directorCover = d.data!.id;
    expect((await cover(ops2, finance3, 0)).status).toBe(201);
  });

  it('a cover posts it on behalf of the approver; someone else verifies it', async () => {
    const r = await reduce(finance2, plan1);
    expect(r.status).toBe(201);
    const [row] = await ctx.db
      .select()
      .from(opsFeeRecords)
      .where(eq(opsFeeRecords.id, r.data!.id as never));
    expect(row).toMatchObject({ recordedBy: finance2.id, onBehalfOf: director.id });
    const [plan] = await ctx.db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.id, plan1 as never));
    const shown = (await listAdmissionFees(ctx.db, ops, plan!.admissionId)).records.find(
      (x) => x.id === r.data!.id,
    );
    expect(shown?.recordedByName).toBe('Sample Finance Two on behalf of Sample Director Cover');
    expect((await verify(ops, r.data!.id)).status).toBe(200);
  });

  it.each([
    ['the maker of the agreement (no cover)', () => finance, () => plan1, 'waiver'],
    ["a cover, on the approver's own agreement", () => finance3, () => plan2, 'discount'],
  ])('refuses %s (403)', async (_n, who, planId, kind) => {
    expect((await reduce(who(), planId(), kind)).status).toBe(403);
  });

  it("a cover posts on someone else's agreement, the approver cannot verify it; after revoke it is refused", async () => {
    const ok = await reduce(finance3, plan1, 'waiver');
    expect(ok.status).toBe(201);
    const [row] = await ctx.db
      .select()
      .from(opsFeeRecords)
      .where(eq(opsFeeRecords.id, ok.data!.id as never));
    expect(row!.onBehalfOf).toBe(ops2.id);
    // The approver it was posted for is its maker too: never the second check (0020 review M-1).
    expect((await verify(ops2, ok.data!.id)).status).toBe(403);
    expect((await revoke(director, directorCover)).status).toBe(200);
    expect((await reduce(finance2, plan1)).status).toBe(403);
  });
});

describe('leave files through a cover', () => {
  const canRead = (u: TestUser, id: string) =>
    ATTACHMENT_ACCESS.leave_application.canRead(ctx.db, u, id);
  const apply = async (u: StaffUser, from: number) =>
    (
      await applyForLeave(ctx.db, u, {
        kind: 'Casual',
        fromDate: day(from),
        toDate: day(from),
        reason: 'Family function (test)',
      })
    ).id;

  it("the cover reads what they may decide, not after the cover dates, never the approver's own", async () => {
    const theirs = await apply(finance, 20);
    const approversOwn = await apply(ops, 21);
    expect(await canRead(hr2, theirs)).toBe(false); // HR without a cover: outside its reach
    expect(await canRead(hr, theirs)).toBe(true);
    expect(await canRead(hr, approversOwn)).toBe(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 3 * 86_400_000)); // the cover ended yesterday (IST)
    try {
      expect(await canRead(hr, theirs)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a cover who no longer qualifies stops covering (FR-B I-1)', () => {
  it.each([
    [
      'moved to a role the setting does not list',
      async (c: StaffUser) => {
        await ctx.db.delete(userRoles).where(eq(userRoles.userId, c.id));
        await ctx.db.insert(userRoles).values({ userId: c.id, role: 'admissions_counsellor' });
      },
    ],
    [
      'whose staff record is inactive',
      async (c: StaffUser) => {
        await ctx.db
          .update(staffMembers)
          .set({ status: 'inactive' })
          .where(eq(staffMembers.id, c.staffId));
      },
    ],
    [
      'whose login is disabled',
      async (c: StaffUser) => {
        await ctx.db.update(users).set({ status: 'disabled' }).where(eq(users.id, c.id));
      },
    ],
  ])('a cover %s', async (_n, change) => {
    const approver = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Lapse' });
    const c = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Lapse' });
    expect((await cover(approver, c, 0)).status).toBe(201);
    const id = await send(finance, 'Lapsed cover (test)');
    expect((await open(c, id)).data?.as).toBe('hr');
    await change(c);
    expect(await activeCoverFor(ctx.db, c.id, 'hr_request')).toEqual([]);
    if (!_n.includes('disabled')) {
      expect((await open(c, id)).status).toBe(404);
      expect((await act(c, id, 'review')).status).toBe(404);
    }
  });

  it('a role the setting stops listing', async () => {
    const approver = await staffUser(ctx.db, ['operations_manager'], {
      name: 'Sample Ops Setting',
    });
    const c = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Setting' });
    expect((await cover(approver, c, 0)).status).toBe(201);
    const set = (roles: string[]) =>
      updateSetting(ctx.db, ops, { key: 'hr.approval_cover', value: { roles } });
    await set(['operations_manager', 'hr_manager']);
    try {
      expect(await activeCoverFor(ctx.db, c.id, 'fee_approval')).toEqual([]);
    } finally {
      await set(['operations_manager', 'hr_manager', 'finance_officer']);
    }
    expect(await activeCoverFor(ctx.db, c.id, 'fee_approval')).toEqual([approver.id]);
  });
});

describe("a cover without HR's own access gets the approver's queue (FR-B M5)", () => {
  it('lists what the approver reaches, never more; nothing before the cover', async () => {
    const approver = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR Queue' });
    const c = await staffUser(ctx.db, ['finance_officer'], { name: 'Sample Finance Queue' });
    const inside = await staffUser(ctx.db, ['admissions_counsellor'], {
      name: 'Sample Counsellor Queue',
    });
    await inDept(inside, 'ACADEMICS');
    const theirs = await send(inside, 'Inside the approver reach (test)');
    const outside = await send(finance, 'Outside the approver reach (test)');
    await expect(queued(c)).rejects.toMatchObject({ status: 403 });
    expect((await cover(approver, c, 0)).status).toBe(201);
    const rows = await queued(c);
    expect(rows).toContain(theirs);
    expect(rows).not.toContain(outside);
    expect((await act(c, theirs, 'review')).status).toBe(200);
    expect((await act(c, outside, 'review')).status).toBe(404);
  });
});
