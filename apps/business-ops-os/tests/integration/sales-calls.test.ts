/**
 * Sales calls and the lead funnel (owner brief 23 Oct 2026 §10–11): call fields typed by staff,
 * next follow-up through the follow-up service, Do not contact, own scope, and funnel figures
 * that equal their drill-down rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { authedRequest, buildRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import type { IsoDate } from '@elevate/shared-types';
import { auditEvents, notifications, opsFollowUps, opsLeadActivities } from '@elevate/database';
import { leadsRoutes as R } from '../../src/leads';
import { runFollowUpReminders } from '../../src/server/follow-ups';
import { leadFunnel, leadFunnelRows, NOT_STAGED } from '../../src/server/lead-funnel';
import { createLead, getLead, listLeads } from '../../src/server/leads';
import { ensureSystemLeadStages } from '../../src/server/lead-stages';
import { isoDaysFromNow, phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const day = (n: number) => isoDaysFromNow(n) as IsoDate;
let manager: StaffUser;
let employee: StaffUser;
let otherEmployee: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  await ensureSystemLeadStages(ctx.db);
  manager = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Marketing Manager' });
  employee = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Caller' });
  otherEmployee = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Caller 2' });
});

const post = <T = unknown>(
  route: Parameters<typeof callRoute>[0],
  user: StaffUser | null,
  json: unknown,
  params?: Record<string, string>,
) =>
  callRoute<T>(
    route,
    user
      ? authedRequest(user, '/marketing/api/v1/x', { method: 'POST', json })
      : buildRequest('/marketing/api/v1/x', { json }),
    params,
  );
async function newLead(user: StaffUser) {
  const res = await post<{ lead: { id: string } }>(R.leads.POST, user, {
    studentName: 'Sample Call Lead',
    studentPhone: phone(),
  });
  return res.data!.lead.id;
}
const logCall = (user: StaffUser | null, leadId: string, over: Record<string, unknown> = {}) =>
  post<{ activity: { id: string }; followUp: { id: string } | null }>(R['leads/calls'].POST, user, {
    leadId,
    direction: 'outbound',
    outcome: 'connected_two_way',
    ...over,
  });

describe('POST /leads/calls (call log)', () => {
  it('stores the typed call fields and creates, then moves, one follow-up', async () => {
    const leadId = await newLead(employee);
    const due = isoDaysFromNow(3);
    const res = await logCall(employee, leadId, {
      durationMinutes: 5,
      note: 'Discussed CLAT batch timings',
      nextAction: 'Send fee structure',
      nextFollowUpOn: due,
    });
    expect(res.status).toBe(201);
    const [call] = await ctx.db
      .select()
      .from(opsLeadActivities)
      .where(eq(opsLeadActivities.id, res.data!.activity.id as never));
    expect(call).toMatchObject({
      kind: 'call',
      direction: 'outbound',
      durationSeconds: 300,
      nextAction: 'Send fee structure',
      nextFollowUpOn: due,
      staffId: employee.staffId,
    });
    const openFollowUps = () =>
      ctx.db
        .select()
        .from(opsFollowUps)
        .where(
          and(
            eq(opsFollowUps.leadId, leadId as never),
            eq(opsFollowUps.status, 'open'),
            eq(opsFollowUps.source, 'manual'),
          ),
        );
    expect(await openFollowUps()).toEqual([
      expect.objectContaining({
        dueDate: due,
        title: 'Send fee structure',
        ownerStaffId: employee.staffId,
      }),
    ]);
    const later = isoDaysFromNow(6);
    expect(
      (await logCall(employee, leadId, { outcome: 'no_answer', nextFollowUpOn: later })).status,
    ).toBe(201);
    expect((await openFollowUps()).map((f) => f.dueDate)).toEqual([later]);
    const moved = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'followup.rescheduled'));
    expect(moved).toHaveLength(1);
  });

  it.each([
    ['no session', null, {}, 401],
    ['no direction', 'employee', { direction: undefined }, 400],
    ['duration over a day', 'employee', { durationMinutes: 2000 }, 400],
    ['duration not in whole minutes', 'employee', { durationMinutes: 4.5 }, 400],
    ['follow-up in the past', 'employee', { nextFollowUpOn: isoDaysFromNow(-2) }, 400],
    ['another employee’s lead', 'other', {}, 403],
  ] as const)('%s → %i', async (_, who, over, code) => {
    const leadId = await newLead(employee);
    const user = who === 'employee' ? employee : who === 'other' ? otherEmployee : null;
    expect((await logCall(user, leadId, over)).status).toBe(code);
  });

  it.each([
    ['a duration', { durationMinutes: 3 }],
    ['a direction', { direction: 'inbound' }],
  ])('%s on a non-call contact is refused', async (_, extra) => {
    const leadId = await newLead(employee);
    const res = await post(
      R['leads/[id]/activities'].POST,
      employee,
      { kind: 'whatsapp', outcome: 'replied', ...extra },
      { id: leadId },
    );
    expect(res.status).toBe(400);
  });

  it('Do not contact blocks outbound calls with a clear message; an inbound call can be logged', async () => {
    const leadId = await newLead(employee);
    await post(
      R['leads/[id]/stage'].POST,
      employee,
      { stageKey: 'do_not_contact', reason: 'Asked by parent' },
      { id: leadId },
    );
    const blocked = await logCall(employee, leadId);
    expect(blocked.status).toBe(409);
    expect(blocked.error?.message).toMatch(/Do not contact/);
    expect((await logCall(employee, leadId, { direction: 'inbound' })).status).toBe(201);
  });
});

it('GET /leads/calls: employees see calls on their own leads; filters apply', async () => {
  const mine = await newLead(employee);
  const theirs = await newLead(otherEmployee);
  await logCall(employee, mine, { direction: 'inbound', outcome: 'other' });
  await logCall(otherEmployee, theirs);
  const list = async (user: StaffUser, query = '') =>
    (
      await callRoute<{ leadId: string; direction: string }[]>(
        R['leads/calls'].GET,
        authedRequest(user, `/marketing/api/v1/leads/calls${query}`),
      )
    ).data!;
  const own = await list(employee);
  expect(own.every((c) => c.leadId !== theirs)).toBe(true);
  expect(own.some((c) => c.leadId === mine)).toBe(true);
  expect((await list(manager)).some((c) => c.leadId === theirs)).toBe(true);
  expect((await list(employee, '?direction=inbound')).every((c) => c.direction === 'inbound')).toBe(
    true,
  );
});

it('an overdue first-contact follow-up of the case flags and reminds a counsellor, never Marketing, who cannot see it (C4-3)', async () => {
  const counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { name: 'Sample Counsellor' });
  const marketingLead = await newLead(employee);
  const counsellorLead = (
    await createLead(ctx.db, counsellor, {
      studentName: 'Sample Counsellor Lead',
      studentPhone: phone(),
      interestMode: 'undecided',
      sourceCode: 'UNKNOWN',
    })
  ).lead.id;
  const where = inArray(opsFollowUps.leadId, [marketingLead, counsellorLead] as never[]);
  await ctx.db.update(opsFollowUps).set({ dueDate: day(-2) }).where(where);
  const overdue = async (user: StaffUser, id: string) =>
    (await listLeads(ctx.db, user, { flag: 'overdue' })).some((l) => l.id === id);
  expect(await overdue(employee, marketingLead)).toBe(false);
  expect(await overdue(manager, marketingLead)).toBe(false);
  expect(await overdue(counsellor, counsellorLead)).toBe(true);
  await runFollowUpReminders(ctx.db);
  const followUps = await ctx.db.select({ id: opsFollowUps.id }).from(opsFollowUps).where(where);
  const told = await ctx.db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(inArray(notifications.entityId, followUps.map((f) => f.id)));
  expect(told).toEqual([{ userId: counsellor.id }]);
});

it('a successful call keeps its next follow-up open, even one that was for first contact (REV-2 I-1)', async () => {
  const leadId = await newLead(employee);
  const json = { leadId, kind: 'first_contact', dueDate: day(1) };
  expect((await post(R['follow-ups'].POST, employee, json)).status).toBe(201);
  const res = await logCall(employee, leadId, { nextFollowUpOn: day(5) });
  const [next] = await ctx.db
    .select()
    .from(opsFollowUps)
    .where(eq(opsFollowUps.id, res.data!.followUp!.id as never));
  expect(next).toMatchObject({ status: 'open', dueDate: day(5) });
});

it('Marketing sees no follow-up of the case, in the lead’s follow-ups or its history (REV-2 I-2)', async () => {
  const leadId = await newLead(employee);
  expect((await logCall(employee, leadId, { nextFollowUpOn: day(2) })).status).toBe(201);
  const view = await getLead(ctx.db, employee, leadId);
  expect(view.followUps.map((f) => f.admissionId)).toEqual([null]);
  const audits = view.history.filter((h) => h.entityType === 'follow_up');
  expect(audits.map((h) => h.action)).toEqual(['followup.created']);
});

describe('lead funnel', () => {
  it('each figure equals its drill-down rows, for the manager and in own scope', async () => {
    const ids = [await newLead(employee), await newLead(employee), await newLead(otherEmployee)];
    await post(R['leads/[id]/stage'].POST, employee, { stageKey: 'qualified' }, { id: ids[0]! });
    await post(
      R['leads/[id]/stage'].POST,
      employee,
      { stageKey: 'lost', reason: 'Not interested' },
      { id: ids[1]! },
    );
    const period = { from: day(-1), to: day(1) };
    for (const user of [manager, employee]) {
      const funnel = await leadFunnel(ctx.db, user, period);
      expect(funnel.stagesConfigured).toBe(true);
      for (const s of funnel.stages)
        expect((await leadFunnelRows(ctx.db, user, { ...period, stageKey: s.key })).length).toBe(
          s.count,
        );
      expect((await leadFunnelRows(ctx.db, user, { ...period, stageKey: NOT_STAGED })).length).toBe(
        funnel.notStaged,
      );
      expect(funnel.stages.reduce((n, s) => n + s.count, funnel.notStaged)).toBe(funnel.total);
    }
    const own = await leadFunnelRows(ctx.db, employee, period);
    expect(own.map((r) => r.id)).not.toContain(ids[2]);
    expect(
      (await leadFunnel(ctx.db, employee, period)).stages.find((s) => s.key === 'qualified')?.count,
    ).toBeGreaterThan(0);
    const outside = await leadFunnel(ctx.db, manager, { from: day(-30), to: day(-20) });
    expect(outside.total).toBe(0);
  });
});
