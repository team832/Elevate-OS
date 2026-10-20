import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import {
  eventDeliveries,
  integrationEvents,
  opsIncidents,
  opsPolicyVersions,
  opsTasks,
} from '@elevate/database';
import { GET as listRisks, POST as createRisk } from '../../src/app/api/v1/risks/route';
import {
  GET as listMitigations,
  POST as addMitigation,
} from '../../src/app/api/v1/risks/[id]/mitigations/route';
import { PATCH as patchMitigation } from '../../src/app/api/v1/risks/[id]/mitigations/[mitigationId]/route';
import { POST as createProject, GET as listProjects } from '../../src/app/api/v1/projects/route';
import { PATCH as patchProject } from '../../src/app/api/v1/projects/[id]/route';
import { GET as blockedProjects } from '../../src/app/api/v1/projects/blocked/route';
import { GET as listIncidents, POST as createIncident } from '../../src/app/api/v1/incidents/route';
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../../src/app/api/v1/settings/policies/route';
import {
  GET as getPolicy,
  PATCH as patchPolicy,
} from '../../src/app/api/v1/settings/policies/[id]/route';
import { PUT as policyDraft } from '../../src/app/api/v1/settings/policies/[id]/draft/route';
import { POST as policyWorkflow } from '../../src/app/api/v1/settings/policies/[id]/workflow/route';
import { GET as policyHistory } from '../../src/app/api/v1/settings/policies/[id]/history/route';
import { GET as report } from '../../src/app/api/v1/reports/operations/route';
import { isoDaysFromNow, setupReference, type StaffUser } from './fixtures';
import { get, post, staffIn, statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let manager2: StaffUser;
let director: StaffUser;
let counsellor: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffIn(ctx.db, ['operations_manager']);
  manager2 = await staffIn(ctx.db, ['operations_manager']);
  director = await staffIn(ctx.db, ['director']);
  counsellor = await staffIn(ctx.db, ['admissions_counsellor']);
});

describe('risk mitigations', () => {
  it('add, progress and drop (outcome required); finished actions are final; director cannot write', async () => {
    const risk = await callRoute<{ id: string }>(
      createRisk,
      post(manager, {
        kind: 'risk',
        title: 'Only one person can open the office (fictional)',
        likelihood: 'medium',
        impact: 'high',
      }),
    );
    const id = risk.data!.id;
    expect(await statusOf(addMitigation, post(director, { action: 'x' }), { id })).toBe(403);
    const m = await callRoute<{ id: string; status: string }>(
      addMitigation,
      post(manager, {
        action: 'Train a backup key holder',
        ownerStaffId: manager2.staffId,
        dueDate: isoDaysFromNow(-1),
      }),
      { id },
    );
    expect(m.status).toBe(201);
    const list = await callRoute<{ overdue: boolean }[]>(listMitigations, get(director), { id });
    expect(list.data?.[0]?.overdue).toBe(true);
    const at = { id, mitigationId: m.data!.id };
    const patch = (json: unknown) => statusOf(patchMitigation, post(manager, json, 'PATCH'), at);
    expect(await patch({ status: 'dropped' })).toBe(400);
    expect(await patch({ status: 'done' })).toBe(200);
    expect(await patch({ dueDate: isoDaysFromNow(3) })).toBe(409);
    const risks = await callRoute<{ id: string; mitigations: { status: string }[] }[]>(
      listRisks,
      get(director),
    );
    expect(risks.data?.find((r) => r.id === id)?.mitigations.map((x) => x.status)).toEqual([
      'done',
    ]);
  });
});

describe('blocked projects', () => {
  it('on-hold and blocked-task projects are listed with reasons; completed ones are not', async () => {
    const project = async (name: string, status: string) =>
      (await callRoute<{ id: string }>(createProject, post(manager, { name, status }))).data!.id;
    const p = await project('Blocked project (fictional)', 'active');
    await ctx.db.insert(opsTasks).values({
      code: 'TSK-90001',
      title: 'Blocked linked task (fictional)',
      status: 'blocked',
      projectId: p as never,
      createdBy: manager.id,
    });
    const done = await project('Done project (fictional)', 'active');
    await callRoute(patchProject, post(manager, { status: 'completed' }, 'PATCH'), { id: done });
    const held = await project('Held project (fictional)', 'on_hold');
    const r = await callRoute<{ id: string; reasons: string[] }[]>(blockedProjects, get(director));
    expect(r.data?.find((x) => x.id === p)?.reasons).toEqual(['blocked_tasks']);
    expect(r.data?.find((x) => x.id === held)?.reasons).toEqual(['on_hold']);
    expect(r.data?.some((x) => x.id === done)).toBe(false);
    expect(await statusOf(blockedProjects, get(counsellor))).toBe(403);
    expect(await statusOf(listProjects, get(director))).toBe(200);
  });
});

describe('incident resolution target flags', () => {
  it('an old high-severity open incident is breached (setting is proposed)', async () => {
    const inc = await callRoute<{ id: string }>(
      createIncident,
      post(manager, {
        kind: 'incident',
        category: 'access_problem',
        title: 'Portal down (fictional)',
        severity: 'high',
      }),
    );
    await ctx.db
      .update(opsIncidents)
      .set({ occurredAt: new Date(Date.now() - 6 * 86_400_000) })
      .where(eq(opsIncidents.id, inc.data!.id as never));
    const list = await callRoute<{ id: string; sla: { state: string } }[]>(
      listIncidents,
      get(director),
    );
    expect(list.data?.find((i) => i.id === inc.data!.id)?.sla.state).toBe('breached');
  });
});

describe('policies & compliance register (OPS-066)', () => {
  type P = { id: string; code: string; status: string };
  const base = {
    title: 'Staff leave request notice (fictional test entry)',
    area: 'leave',
    requirementText:
      'Leave requests are raised at least 3 days ahead (test text entered by staff).',
    sourceReference: 'Test handbook v0 (fictional)',
    linkedSettingKeys: ['tasks.reminders'],
    effectiveDate: isoDaysFromNow(0),
    nextReviewDate: isoDaysFromNow(10),
  };
  const flow = (user: StaffUser, json: unknown, id: string) =>
    statusOf(policyWorkflow, post(user, json), { id });
  /** A proposed entry with an accountable person. */
  const proposed = async () => {
    const created = await callRoute<P>(
      createPolicy,
      post(manager, { ...base, accountableStaffId: manager.staffId }),
    );
    const id = created.data!.id;
    await flow(manager, { action: 'propose' }, id);
    return id;
  };

  it('auditor and director are read-only; invalid setting keys and dates are rejected', async () => {
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect(await statusOf(listPolicies, get(auditor))).toBe(200);
    expect(await statusOf(createPolicy, post(auditor, base))).toBe(403);
    expect(await statusOf(createPolicy, post(director, base))).toBe(403);
    expect(await statusOf(listPolicies, get(counsellor))).toBe(403);
    for (const bad of [
      { linkedSettingKeys: ['no.such.key'] },
      { nextReviewDate: isoDaysFromNow(-5) },
      { area: 'astrology' },
    ])
      expect(await statusOf(createPolicy, post(manager, { ...base, ...bad }))).toBe(400);
  });

  it('draft → proposed → approved by another person; changes create a new version; retired stays readable', async () => {
    const created = await callRoute<P>(createPolicy, post(manager, base));
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ status: 'draft' });
    expect(created.data?.code).toMatch(/^POL-\d{4}$/);
    const id = created.data!.id;
    // Proposal needs an accountable person.
    expect(await flow(manager, { action: 'propose' }, id)).toBe(400);
    await callRoute(patchPolicy, post(manager, { accountableStaffId: manager2.staffId }, 'PATCH'), {
      id,
    });
    expect(await flow(manager, { action: 'propose' }, id)).toBe(200);
    // Editing a proposed version is refused; the proposer cannot approve.
    expect(
      await statusOf(policyDraft, post(manager, { requirementText: 'changed' }, 'PUT'), { id }),
    ).toBe(409);
    expect(await flow(manager, { action: 'approve' }, id)).toBe(403);
    expect(await flow(manager2, { action: 'approve', comment: 'Agreed' }, id)).toBe(200);
    type Detail = {
      policy: { status: string };
      versions: { versionNumber: number; status: string; requirementText: string }[];
      reviewFlag: string;
    };
    const detail = async () => (await callRoute<Detail>(getPolicy, get(director), { id })).data;
    let d = await detail();
    expect(d?.policy.status).toBe('approved');
    expect(d?.reviewFlag).toBe('due_soon');
    // A change creates version 2; version 1 text is unchanged and stays approved.
    const revised = { ...base, requirementText: 'Revised text (test).' };
    expect(await statusOf(policyDraft, post(manager2, revised, 'PUT'), { id })).toBe(200);
    d = await detail();
    expect(d?.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, 'draft'],
      [1, 'approved'],
    ]);
    expect(d?.versions[1]?.requirementText).toBe(base.requirementText);
    expect(d?.policy.status).toBe('approved');
    await flow(manager2, { action: 'propose' }, id);
    await flow(manager, { action: 'approve' }, id);
    const versions = await ctx.db
      .select()
      .from(opsPolicyVersions)
      .where(eq(opsPolicyVersions.policyId, id as never));
    expect(versions.map((v) => [v.versionNumber, v.status]).sort()).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    // Retire; it remains readable and read-only.
    expect(await flow(manager, { action: 'retire', reason: 'Replaced (test)' }, id)).toBe(200);
    expect((await detail())?.policy.status).toBe('retired');
    expect(await statusOf(patchPolicy, post(manager, { title: 'x' }, 'PATCH'), { id })).toBe(409);
    const h = await callRoute<{ action: string }[]>(policyHistory, get(director), { id });
    expect(h.data?.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'policy.created',
        'policy.proposed',
        'policy.approved',
        'policy.retired',
      ]),
    );
    const filtered = await callRoute<P[]>(
      listPolicies,
      get(director, '/x?status=retired&area=leave'),
    );
    expect(filtered.data?.map((p) => p.id)).toContain(id);
  });

  it.each([
    ['director', 200],
    ['hr_manager', 200],
    ['hr_contributor', 403],
    ['auditor', 403],
  ] as const)('ops:policies:approve — %s deciding a proposed version → %i', async (role, code) => {
    const id = await proposed();
    const decider = await staffIn(ctx.db, [role]);
    expect(await flow(decider, { action: 'approve' }, id)).toBe(code);
    // Deciding never lets them propose or retire.
    expect(await flow(decider, { action: 'retire', reason: 'x' }, id)).toBe(403);
  });

  it('rejection needs a comment and returns the entry to draft', async () => {
    const id = await proposed();
    expect(await flow(manager2, { action: 'reject' }, id)).toBe(400);
    expect(await flow(manager2, { action: 'reject', comment: 'Needs the source' }, id)).toBe(200);
    const d = await callRoute<{ policy: { status: string } }>(getPolicy, get(manager), { id });
    expect(d.data?.policy.status).toBe('draft');
  });
});

describe('operations report', () => {
  it('403 for a counsellor; rates are missing (never 0 %) without data; integration errors counted', async () => {
    expect(await statusOf(report, get(counsellor))).toBe(403);
    const [ev] = await ctx.db
      .insert(integrationEvents)
      .values({
        type: 'academic.enrolment.confirmed',
        version: 1,
        producer: 'academic',
        idempotencyKey: `test-${Date.now()}`,
        payload: {},
      })
      .returning();
    await ctx.db.insert(eventDeliveries).values({
      eventId: ev!.id,
      consumer: 'ops.enrolment-replies',
      status: 'dead',
      attempts: 5,
      lastError: 'test failure',
    });
    type R = {
      kpis: Record<string, { status: string; value: number | null }>;
      integrationErrors: { consumer: string }[];
      capacity: { byOwner: { label: string }[] };
    };
    const r = await callRoute<R>(report, get(director));
    expect(r.status).toBe(200);
    expect(r.data?.kpis.sopAcknowledgementCoverage).toMatchObject({
      status: 'missing',
      value: null,
    });
    expect(r.data?.kpis.unresolvedIntegrationErrors).toMatchObject({ status: 'ok', value: 1 });
    expect(r.data?.integrationErrors[0]?.consumer).toBe('ops.enrolment-replies');
    expect(r.data?.kpis.blockedProjects?.value).toBeGreaterThanOrEqual(1);
    const labels = (r.data?.capacity.byOwner.map((x) => x.label) ?? []).filter(
      (l) => l !== 'No owner',
    );
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});
