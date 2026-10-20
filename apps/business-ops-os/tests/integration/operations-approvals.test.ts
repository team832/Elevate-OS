import { beforeAll, describe, expect, it } from 'vitest';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { POST as createSop } from '../../src/app/api/v1/sops/route';
import { POST as workflow } from '../../src/app/api/v1/sops/[id]/workflow/route';
import { POST as createTask } from '../../src/app/api/v1/tasks/route';
import { POST as setStatus } from '../../src/app/api/v1/tasks/[id]/status/route';
import { PUT as requireReview } from '../../src/app/api/v1/tasks/[id]/review-requirement/route';
import { GET as inbox } from '../../src/app/api/v1/operations/approvals/route';
import { listApprovalInbox, type ApprovalSource } from '../../src/server/approvals';
import { isoDaysFromNow, setupReference, type StaffUser } from './fixtures';
import { get, post, staffIn, statusOf } from './operations-fixtures';

const ctx = setupTestDatabase();
let owner: StaffUser;
let reviewer: StaffUser;
let director: StaffUser;
let manager: StaffUser;
let counsellor: StaffUser;

type Inbox = {
  total: number | null;
  sources: {
    key: string;
    count: number | null;
    status: string;
    items: { id: string; title: string; ready: boolean; link: string }[];
  }[];
};
const source = (data: Inbox | undefined, key: string) => data?.sources.find((s) => s.key === key);
const inboxOf = async (user: { token: string }) => (await callRoute<Inbox>(inbox, get(user))).data;

beforeAll(async () => {
  await setupReference(ctx.db);
  owner = await staffIn(ctx.db, ['operations_manager']);
  reviewer = await staffIn(ctx.db, ['operations_manager']);
  director = await staffIn(ctx.db, ['director']);
  manager = await staffIn(ctx.db, ['operations_manager']);
  counsellor = await staffIn(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
});

describe('approvals inbox scoping', () => {
  it('401 without a session', async () => {
    expect(await statusOf(inbox, new Request('http://localhost/ops/api/v1/x'))).toBe(401);
  });

  it('SOP approvals: never the requester or the SOP owner; the reviewer sees a review item', async () => {
    const sop = await callRoute<{ id: string; code: string }>(
      createSop,
      post(owner, {
        title: 'Inbox SOP (fictional)',
        ownerStaffId: owner.staffId,
        reviewerStaffId: reviewer.staffId,
        content: '1. Step one.',
      }),
    );
    const { id, code } = sop.data!;
    const versionItem = async (user: StaffUser) =>
      source(await inboxOf(user), 'ops.sop_versions')?.items.find((i) => i.title.includes(code));
    await callRoute(workflow, post(owner, { action: 'submit' }), { id });
    const asOwner = source(await inboxOf(owner), 'ops.sop_versions');
    expect(asOwner?.items.some((i) => i.title.includes(code))).toBe(false);
    expect(source(await inboxOf(reviewer), 'ops.sop_reviews')?.items).toHaveLength(1);
    expect(await versionItem(director)).toMatchObject({ ready: false, link: `/ops/sops/${id}` }); // review missing
    expect(source(await inboxOf(director), 'ops.sop_reviews')?.items).toHaveLength(0);
    await callRoute(workflow, post(reviewer, { action: 'review', outcome: 'recommend_approval' }), {
      id,
    });
    expect((await versionItem(director))?.ready).toBe(true);
    // A counsellor cannot approve SOPs: the source is not shown at all.
    const asCounsellor = await inboxOf(counsellor);
    expect(source(asCounsellor, 'ops.sop_versions')).toBeUndefined();
    expect(source(asCounsellor, 'ops.fee_arrangements')).toBeUndefined();
  });

  it('task reviews: shown to the deciding manager, never to the person who completed it', async () => {
    const t = await callRoute<{ id: string; code: string }>(
      createTask,
      post(manager, {
        title: 'Inbox review task (fictional)',
        ownerStaffId: counsellor.staffId,
        dueDate: isoDaysFromNow(2),
      }),
    );
    await callRoute(requireReview, post(manager, {}, 'PUT'), { id: t.data!.id });
    await callRoute(setStatus, post(counsellor, { to: 'completed', completionNote: 'Done' }), {
      id: t.data!.id,
    });
    expect(source(await inboxOf(counsellor), 'ops.task_reviews')?.items ?? []).toHaveLength(0);
    expect(source(await inboxOf(manager), 'ops.task_reviews')?.items.map((i) => i.title)).toContain(
      `${t.data!.code} Inbox review task (fictional)`,
    );
    // The director cannot write tasks, so cannot decide task reviews.
    expect(source(await inboxOf(director), 'ops.task_reviews')).toBeUndefined();
  });

  it('registry: self-requested items are dropped; a failing source is unavailable, not zero', async () => {
    const user = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const item = (id: string, title: string, requestedByUserId: typeof user.id | null) => ({
      id,
      title,
      detail: null,
      requestedByUserId,
      requestedByName: null,
      requestedAt: new Date().toISOString(),
      link: '/ops',
      ready: true,
      blockers: [],
    });
    const fake: ApprovalSource = {
      key: 'test.fake',
      label: 'Fake (test)',
      permission: 'ops:module:access',
      list: async () => [item('a', 'Mine', user.id), item('b', 'Someone else', null)],
    };
    const broken: ApprovalSource = {
      key: 'test.broken',
      label: 'Broken (test)',
      permission: 'ops:module:access',
      list: async () => {
        throw new Error('boom');
      },
    };
    const hidden: ApprovalSource = {
      ...fake,
      key: 'test.hidden',
      permission: 'ops:compensation:manage',
    };
    const r = await listApprovalInbox(ctx.db, user, [fake, broken, hidden]);
    expect(r.sources.map((s) => s.key)).toEqual(['test.fake', 'test.broken']);
    expect(r.sources[0]?.items.map((i) => i.id)).toEqual(['b']);
    expect(r.sources[1]).toMatchObject({ status: 'unavailable', count: null });
    expect(r).toMatchObject({ total: 1, unavailable: 1 });
    const allBroken = await listApprovalInbox(ctx.db, user, [broken]);
    expect(allBroken.total).toBeNull();
  });
});
