import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { approvals, opsSops, opsSopVersions } from '@elevate/database';
import { GET as listSops, POST as createSop } from '../../src/app/api/v1/sops/route';
import { GET as getSop, PATCH as patchSop } from '../../src/app/api/v1/sops/[id]/route';
import { PUT as saveDraft } from '../../src/app/api/v1/sops/[id]/draft/route';
import { POST as workflow } from '../../src/app/api/v1/sops/[id]/workflow/route';
import { importLegacySops } from '../../seed/legacy';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { get, post as req, statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
let owner: StaffUser; // operations manager who owns the SOP
let reviewer: StaffUser;
let director: StaffUser;
let counsellor: StaffUser;

const flow = (user: { token: string }, json: unknown, id: string) =>
  statusOf(workflow, req(user, json), { id });
const recommend = { action: 'review', outcome: 'recommend_approval' };

beforeAll(async () => {
  await setupReference(ctx.db);
  owner = await staffUser(ctx.db, ['operations_manager']);
  reviewer = await staffUser(ctx.db, ['operations_manager']);
  director = await staffUser(ctx.db, ['director']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
});

describe('SOP register and approval rules', () => {
  it('counsellor can read but not administer SOPs', async () => {
    expect(await statusOf(listSops, get(counsellor))).toBe(200);
    expect(await statusOf(createSop, req(counsellor, { title: 'x' }))).toBe(403);
  });

  it('full lifecycle: reviewer required, owner cannot approve, reviewer must recommend, director approves', async () => {
    const created = await callRoute<{ id: string; code: string; status: string }>(
      createSop,
      req(owner, {
        title: 'Enquiry capture (test)',
        ownerStaffId: owner.staffId,
        content: '1. Answer the call.\n2. Record the enquiry.',
      }),
    );
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ status: 'draft' });
    expect(created.data?.code).toMatch(/^SOP-\d{4}$/);
    const id = created.data!.id;
    const setReviewer = (reviewerStaffId: string) =>
      statusOf(patchSop, req(owner, { reviewerStaffId }, 'PATCH'), { id });
    expect(await flow(owner, { action: 'submit' }, id)).toBe(400); // no reviewer
    expect(await setReviewer(owner.staffId)).toBe(400); // reviewer = owner
    expect(await setReviewer(reviewer.staffId)).toBe(200);
    expect(await flow(owner, { action: 'submit' }, id)).toBe(200);
    expect(await flow(director, { action: 'approve' }, id)).toBe(409); // review missing
    expect(await flow(director, recommend, id)).toBe(403); // not the reviewer
    expect(await flow(reviewer, { ...recommend, note: 'Good' }, id)).toBe(200);
    expect(await flow(owner, { action: 'approve' }, id)).toBe(403); // owner (and requester) cannot approve
    expect(await flow(counsellor, { action: 'approve' }, id)).toBe(403);
    expect(await flow(director, { action: 'approve', comment: 'OK' }, id)).toBe(200);
    const detail = await callRoute<{
      sop: { status: string; approvedVersionId: string };
      decisionState: string;
      approvals: { status: string }[];
    }>(getSop, get(owner), { id });
    expect(detail.data).toMatchObject({ decisionState: 'approved', sop: { status: 'approved' } });
    expect(detail.data?.approvals.map((a) => a.status)).toEqual(['approved']);
  });

  it('a new draft of an approved SOP keeps the approved version in force; history is never erased', async () => {
    const created = await callRoute<{ id: string }>(
      createSop,
      req(owner, {
        title: 'Demo booking (test)',
        ownerStaffId: owner.staffId,
        reviewerStaffId: reviewer.staffId,
        content: 'v1',
      }),
    );
    const id = created.data!.id;
    await flow(owner, { action: 'submit' }, id);
    await flow(reviewer, recommend, id);
    await flow(director, { action: 'approve' }, id);
    const draft = await callRoute<{ versionLabel: string; status: string }>(
      saveDraft,
      req(owner, { content: 'v2 with changes', changeNote: 'Add steps' }, 'PUT'),
      { id },
    );
    expect(draft.data).toMatchObject({ versionLabel: '1.0', status: 'draft' });
    const [sop] = await ctx.db
      .select()
      .from(opsSops)
      .where(eq(opsSops.id, id as never));
    expect(sop?.status).toBe('approved');
    const versions = await ctx.db
      .select()
      .from(opsSopVersions)
      .where(eq(opsSopVersions.sopId, id as never));
    expect(versions.map((v) => v.status).sort()).toEqual(['approved', 'draft']);
    // Reviewer requests changes → requester withdraws → resubmits.
    await flow(owner, { action: 'submit' }, id);
    await flow(reviewer, { action: 'review', outcome: 'changes_requested' }, id);
    expect(await flow(director, { action: 'approve' }, id)).toBe(409);
    expect(await flow(reviewer, { action: 'withdraw' }, id)).toBe(403);
    expect(await flow(owner, { action: 'withdraw' }, id)).toBe(200);
    const all = await ctx.db
      .select()
      .from(approvals)
      .where(eq(approvals.policy, 'ops.sop.approve'));
    expect(all.some((a) => a.status === 'withdrawn')).toBe(true);
  });

  it('auditor cannot submit (403)', async () => {
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    const [any] = await ctx.db.select().from(opsSops).limit(1);
    expect(await flow(auditor, { action: 'submit' }, any!.id)).toBe(403);
  });

  it('legacy import: coordinator SOP enters as a draft; nothing imported is approved; re-import is idempotent', async () => {
    await importLegacySops(ctx.db);
    await importLegacySops(ctx.db);
    const legacy = (await ctx.db.select().from(opsSops)).filter((s) =>
      s.code.startsWith('LEGACY-'),
    );
    expect(legacy).toHaveLength(25 + 16 + 9 + 1);
    expect(legacy.every((s) => s.status === 'draft' || s.status === 'not_drafted')).toBe(true);
    const coord = legacy.find((s) => s.code === 'LEGACY-ONLINE-SOP-COORDINATOR');
    expect(coord).toMatchObject({ status: 'draft', ownerStaffId: null });
    const detail = await callRoute<{
      current: { versionLabel: string; sourceDate: string };
      checklist: unknown[];
      decisionState: string;
    }>(getSop, get(counsellor), { id: coord!.id });
    expect(detail.data).toMatchObject({
      decisionState: 'proposed',
      current: { versionLabel: '0.1', sourceDate: '2026-09-18' },
    });
    expect(detail.data?.checklist.length).toBeGreaterThan(30);
  });
});
