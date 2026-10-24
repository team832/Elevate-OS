/**
 * Records behind Marketing targets and the stage-entry funnel (owner brief 23 Oct 2026 §10, §15):
 * first entry into a stage, completed follow-ups, Ops-confirmed admissions credited to the lead
 * owner at confirmation, campaign outcomes; always in the caller's lead scope.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { auditEvents, opsAdmissions } from '@elevate/database';
import type { IsoDate } from '@elevate/shared-types';
import { leadsRoutes as R } from '../../src/leads';
import {
  campaignLeadOutcomes,
  leadMetricRecords,
  leadStageEntries,
  leadStageFunnel,
  OWNER_WITHOUT_HISTORY,
  REDACTED_LEAD,
} from '../../src/server/lead-metrics';
import { ensureSystemLeadStages } from '../../src/server/lead-stages';
import { isoDaysFromNow, phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const day = (n: number) => isoDaysFromNow(n) as IsoDate;
const period = { from: day(-1), to: day(1) };
let manager: StaffUser;
let a: StaffUser;
let b: StaffUser;
let leadId: string;

const post = <T = unknown>(
  route: Parameters<typeof callRoute>[0],
  user: StaffUser,
  json: unknown,
  params?: Record<string, string>,
) =>
  callRoute<T>(route, authedRequest(user, '/marketing/api/v1/x', { method: 'POST', json }), params);
const move = (user: StaffUser, id: string, stageKey: string) =>
  post(R['leads/[id]/stage'].POST, user, { stageKey }, { id });

beforeAll(async () => {
  await setupReference(ctx.db);
  await ensureSystemLeadStages(ctx.db);
  manager = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Manager' });
  a = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer A' });
  b = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer B' });
  const res = await post<{ lead: { id: string } }>(R.leads.POST, a, {
    studentName: 'Sample Metric Lead',
    studentPhone: phone(),
    campaignRef: 'CMP-SAMPLE-1',
  });
  leadId = res.data!.lead.id;
  for (const s of ['qualified', 'contacted', 'qualified', 'demo_booked'])
    expect((await move(a, leadId, s)).status).toBe(200);
});

const ids = async (q: Parameters<typeof leadMetricRecords>[2], actor: StaffUser = manager) =>
  (await leadMetricRecords(ctx.db, actor, q)).map((r) => r.id);

describe('leadMetricRecords', () => {
  it('qualified and demo bookings: first entry in the period, owner filter, actor scope, cutoff', async () => {
    const q = { metric: 'qualified_leads' as const, ...period };
    expect(await ids({ ...q, ownerStaffIds: [a.staffId] })).toEqual([leadId]);
    expect(await ids({ ...q, ownerStaffIds: [b.staffId] })).toEqual([]);
    expect(await ids({ ...q, ownerStaffIds: 'all' }, b)).toEqual([]);
    expect(
      await ids({ ...q, ownerStaffIds: 'all', cutoff: new Date(Date.now() - 3_600_000) }),
    ).toEqual([]);
    expect(await ids({ ...q, metric: 'demo_bookings', ownerStaffIds: 'all' })).toEqual([leadId]);
    const [rec] = await leadMetricRecords(ctx.db, manager, { ...q, ownerStaffIds: 'all' });
    expect(rec?.href).toBe(`/marketing/leads/${leadId}`);
  });

  it('completed follow-ups count by the follow-up owner and completion time', async () => {
    const call = await post<{ followUp: { id: string } }>(R['leads/calls'].POST, a, {
      leadId,
      direction: 'outbound',
      outcome: 'connected_two_way',
      nextFollowUpOn: day(1),
    });
    const q = { metric: 'follow_ups_completed' as const, ownerStaffIds: [a.staffId], ...period };
    expect(await ids(q)).toEqual([]);
    const done = await post(
      R['follow-ups/[id]'].POST,
      a,
      { action: 'complete', outcome: 'Fee structure sent' },
      {
        id: call.data!.followUp.id,
      },
    );
    expect(done.status).toBe(200);
    expect(await ids(q)).toEqual([call.data!.followUp.id]);
  });

  it('verified admissions are credited to the lead owner at confirmation, not a later owner', async () => {
    const [adm] = await ctx.db
      .update(opsAdmissions)
      .set({ admissionNumber: '9801', admissionDate: day(0), status: 'admitted' })
      .where(eq(opsAdmissions.leadId, leadId as never))
      .returning();
    expect(
      (
        await post(
          R['leads/[id]/assign'].POST,
          manager,
          { ownerStaffId: b.staffId },
          { id: leadId },
        )
      ).status,
    ).toBe(200);
    const q = { metric: 'verified_admissions' as const, ...period };
    expect(await ids({ ...q, ownerStaffIds: [a.staffId] })).toEqual([adm!.id]);
    expect(await ids({ ...q, ownerStaffIds: [b.staffId] })).toEqual([]);
    expect(await ids({ ...q, from: day(-20), to: day(-10), ownerStaffIds: 'all' })).toEqual([]);
  });
});

it('stage-entry funnel: each figure equals leadStageEntries for that stage', async () => {
  const funnel = await leadStageFunnel(ctx.db, manager, period);
  for (const s of funnel)
    expect((await leadStageEntries(ctx.db, manager, { ...period, stageKey: s.key })).length).toBe(
      s.count,
    );
  expect(funnel.find((s) => s.key === 'qualified')?.count).toBe(1);
});

it('campaign outcomes: leads, demos and confirmed admissions by campaign reference', async () => {
  expect(await campaignLeadOutcomes(ctx.db, manager, 'CMP-SAMPLE-1')).toEqual({
    leads: 1,
    demos: 0,
    admissions: 1,
  });
  expect(await campaignLeadOutcomes(ctx.db, manager, 'CMP-NONE')).toEqual({
    leads: 0,
    demos: 0,
    admissions: 0,
  });
});

describe('fix round 1', () => {
  it('fix I2: stage entries credit the owner at entry time, so a reassignment changes nothing', async () => {
    // beforeAll: A owned the lead when it entered qualified; the verified test reassigned it to B.
    const q = { metric: 'qualified_leads' as const, ...period };
    expect(await ids({ ...q, ownerStaffIds: [a.staffId] })).toEqual([leadId]);
    expect(await ids({ ...q, ownerStaffIds: [b.staffId] })).toEqual([]);
    const funnel = await leadStageFunnel(ctx.db, manager, {
      ...period,
      ownerStaffIds: [a.staffId],
    });
    expect(funnel.find((s) => s.key === 'qualified')?.count).toBe(1);
  });

  it('merged-away leads leave the stage entries', async () => {
    const shared = phone();
    const make = async (ack?: object) =>
      (
        await post<{ lead: { id: string } }>(R.leads.POST, a, {
          studentName: 'Sample Merge Metric',
          studentPhone: shared,
          ...(ack ? { acknowledgeDuplicates: ack } : {}),
        })
      ).data!.lead.id;
    const target = await make();
    const source = await make({ reason: 'Check later' });
    await move(a, source, 'qualified');
    const merged = await post(
      R['leads/[id]/merge'].POST,
      manager,
      { targetLeadId: target, note: 'Same' },
      { id: source },
    );
    expect(merged.status).toBe(200);
    const entries = await leadStageEntries(ctx.db, manager, { ...period, stageKey: 'qualified' });
    expect(entries.map((e) => e.id)).not.toContain(source);
  });

  it('fix C1: an admission cancelled before enrolment leaves verified admissions and campaign outcomes', async () => {
    await ctx.db
      .update(opsAdmissions)
      .set({ status: 'cancelled_before_enrolment' })
      .where(eq(opsAdmissions.leadId, leadId as never));
    expect(await ids({ metric: 'verified_admissions', ownerStaffIds: 'all', ...period })).toEqual(
      [],
    );
    expect(await campaignLeadOutcomes(ctx.db, manager, 'CMP-SAMPLE-1')).toEqual({
      leads: 1,
      demos: 0,
      admissions: 0,
    });
  });

  it('a lead without ownership history is credited to its current owner, and says so', async () => {
    const res = await post<{ lead: { id: string } }>(R.leads.POST, a, {
      studentName: 'Sample Migrated Lead',
      studentPhone: phone(),
    });
    const id = res.data!.lead.id;
    await move(a, id, 'qualified');
    // Migrated rows carry no lead.created / lead.assigned audit events.
    await ctx.db
      .delete(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, id),
          inArray(auditEvents.action, ['lead.created', 'lead.assigned']),
        ),
      );
    const recs = await leadMetricRecords(ctx.db, manager, {
      metric: 'qualified_leads',
      ownerStaffIds: [a.staffId],
      ...period,
    });
    expect(recs.find((r) => r.id === id)).toMatchObject({ ownerNote: OWNER_WITHOUT_HISTORY });
    expect(recs.find((r) => r.id === leadId)?.ownerNote).toBeUndefined();
  });

  it('own view: credit kept after a reassignment, matching the manager; the lost lead is redacted', async () => {
    const q = { ...period, ownerStaffIds: [a.staffId] };
    for (const metric of ['qualified_leads', 'demo_bookings'] as const) {
      const mine = await leadMetricRecords(ctx.db, a, { ...q, metric });
      const managers = await leadMetricRecords(ctx.db, manager, { ...q, metric });
      expect(mine.map((r) => r.id).sort()).toEqual(managers.map((r) => r.id).sort());
      // The beforeAll lead now belongs to B: A sees only that it counted.
      expect(mine.find((r) => r.id === leadId)).toMatchObject({ title: REDACTED_LEAD, href: null });
      expect(JSON.stringify(mine)).not.toContain('Sample Metric Lead');
    }
    const funnelA = await leadStageFunnel(ctx.db, a, q);
    const funnelM = await leadStageFunnel(ctx.db, manager, q);
    expect(funnelA).toEqual(funnelM);
    // Asking for someone else's credit stays within the reader's own leads.
    expect(
      await ids({ metric: 'qualified_leads', ...period, ownerStaffIds: [b.staffId] }, a),
    ).toEqual([]);
  });
});
