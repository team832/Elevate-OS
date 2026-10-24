/** Ideas board (brief 23 Oct 2026 §13): new fields, the review guard, approved idea → one calendar item (+ Ops task). */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { marketingCalendarItems, opsStaffTasks, staffMembers } from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as createIdeaRoute } from '../../src/app/api/v1/ideas/route';
import { PATCH as patchIdeaRoute } from '../../src/app/api/v1/ideas/[id]/route';
import { POST as statusRoute } from '../../src/app/api/v1/ideas/[id]/status/route';
import { POST as planRoute } from '../../src/app/api/v1/ideas/[id]/plan/route';
import { POST as taskRoute } from '../../src/app/api/v1/calendar-items/[id]/task/route';
import { POST as cancelRoute } from '../../src/app/api/v1/calendar-items/[id]/[action]/route';
import { marketingStaff, type Staff } from './marketing-people';
import { IDEA_STATUSES } from '../../src/domain';
import { call, seedRegistry, uniqueTitle } from '../helpers';

const ctx = setupTestDatabase();
let manager: Staff;
let manager2: TestUser;
let anika: Staff;
let bharat: Staff;

const person = (role: 'marketing_manager' | 'marketing_contributor', name: string) =>
  marketingStaff(ctx.db, role, name);

type Idea = { id: string; status: string } & Record<string, unknown>;
async function newIdea(user: TestUser, extra: Record<string, unknown> = {}) {
  const res = await call<{ idea: Idea }>(createIdeaRoute, user, '/marketing/api/v1/ideas', {
    json: { coursePrefix: 'IPMAT', title: uniqueTitle('Sample IPMAT quant practice'), ...extra },
  });
  expect(res.status).toBe(201);
  return res.data!.idea;
}
const setStatus = (user: TestUser, id: string, status: string, reason?: string) =>
  call<Idea>(statusRoute, user, `/x/${id}`, { json: { status, reason }, params: { id } });
const plan = (user: TestUser, id: string, json: Record<string, unknown> = {}) =>
  call<{
    item: { id: string; ideaId: string; status: string };
    created: boolean;
    taskId: string | null;
  }>(planRoute, user, `/marketing/api/v1/ideas/${id}/plan`, { json, params: { id } });
async function approved(owner: Staff) {
  const idea = await newIdea(owner, { proposedFormat: 'short_video', ownerStaffId: owner.staffId });
  await setStatus(owner, idea.id, 'submitted');
  expect((await setStatus(manager2, idea.id, 'approved')).status).toBe(200);
  return idea;
}

beforeAll(async () => {
  await seedRegistry(ctx.db);
  manager = await person('marketing_manager', 'Sample Manager Meera');
  manager2 = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  anika = await person('marketing_contributor', 'Sample Marketer Anika');
  bharat = await person('marketing_contributor', 'Sample Marketer Bharat');
});

describe('ideas board fields', () => {
  it('stores and edits the §13 fields; an owner outside marketing is refused', async () => {
    const idea = await newIdea(anika, {
      problemNeed: 'Students lose marks on percentages.',
      hypothesis: 'A 60-second drill gets saves.',
      effort: 's',
      expectedOutcome: 'More saves than our average reel.',
      proposedFormat: 'short_video',
      proposedChannel: 'instagram',
      ownerStaffId: anika.staffId,
    });
    expect(idea).toMatchObject({
      effort: 's',
      proposedChannel: 'instagram',
      ownerStaffId: anika.staffId,
    });
    const patch = (json: Record<string, unknown>) =>
      call<{ idea: Idea }>(patchIdeaRoute, anika, `/x/${idea.id}`, {
        method: 'PATCH',
        json,
        params: { id: idea.id },
      });
    expect((await patch({ effort: 'l', hypothesis: null })).data!.idea).toMatchObject({
      effort: 'l',
      hypothesis: null,
    });
    expect((await patch({ effort: 'xl' })).status).toBe(400);
    const outsider = await createTestUser(ctx.db, { roles: ['teacher'] });
    const [s] = await ctx.db
      .insert(staffMembers)
      .values({ userId: outsider.id, fullName: 'Sample Teacher' })
      .returning({ id: staffMembers.id });
    expect(
      (
        await call(patchIdeaRoute, manager, `/x/${idea.id}`, {
          method: 'PATCH',
          json: { ownerStaffId: s!.id },
          params: { id: idea.id },
        })
      ).status,
    ).toBe(400);
  });
});

describe('who may edit an idea (review R-MKT-A I1)', () => {
  const patch = (user: TestUser, id: string, json: Record<string, unknown>) =>
    call(patchIdeaRoute, user, `/x/${id}`, { method: 'PATCH', json, params: { id } });

  it("Bharat cannot edit Anika's approved idea, take it over, or plan it", async () => {
    const idea = await approved(anika);
    expect((await patch(bharat, idea.id, { hypothesis: 'Mine now' })).status).toBe(403);
    expect((await patch(bharat, idea.id, { ownerStaffId: bharat.staffId })).status).toBe(403);
    expect((await plan(bharat, idea.id)).status).toBe(403);
  });

  it('an approved idea is locked, even for its owner and a manager (409, unchanged)', async () => {
    const idea = await approved(anika);
    expect((await patch(anika, idea.id, { hypothesis: 'Changed after approval' })).status).toBe(
      409,
    );
    expect((await patch(manager, idea.id, { hypothesis: 'Changed after approval' })).status).toBe(
      409,
    );
  });

  it('only a reviewer changes the owner; an employee names only themselves on a new idea', async () => {
    const idea = await newIdea(anika, { ownerStaffId: anika.staffId });
    expect((await patch(anika, idea.id, { ownerStaffId: bharat.staffId })).status).toBe(403);
    expect((await patch(anika, idea.id, { ownerStaffId: null })).status).toBe(403);
    expect((await patch(anika, idea.id, { hypothesis: 'Still mine' })).status).toBe(200);
    expect((await patch(manager, idea.id, { ownerStaffId: bharat.staffId })).status).toBe(200);
    const res = await call(createIdeaRoute, anika, '/marketing/api/v1/ideas', {
      json: {
        coursePrefix: 'CLAT',
        title: uniqueTitle('Sample for Bharat'),
        ownerStaffId: bharat.staffId,
      },
    });
    expect(res.status).toBe(403);
  });
});

describe("who may change an idea's status (fix round 2)", () => {
  let anikas: Idea;
  beforeAll(async () => {
    anikas = await approved(anika);
  });

  it.each(IDEA_STATUSES)("Bharat cannot move Anika's idea to %s", async (status) => {
    expect((await setStatus(bharat, anikas.id, status, 'Taking this over.')).status).toBe(403);
  });

  it("Anika can change her own idea and a manager can change anyone's", async () => {
    const own = await newIdea(anika);
    expect((await setStatus(anika, own.id, 'submitted')).status).toBe(200);
    expect((await setStatus(manager, anikas.id, 'held', 'Waiting for exam dates.')).status).toBe(
      200,
    );
  });
});

describe('idea review guard (server/ideas.ts changeIdeaStatus)', () => {
  it('approving needs content:approve and never your own idea', async () => {
    const byAnika = await newIdea(anika, { ownerStaffId: anika.staffId });
    await setStatus(anika, byAnika.id, 'submitted');
    expect((await setStatus(anika, byAnika.id, 'approved')).status).toBe(403);

    const byManager = await newIdea(manager);
    await setStatus(manager, byManager.id, 'submitted');
    expect((await setStatus(manager, byManager.id, 'approved')).status).toBe(403);

    const ownedByManager = await newIdea(anika);
    await call(patchIdeaRoute, manager2, '/x', {
      method: 'PATCH',
      json: { ownerStaffId: manager.staffId },
      params: { id: ownedByManager.id },
    });
    await setStatus(anika, ownedByManager.id, 'submitted');
    expect((await setStatus(manager, ownedByManager.id, 'approved')).status).toBe(403);
    expect((await setStatus(manager2, ownedByManager.id, 'changes_requested')).status).toBe(400);
    expect(
      (await setStatus(manager2, ownedByManager.id, 'changes_requested', 'Name the chapter.')).data!
        .status,
    ).toBe('changes_requested');

    expect((await setStatus(manager, byAnika.id, 'approved')).data!.status).toBe('approved');
  });
});

describe('approved idea → calendar item', () => {
  it('only an approved idea can be planned, and a second click returns the same item', async () => {
    const draft = await newIdea(anika, { proposedFormat: 'article' });
    expect((await plan(anika, draft.id)).status).toBe(409);

    const idea = await approved(anika);
    const first = await plan(anika, idea.id, { plannedAt: '2026-11-10T17:00' });
    expect(first.status).toBe(201);
    expect(first.data!.item).toMatchObject({ ideaId: idea.id, status: 'planned' });
    const second = await plan(anika, idea.id, { plannedAt: '2026-12-01T09:00' });
    expect(second.status).toBe(200);
    expect(second.data!.item.id).toBe(first.data!.item.id);
    const rows = await ctx.db
      .select()
      .from(marketingCalendarItems)
      .where(eq(marketingCalendarItems.ideaId, idea.id as never));
    expect(rows).toHaveLength(1);
  });

  it('creates the Ops task through the mounted route once and stores the link', async () => {
    const idea = await approved(anika);
    const res = await plan(anika, idea.id, { plannedAt: '2026-11-12T11:00', createTask: true });
    expect(res.status).toBe(201);
    const taskId = res.data!.taskId!;
    const [task] = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.id, taskId as never));
    expect(task).toMatchObject({
      staffId: anika.staffId,
      dueOn: '2026-11-12',
      linkedRef: `Marketing calendar item ${res.data!.item.id}`,
    });
    const again = await call<{ taskId: string; created: boolean }>(taskRoute, anika, '/x', {
      params: { id: res.data!.item.id },
    });
    expect(again.data).toEqual({ taskId, created: false });
    const tasks = await ctx.db
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.linkedRef, `Marketing calendar item ${res.data!.item.id}`));
    expect(tasks).toHaveLength(1);
  });

  it('no task for a cancelled item (409)', async () => {
    const idea = await approved(anika);
    const { item } = (await plan(anika, idea.id, { plannedAt: '2026-11-14T11:00' })).data!;
    await call(cancelRoute, anika, '/x', {
      json: { reason: 'Dropped.' },
      params: { id: item.id, action: 'cancel' },
    });
    expect((await call(taskRoute, anika, '/x', { params: { id: item.id } })).status).toBe(409);
  });
});
