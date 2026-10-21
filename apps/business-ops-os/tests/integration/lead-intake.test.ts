import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  opsContactPreferences,
  opsDuplicateFlags,
  opsEnquiries,
  opsLeadHandoffReceipts,
  opsLeads,
  opsLeadSources,
} from '@elevate/database';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as runJob } from '../../src/app/api/v1/jobs/[job]/route';
import { GET as listHandoffs } from '../../src/app/api/v1/leads/handoffs/route';
import { POST as retry } from '../../src/app/api/v1/leads/handoffs/[id]/retry/route';
import {
  publishMockLeadHandoff,
  type LeadHandoffPayload,
} from '../../src/server/adapters/marketing-intake';
import { setupReference, staffUser, phone, e164, type StaffUser } from './fixtures';
import { get, post } from './admissions-fixtures';
import { POST as createLead } from '../../src/app/api/v1/leads/route';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let director: TestUser;

const handoff = (extra: Partial<LeadHandoffPayload> = {}): LeadHandoffPayload => ({
  marketingLeadId: randomUUID(),
  source: { code: 'META_ADS', channel: 'Instagram account' },
  campaign: { ref: 'CMP-TEST-01', name: 'Test campaign' },
  contacts: { studentName: 'Handoff Student', studentPhone: e164(phone()) },
  courseInterest: '12+CLAT',
  consent: { status: 'given', by: 'guardian', allowedChannels: ['call', 'whatsapp'] },
  capturedAt: new Date().toISOString() as LeadHandoffPayload['capturedAt'],
  sourceReference: 'Landing page form',
  ...extra,
});
const intake = (user: { token: string } = manager) =>
  callRoute<{ processed: number; failed: number; retried: number }>(runJob, post(user, {}), {
    job: 'lead-intake',
  });
const receiptOf = async (marketingLeadId: string) =>
  (
    await ctx.db
      .select()
      .from(opsLeadHandoffReceipts)
      .where(eq(opsLeadHandoffReceipts.marketingLeadId, marketingLeadId))
  )[0]!;
const leadsWithNote = (marketingLeadId: string) =>
  ctx.db
    .select()
    .from(opsLeads)
    .then((rows) => rows.filter((l) => l.notes?.includes(marketingLeadId)));

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
});

describe('lead intake: idempotent, attribution kept', () => {
  it('only holders of ops:jobs:run may run it (401 / 403)', async () => {
    expect(
      (await callRoute(runJob, buildRequest('/x', { method: 'POST' }), { job: 'lead-intake' }))
        .status,
    ).toBe(401);
    expect((await intake(counsellor)).status).toBe(403);
  });

  it('the same event twice gives one event, one delivery and one lead with source, campaign and consent', async () => {
    const p = handoff();
    const first = await publishMockLeadHandoff(ctx.db, p);
    const again = await publishMockLeadHandoff(ctx.db, p);
    expect(again).toEqual({ id: first.id, created: false });
    expect((await intake()).data?.processed).toBe(1);
    expect((await intake()).data?.processed).toBe(0);
    const leads = await leadsWithNote(p.marketingLeadId);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.notes).toContain('Course interest as supplied: 12+CLAT');
    expect(await receiptOf(p.marketingLeadId)).toMatchObject({
      status: 'accepted',
      attempts: 1,
      leadId: leads[0]!.id,
    });
    const [enquiry] = await ctx.db
      .select()
      .from(opsEnquiries)
      .where(eq(opsEnquiries.leadId, leads[0]!.id));
    expect(enquiry).toMatchObject({ sourceCode: 'META_ADS', campaignRef: 'CMP-TEST-01' });
    const [consent] = await ctx.db
      .select()
      .from(opsContactPreferences)
      .where(eq(opsContactPreferences.leadId, leads[0]!.id));
    expect(consent).toMatchObject({
      consentStatus: 'given',
      allowedChannels: ['call', 'whatsapp'],
    });
  });

  it('a second event for an already handed-off lead is counted, never a second lead', async () => {
    const p = handoff({ courseInterest: 'clat' });
    await publishMockLeadHandoff(ctx.db, p);
    await publishMockLeadHandoff(ctx.db, p, `lead-handoff:${p.marketingLeadId}:resent`);
    await intake();
    const leads = await leadsWithNote(p.marketingLeadId);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.programmeId).not.toBeNull();
    expect(await receiptOf(p.marketingLeadId)).toMatchObject({
      status: 'accepted',
      duplicateDeliveries: 1,
    });
  });
});

describe('lead intake: failure → retry → success without duplicates', () => {
  it('records the failure, refuses unauthorised retries, then succeeds once', async () => {
    const p = handoff({ source: { code: 'MARKETING_FORM' } });
    await publishMockLeadHandoff(ctx.db, p);
    expect((await intake()).data).toMatchObject({ processed: 1, retried: 0 });
    const failed = await receiptOf(p.marketingLeadId);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, leadId: null });
    expect(failed.lastError).toContain('MARKETING_FORM');
    expect(await leadsWithNote(p.marketingLeadId)).toHaveLength(0);

    expect(
      (await callRoute(retry, buildRequest('/x', { method: 'POST' }), { id: failed.id })).status,
    ).toBe(401);
    expect((await callRoute(retry, post(counsellor, {}), { id: failed.id })).status).toBe(403);
    expect((await callRoute(retry, post(manager, {}), { id: 'nope' })).status).toBe(400);
    expect((await callRoute(retry, post(manager, {}), { id: failed.id })).data).toMatchObject({
      status: 'failed',
      attempts: 2,
    });

    await ctx.db
      .insert(opsLeadSources)
      .values({ code: 'MARKETING_FORM', label: 'Marketing form (test)' });
    expect((await intake()).data).toMatchObject({ processed: 0, retried: 1 });
    expect(await receiptOf(p.marketingLeadId)).toMatchObject({ status: 'accepted', attempts: 3 });
    expect(await leadsWithNote(p.marketingLeadId)).toHaveLength(1);
    expect((await callRoute(retry, post(manager, {}), { id: failed.id })).status).toBe(409);
    const audits = await ctx.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'lead_handoff'), eq(auditEvents.entityId, failed.id)));
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'lead_handoff.failed',
        'lead_handoff.retry_requested',
        'lead_handoff.accepted',
      ]),
    );
  });
});

describe('lead intake: uncertain match goes to duplicate review, never merged', () => {
  it('flags the existing lead with the same phone and keeps both', async () => {
    const raw = phone();
    const existing = await callRoute<{ lead: { id: string } }>(
      createLead,
      post(manager, {
        studentName: 'Existing Lead',
        studentPhone: raw,
        sourceCode: 'WALK_IN',
      }),
    );
    expect(existing.status).toBe(201);
    const p = handoff({
      contacts: { studentName: 'Existing Lead', studentPhone: e164(raw) },
    });
    await publishMockLeadHandoff(ctx.db, p);
    await intake();
    const receipt = await receiptOf(p.marketingLeadId);
    expect(receipt.status).toBe('duplicate_review');
    const [flag] = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, receipt.leadId!));
    expect(flag).toMatchObject({ matchedLeadId: existing.data!.lead.id, status: 'open' });
    const both = await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, existing.data!.lead.id as never));
    expect(both[0]!.mergedIntoLeadId).toBeNull();
  });
});

describe('handoff list: attribution only for permitted roles, no contacts', () => {
  type List = {
    items: { marketingLeadId: string; attribution: unknown }[];
    counts: Record<string, number>;
  };
  it('manager and director see attribution; a counsellor sees own handoffs without it', async () => {
    const p = handoff();
    await publishMockLeadHandoff(ctx.db, p);
    await intake();
    const receipt = await receiptOf(p.marketingLeadId);
    await ctx.db
      .update(opsLeads)
      .set({ ownerStaffId: counsellor.staffId })
      .where(eq(opsLeads.id, receipt.leadId!));
    const m = await callRoute<List>(listHandoffs, get(manager, '/ops/api/v1/leads/handoffs'));
    expect(m.data!.counts.failed).toBe(0);
    expect(
      m.data!.items.find((i) => i.marketingLeadId === p.marketingLeadId)?.attribution,
    ).toMatchObject({
      campaignRef: 'CMP-TEST-01',
      campaignName: 'Test campaign',
    });
    expect(JSON.stringify(m.data)).not.toContain(p.contacts.studentPhone!);
    const d = await callRoute<List>(
      listHandoffs,
      get(director, '/ops/api/v1/leads/handoffs?status=accepted'),
    );
    expect(d.data!.items.every((i) => i.attribution)).toBe(true);
    const c = await callRoute<List>(listHandoffs, get(counsellor, '/ops/api/v1/leads/handoffs'));
    expect(c.data!.items).toEqual([
      expect.objectContaining({ marketingLeadId: p.marketingLeadId, attribution: null }),
    ]);
    expect(
      (await callRoute(listHandoffs, get(manager, '/ops/api/v1/leads/handoffs?status=bogus')))
        .status,
    ).toBe(400);
  });
});
