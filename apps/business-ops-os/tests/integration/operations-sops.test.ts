import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
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
import {
  approvedSop,
  department,
  get,
  post,
  staffIn,
  staffWithoutLogin,
  statusOf,
} from './operations-fixtures';

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
const detail = async (user: StaffUser, id: string) =>
  (await callRoute<Detail>(getSop, get(user), { id })).data;
const schedule = (user: StaffUser, id: string, effective: number, review?: number) =>
  statusOf(
    setSchedule,
    post(
      user,
      {
        effectiveDate: isoDaysFromNow(effective),
        ...(review === undefined ? {} : { nextReviewDate: isoDaysFromNow(review) }),
      },
      'PUT',
    ),
    { id },
  );

describe('SOP effective date, publication and version history', () => {
  it('schedule only after approval; published once the effective date is reached; history kept', async () => {
    const { id } = await approvedSop(owner, reviewer, director);
    expect(await schedule(member1, id, 0)).toBe(403);
    expect(await schedule(owner, id, 5, 1)).toBe(400);
    expect(await schedule(owner, id, 10)).toBe(200);
    expect((await detail(member1, id))?.publicationState).toBe('approved_not_yet_effective');
    await schedule(owner, id, -1, 300);
    expect((await detail(member1, id))?.publicationState).toBe('published');
    // A new draft keeps the approved version in force (history never erased).
    const draft = post(owner, { content: 'v2 text', changeNote: 'Add step 3' }, 'PUT');
    await callRoute(saveDraft, draft, { id });
    const d = await detail(member1, id);
    expect(d?.versions.map((v) => [v.versionLabel, v.status])).toEqual([
      ['1.0', 'draft'],
      ['0.1', 'approved'],
    ]);
    expect(d?.publicationState).toBe('published');
    const h = await callRoute<{ action: string }[]>(history, get(member1), { id });
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
    expect(await statusOf(archive, post(owner, { reason: 'old' }), { id })).toBe(409);
    await callRoute(workflow, post(owner, { action: 'retire', reason: 'Replaced' }), { id });
    expect(await statusOf(archive, post(owner, { reason: 'Replaced in 2026' }), { id })).toBe(201);
    const d = await callRoute<Detail>(getSop, get(outsider), { id });
    expect(d.status).toBe(200);
    expect(d.data?.publicationState).toBe('archived');
  });
});

describe('required acknowledgements', () => {
  it('department audience; members acknowledge once; outsiders and auditors cannot; report counts', async () => {
    const { id } = await approvedSop(owner, reviewer, director, 'Ack test SOP (fictional)');
    const dept = { audienceType: 'department', departmentId: deptId };
    expect(await statusOf(requireAck, post(member1, dept), { id })).toBe(403);
    expect(await statusOf(requireAck, post(owner, { audienceType: 'department' }), { id })).toBe(
      400,
    );
    const req = await callRoute<{ id: string }>(
      requireAck,
      post(owner, { ...dept, dueDate: isoDaysFromNow(5) }),
      { id },
    );
    expect(req.status).toBe(201);
    expect(await statusOf(requireAck, post(owner, dept), { id })).toBe(409); // one active requirement per audience
    let d = await detail(member1, id);
    expect(d?.myAcknowledgement).toMatchObject({ required: true, canAcknowledge: true });
    expect(d?.acknowledgements.totals).toEqual({
      required: 2,
      acknowledged: 0,
      outstanding: 2,
      noLogin: 1,
    });
    expect(d?.acknowledgements.requirements[0]?.outstanding).toBeNull(); // names hidden from a counsellor
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    for (const [user, code] of [
      [member1, 201],
      [member1, 409],
      [outsider, 403],
      [auditor, 403],
    ] as const)
      expect(await statusOf(acknowledge, post(user, {}), { id })).toBe(code);
    const report = await callRoute<Detail['acknowledgements']>(ackReport, get(owner), { id });
    expect(report.data?.totals).toMatchObject({ acknowledged: 1, outstanding: 1 });
    expect(report.data?.requirements[0]?.outstanding).toEqual(['Bina Desk (fictional)']);
    expect(report.data?.requirements[0]?.noLogin).toEqual(['Chetan No-login (fictional)']);
    const all = await callRoute<{ bySop: { id: string; outstanding: number }[] }>(
      outstanding,
      get(member2),
    );
    expect(all.data?.bySop.find((s) => s.id === id)?.outstanding).toBe(1);
    // Acknowledgements are version-specific and append-only.
    const rows = await ctx.db
      .select()
      .from(opsSopAcknowledgements)
      .where(eq(opsSopAcknowledgements.userId, member1.id));
    expect(rows).toHaveLength(1);
    // Withdrawing needs a reason and removes the requirement from the report.
    const at = { id, requirementId: req.data!.id };
    expect(await statusOf(withdrawReq, post(owner, { reason: '' }), at)).toBe(400);
    expect(await statusOf(withdrawReq, post(owner, { reason: 'Wrong audience' }), at)).toBe(200);
    d = await detail(member1, id);
    expect(d?.acknowledgements.totals.required).toBe(0);
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'sop.acknowledged')));
    expect(audits).toHaveLength(1);
  });

  it('role audience reaches users holding the role', async () => {
    const { id } = await approvedSop(owner, reviewer, director, 'Role ack SOP (fictional)');
    await callRoute(requireAck, post(owner, { audienceType: 'role', role: 'employee' }), { id });
    expect((await detail(member2, id))?.myAcknowledgement.canAcknowledge).toBe(true);
    expect(await statusOf(acknowledge, post(member2, { note: 'Read it' }), { id })).toBe(201);
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
    expect(await schedule(owner, id, 0)).toBe(409);
    const byRole = post(owner, { audienceType: 'role', role: 'employee' });
    expect(await statusOf(requireAck, byRole, { id })).toBe(409);
    const list = await callRoute<{ id: string; publicationState: string; decisionState: string }[]>(
      listSops,
      get(member1),
    );
    const row = list.data?.find((s) => s.id === id);
    expect(row).toMatchObject({ publicationState: 'not_approved', decisionState: 'proposed' });
    const [after] = await ctx.db.select().from(opsSops).where(eq(opsSops.id, id));
    expect(after?.status).toBe('draft');
    expect(after?.approvedVersionId).toBeNull();
  });
});
