/**
 * Lead stages, conversion link, Do not contact, merge and own scope (owner brief 23 Oct 2026 §11),
 * through the routes Marketing OS mounts from `@elevate/business-ops-os/leads`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  opsAdmissions,
  opsLeads,
  opsLeadStageHistory,
  opsLeadStages,
} from '@elevate/database';
import { leadsRoutes } from '../../src/leads';
import { ensureSystemLeadStages } from '../../src/server/lead-stages';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const R = leadsRoutes;
let manager: StaffUser;
let employee: StaffUser;
let otherEmployee: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  await ensureSystemLeadStages(ctx.db);
  await ensureSystemLeadStages(ctx.db); // idempotent
  manager = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Manager' });
  employee = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer' });
  otherEmployee = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Marketer 2' });
});

const send = <T = unknown>(
  route: Parameters<typeof callRoute>[0],
  user: StaffUser | null,
  json?: unknown,
  params?: Record<string, string>,
  method = 'POST',
) =>
  callRoute<T>(
    route,
    user
      ? authedRequest(user, '/marketing/api/v1/x', { method, json })
      : buildRequest('/marketing/api/v1/x', { method, json }),
    params,
  );

async function newLead(user: StaffUser, over: Record<string, unknown> = {}) {
  const res = await send<{ lead: { id: string; code: string; stageKey: string | null } }>(
    R.leads.POST,
    user,
    { studentName: 'Sample Stage Lead', studentPhone: phone(), programmeCode: 'CLAT', ...over },
  );
  expect(res.status).toBe(201);
  return res.data!.lead;
}
const move = (user: StaffUser | null, id: string, stageKey: string, reason?: string) =>
  send<{ stageKey: string; doNotContact: boolean }>(
    R['leads/[id]/stage'].POST,
    user,
    { stageKey, reason },
    { id },
  );
const leadRow = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsLeads)
      .where(eq(opsLeads.id, id as never))
  )[0]!;
const history = (id: string) =>
  ctx.db
    .select()
    .from(opsLeadStageHistory)
    .where(eq(opsLeadStageHistory.leadId, id as never));
type Detail = {
  stageChanges: { toKey: string; reason: string | null; leadId: string }[];
  converted: { admissionNumber: string; status: string }[];
  admissions: { admissionNumber?: string | null }[];
  history: { action: string }[];
};
const detail = (user: StaffUser, id: string) =>
  send<Detail>(R['leads/[id]'].GET, user, undefined, { id }, 'GET');

describe('lead stage changes', () => {
  it('a new lead starts at New; moves write history and audit; 401/403/400', async () => {
    const lead = await newLead(employee);
    expect(lead.stageKey).toBe('new');
    expect((await move(null, lead.id, 'contacted')).status).toBe(401);
    expect((await move(otherEmployee, lead.id, 'contacted')).status).toBe(403);
    expect((await move(employee, lead.id, 'no_such_stage')).status).toBe(400);
    expect((await move(employee, lead.id, 'contacted')).status).toBe(200);
    expect((await history(lead.id)).map((h) => [h.fromKey, h.toKey])).toEqual(
      expect.arrayContaining([
        [null, 'new'],
        ['new', 'contacted'],
      ]),
    );
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, lead.id), eq(auditEvents.action, 'lead.stage_changed')));
    expect(audits).toHaveLength(2);
    // The admission case is untouched: stage ≠ admission status.
    const [adm] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.leadId, lead.id as never));
    expect(adm?.status).toBe('new');
  });

  it.each([
    ['lost', undefined, 400],
    ['lost', 'Chose another institute', 200],
    ['nurture', undefined, 200],
    ['duplicate', undefined, 400],
  ])('to %s with reason %s → %i', async (stageKey, reason, code) => {
    const lead = await newLead(employee);
    const res = await move(employee, lead.id, stageKey, reason);
    expect(res.status).toBe(code);
    if (code === 400)
      expect(res.error?.details).toEqual([expect.objectContaining({ path: ['reason'] })]);
  });

  it('Do not contact sets the flag; leaving it needs a reason and clears it', async () => {
    const lead = await newLead(employee);
    expect(
      (await move(employee, lead.id, 'do_not_contact', 'Parent asked')).data?.doNotContact,
    ).toBe(true);
    expect((await leadRow(lead.id)).doNotContact).toBe(true);
    expect((await move(employee, lead.id, 'nurture')).status).toBe(400);
    expect(
      (await move(employee, lead.id, 'nurture', 'Parent called back')).data?.doNotContact,
    ).toBe(false);
  });
});

describe('Converted only after Ops confirms the admission', () => {
  it('refused without a number or with an unverified legacy number; accepted after; read-only link data', async () => {
    const lead = await newLead(employee);
    const refused = await move(employee, lead.id, 'converted');
    expect(refused.status).toBe(400);
    expect(refused.error?.message).toMatch(/Business Operations confirms/);
    const setCase = (values: Partial<typeof opsAdmissions.$inferInsert>) =>
      ctx.db
        .update(opsAdmissions)
        .set(values)
        .where(eq(opsAdmissions.leadId, lead.id as never));
    await setCase({ admissionNumber: '9901', legacyVerification: 'required' });
    expect((await move(employee, lead.id, 'converted')).status).toBe(400);
    await setCase({ legacyVerification: null, status: 'admitted' });
    expect((await move(employee, lead.id, 'converted')).status).toBe(200);
    const d = await detail(employee, lead.id);
    expect(d.data?.converted).toEqual([
      expect.objectContaining({ admissionNumber: '9901', status: 'admitted' }),
    ]);
    // Marketing gets the number and status only, not the case details.
    expect(d.data?.admissions[0]).toEqual(expect.objectContaining({ admissionNumber: '9901' }));
    expect(d.data?.admissions[0]).not.toHaveProperty('counsellorName');
    // Fix C1: Marketing's converted[] carries no admission id or legacy state.
    expect(Object.keys(d.data!.converted[0]!).sort()).toEqual([
      'admissionNumber',
      'conversion',
      'status',
    ]);
  });

  it('fix C1: a cancelled admission never converts; one withdrawn after enrolment still counts', async () => {
    const setCase = (id: string, values: Partial<typeof opsAdmissions.$inferInsert>) =>
      ctx.db
        .update(opsAdmissions)
        .set(values)
        .where(eq(opsAdmissions.leadId, id as never));
    const cancelled = await newLead(employee);
    await setCase(cancelled.id, { admissionNumber: '9911', status: 'cancelled_before_enrolment' });
    expect((await move(employee, cancelled.id, 'converted')).status).toBe(400);
    const ended = await newLead(employee);
    await setCase(ended.id, { admissionNumber: '9912', status: 'admitted' });
    expect((await move(employee, ended.id, 'converted')).status).toBe(200);
    await setCase(ended.id, { status: 'withdrawn' });
    expect((await detail(employee, ended.id)).data?.converted).toEqual([
      expect.objectContaining({ admissionNumber: '9912', conversion: 'ended' }),
    ]);
  });
});

describe('stage settings (marketing manager)', () => {
  it('rename and switch off keep history; system stages stay; employee 403', async () => {
    const lead = await newLead(manager);
    await move(manager, lead.id, 'qualified');
    const patch = (user: StaffUser, key: string, json: unknown) =>
      send(R['lead-stages/[key]'].PATCH, user, json, { key }, 'PATCH');
    expect((await patch(employee, 'qualified', { label: 'Hot' })).status).toBe(403);
    expect((await patch(manager, 'qualified', { label: 'Interested', active: false })).status).toBe(
      200,
    );
    expect((await patch(manager, 'converted', { active: false })).status).toBe(400);
    // Fix: keys never change; unknown fields are refused.
    expect((await patch(manager, 'qualified', { key: 'hot_lead', label: 'Hot' })).status).toBe(400);
    const d = await detail(manager, lead.id);
    expect(d.data?.stageChanges.map((h) => h.toKey)).toContain('qualified');
    expect((await leadRow(lead.id)).stageKey).toBe('qualified');
    const other = await newLead(manager);
    expect((await move(manager, other.id, 'qualified')).status).toBe(400);
    const del = (key: string) =>
      send(R['lead-stages/[key]'].DELETE, manager, undefined, { key }, 'DELETE');
    expect((await del('qualified')).status).toBe(409);
    const add = await send(R['lead-stages'].POST, manager, {
      key: 'call_back_later',
      label: 'Call back later',
    });
    expect(add.status).toBe(201);
    expect(
      (await send(R['lead-stages'].POST, manager, { key: 'call_back_later', label: 'Again' }))
        .status,
    ).toBe(409);
    expect(
      (await send(R['lead-stages'].POST, employee, { key: 'mine_only', label: 'Mine' })).status,
    ).toBe(403);
    expect((await del('call_back_later')).status).toBe(200);
    const keys = (await ctx.db.select().from(opsLeadStages)).map((s) => s.key);
    expect(keys).toHaveLength(12);
  });
});

describe('duplicate review and merge', () => {
  it('employee 403; marketing manager merges with stage history, ownership and DNC preserved', async () => {
    const shared = phone();
    const target = await newLead(employee, {
      studentPhone: shared,
      studentName: 'Sample Twin Lead',
    });
    const source = await newLead(manager, {
      studentPhone: shared,
      studentName: 'Sample Twin Lead',
      acknowledgeDuplicates: { reason: 'Checking later' },
      ownerStaffId: otherEmployee.staffId,
    });
    await move(manager, source.id, 'do_not_contact', 'Asked by parent');
    const mergeRoute = R['leads/[id]/merge'].POST;
    const body = { targetLeadId: target.id, note: 'Same student' };
    expect((await send(mergeRoute, employee, body, { id: source.id })).status).toBe(403);
    expect((await send(mergeRoute, manager, body, { id: source.id })).status).toBe(200);
    const src = await leadRow(source.id);
    expect(src).toMatchObject({
      mergedIntoLeadId: target.id,
      stageKey: 'duplicate',
      ownerStaffId: otherEmployee.staffId,
    });
    expect(await leadRow(target.id)).toMatchObject({
      doNotContact: true,
      ownerStaffId: employee.staffId,
    });
    const d = await detail(manager, target.id);
    expect(d.data?.stageChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leadId: source.id,
          toKey: 'do_not_contact',
          reason: 'Asked by parent',
        }),
        expect.objectContaining({ leadId: source.id, toKey: 'duplicate' }),
      ]),
    );
    // Fix I1: the target moves to Do not contact with a history row naming the merged lead.
    expect((await leadRow(target.id)).stageKey).toBe('do_not_contact');
    expect(d.data?.stageChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leadId: target.id,
          toKey: 'do_not_contact',
          reason: `Merged from ${source.code}`,
        }),
      ]),
    );
    const leave = await move(manager, target.id, 'nurture', 'Parent asked for a call');
    expect(leave.data).toMatchObject({ stageKey: 'nurture', doNotContact: false });
    expect(d.data?.history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['lead.merged', 'lead.stage_changed', 'lead.created']),
    );
  });
});

it('employee own scope: another employee’s lead is 403 to read and to work', async () => {
  const lead = await newLead(otherEmployee);
  expect((await detail(employee, lead.id)).status).toBe(403);
  expect((await move(employee, lead.id, 'contacted')).status).toBe(403);
  expect((await detail(manager, lead.id)).status).toBe(200);
});
