/** Campaign members and the marketing employee's own scope (brief 23 Oct 2026 §5, §16). */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  departments,
  marketingContentItems,
  marketingPlacementGroups,
  marketingPlacements,
  staffMembers,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { eq } from 'drizzle-orm';
import { GET as listCampaignsRoute } from '../../src/app/api/v1/campaigns/route';
import { GET as campaignRoute } from '../../src/app/api/v1/campaigns/[id]/route';
import {
  GET as membersRoute,
  POST as addMemberRoute,
} from '../../src/app/api/v1/campaigns/[id]/members/route';
import { PATCH as endMemberRoute } from '../../src/app/api/v1/campaigns/[id]/members/[memberId]/route';
import { GET as contentListRoute } from '../../src/app/api/v1/content-items/route';
import { GET as contentRoute } from '../../src/app/api/v1/content-items/[id]/route';
import { POST as commentRoute } from '../../src/app/api/v1/content-items/[id]/comments/route';
import { POST as submitRoute } from '../../src/app/api/v1/content-items/[id]/submit/route';
import { GET as ideaRoute } from '../../src/app/api/v1/ideas/[id]/route';
import { GET as dashboardRoute } from '../../src/app/api/v1/dashboard/route';
import { PUT as assignRoute } from '../../src/app/api/v1/content-items/[id]/assignments/route';
import { GET as weeklyRoute } from '../../src/app/api/v1/metrics/weekly/route';
import { GET as groupRoute } from '../../src/app/api/v1/placement-groups/[id]/route';
import { POST as cancelRoute } from '../../src/app/api/v1/placements/[id]/cancel/route';
import {
  contentFilter,
  createCampaign,
  createContentItem,
  createIdea,
  createPlacement,
  listPlannedPlacements,
  setAssignment,
  setPlacementCampaign,
} from '../../src/server';
import { call, seedRegistry, uniqueTitle } from '../helpers';

const ctx = setupTestDatabase();
let manager: TestUser;
let anika: TestUser & { staffId: string };
let bharat: TestUser & { staffId: string };
let mine: { id: string };
let other: { id: string };
let ideaId: string;
const items = {} as Record<'inMine' | 'unrelated' | 'bharats', { id: string }>;

let marketingDept: string;
/** A fictional marketing employee linked to a staff record in Marketing & Growth. */
async function employee(name: string) {
  const user = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: name, departmentId: marketingDept as never })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}

const ids = (rows: { id: string }[] | undefined) => (rows ?? []).map((r) => r.id).sort();

beforeAll(async () => {
  await seedRegistry(ctx.db);
  manager = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  const [dept] = await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoUpdate({ target: departments.code, set: { name: 'Marketing & Growth' } })
    .returning({ id: departments.id });
  marketingDept = dept!.id;
  anika = await employee('Sample Marketer Anika');
  bharat = await employee('Sample Marketer Bharat');
  mine = await createCampaign(ctx.db, manager, {
    code: 'SCOPE-MINE',
    name: 'Sample A',
    status: 'active',
  });
  other = await createCampaign(ctx.db, manager, {
    code: 'SCOPE-OTHER',
    name: 'Sample B',
    status: 'active',
  });
  const { idea } = await createIdea(ctx.db, manager, {
    coursePrefix: 'CLAT',
    title: uniqueTitle(),
  });
  ideaId = idea.id;
  for (const key of ['inMine', 'unrelated', 'bharats'] as const)
    items[key] = await createContentItem(ctx.db, manager, idea.id, {
      title: `Sample ${key}`,
      format: 'post',
    });
  const { placement } = await createPlacement(ctx.db, manager, items.inMine.id, {
    accountCode: 'IGC',
  });
  await setPlacementCampaign(ctx.db, manager, placement.id, mine.id);
  await createPlacement(ctx.db, manager, items.unrelated.id, { accountCode: 'LI' });
  await setAssignment(ctx.db, manager, items.bharats.id, { role: 'designer', userId: bharat.id });
});

describe('campaign members (marketing manager only, audited)', () => {
  let memberId: string;

  it('the manager adds an owner; a marketing employee cannot; a second open row is refused', async () => {
    const path = `/marketing/api/v1/campaigns/${mine.id}/members`;
    const json = { staffId: anika.staffId, role: 'owner', fromDate: '2026-10-01' };
    expect(
      (await call(addMemberRoute, anika, path, { json, params: { id: mine.id } })).status,
    ).toBe(403);
    const added = await call<{ id: string; role: string }>(addMemberRoute, manager, path, {
      json,
      params: { id: mine.id },
    });
    expect(added.status).toBe(201);
    expect(added.data!.role).toBe('owner');
    memberId = added.data!.id;
    expect(
      (await call(addMemberRoute, manager, path, { json, params: { id: mine.id } })).status,
    ).toBe(409);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'campaign.member_added'));
    expect(audit).toHaveLength(1);
  });

  it('a marketing employee sees only campaigns they are on; any other campaign id is 404', async () => {
    const list = (u: TestUser) => call<{ id: string }[]>(listCampaignsRoute, u, '/x');
    expect(ids((await list(anika)).data)).toEqual([mine.id]);
    expect((await list(bharat)).data).toEqual([]);
    expect(ids((await list(manager)).data)).toEqual(ids([mine, other]));
    for (const route of [campaignRoute, membersRoute]) {
      expect((await call(route, anika, '/x', { params: { id: mine.id } })).status).toBe(200);
      expect((await call(route, anika, '/x', { params: { id: other.id } })).status).toBe(404);
      expect((await call(route, bharat, '/x', { params: { id: mine.id } })).status).toBe(404);
    }
    const detail = await call<{ members: { staffName: string }[] }>(campaignRoute, manager, '/x', {
      params: { id: mine.id },
    });
    expect(detail.data!.members.map((m) => m.staffName)).toEqual(['Sample Marketer Anika']);
  });

  it('content: a marketing employee sees content in their campaigns or assigned to them; managers see all', async () => {
    const list = async (u: TestUser) =>
      ids(
        (await call<{ item: { id: string } }[]>(contentListRoute, u, '/x')).data!.map(
          (r) => r.item,
        ),
      );
    expect(await list(anika)).toEqual([items.inMine.id]);
    expect(await list(bharat)).toEqual([items.bharats.id]);
    expect(await list(manager)).toEqual(ids(Object.values(items)));

    const open = (u: TestUser, id: string) => call(contentRoute, u, '/x', { params: { id } });
    expect((await open(anika, items.inMine.id)).status).toBe(200);
    expect((await open(anika, items.unrelated.id)).status).toBe(404);
    expect((await open(anika, items.bharats.id)).status).toBe(404);
    expect((await open(bharat, items.bharats.id)).status).toBe(200);

    const idea = (u: TestUser) =>
      call<{ contentItems: { id: string }[]; placements: { contentItemId: string }[] }>(
        ideaRoute,
        u,
        '/x',
        { params: { id: ideaId } },
      );
    const seen = (await idea(anika)).data!;
    expect(ids(seen.contentItems)).toEqual([items.inMine.id]);
    expect(seen.placements.map((p) => p.contentItemId)).toEqual([items.inMine.id]);
    const none = (await idea(bharat)).data!; // bharats has no placement
    expect(none.placements).toEqual([]);
    expect((await idea(manager)).data!.placements).toHaveLength(2);
    const planned = await listPlannedPlacements(ctx.db, await contentFilter(ctx.db, anika));
    expect(planned.map((p) => p.p.contentItemId)).toEqual([items.inMine.id]);

    expect((await call(dashboardRoute, anika, '/x')).status).toBe(403);
    expect((await call(dashboardRoute, manager, '/x')).status).toBe(200);
  });

  it('a changed content id in a write cannot reach content out of scope (404)', async () => {
    const params = { id: items.unrelated.id };
    expect(
      (await call(commentRoute, anika, '/x', { json: { body: 'Sample note' }, params })).status,
    ).toBe(404);
    expect((await call(submitRoute, anika, '/x', { json: {}, params })).status).toBe(404);
  });

  it('ending a membership removes the campaign and its content from the employee (history kept)', async () => {
    const path = `/marketing/api/v1/campaigns/${mine.id}/members/${memberId}`;
    const params = { id: mine.id, memberId };
    expect(
      (await call(endMemberRoute, anika, path, { method: 'PATCH', json: {}, params })).status,
    ).toBe(403);
    expect(
      (
        await call(endMemberRoute, manager, path, {
          method: 'PATCH',
          json: {},
          params: { id: other.id, memberId },
        })
      ).status,
    ).toBe(404);
    const ended = await call<{ toDate: string }>(endMemberRoute, manager, path, {
      method: 'PATCH',
      json: {},
      params,
    });
    expect(ended.status).toBe(200);
    expect(ended.data!.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (await call(endMemberRoute, manager, path, { method: 'PATCH', json: {}, params })).status,
    ).toBe(409);
    expect((await call(campaignRoute, anika, '/x', { params: { id: mine.id } })).status).toBe(404);
    expect(
      (await call(contentRoute, anika, '/x', { params: { id: items.inMine.id } })).status,
    ).toBe(404);
    const members = await call<{ toDate: string | null }[]>(membersRoute, manager, '/x', {
      params: { id: mine.id },
    });
    expect(members.data).toHaveLength(1);
  });
});

describe('review fixes (fix round 1)', () => {
  const add = (staffId: string, json: Record<string, unknown> = {}) =>
    call<{ id: string }>(addMemberRoute, manager, '/x', {
      json: { staffId, ...json },
      params: { id: other.id },
    });

  it('E2/E3: membership dates cannot be in the future (they take effect at once)', async () => {
    expect((await add(bharat.staffId, { fromDate: '2099-01-01' })).status).toBe(400);
    const m = await add(bharat.staffId);
    expect(m.status).toBe(201);
    const params = { id: other.id, memberId: m.data!.id };
    const end = (toDate: string) =>
      call(endMemberRoute, manager, '/x', { method: 'PATCH', json: { toDate }, params });
    expect((await end('2099-12-31')).status).toBe(400);
    expect((await call(campaignRoute, bharat, '/x', { params: { id: other.id } })).status).toBe(
      200,
    );
  });

  it('E4: an employee cannot assign anyone (themselves included) to content', async () => {
    const res = await call(assignRoute, bharat, '/x', {
      method: 'PUT',
      params: { id: items.bharats.id },
      json: { role: 'editor', userId: bharat.id },
    });
    expect(res.status).toBe(403);
  });

  it('E5: only active Marketing & Growth staff can be added', async () => {
    const [outsider] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'Sample Teacher Outsider' })
      .returning({ id: staffMembers.id });
    expect((await add(outsider!.id)).status).toBe(400);
  });

  it('I3: per-campaign weekly figures and collab groups follow the scope', async () => {
    const weekly = (u: TestUser) =>
      call(weeklyRoute, u, '/marketing/api/v1/metrics/weekly?groupBy=campaign');
    expect((await weekly(bharat)).status).toBe(403);
    expect((await weekly(manager)).status).toBe(200);
    // A collab group over the unrelated item's placement (direct rows: only the read is under test).
    const [group] = await ctx.db
      .insert(marketingPlacementGroups)
      .values({ code: 'SAMPLE-GRP', ideaId: ideaId as never, platform: 'instagram' })
      .returning({ id: marketingPlacementGroups.id });
    await ctx.db
      .update(marketingPlacements)
      .set({ placementGroupId: group!.id })
      .where(eq(marketingPlacements.contentItemId, items.unrelated.id as never));
    const open = (u: TestUser, id: string = group!.id) =>
      call<unknown>(groupRoute, u, '/x', { params: { id } });
    expect((await open(manager)).status).toBe(200);
    // Out of scope, empty and missing all read the same (no existence oracle).
    const [empty] = await ctx.db
      .insert(marketingPlacementGroups)
      .values({ code: 'SAMPLE-EMPTY', ideaId: ideaId as never, platform: 'instagram' })
      .returning({ id: marketingPlacementGroups.id });
    expect((await open(manager, empty!.id)).status).toBe(200);
    for (const id of [group!.id, empty!.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await open(bharat, id);
      expect([res.status, res.error?.message]).toEqual([404, 'Collab group not found.']);
    }
  });

  it('M3: content seen through a campaign placement disappears when that placement is cancelled', async () => {
    const { idea } = await createIdea(ctx.db, manager, {
      coursePrefix: 'CLAT',
      title: uniqueTitle(),
    });
    const item = await createContentItem(ctx.db, manager, idea.id, {
      title: 'Sample M3',
      format: 'post',
    });
    const { placement } = await createPlacement(ctx.db, manager, item.id, { accountCode: 'IGC' });
    await setPlacementCampaign(ctx.db, manager, placement.id, other.id); // bharat is on `other`
    const read = async (u: TestUser) =>
      (await call(contentRoute, u, '/x', { params: { id: item.id } })).status;
    expect(await read(bharat)).toBe(200);
    const cancel = (u: TestUser, id: string) =>
      call<unknown>(cancelRoute, u, '/x', { params: { id }, json: { reason: 'Sample cancel' } });
    // An out-of-scope placement reads like a missing one.
    const [foreign] = await listPlannedPlacements(
      ctx.db,
      eq(marketingContentItems.id, items.unrelated.id as never),
    );
    for (const id of [foreign!.p.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await cancel(anika, id);
      expect([res.status, res.error?.message]).toEqual([404, 'Placement not found.']);
    }
    expect((await cancel(manager, placement.id)).status).toBe(200);
    expect(await read(bharat)).toBe(404);
    expect(await read(manager)).toBe(200);
  });
});
