/**
 * F4-16 automatic lead sharing: a new lead nobody owns goes to the next counsellor of its
 * programme's rule (else the default rule), inside the create transaction; audited; inactive
 * counsellors skipped; everyone at the cap → unassigned and flagged in the audit. Off by default.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { and, desc, eq } from 'drizzle-orm';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  opsAdmissions,
  opsLeadAssignmentRules,
  opsLeaveRecords,
  staffMembers,
} from '@elevate/database';
import { istToday } from '../../src/domain';
import { GET, POST } from '../../src/app/api/v1/lead-sharing/route';
import { DELETE } from '../../src/app/api/v1/lead-sharing/[id]/route';
import { createLead } from '../../src/server/leads';
import { updateSetting } from '../../src/server/settings';
import { LeadSharingBody } from '../../src/app/leads/lead-sharing-body';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/',
}));

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
  await sharingOn(true);
});
beforeEach(async () => {
  await ctx.db.delete(opsLeadAssignmentRules);
});

const sharingOn = (enabled: boolean) =>
  updateSetting(ctx.db, manager, { key: 'leads.sharing.enabled', value: { enabled } });
const saveRule = (json: Record<string, unknown>, user: { token: string } = manager) =>
  callRoute<{ id: string }>(
    POST,
    authedRequest(user, '/ops/api/v1/lead-sharing', { method: 'POST', json }),
  );
const team = () =>
  Promise.all(
    [1, 2, 3].map((n) =>
      staffUser(ctx.db, ['admissions_counsellor'], { name: `Sample Counsellor ${n}` }),
    ),
  );
const newLead = async (extra: Record<string, unknown> = {}, by: StaffUser = manager) =>
  (
    await createLead(ctx.db, by, {
      studentName: 'Sample Shared Lead',
      studentPhone: phone(),
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
      ...extra,
    })
  ).lead;
const owners = async (n: number, extra?: Record<string, unknown>) => {
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) out.push((await newLead(extra)).ownerStaffId);
  return out;
};

describe('choosing the counsellor', () => {
  it.each([
    ['round robin goes in turn and starts again', {}, 4, [0, 1, 2, 0]],
    [
      'a daily cap leaves the lead unassigned once everyone is full',
      { dailyCap: 1 },
      4,
      [0, 1, 2, null],
    ],
    ['an inactive counsellor is skipped', { inactive: 1 }, 3, [0, 2, 0]],
    ['M1: a counsellor on approved leave today is skipped', { leave: 'approved' }, 3, [0, 2, 0]],
    ['M1: cancelled leave does not take a counsellor out', { leave: 'cancelled' }, 3, [0, 1, 2]],
    [
      'fewest open leads, a tie going to the next in turn',
      { mode: 'fewest_open', open: [2, 1, 0] },
      2,
      [2, 1],
    ],
    ['sharing switched off leaves the lead unassigned', { off: true }, 1, [null]],
  ] as const)('%s', async (_, setup, n, expected) => {
    const s = await team();
    const ids = s.map((u) => u.staffId as string);
    const opts = setup as {
      dailyCap?: number;
      inactive?: number;
      mode?: string;
      open?: number[];
      off?: boolean;
      leave?: 'approved' | 'cancelled';
    };
    const today = istToday(new Date());
    if (opts.leave)
      await ctx.db.insert(opsLeaveRecords).values({
        staffId: s[1]!.staffId,
        fromDate: today,
        toDate: today,
        kind: 'Casual leave',
        status: opts.leave,
        approvedBy: manager.id,
      });
    for (const [i, k] of (opts.open ?? []).entries())
      for (let j = 0; j < k; j++) await newLead({ ownerStaffId: ids[i] });
    expect(
      (await saveRule({ counsellors: ids, mode: opts.mode, dailyCap: opts.dailyCap })).status,
    ).toBe(201);
    if (opts.inactive !== undefined)
      await ctx.db
        .update(staffMembers)
        .set({ status: 'inactive' })
        .where(eq(staffMembers.id, s[opts.inactive]!.staffId));
    if (opts.off) await sharingOn(false);
    expect(await owners(n)).toEqual(expected.map((i) => (i === null ? null : ids[i])));
    if (opts.off) await sharingOn(true);
  });

  it('a programme rule beats the default rule; other programmes and none use the default', async () => {
    const [a, b] = await team();
    await saveRule({ counsellors: [a!.staffId] });
    await saveRule({ counsellors: [b!.staffId], programmeCode: 'CLAT' });
    expect(await owners(1, { programmeCode: 'CLAT' })).toEqual([b!.staffId]);
    expect(await owners(1, { programmeCode: 'IPMAT' })).toEqual([a!.staffId]);
    expect(await owners(1)).toEqual([a!.staffId]);
  });

  it('the shared lead is handed off like an assigned one and the audit says by which rule', async () => {
    const [a] = await team();
    const rule = await saveRule({ counsellors: [a!.staffId], dailyCap: 1 });
    const lead = await newLead({ programmeCode: 'CUET' });
    expect(lead).toMatchObject({ ownerStaffId: a!.staffId, acceptedAt: null });
    const [admission] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.leadId, lead.id));
    expect(admission!.counsellorStaffId).toBe(a!.staffId);
    const audit = async (id: string) =>
      (
        await ctx.db
          .select({ metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'lead.created')))
          .orderBy(desc(auditEvents.at))
      )[0]!.metadata;
    expect(await audit(lead.id)).toMatchObject({
      sharing: { ruleId: rule.data!.id, outcome: 'assigned_by_rule' },
    });
    const capped = await newLead();
    expect(capped.ownerStaffId).toBeNull();
    expect(await audit(capped.id)).toMatchObject({ sharing: { outcome: 'no_counsellor_free' } });
  });

  it('a lead with an owner is never shared', async () => {
    const [a, b] = await team();
    await saveRule({ counsellors: [a!.staffId] });
    expect((await newLead({ ownerStaffId: b!.staffId })).ownerStaffId).toBe(b!.staffId);
    expect((await newLead({}, counsellor)).ownerStaffId).toBe(counsellor.staffId);
  });
});

describe('rules routes', () => {
  const TWICE = 'Each counsellor can be listed once.';
  it.each([
    ['nobody signed in', null, (id: string) => ({ counsellors: [id] }), 401],
    [
      'a counsellor (no ops:leads:assign)',
      'counsellor',
      (id: string) => ({ counsellors: [id] }),
      403,
    ],
    ['no counsellor chosen', 'manager', () => ({ counsellors: {} }), 400],
    [
      'the same counsellor twice (M-4)',
      'manager',
      (id: string) => ({ counsellors: [id, id.toUpperCase()] }),
      400,
    ],
    ['an unknown field', 'manager', (id: string) => ({ counsellors: [id], ownerStaffId: id }), 400],
  ] as const)('refuses: %s', async (name, who, json, status) => {
    const [a] = await team();
    const body = json(a!.staffId);
    const req =
      who === null
        ? buildRequest('/ops/api/v1/lead-sharing', { method: 'POST', json: body })
        : authedRequest(who === 'manager' ? manager : counsellor, '/ops/api/v1/lead-sharing', {
            method: 'POST',
            json: body,
          });
    const r = await callRoute(POST, req);
    expect(r.status).toBe(status);
    if (name.includes('twice')) expect(JSON.stringify(r.error)).toContain(TWICE);
  });

  it('saves the screen’s ticked boxes, replaces a programme’s rule, downloads and removes', async () => {
    const [a, b] = await team();
    const first = await saveRule({ counsellors: { [a!.staffId]: true, [b!.staffId]: false } });
    expect(first.status).toBe(201);
    const again = await saveRule({ counsellors: [b!.staffId], mode: 'fewest_open', dailyCap: 3 });
    expect(again.data!.id).toBe(first.data!.id);
    const rows = await ctx.db.select().from(opsLeadAssignmentRules);
    expect(rows).toEqual([
      expect.objectContaining({
        counsellorStaffIds: [b!.staffId],
        mode: 'fewest_open',
        dailyCap: 3,
      }),
    ]);
    const csv = await GET(authedRequest(manager, '/ops/api/v1/lead-sharing'), {
      params: Promise.resolve({}),
    });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('Fewest open leads');
    const del = (id: string) =>
      callRoute(
        DELETE,
        authedRequest(manager, `/ops/api/v1/lead-sharing/${id}`, { method: 'DELETE' }),
        { id },
      );
    expect((await del(first.data!.id)).status).toBe(200);
    expect((await del(first.data!.id)).status).toBe(404);
  });

  it('refuses an inactive counsellor when saving', async () => {
    const [a] = await team();
    await ctx.db
      .update(staffMembers)
      .set({ status: 'inactive' })
      .where(eq(staffMembers.id, a!.staffId));
    expect((await saveRule({ counsellors: [a!.staffId] })).status).toBe(400);
  });
});

describe('the rules screen on both mounts', () => {
  const html = async (user: StaffUser, base: string) =>
    new Response(
      (await prerender(createElement(LeadSharingBody, { user, base, sp: {} }))).prelude,
    ).text();
  const ASK = 'Ask an operations manager to switch it on in Business Ops OS settings.';
  it.each([
    ['/ops', 'operations_manager', true],
    ['/marketing', 'operations_manager', true],
    ['/marketing', 'marketing_manager', false],
  ] as const)('on %s a %s gets the Business Ops settings link: %s', async (base, role, link) => {
    const out = await html(await staffUser(ctx.db, [role]), base);
    expect(out).not.toContain('/marketing/settings');
    if (link) expect(out).toContain('href="/ops/settings?open=leads.sharing.enabled"');
    else expect(out).toContain(ASK);
    expect(out.includes('/ops/settings')).toBe(link);
  });
});
