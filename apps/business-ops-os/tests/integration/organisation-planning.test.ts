import { beforeAll, describe, expect, it } from 'vitest';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as directory } from '../../src/app/api/v1/organisation/route';
import { POST as createStaff } from '../../src/app/api/v1/staff/route';
import { PATCH as patchStaff } from '../../src/app/api/v1/staff/[id]/route';
import { POST as startOnboarding } from '../../src/app/api/v1/staff/[id]/onboarding/route';
import { POST as createResponsibility } from '../../src/app/api/v1/responsibilities/route';
import { GET as listDecisions, POST as createDecision } from '../../src/app/api/v1/decisions/route';
import { PATCH as patchDecision } from '../../src/app/api/v1/decisions/[id]/route';
import { GET as listRisks, POST as createRisk } from '../../src/app/api/v1/risks/route';
import { POST as createProject } from '../../src/app/api/v1/projects/route';
import { POST as addMilestone } from '../../src/app/api/v1/projects/[id]/milestones/route';
import { PATCH as patchMilestone } from '../../src/app/api/v1/milestones/[id]/route';
import { POST as createIncident } from '../../src/app/api/v1/incidents/route';
import { PATCH as patchIncident } from '../../src/app/api/v1/incidents/[id]/route';
import { GET as listSettings } from '../../src/app/api/v1/settings/route';
import { PUT as putSetting } from '../../src/app/api/v1/settings/[key]/route';
import { GET as workInventory } from '../../src/app/api/v1/work-inventory/route';
import { importLegacyDecisions, importWorkInventory } from '../../seed/legacy';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let director: TestUser;
let auditor: TestUser;
const req = (user: { token: string }, json: unknown, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/x', { method, json });

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

describe('staff directory (steward of core tables)', () => {
  it('counsellor and auditor can read but not administer staff', async () => {
    expect((await callRoute(directory, authedRequest(counsellor, '/x'))).status).toBe(200);
    expect(
      (await callRoute(createStaff, req(counsellor, { fullName: 'X (fictional)' }))).status,
    ).toBe(403);
    expect((await callRoute(createStaff, req(auditor, { fullName: 'X (fictional)' }))).status).toBe(
      403,
    );
  });

  it('creates staff, rejects reporting-line loops, builds the onboarding checklist', async () => {
    const a = await callRoute<{ id: string }>(
      createStaff,
      req(manager, {
        fullName: 'Lead A (fictional)',
        employmentType: 'full_time',
        roleLabels: ['Operations Lead'],
      }),
    );
    const b = await callRoute<{ id: string }>(
      createStaff,
      req(manager, { fullName: 'Member B (fictional)', managerId: a.data!.id }),
    );
    expect(b.status).toBe(201);
    const loop = await callRoute(patchStaff, req(manager, { managerId: b.data!.id }, 'PATCH'), {
      id: a.data!.id,
    });
    expect(loop.status).toBe(409);
    expect(
      (
        await callRoute(patchStaff, req(manager, { managerId: a.data!.id }, 'PATCH'), {
          id: a.data!.id,
        })
      ).status,
    ).toBe(409);
    const items = await callRoute<{ title: string }[]>(startOnboarding, req(manager, {}), {
      id: b.data!.id,
    });
    expect(items.data?.length).toBe(5);
    const again = await callRoute<unknown[]>(startOnboarding, req(manager, {}), { id: b.data!.id });
    expect(again.data?.length).toBe(5);
  });

  it('responsibility gap report lists missing holders/backups; holder = backup is rejected', async () => {
    expect(
      (
        await callRoute(
          createResponsibility,
          req(manager, {
            title: 'Fee verification',
            holderStaffId: counsellor.staffId,
            backupStaffId: counsellor.staffId,
          }),
        )
      ).status,
    ).toBe(400);
    await callRoute(
      createResponsibility,
      req(manager, { title: 'Demo booking', holderStaffId: counsellor.staffId, critical: true }),
    );
    const dir = await callRoute<{ gaps: { title: string; gaps: string[]; critical: boolean }[] }>(
      directory,
      authedRequest(manager, '/x'),
    );
    expect(dir.data?.gaps.find((g) => g.title === 'Demo booking')).toMatchObject({
      gaps: ['no_backup'],
      critical: true,
    });
  });
});

describe('planning registers', () => {
  it('imports 24 legacy decisions with original statuses; director records and supersedes decisions', async () => {
    await importLegacyDecisions(ctx.db);
    await importLegacyDecisions(ctx.db);
    const list = await callRoute<{ code: string; state: string; legacyStatus: string }[]>(
      listDecisions,
      authedRequest(auditor, '/x'),
    );
    expect(list.data?.filter((d) => d.code.startsWith('LEGACY-OPSWB-D-'))).toHaveLength(24);
    expect(list.data?.find((d) => d.code === 'LEGACY-OPSWB-D-016')).toMatchObject({
      state: 'open',
      legacyStatus: 'Open',
    });
    const decide = (user: { token: string }, json: object) =>
      callRoute<{ id: string; code: string }>(createDecision, req(user, json));
    expect((await decide(counsellor, { area: 'x', statement: 'y' })).status).toBe(403);
    const undated = { area: 'Demo', statement: 'z', state: 'confirmed' };
    expect((await decide(director, undated)).status).toBe(400);
    const d1 = await decide(director, {
      area: 'Demo limits',
      statement: 'Proposal A (test)',
      ownerDecisionRef: 'OD-012',
    });
    const d2 = await decide(director, {
      area: 'Demo limits',
      statement: 'Proposal B (test)',
      state: 'confirmed',
      decidedOn: '2026-10-18',
    });
    expect(d1.data?.code).toMatch(/^DEC-\d{4}$/);
    const supersede = (json: object) =>
      statusOf(patchDecision, req(director, { state: 'superseded', ...json }, 'PATCH'), {
        id: d1.data!.id,
      });
    expect(await supersede({})).toBe(400);
    expect(await supersede({ supersededById: d2.data!.id })).toBe(200);
  });

  it('risks are flagged (high severity, no owner); director cannot write risks', async () => {
    expect(await statusOf(createRisk, req(director, { kind: 'risk', title: 'x' }))).toBe(403);
    await callRoute(
      createRisk,
      req(manager, {
        kind: 'blocker',
        title: 'CRM decision pending (OD-010)',
        likelihood: 'high',
        impact: 'medium',
      }),
    );
    const list = await callRoute<{ title: string; flags: string[]; severity: string }[]>(
      listRisks,
      authedRequest(director, '/x'),
    );
    expect(list.data?.[0]).toMatchObject({
      severity: 'high',
      flags: ['high_severity', 'no_owner'],
    });
  });

  it('milestone dependencies reject cycles and block completion of dependants', async () => {
    const name = 'Test project (fictional)';
    const backwards = { name, startDate: '2026-11-01', endDate: '2026-10-01' };
    expect(await statusOf(createProject, req(manager, backwards))).toBe(400);
    const project = await callRoute<{ id: string }>(createProject, req(manager, { name }));
    const milestone = (json: object) =>
      callRoute<{ id: string }>(addMilestone, req(manager, json), { id: project.data!.id });
    const m1 = (await milestone({ title: 'M1' })).data!.id;
    const m2 = (await milestone({ title: 'M2', dependsOnMilestoneIds: [m1] })).data!.id;
    const patch = (id: string, json: object) =>
      statusOf(patchMilestone, req(manager, json, 'PATCH'), { id });
    expect(await patch(m1, { addDependsOnMilestoneId: m2 })).toBe(409);
    expect(await patch(m2, { status: 'done' })).toBe(409);
    expect(await patch(m1, { status: 'done' })).toBe(200);
  });

  it('work inventory import (25 rows) is readable by the auditor', async () => {
    await importWorkInventory(ctx.db);
    const list = await callRoute<{ code: string }[]>(workInventory, authedRequest(auditor, '/x'));
    expect(list.data).toHaveLength(25);
  });

  it('incidents: fee exceptions are flagged for authorised approval; resolving needs a resolution', async () => {
    const inc = await callRoute<{ id: string; needsAuthorisedApproval: boolean }>(
      createIncident,
      req(manager, { kind: 'exception', category: 'fee_waiver', title: 'Waiver request (test)' }),
    );
    expect(inc.data?.needsAuthorisedApproval).toBe(true);
    const resolve = (json: object) =>
      statusOf(patchIncident, req(manager, { status: 'resolved', ...json }, 'PATCH'), {
        id: inc.data!.id,
      });
    expect(await resolve({})).toBe(400);
    expect(await resolve({ resolution: 'Referred to director' })).toBe(200);
  });
});

describe('settings (policy register)', () => {
  it('changes stay proposed; legacy-approved demo terms are read-only; auditor cannot change', async () => {
    const before = await callRoute<{ key: string; decisionState: string }[]>(
      listSettings,
      authedRequest(auditor, '/x'),
    );
    expect(before.data?.find((s) => s.key === 'demo.fee')?.decisionState).toBe(
      'pending_verification',
    );
    const put = (user: { token: string }, key: string, value: unknown) =>
      callRoute<{ decisionState: string; value: unknown }>(
        putSetting,
        req(user, { value }, 'PUT'),
        { key },
      );
    expect((await put(auditor, 'demo.fee', { amountInr: 1 })).status).toBe(403);
    expect((await put(manager, 'demo.terms', { days: 3 })).status).toBe(400);
    const res = await put(manager, 'pipeline.demo_skip', { allowed: false });
    expect(res.data).toMatchObject({ decisionState: 'proposed', value: { allowed: false } });
  });
});
