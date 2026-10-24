/**
 * Targets (brief 23 Oct 2026 §15): manager-only changes, own read scope, actual = drill-down
 * rows (one records function, Marketing and Business Ops metrics), missing ≠ 0, monthly snapshot
 * (with lead funnel, calls and follow-ups) frozen at its cut-off.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  marketingCalendarItems,
  marketingCampaignMembers,
  marketingCampaigns,
  marketingOptimisationCategories,
  marketingPolicySettings,
  opsFollowUps,
  opsLeadActivities,
  opsLeadStageHistory,
  opsLeadStages,
  opsLeads,
  staffMembers,
} from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  marketingMonthlySnapshotV1Schema,
  type MarketingMonthlySnapshotV1,
} from '@elevate/shared-contracts';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/targets/route';
import {
  DELETE as deleteRoute,
  GET as drillRoute,
  PATCH as patchRoute,
} from '../../src/app/api/v1/targets/[id]/route';
import { GET as monthlyRoute } from '../../src/app/api/v1/reports/monthly/route';
import { GET as internalMonthlyRoute } from '../../src/app/api/internal/v1/reports/monthly/route';
import { buildMonthlySnapshot } from '../../src/server/monthly-report';
import {
  createOptimisationItem,
  submitOptimisationItem,
  updateOptimisationItem,
} from '../../src/server/optimisation';
import { admissionAttribution } from '../../src/server/targets';
import { call } from '../helpers';

const ctx = setupTestDatabase();
type Staffed = TestUser & { staffId: string };
let manager: Staffed;
let anika: Staffed;
let bharat: Staffed;
let campaignId: string;

const BASE = '/marketing/api/v1/targets';
const OCT = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };

async function staffed(roles: ['marketing_manager'] | ['marketing_contributor'], name: string) {
  const user = await createTestUser(ctx.db, { roles });
  const [dept] = await ctx.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'MARKETING_GROWTH'));
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: name, departmentId: dept!.id })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}

/** A calendar item approved (and optionally published) at an instant, owned by `owner`. */
async function approvedItem(
  owner: Staffed,
  approvedAt: string,
  extra: Record<string, unknown> = {},
) {
  const at = new Date(approvedAt);
  const [row] = await ctx.db
    .insert(marketingCalendarItems)
    .values({
      title: `Sample item ${approvedAt}`,
      itemType: 'social_post',
      status: 'approved',
      plannedAt: at,
      originalPlannedAt: at,
      ownerStaffId: owner.staffId as never,
      approvedAt: at,
      approvedBy: manager.id,
      createdBy: manager.id,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      isSample: true,
      ...extra,
    })
    .returning({ id: marketingCalendarItems.id });
  return row!.id;
}

beforeAll(async () => {
  await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoNothing();
  manager = await staffed(['marketing_manager'], 'Sample Marketing Manager');
  anika = await staffed(['marketing_contributor'], 'Sample Marketer Anika');
  bharat = await staffed(['marketing_contributor'], 'Sample Marketer Bharat');
  const [c] = await ctx.db
    .insert(marketingCampaigns)
    .values({
      code: 'SAMPLE-OCT',
      name: 'Sample October campaign',
      status: 'active',
      isSample: true,
    })
    .returning({ id: marketingCampaigns.id });
  campaignId = c!.id;
  await ctx.db.insert(marketingCampaignMembers).values({
    campaignId: c!.id,
    staffId: anika.staffId as never,
    fromDate: '2026-10-01',
    addedBy: manager.id,
  });
  // Anika: two approvals in October (one at 23:59 IST on 31 Oct), one in November (UTC Oct 31).
  await approvedItem(anika, '2026-10-05T10:00:00+05:30', { campaignId: c!.id });
  await approvedItem(anika, '2026-10-31T23:59:00+05:30');
  await approvedItem(anika, '2026-11-01T00:30:00+05:30');
  await approvedItem(bharat, '2026-10-10T10:00:00+05:30');
  await approvedItem(anika, '2026-10-12T10:00:00+05:30', {
    status: 'cancelled',
    cancelledReason: 'Sample: event moved',
  });
  await leadFixtures();
});

/**
 * Business Ops lead records, with the ownership history the lead services write (audit
 * lead.created / lead.assigned): Anika's L1 qualified 3 Oct and demo booked 10 Oct, her L2
 * qualified 28 Sept (outside October), Bharat's L3 qualified 5 Oct, and L4 (Bharat's, given to
 * Anika on 1 Oct, qualified 6 Oct, given back to Bharat on 15 Oct: credited to Anika, who owned it
 * when it reached Qualified), and L5 (Anika's, qualified 7 Oct, migrated with no ownership trail:
 * credited to its current owner with a note). Anika completed one follow-up on 12 Oct and logged calls on 12 Oct
 * (connected) and 22 Oct (no answer).
 */
async function leadFixtures() {
  await ctx.db.insert(opsLeadStages).values([
    { key: 'new', label: 'New', sortOrder: 1 },
    { key: 'qualified', label: 'Qualified', sortOrder: 2 },
    { key: 'demo_booked', label: 'Demo booked', sortOrder: 3 },
  ]);
  const at = (d: string) => new Date(`${d}T11:00:00+05:30`);
  const owned = (leadId: string, action: string, owner: Staffed, day: string) =>
    ctx.db.insert(auditEvents).values({
      at: at(day),
      actorType: 'user',
      actorUserId: manager.id,
      module: 'ops',
      action,
      entityType: 'lead',
      entityId: leadId,
      after: { ownerStaffId: owner.staffId },
    });
  const lead = async (
    n: number,
    owner: Staffed,
    moves: [string, string][],
    handovers: [string, Staffed][] = [],
    trail = true,
  ) => {
    const current = handovers.at(-1)?.[1] ?? owner;
    const [l] = await ctx.db
      .insert(opsLeads)
      .values({
        code: `LEAD-00000${n}`,
        studentName: `Sample Lead ${n}`,
        studentEmail: `sample.lead${n}@example.test`,
        firstReceivedAt: at('2026-09-01'),
        ownerStaffId: current.staffId as never,
        stageKey: moves.at(-1)![1],
        stageChangedAt: at(moves.at(-1)![0]),
        isSample: true,
        createdBy: manager.id,
      })
      .returning({ id: opsLeads.id });
    if (trail) await owned(l!.id, 'lead.created', owner, '2026-09-01');
    for (const [day, to] of handovers) await owned(l!.id, 'lead.assigned', to, day);
    let from: string | null = null;
    for (const [day, to] of moves) {
      await ctx.db.insert(opsLeadStageHistory).values({
        leadId: l!.id,
        fromKey: from,
        toKey: to,
        actorUserId: manager.id,
        changedAt: at(day),
      });
      from = to;
    }
    return l!.id;
  };
  const l1 = await lead(1, anika, [
    ['2026-10-03', 'qualified'],
    ['2026-10-10', 'demo_booked'],
  ]);
  await lead(2, anika, [['2026-09-28', 'qualified']]);
  await lead(3, bharat, [['2026-10-05', 'qualified']]);
  await lead(
    4,
    bharat,
    [['2026-10-06', 'qualified']],
    [
      ['2026-10-01', anika],
      ['2026-10-15', bharat],
    ],
  );
  await lead(5, anika, [['2026-10-07', 'qualified']], [], false);
  await ctx.db.insert(opsFollowUps).values({
    leadId: l1,
    kind: 'first_contact',
    title: 'Sample call back',
    dueDate: '2026-10-12',
    ownerStaffId: anika.staffId as never,
    status: 'done',
    outcome: 'Sample: demo agreed',
    completedAt: at('2026-10-12'),
    completedBy: anika.id,
  });
  for (const [day, outcome] of [
    ['2026-10-12', 'connected_two_way'],
    ['2026-10-22', 'no_answer'],
  ])
    await ctx.db.insert(opsLeadActivities).values({
      leadId: l1,
      kind: 'call',
      outcome: outcome!,
      occurredAt: at(day!),
      staffId: anika.staffId as never,
      createdBy: anika.id,
      createdAt: at(day!),
    });
}

const target = (over: object) => ({
  scope: 'employee',
  staffId: anika.staffId,
  metricKey: 'approved_content',
  targetValue: 5,
  ...OCT,
  ...over,
});

describe('targets', () => {
  const ids = {} as Record<
    | 'anika'
    | 'bharat'
    | 'team'
    | 'leads'
    | 'teamLeads'
    | 'demos'
    | 'followUps'
    | 'campaign'
    | 'campaignLeads',
    string
  >;

  it.each([
    [null, 401],
    ['anika', 403],
  ] as const)('create as %s → %i', async (who, status) => {
    const user = who ? anika : null;
    expect((await call(createRoute, user, BASE, { json: target({}) })).status).toBe(status);
  });

  it.each([
    [{ staffId: undefined }, 'employee needs staff'],
    [{ scope: 'team' }, 'team has no staff'],
    [{ metricKey: 'calls_made' }, 'never a call-count target'],
    [{ targetValue: 0 }, 'positive'],
    [{ periodStart: '2026-11-01' }, 'period order'],
  ] as [object, string][])('refuses %# (%s)', async (over) => {
    expect((await call(createRoute, manager, BASE, { json: target(over) })).status).toBe(400);
  });

  it('the manager sets targets by employee, team and campaign (audited); duplicates conflict', async () => {
    const make = async (json: object) => {
      const res = await call<{ id: string }>(createRoute, manager, BASE, { json });
      expect(res.status).toBe(201);
      return res.data!.id;
    };
    ids.anika = await make(target({}));
    ids.bharat = await make(target({ staffId: bharat.staffId }));
    ids.team = await make(target({ scope: 'team', staffId: undefined }));
    ids.leads = await make(target({ metricKey: 'qualified_leads', targetValue: 20 }));
    ids.teamLeads = await make(
      target({ scope: 'team', staffId: undefined, metricKey: 'qualified_leads', targetValue: 30 }),
    );
    ids.demos = await make(target({ metricKey: 'demo_bookings', targetValue: 4 }));
    ids.followUps = await make(target({ metricKey: 'follow_ups_completed', targetValue: 10 }));
    ids.campaignLeads = await make(
      target({ scope: 'campaign', staffId: undefined, campaignId, metricKey: 'qualified_leads' }),
    );
    ids.campaign = await make(
      target({
        scope: 'campaign',
        staffId: undefined,
        campaignId,
        metricKey: 'campaign_deliverables',
      }),
    );
    expect((await call(createRoute, manager, BASE, { json: target({}) })).status).toBe(409);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, ids.anika), eq(auditEvents.action, 'target.created')));
    expect(audit).toHaveLength(1);
  });

  it('actual equals the drill-down rows for every target (IST period edges, cancelled excluded)', async () => {
    const list = await call<{ target: { id: string }; actual: { value: number | null } }[]>(
      listRoute,
      manager,
      `${BASE}?from=2026-10-01&to=2026-10-31`,
    );
    for (const row of list.data!) {
      const drill = await call<{
        actual: { value: number | null };
        records: { status: string; rows?: unknown[] };
      }>(drillRoute, manager, `${BASE}/${row.target.id}`, { params: { id: row.target.id } });
      expect(drill.data!.actual.value).toBe(row.actual.value);
      if (drill.data!.records.status === 'ok')
        expect(drill.data!.records.rows!.length).toBe(row.actual.value);
    }
    const value = (id: string) => list.data!.find((r) => r.target.id === id)!.actual.value;
    expect(value(ids.anika)).toBe(2);
    expect(value(ids.bharat)).toBe(1);
    expect(value(ids.team)).toBe(3);
    expect(value(ids.campaign)).toBe(1);
    // Business Ops lead metrics: first entry into the stage inside October, by owner.
    expect(value(ids.leads)).toBe(3); // L1, L4 although Bharat owns it now, L5 without a trail
    expect(value(ids.teamLeads)).toBe(4);
    expect(value(ids.demos)).toBe(1);
    expect(value(ids.followUps)).toBe(1);
  });

  it.each([
    ['manager', 'campaignLeads', /not credited to campaigns/],
    ['anika', 'teamLeads', /only your own leads/],
  ] as const)(
    'a lead actual the %s cannot count (%s) is "missing" with a reason, never 0, no remaining',
    async (who, key, reason) => {
      const user = who === 'manager' ? manager : anika;
      const drill = await call<{
        actual: { status: string; value: number | null; reason: string };
        remaining: number | null;
      }>(drillRoute, user, `${BASE}/${ids[key]}`, { params: { id: ids[key] } });
      expect(drill.data!.actual).toMatchObject({ status: 'missing', value: null });
      expect(drill.data!.actual.reason).toMatch(reason);
      expect(drill.data!.remaining).toBeNull();
    },
  );

  it('an employee counts their own lead target; remaining is target minus actual', async () => {
    const own = await call<{
      actual: { value: number };
      records: { rows: { title: string; href: string | null }[] };
    }>(drillRoute, anika, `${BASE}/${ids.leads}`, { params: { id: ids.leads } });
    const managerView = await call<{ actual: { value: number } }>(
      drillRoute,
      manager,
      `${BASE}/${ids.leads}`,
      { params: { id: ids.leads } },
    );
    // Anika keeps the credit for L4 (now Bharat's) but sees it redacted, without a link.
    expect(own.data!.actual.value).toBe(managerView.data!.actual.value);
    expect(own.data!.actual.value).toBe(own.data!.records.rows.length);
    expect(own.data!.records.rows.map((r) => r.title)).toContain('LEAD-000001: Sample Lead 1');
    expect(own.data!.records.rows).toContainEqual(
      expect.objectContaining({ title: 'Lead now with another owner', href: null }),
    );
    const ok = await call<{ remaining: number }>(drillRoute, manager, `${BASE}/${ids.anika}`, {
      params: { id: ids.anika },
    });
    expect(ok.data!.remaining).toBe(3);
  });

  it('a lead credited without ownership history carries the note in the drill-down', async () => {
    const drill = await call<{ records: { rows: { title: string; note?: string }[] } }>(
      drillRoute,
      manager,
      `${BASE}/${ids.leads}`,
      { params: { id: ids.leads } },
    );
    expect(drill.data!.records.rows.find((r) => r.title.startsWith('LEAD-000005'))!.note).toBe(
      'owner from current record (no history)',
    );
    expect(drill.data!.records.rows.find((r) => r.title.startsWith('LEAD-000001'))!.note).toBe(
      undefined,
    );
  });

  it('a member whose membership ends later still sees the campaign target; an ended one does not', async () => {
    const chitra = await staffed(['marketing_contributor'], 'Sample Marketer Chitra');
    const dina = await staffed(['marketing_contributor'], 'Sample Marketer Dina');
    for (const [who, toDate] of [
      [chitra, addDays(toIsoDate(), 30)],
      [dina, '2026-10-10'],
    ] as const)
      await ctx.db.insert(marketingCampaignMembers).values({
        campaignId: campaignId as never,
        staffId: who.staffId as never,
        fromDate: '2026-10-01',
        toDate,
        addedBy: manager.id,
      });
    const drill = (u: TestUser) =>
      call(drillRoute, u, `${BASE}/${ids.campaign}`, { params: { id: ids.campaign } });
    expect((await drill(chitra)).status).toBe(200);
    expect((await drill(dina)).status).toBe(404);
  });

  it('an invalid stored admission credit rule falls back to the proposed default', async () => {
    await ctx.db.insert(marketingPolicySettings).values({
      key: 'marketing.targets.admission_attribution',
      value: 'whoever_asks',
      status: 'approved',
      description: 'Sample invalid value',
    });
    expect(await admissionAttribution(ctx.db)).toMatchObject({
      value: 'lead_owner_at_confirmation',
      status: 'proposed',
    });
    await ctx.db
      .delete(marketingPolicySettings)
      .where(eq(marketingPolicySettings.key, 'marketing.targets.admission_attribution'));
  });

  it('an employee reads own, team and own-campaign targets only; others are not found', async () => {
    const mine = await call<{ target: { id: string } }[]>(listRoute, anika, BASE);
    expect(mine.data!.map((r) => r.target.id).sort()).toEqual(
      [
        ids.anika,
        ids.team,
        ids.leads,
        ids.teamLeads,
        ids.demos,
        ids.followUps,
        ids.campaign,
        ids.campaignLeads,
      ].sort(),
    );
    const theirs = await call(drillRoute, anika, `${BASE}/${ids.bharat}`, {
      params: { id: ids.bharat },
    });
    expect(theirs.status).toBe(404);
    expect(
      (await call(drillRoute, bharat, `${BASE}/${ids.campaign}`, { params: { id: ids.campaign } }))
        .status,
    ).toBe(404);
  });

  it('only the manager changes or removes a target; identity fields cannot be patched', async () => {
    const opts = { params: { id: ids.bharat }, method: 'PATCH', json: { targetValue: 8 } };
    expect((await call(patchRoute, anika, `${BASE}/${ids.bharat}`, opts)).status).toBe(403);
    expect(
      (
        await call(patchRoute, manager, `${BASE}/${ids.bharat}`, {
          ...opts,
          json: { metricKey: 'published_content' },
        })
      ).status,
    ).toBe(400);
    const res = await call<{ targetValue: number }>(
      patchRoute,
      manager,
      `${BASE}/${ids.bharat}`,
      opts,
    );
    expect(res.data!.targetValue).toBe(8);
    const del = { params: { id: ids.bharat }, method: 'DELETE' };
    expect((await call(deleteRoute, anika, `${BASE}/${ids.bharat}`, del)).status).toBe(403);
    expect((await call(deleteRoute, manager, `${BASE}/${ids.bharat}`, del)).status).toBe(200);
    expect(
      (await call(drillRoute, manager, `${BASE}/${ids.bharat}`, { params: { id: ids.bharat } }))
        .status,
    ).toBe(404);
  });
});

describe('monthly report facts', () => {
  it('follow the snapshot contract, count lead facts and are frozen at their cut-off', async () => {
    const cutoffAt = new Date('2026-10-20T12:00:00Z');
    const first = await buildMonthlySnapshot(ctx.db, manager, {
      staffId: anika.staffId,
      month: '2026-10',
      cutoffAt,
    });
    expect(marketingMonthlySnapshotV1Schema.parse(first)).toEqual(first);
    expect(first.content.approved).toMatchObject({ status: 'ok', value: 1 }); // 5 Oct only by 20 Oct
    const counts = (rows: { key: string; count: { value: number | null } }[]) =>
      Object.fromEntries(rows.map((r) => [r.key, r.count.value]));
    expect(counts(first.funnel)).toEqual({ new: 0, qualified: 3, demo_booked: 1 });
    // L5 is credited to its current owner (no ownership history), and the row says so.
    expect(first.funnel.find((r) => r.key === 'qualified')!.label).toBe(
      'Qualified (1 with owner from current record (no history))',
    );
    // The 22 Oct call is after the cut-off.
    expect(counts(first.callOutcomes)).toEqual({
      calls_logged: 1,
      call_connected_two_way: 1,
      follow_ups_completed: 1,
    });
    expect(first.campaigns.map((c) => c.code)).toEqual(['SAMPLE-OCT']);
    expect(first.isSample).toBe(true);
    // A later approval inside October does not change the facts as of the same cut-off.
    await approvedItem(anika, '2026-10-25T10:00:00+05:30', { createdAt: new Date() });
    expect(
      await buildMonthlySnapshot(ctx.db, manager, {
        staffId: anika.staffId,
        month: '2026-10',
        cutoffAt,
      }),
    ).toEqual(first);
    const later = await buildMonthlySnapshot(ctx.db, manager, {
      staffId: anika.staffId,
      month: '2026-10',
      cutoffAt: new Date('2026-11-15T00:00:00Z'),
    });
    expect(later.content.approved.value).toBe(3);
    expect(counts(later.callOutcomes)).toMatchObject({ calls_logged: 2, call_no_answer: 1 });
  });

  it('the live view explains a missing lead fact in terms of the viewer', async () => {
    const snap = await buildMonthlySnapshot(
      ctx.db,
      { id: manager.id, roles: [] },
      {
        staffId: anika.staffId,
        month: '2026-10',
        reader: 'viewer',
      },
    );
    expect((snap.funnel[0]!.count as { reason: string }).reason).toMatch(/^You cannot read leads/);
  });

  it('SEO rows are the work done in the month as of the cut-off (audit trail), not due dates', async () => {
    await ctx.db
      .insert(marketingOptimisationCategories)
      .values({ key: 'seo', label: 'SEO', meaning: 'Sample meaning.' })
      .onConflictDoNothing();
    const make = (topic: string, dueOn: string) =>
      createOptimisationItem(ctx.db, anika, {
        pageUrl: 'https://example.test/page',
        topic,
        categoryKey: 'seo',
        dueOn,
        checks: [],
      });
    const worked = await make('Sample worked page', '2026-12-01');
    const idle = await make('Sample idle page due in October', '2026-10-15');
    await updateOptimisationItem(ctx.db, anika, worked.id, { evidence: 'Sample FAQ live' });
    await submitOptimisationItem(ctx.db, anika, worked.id);
    const dated = async (action: string, iso: string) =>
      ctx.db
        .update(auditEvents)
        .set({ at: new Date(iso) })
        .where(
          and(eq(auditEvents.entityType, 'optimisation_item'), eq(auditEvents.action, action)),
        );
    await dated('optimisation_item.created', '2026-09-02T10:00:00+05:30');
    await dated('optimisation_item.updated', '2026-10-08T10:00:00+05:30');
    await dated('optimisation_item.submitted', '2026-10-25T10:00:00+05:30');
    // The idle item's evidence was written in September: not work done in October.
    await updateOptimisationItem(ctx.db, anika, idle.id, { evidence: 'Sample September note' });
    await ctx.db
      .update(auditEvents)
      .set({ at: new Date('2026-09-20T10:00:00+05:30') })
      .where(
        and(eq(auditEvents.entityId, idle.id), eq(auditEvents.action, 'optimisation_item.updated')),
      );
    const asOf = (iso: string) =>
      buildMonthlySnapshot(ctx.db, manager, {
        staffId: anika.staffId,
        month: '2026-10',
        cutoffAt: new Date(iso),
      }).then((x) => x.optimisation);
    expect(await asOf('2026-10-05T00:00:00Z')).toEqual([]);
    expect(await asOf('2026-10-20T00:00:00Z')).toEqual([
      {
        itemId: worked.id,
        categoryKey: 'seo',
        topic: 'Sample worked page',
        reviewState: 'draft',
        evidence: 'Sample FAQ live',
      },
    ]);
    const later = await asOf('2026-11-15T00:00:00Z');
    expect(later.map((o) => [o.itemId, o.reviewState])).toEqual([[worked.id, 'submitted']]);
    expect(later.some((o) => o.itemId === idle.id)).toBe(false);
  });

  it('own scope: an employee reads only their own month; a manager reads anyone', async () => {
    const path = (staffId: string) =>
      `/marketing/api/v1/reports/monthly?month=2026-10&staffId=${staffId}`;
    expect((await call(monthlyRoute, anika, path(bharat.staffId))).status).toBe(404);
    expect((await call(monthlyRoute, anika, path(anika.staffId))).status).toBe(200);
    expect((await call(monthlyRoute, manager, path(bharat.staffId))).status).toBe(200);
    expect((await call(monthlyRoute, null, path(anika.staffId))).status).toBe(401);
  });

  it('the internal snapshot route answers Business Ops only', async () => {
    const url = `/marketing/api/internal/v1/reports/monthly?staffId=${anika.staffId}&month=2026-10`;
    const token = 'test-only-internal-token-for-vitest-runs-0001';
    const as = (caller: string) =>
      callRoute(
        internalMonthlyRoute,
        buildRequest(url, {
          headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': caller },
        }),
      );
    const ops = await as('ops');
    expect(ops.status).toBe(200);
    // Read as Anika herself: the same count a manager sees (L4, now Bharat's, still hers).
    const snap = marketingMonthlySnapshotV1Schema.parse(ops.data);
    expect(snap.funnel.find((r) => r.key === 'qualified')!.count.value).toBe(3);
    expect((await as('academic')).status).toBe(403);
    const other = (staffId: string) =>
      callRoute<MarketingMonthlySnapshotV1>(
        internalMonthlyRoute,
        buildRequest(
          `/marketing/api/internal/v1/reports/monthly?staffId=${staffId}&month=2026-10`,
          {
            headers: { authorization: `Bearer ${token}`, 'x-elevate-caller': 'ops' },
          },
        ),
      );
    expect((await other('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    // A stored snapshot names the person, not the reader.
    const [loginless] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'Sample Marketer Without Login' })
      .returning({ id: staffMembers.id });
    const stored = await other(loginless!.id);
    expect(stored.status).toBe(200);
    expect((stored.data!.funnel[0]!.count as { reason: string }).reason).toMatch(
      /^This person cannot read leads/,
    );
    expect((await callRoute(internalMonthlyRoute, authedRequest(manager, url))).status).toBe(401);
  });
});
