import { beforeAll, describe, expect, it } from 'vitest';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { POST as createSop } from '../../src/app/api/v1/sops/route';
import { POST as workflow } from '../../src/app/api/v1/sops/[id]/workflow/route';
import { POST as createTask } from '../../src/app/api/v1/tasks/route';
import { POST as setStatus } from '../../src/app/api/v1/tasks/[id]/status/route';
import { PUT as requireReview } from '../../src/app/api/v1/tasks/[id]/review-requirement/route';
import { GET as inbox } from '../../src/app/api/v1/operations/approvals/route';
import { listApprovalInbox, type ApprovalSource } from '../../src/server/approvals';
import { isoDaysFromNow, setupReference, type StaffUser } from './fixtures';
import { post, staffIn } from './operations-fixtures';

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
    expect((await callRoute(inbox, new Request('http://localhost/ops/api/v1/x'))).status).toBe(401);
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
    await callRoute(workflow, post(owner, { action: 'submit' }), { id: sop.data!.id });
    const asOwner = await callRoute<Inbox>(inbox, authedRequest(owner, '/x'));
    expect(
      source(asOwner.data, 'ops.sop_versions')
        ?.items.map((i) => i.title)
        .join(),
    ).not.toContain(sop.data!.code);
    const asReviewer = await callRoute<Inbox>(inbox, authedRequest(reviewer, '/x'));
    expect(source(asReviewer.data, 'ops.sop_reviews')?.items).toHaveLength(1);
    const asDirector = await callRoute<Inbox>(inbox, authedRequest(director, '/x'));
    const item = source(asDirector.data, 'ops.sop_versions')?.items.find((i) =>
      i.title.includes(sop.data!.code),
    );
    expect(item).toMatchObject({ ready: false, link: `/ops/sops/${sop.data!.id}` }); // review missing
    expect(source(asDirector.data, 'ops.sop_reviews')?.items).toHaveLength(0);
    await callRoute(workflow, post(reviewer, { action: 'review', outcome: 'recommend_approval' }), {
      id: sop.data!.id,
    });
    const ready = await callRoute<Inbox>(inbox, authedRequest(director, '/x'));
    expect(
      source(ready.data, 'ops.sop_versions')?.items.find((i) => i.title.includes(sop.data!.code))
        ?.ready,
    ).toBe(true);
    // A counsellor cannot approve SOPs: the source is not shown at all.
    const asCounsellor = await callRoute<Inbox>(inbox, authedRequest(counsellor, '/x'));
    expect(source(asCounsellor.data, 'ops.sop_versions')).toBeUndefined();
    expect(source(asCounsellor.data, 'ops.fee_arrangements')).toBeUndefined();
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
    const asCounsellor = await callRoute<Inbox>(inbox, authedRequest(counsellor, '/x'));
    expect(source(asCounsellor.data, 'ops.task_reviews')?.items ?? []).toHaveLength(0);
    const asManager = await callRoute<Inbox>(inbox, authedRequest(manager, '/x'));
    expect(source(asManager.data, 'ops.task_reviews')?.items.map((i) => i.title)).toContain(
      `${t.data!.code} Inbox review task (fictional)`,
    );
    // The director cannot write tasks, so cannot decide task reviews.
    const asDirector = await callRoute<Inbox>(inbox, authedRequest(director, '/x'));
    expect(source(asDirector.data, 'ops.task_reviews')).toBeUndefined();
  });

  it('registry: self-requested items are dropped; a failing source is unavailable, not zero', async () => {
    const user = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const fake: ApprovalSource = {
      key: 'test.fake',
      label: 'Fake (test)',
      permission: 'ops:module:access',
      list: async () => [
        {
          id: 'a',
          title: 'Mine',
          detail: null,
          requestedByUserId: user.id,
          requestedByName: null,
          requestedAt: new Date().toISOString(),
          link: '/ops',
          ready: true,
          blockers: [],
        },
        {
          id: 'b',
          title: 'Someone else',
          detail: null,
          requestedByUserId: null,
          requestedByName: null,
          requestedAt: new Date().toISOString(),
          link: '/ops',
          ready: true,
          blockers: [],
        },
      ],
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
