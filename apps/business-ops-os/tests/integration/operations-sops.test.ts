import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { auditEvents, opsSopAcknowledgements, opsSops } from '@elevate/database';
import type { DepartmentId } from '@elevate/shared-types';
import { GET as listSops } from '../../src/app/api/v1/sops/route';
import { GET as getSop } from '../../src/app/api/v1/sops/[id]/route';
import { PUT as saveDraft } from '../../src/app/api/v1/sops/[id]/draft/route';
import { POST as workflow } from '../../src/app/api/v1/sops/[id]/workflow/route';
import { PUT as setSchedule } from '../../src/app/api/v1/sops/[id]/schedule/route';
import { POST as archive } from '../../src/app/api/v1/sops/[id]/archive/route';
import {
  GET as ackReport,
  POST as requireAck,
} from '../../src/app/api/v1/sops/[id]/acknowledgement-requirements/route';
import { POST as withdrawReq } from '../../src/app/api/v1/sops/[id]/acknowledgement-requirements/[requirementId]/withdraw/route';
import { POST as acknowledge } from '../../src/app/api/v1/sops/[id]/acknowledge/route';
import { GET as history } from '../../src/app/api/v1/sops/[id]/history/route';
import { GET as outstanding } from '../../src/app/api/v1/sops/acknowledgements/route';
import { importLegacySops } from '../../seed/legacy';
import { isoDaysFromNow, setupReference, type StaffUser } from './fixtures';
import { approvedSop, department, post, staffIn, staffWithoutLogin } from './operations-fixtures';

const ctx = setupTestDatabase();
let owner: StaffUser;
let reviewer: StaffUser;
let director: StaffUser;
let member1: StaffUser;
let member2: StaffUser;
let outsider: StaffUser;
let deptId: DepartmentId;

beforeAll(async () => {
  await setupReference(ctx.db);
  deptId = (await department(ctx.db, 'Front desk (fictional)')).id;
  owner = await staffIn(ctx.db, ['operations_manager']);
  reviewer = await staffIn(ctx.db, ['operations_manager']);
  director = await staffIn(ctx.db, ['director']);
  member1 = await staffIn(ctx.db, ['admissions_counsellor'], {
    departmentId: deptId,
    name: 'Asha Desk (fictional)',
  });
  member2 = await staffIn(ctx.db, ['employee'], {
    departmentId: deptId,
    name: 'Bina Desk (fictional)',
  });
  outsider = await staffIn(ctx.db, ['admissions_counsellor']);
  await staffWithoutLogin(ctx.db, deptId, 'Chetan No-login (fictional)');
});

type Detail = {
  sop: { id: string; status: string; approvedVersionId: string | null };
  publicationState: string;
  versions: { versionLabel: string; status: string }[];
  acknowledgements: {
    totals: { required: number; acknowledged: number; outstanding: number; noLogin: number };
    requirements: { id: string; outstanding: string[] | null; noLogin: string[] | null }[];
  };
  myAcknowledgement: { required: boolean; canAcknowledge: boolean };
};

describe('SOP effective date, publication and version history', () => {
  it('schedule only after approval; published once the effective date is reached; history kept', async () => {
    const created = await approvedSop(owner, reviewer, director);
    const id = created.id;
    expect(
      (
        await callRoute(setSchedule, post(member1, { effectiveDate: isoDaysFromNow(0) }, 'PUT'), {
          id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callRoute(
          setSchedule,
          post(
            owner,
            { effectiveDate: isoDaysFromNow(5), nextReviewDate: isoDaysFromNow(1) },
            'PUT',
          ),
          { id },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await callRoute(setSchedule, post(owner, { effectiveDate: isoDaysFromNow(10) }, 'PUT'), {
          id,
        })
      ).status,
    ).toBe(200);
    let d = await callRoute<Detail>(getSop, authedRequest(member1, '/x'), { id });
    expect(d.data?.publicationState).toBe('approved_not_yet_effective');
    await callRoute(
      setSchedule,
      post(
        owner,
        { effectiveDate: isoDaysFromNow(-1), nextReviewDate: isoDaysFromNow(300) },
        'PUT',
      ),
      { id },
    );
    d = await callRoute<Detail>(getSop, authedRequest(member1, '/x'), { id });
    expect(d.data?.publicationState).toBe('published');
    // A new draft keeps the approved version in force (history never erased).
    await callRoute(
      saveDraft,
      post(owner, { content: 'v2 text', changeNote: 'Add step 3' }, 'PUT'),
      { id },
    );
    d = await callRoute<Detail>(getSop, authedRequest(member1, '/x'), { id });
    expect(d.data?.versions.map((v) => [v.versionLabel, v.status])).toEqual([
      ['1.0', 'draft'],
      ['0.1', 'approved'],
    ]);
    expect(d.data?.publicationState).toBe('published');
    const h = await callRoute<{ action: string }[]>(history, authedRequest(member1, '/x'), { id });
    expect(h.data?.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'sop.created',
        'sop.approved',
        'sop.schedule_set',
        'sop.draft_saved',
      ]),
    );
  });

  it('archive only after retirement; archived SOPs stay readable', async () => {
    const { id } = await approvedSop(owner, reviewer, director, 'Archive me (fictional test SOP)');
    expect((await callRoute(archive, post(owner, { reason: 'old' }), { id })).status).toBe(409);
    await callRoute(workflow, post(owner, { action: 'retire', reason: 'Replaced' }), { id });
    expect(
      (await callRoute(archive, post(owner, { reason: 'Replaced in 2026' }), { id })).status,
    ).toBe(201);
    const d = await callRoute<Detail>(getSop, authedRequest(outsider, '/x'), { id });
    expect(d.status).toBe(200);
    expect(d.data?.publicationState).toBe('archived');
  });
});

describe('required acknowledgements', () => {
  it('department audience; members acknowledge once; outsiders and auditors cannot; report counts', async () => {
    const { id } = await approvedSop(owner, reviewer, director, 'Ack test SOP (fictional)');
    expect(
      (
        await callRoute(
          requireAck,
          post(member1, { audienceType: 'department', departmentId: deptId }),
          { id },
        )
      ).status,
    ).toBe(403);
    expect(
      (await callRoute(requireAck, post(owner, { audienceType: 'department' }), { id })).status,
    ).toBe(400);
    const req = await callRoute<{ id: string }>(
      requireAck,
      post(owner, { audienceType: 'department', departmentId: deptId, dueDate: isoDaysFromNow(5) }),
      { id },
    );
    expect(req.status).toBe(201);
    expect(
      (
        await callRoute(
          requireAck,
          post(owner, { audienceType: 'department', departmentId: deptId }),
          { id },
        )
      ).status,
    ).toBe(409); // one active requirement per audience
    let d = await callRoute<Detail>(getSop, authedRequest(member1, '/x'), { id });
    expect(d.data?.myAcknowledgement).toMatchObject({ required: true, canAcknowledge: true });
    expect(d.data?.acknowledgements.totals).toEqual({
      required: 2,
      acknowledged: 0,
      outstanding: 2,
      noLogin: 1,
    });
    expect(d.data?.acknowledgements.requirements[0]?.outstanding).toBeNull(); // names hidden from a counsellor
    expect((await callRoute(acknowledge, post(member1, {}), { id })).status).toBe(201);
    expect((await callRoute(acknowledge, post(member1, {}), { id })).status).toBe(409);
    expect((await callRoute(acknowledge, post(outsider, {}), { id })).status).toBe(403);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await callRoute(acknowledge, post(auditor, {}), { id })).status).toBe(403);
    const report = await callRoute<Detail['acknowledgements']>(
      ackReport,
      authedRequest(owner, '/x'),
      { id },
    );
    expect(report.data?.totals).toMatchObject({ acknowledged: 1, outstanding: 1 });
    expect(report.data?.requirements[0]?.outstanding).toEqual(['Bina Desk (fictional)']);
    expect(report.data?.requirements[0]?.noLogin).toEqual(['Chetan No-login (fictional)']);
    const all = await callRoute<{ bySop: { id: string; outstanding: number }[] }>(
      outstanding,
      authedRequest(member2, '/x'),
    );
    expect(all.data?.bySop.find((s) => s.id === id)?.outstanding).toBe(1);
    // Acknowledgements are version-specific and append-only.
    const rows = await ctx.db
      .select()
      .from(opsSopAcknowledgements)
      .where(eq(opsSopAcknowledgements.userId, member1.id));
    expect(rows).toHaveLength(1);
    // Withdrawing needs a reason and removes the requirement from the report.
    expect(
      (
        await callRoute(withdrawReq, post(owner, { reason: '' }), {
          id,
          requirementId: req.data!.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callRoute(withdrawReq, post(owner, { reason: 'Wrong audience' }), {
          id,
          requirementId: req.data!.id,
        })
      ).status,
    ).toBe(200);
    d = await callRoute<Detail>(getSop, authedRequest(member1, '/x'), { id });
    expect(d.data?.acknowledgements.totals.required).toBe(0);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'sop.acknowledged')));
    expect(audits).toHaveLength(1);
  });

  it('role audience reaches users holding the role', async () => {
    const { id } = await approvedSop(owner, reviewer, director, 'Role ack SOP (fictional)');
    await callRoute(requireAck, post(owner, { audienceType: 'role', role: 'employee' }), { id });
    const d = await callRoute<Detail>(getSop, authedRequest(member2, '/x'), { id });
    expect(d.data?.myAcknowledgement.canAcknowledge).toBe(true);
    expect((await callRoute(acknowledge, post(member2, { note: 'Read it' }), { id })).status).toBe(
      201,
    );
  });
});

describe('proposed SOPs are never shown as approved or published', () => {
  it('the imported coordinator SOP stays a draft: no schedule, no acknowledgement requirement', async () => {
    await importLegacySops(ctx.db);
    const [coord] = await ctx.db
      .select()
      .from(opsSops)
      .where(eq(opsSops.code, 'LEGACY-ONLINE-SOP-COORDINATOR'));
    expect(coord?.status).toBe('draft');
    const id = coord!.id;
    expect(
      (
        await callRoute(setSchedule, post(owner, { effectiveDate: isoDaysFromNow(0) }, 'PUT'), {
          id,
        })
      ).status,
    ).toBe(409);
    expect(
      (await callRoute(requireAck, post(owner, { audienceType: 'role', role: 'employee' }), { id }))
        .status,
    ).toBe(409);
    const list = await callRoute<{ id: string; publicationState: string; decisionState: string }[]>(
      listSops,
      authedRequest(member1, '/x'),
    );
    const row = list.data?.find((s) => s.id === id);
    expect(row).toMatchObject({ publicationState: 'not_approved', decisionState: 'proposed' });
    const [after] = await ctx.db.select().from(opsSops).where(eq(opsSops.id, id));
    expect(after?.status).toBe('draft');
    expect(after?.approvedVersionId).toBeNull();
  });
});
