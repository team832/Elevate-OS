import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
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
import { post, staffIn } from './operations-fixtures';

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
    expect((await callRoute(addMitigation, post(director, { action: 'x' }), { id })).status).toBe(
      403,
    );
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
    const list = await callRoute<{ overdue: boolean }[]>(
      listMitigations,
      authedRequest(director, '/x'),
      { id },
    );
    expect(list.data?.[0]?.overdue).toBe(true);
    const mid = m.data!.id;
    expect(
      (
        await callRoute(patchMitigation, post(manager, { status: 'dropped' }, 'PATCH'), {
          id,
          mitigationId: mid,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callRoute(patchMitigation, post(manager, { status: 'done' }, 'PATCH'), {
          id,
          mitigationId: mid,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callRoute(patchMitigation, post(manager, { dueDate: isoDaysFromNow(3) }, 'PATCH'), {
          id,
          mitigationId: mid,
        })
      ).status,
    ).toBe(409);
    const risks = await callRoute<{ id: string; mitigations: { status: string }[] }[]>(
      listRisks,
      authedRequest(director, '/x'),
    );
    expect(risks.data?.find((r) => r.id === id)?.mitigations.map((x) => x.status)).toEqual([
      'done',
    ]);
  });
});

describe('blocked projects', () => {
  it('on-hold and blocked-task projects are listed with reasons; completed ones are not', async () => {
    const p = await callRoute<{ id: string; code: string }>(
      createProject,
      post(manager, { name: 'Blocked project (fictional)', status: 'active' }),
    );
    await ctx.db.insert(opsTasks).values({
      code: 'TSK-90001',
      title: 'Blocked linked task (fictional)',
      status: 'blocked',
      projectId: p.data!.id as never,
      createdBy: manager.id,
    });
    const done = await callRoute<{ id: string }>(
      createProject,
      post(manager, { name: 'Done project (fictional)', status: 'active' }),
    );
    await callRoute(patchProject, post(manager, { status: 'completed' }, 'PATCH'), {
      id: done.data!.id,
    });
    const held = await callRoute<{ id: string }>(
      createProject,
      post(manager, { name: 'Held project (fictional)', status: 'on_hold' }),
    );
    const r = await callRoute<{ id: string; reasons: string[] }[]>(
      blockedProjects,
      authedRequest(director, '/x'),
    );
    expect(r.data?.find((x) => x.id === p.data!.id)?.reasons).toEqual(['blocked_tasks']);
    expect(r.data?.find((x) => x.id === held.data!.id)?.reasons).toEqual(['on_hold']);
    expect(r.data?.some((x) => x.id === done.data!.id)).toBe(false);
    expect((await callRoute(blockedProjects, authedRequest(counsellor, '/x'))).status).toBe(403);
    expect((await callRoute(listProjects, authedRequest(director, '/x'))).status).toBe(200);
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
      authedRequest(director, '/x'),
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

  it('auditor and director are read-only; invalid setting keys and dates are rejected', async () => {
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await callRoute(listPolicies, authedRequest(auditor, '/x'))).status).toBe(200);
    expect((await callRoute(createPolicy, post(auditor, base))).status).toBe(403);
    expect((await callRoute(createPolicy, post(director, base))).status).toBe(403);
    expect((await callRoute(listPolicies, authedRequest(counsellor, '/x'))).status).toBe(403);
    const bad = await callRoute(
      createPolicy,
      post(manager, { ...base, linkedSettingKeys: ['no.such.key'] }),
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await callRoute(
          createPolicy,
          post(manager, { ...base, nextReviewDate: isoDaysFromNow(-5) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await callRoute(createPolicy, post(manager, { ...base, area: 'astrology' }))).status,
    ).toBe(400);
  });

  it('draft → proposed → approved by another person; changes create a new version; retired stays readable', async () => {
    const created = await callRoute<P>(createPolicy, post(manager, base));
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ status: 'draft' });
    expect(created.data?.code).toMatch(/^POL-\d{4}$/);
    const id = created.data!.id;
    // Proposal needs an accountable person.
    expect(
      (await callRoute(policyWorkflow, post(manager, { action: 'propose' }), { id })).status,
    ).toBe(400);
    await callRoute(patchPolicy, post(manager, { accountableStaffId: manager2.staffId }, 'PATCH'), {
      id,
    });
    expect(
      (await callRoute(policyWorkflow, post(manager, { action: 'propose' }), { id })).status,
    ).toBe(200);
    // Editing a proposed version is refused; the proposer cannot approve.
    expect(
      (await callRoute(policyDraft, post(manager, { requirementText: 'changed' }, 'PUT'), { id }))
        .status,
    ).toBe(409);
    expect(
      (await callRoute(policyWorkflow, post(manager, { action: 'approve' }), { id })).status,
    ).toBe(403);
    expect(
      (
        await callRoute(policyWorkflow, post(manager2, { action: 'approve', comment: 'Agreed' }), {
          id,
        })
      ).status,
    ).toBe(200);
    type Detail = {
      policy: { status: string };
      versions: { versionNumber: number; status: string; requirementText: string }[];
      reviewFlag: string;
    };
    let d = await callRoute<Detail>(getPolicy, authedRequest(director, '/x'), { id });
    expect(d.data?.policy.status).toBe('approved');
    expect(d.data?.reviewFlag).toBe('due_soon');
    // A change creates version 2; version 1 text is unchanged and stays approved.
    expect(
      (
        await callRoute(
          policyDraft,
          post(manager2, { ...base, requirementText: 'Revised text (test).' }, 'PUT'),
          { id },
        )
      ).status,
    ).toBe(200);
    d = await callRoute<Detail>(getPolicy, authedRequest(director, '/x'), { id });
    expect(d.data?.versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [2, 'draft'],
      [1, 'approved'],
    ]);
    expect(d.data?.versions[1]?.requirementText).toBe(base.requirementText);
    expect(d.data?.policy.status).toBe('approved');
    await callRoute(policyWorkflow, post(manager2, { action: 'propose' }), { id });
    await callRoute(policyWorkflow, post(manager, { action: 'approve' }), { id });
    const versions = await ctx.db
      .select()
      .from(opsPolicyVersions)
      .where(eq(opsPolicyVersions.policyId, id as never));
    expect(versions.map((v) => [v.versionNumber, v.status]).sort()).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    // Retire; it remains readable and read-only.
    expect(
      (
        await callRoute(
          policyWorkflow,
          post(manager, { action: 'retire', reason: 'Replaced (test)' }),
          { id },
        )
      ).status,
    ).toBe(200);
    d = await callRoute<Detail>(getPolicy, authedRequest(director, '/x'), { id });
    expect(d.data?.policy.status).toBe('retired');
    expect(
      (await callRoute(patchPolicy, post(manager, { title: 'x' }, 'PATCH'), { id })).status,
    ).toBe(409);
    const h = await callRoute<{ action: string }[]>(policyHistory, authedRequest(director, '/x'), {
      id,
    });
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
      authedRequest(director, '/x?status=retired&area=leave'),
    );
    expect(filtered.data?.map((p) => p.id)).toContain(id);
  });

  it.each([
    ['director', 200],
    ['hr_manager', 200],
    ['hr_contributor', 403],
    ['auditor', 403],
  ] as const)('ops:policies:approve — %s deciding a proposed version → %i', async (role, code) => {
    const created = await callRoute<P>(
      createPolicy,
      post(manager, { ...base, accountableStaffId: manager.staffId }),
    );
    const id = created.data!.id;
    await callRoute(policyWorkflow, post(manager, { action: 'propose' }), { id });
    const decider = await staffIn(ctx.db, [role]);
    expect(
      (await callRoute(policyWorkflow, post(decider, { action: 'approve' }), { id })).status,
    ).toBe(code);
    // Deciding never lets them propose or retire.
    expect(
      (await callRoute(policyWorkflow, post(decider, { action: 'retire', reason: 'x' }), { id }))
        .status,
    ).toBe(403);
  });

  it('rejection needs a comment and returns the entry to draft', async () => {
    const created = await callRoute<P>(
      createPolicy,
      post(manager, { ...base, accountableStaffId: manager.staffId }),
    );
    const id = created.data!.id;
    await callRoute(policyWorkflow, post(manager, { action: 'propose' }), { id });
    expect(
      (await callRoute(policyWorkflow, post(manager2, { action: 'reject' }), { id })).status,
    ).toBe(400);
    expect(
      (
        await callRoute(
          policyWorkflow,
          post(manager2, { action: 'reject', comment: 'Needs the source' }),
          { id },
        )
      ).status,
    ).toBe(200);
    const d = await callRoute<{ policy: { status: string } }>(
      getPolicy,
      authedRequest(manager, '/x'),
      { id },
    );
    expect(d.data?.policy.status).toBe('draft');
  });
});

describe('operations report', () => {
  it('403 for a counsellor; rates are missing (never 0 %) without data; integration errors counted', async () => {
    expect((await callRoute(report, authedRequest(counsellor, '/x'))).status).toBe(403);
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
    const r = await callRoute<R>(report, authedRequest(director, '/x'));
    expect(r.status).toBe(200);
    expect(r.data?.kpis.sopAcknowledgementCoverage).toMatchObject({
      status: 'missing',
      value: null,
    });
    expect(r.data?.kpis.unresolvedIntegrationErrors).toMatchObject({ status: 'ok', value: 1 });
    expect(r.data?.integrationErrors[0]?.consumer).toBe('ops.enrolment-replies');
    expect(r.data?.kpis.blockedProjects?.value).toBeGreaterThanOrEqual(1);
    const labels = r.data?.capacity.byOwner.map((x) => x.label) ?? [];
    expect(labels.filter((l) => l !== 'No owner')).toEqual(
      [...labels.filter((l) => l !== 'No owner')].sort((a, b) => a.localeCompare(b)),
    );
  });
});
