/** SEO / AIO / GEO work (brief 23 Oct 2026 §14): permissions, own scope, review, observations. */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  marketingOptimisationCategories,
  staffMembers,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/optimisation/route';
import {
  GET as itemRoute,
  PATCH as patchRoute,
} from '../../src/app/api/v1/optimisation/[id]/route';
import { POST as submitRoute } from '../../src/app/api/v1/optimisation/[id]/submit/route';
import { POST as reviewRoute } from '../../src/app/api/v1/optimisation/[id]/review/route';
import { POST as observeRoute } from '../../src/app/api/v1/optimisation/[id]/observations/route';
import { GET as categoriesRoute } from '../../src/app/api/v1/optimisation/categories/route';
import { call } from '../helpers';

const ctx = setupTestDatabase();
type Staffed = TestUser & { staffId: string };
let manager: Staffed;
let manager2: TestUser;
let anika: Staffed;
let bharat: Staffed;
let auditor: TestUser;

const BASE = '/marketing/api/v1/optimisation';
const item = (id: string, suffix = '') => [`${BASE}/${id}${suffix}`, { params: { id } }] as const;
const newItem = {
  pageUrl: 'https://example.test/clat-course',
  topic: 'Sample CLAT course page FAQs',
  targetQuery: 'clat coaching sikar fees',
  categoryKey: 'seo',
  checks: ['faqs', 'title_description'],
};

async function staffed(roles: ['marketing_manager'] | ['marketing_contributor'], name: string) {
  const user = await createTestUser(ctx.db, { roles });
  const [dept] = await ctx.db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'MARKETING_GROWTH'));
  const [s] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: name, departmentId: dept!.id })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: s!.id };
}

beforeAll(async () => {
  await ctx.db
    .insert(departments)
    .values({ code: 'MARKETING_GROWTH', name: 'Marketing & Growth' })
    .onConflictDoNothing();
  await ctx.db.insert(marketingOptimisationCategories).values([
    { key: 'seo', label: 'SEO', meaning: 'Search engine optimisation: pages found by search.' },
    { key: 'geo', label: 'GEO', meaning: 'Generative engine optimisation: AI answers.' },
  ]);
  manager = await staffed(['marketing_manager'], 'Sample Marketing Manager');
  manager2 = await createTestUser(ctx.db, { roles: ['marketing_manager'] });
  anika = await staffed(['marketing_contributor'], 'Sample Marketer Anika');
  bharat = await staffed(['marketing_contributor'], 'Sample Marketer Bharat');
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

describe('work items', () => {
  let id: string;

  it.each([
    [null, 401],
    ['auditor', 403],
  ] as const)('create as %s → %i', async (who, status) => {
    const user = who ? auditor : null;
    expect((await call(createRoute, user, BASE, { json: newItem })).status).toBe(status);
  });

  it.each([
    [{ ...newItem, pageUrl: 'ftp://example.test/x' }, 'pageUrl'],
    [{ ...newItem, checks: ['guaranteed_ranking'] }, 'checks'],
    [{ ...newItem, topic: ' ' }, 'topic'],
  ])('refuses an invalid item (%#: %s)', async (json) => {
    expect((await call(createRoute, anika, BASE, { json })).status).toBe(400);
  });

  it('refuses a category that is not configured', async () => {
    const res = await call(createRoute, anika, BASE, { json: { ...newItem, categoryKey: 'aio' } });
    expect(res.status).toBe(400);
  });

  it('an employee creates their own item with the chosen checks, audited', async () => {
    const res = await call<{ id: string; ownerStaffId: string; checklist: unknown[] }>(
      createRoute,
      anika,
      BASE,
      { json: newItem },
    );
    expect(res.status).toBe(201);
    id = res.data!.id;
    expect(res.data!.ownerStaffId).toBe(anika.staffId);
    expect(res.data!.checklist).toEqual([
      { key: 'title_description', label: 'Page title and description', done: false },
      { key: 'faqs', label: 'Useful FAQs', done: false },
    ]);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'optimisation_item.created')),
      );
    expect(audit).toHaveLength(1);
  });

  it('an employee cannot give work to someone else', async () => {
    const json = { ...newItem, ownerStaffId: bharat.staffId };
    expect((await call(createRoute, anika, BASE, { json })).status).toBe(403);
  });

  it('everyone in Marketing reads it; only its owner (or a manager) changes it', async () => {
    expect((await call(listRoute, bharat, BASE)).data).toHaveLength(1);
    const [path, opts] = item(id);
    expect((await call(itemRoute, bharat, path, opts)).status).toBe(200);
    const json = {
      done: ['faqs'],
      evidence: 'FAQ block live: https://example.test/clat-course#faq',
    };
    expect((await call(patchRoute, bharat, path, { ...opts, method: 'PATCH', json })).status).toBe(
      403,
    );
    const ok = await call<{ checklist: { key: string; done: boolean }[] }>(
      patchRoute,
      anika,
      path,
      {
        ...opts,
        method: 'PATCH',
        json,
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.data!.checklist.find((c) => c.key === 'faqs')!.done).toBe(true);
  });

  it('observations are logged as manual and only by someone who may change the item', async () => {
    const [path, opts] = item(id, '/observations');
    const json = {
      platform: 'ChatGPT',
      query: 'best clat coaching in sikar',
      observedOn: '2026-10-20',
      result: 'Not cited in the answer.',
    };
    expect((await call(observeRoute, bharat, path, { ...opts, json })).status).toBe(403);
    expect(
      (
        await call(observeRoute, anika, path, {
          ...opts,
          json: { ...json, observedOn: '2999-01-01' },
        })
      ).status,
    ).toBe(400);
    const res = await call<{ source: string }>(observeRoute, anika, path, { ...opts, json });
    expect(res.status).toBe(201);
    expect(res.data!.source).toBe('manual');
  });

  it('review: submit needs evidence, nobody reviews own work, changes need a note', async () => {
    const [path, opts] = item(id);
    const review = (user: TestUser, json: object) =>
      call(reviewRoute, user, `${path}/review`, { ...opts, json });
    expect((await review(manager, { decision: 'approved' })).status).toBe(409); // not submitted
    expect((await call(submitRoute, bharat, `${path}/submit`, { ...opts, json: {} })).status).toBe(
      403,
    );
    expect((await call(submitRoute, anika, `${path}/submit`, { ...opts, json: {} })).status).toBe(
      200,
    );
    expect(
      (await call(patchRoute, anika, path, { ...opts, method: 'PATCH', json: { topic: 'x' } }))
        .status,
    ).toBe(409);
    expect((await review(anika, { decision: 'approved' })).status).toBe(403); // no review permission
    expect((await review(manager, { decision: 'changes_requested' })).status).toBe(400);
    const sent = await call<{ reviewState: string }>(reviewRoute, manager, `${path}/review`, {
      ...opts,
      json: { decision: 'changes_requested', note: 'Add the fee table source.' },
    });
    expect(sent.data!.reviewState).toBe('changes_requested');
    await call(submitRoute, anika, `${path}/submit`, { ...opts, json: {} });
    expect((await review(manager2, { decision: 'approved' })).status).toBe(200);
    const after = await call<{ reviewState: string; observations: { source: string }[] }>(
      itemRoute,
      auditor,
      path,
      opts,
    );
    expect(after.data!.reviewState).toBe('approved');
    expect(after.data!.observations.map((o) => o.source)).toEqual(['manual']);
  });

  it('submitting needs evidence; a manager cannot approve work they own', async () => {
    const own = await call<{ id: string }>(createRoute, manager, BASE, {
      json: { ...newItem, evidence: undefined, topic: 'Sample manager-owned page' },
    });
    const [path, opts] = item(own.data!.id);
    const early = await call(submitRoute, manager, `${path}/submit`, { ...opts, json: {} });
    expect(early.status).toBe(400); // no evidence yet
    await call(patchRoute, manager, path, {
      ...opts,
      method: 'PATCH',
      json: { evidence: 'Done.' },
    });
    await call(submitRoute, manager, `${path}/submit`, { ...opts, json: {} });
    const res = await call(reviewRoute, manager, `${path}/review`, {
      ...opts,
      json: { decision: 'approved' },
    });
    expect(res.status).toBe(403);
  });

  it('whoever wrote the evidence cannot approve the item', async () => {
    const res = await call<{ id: string }>(createRoute, anika, BASE, {
      json: { ...newItem, topic: 'Sample page a manager finished' },
    });
    const [path, opts] = item(res.data!.id);
    await call(patchRoute, manager2, path, {
      ...opts,
      method: 'PATCH',
      json: { evidence: 'Sample: fixed by the manager' },
    });
    await call(submitRoute, anika, `${path}/submit`, { ...opts, json: {} });
    const review = (user: TestUser) =>
      call(reviewRoute, user, `${path}/review`, { ...opts, json: { decision: 'approved' } });
    expect((await review(manager2)).status).toBe(403);
    expect((await review(manager)).status).toBe(200);
  });

  it('lists the configured categories with their meaning', async () => {
    const res = await call<{ key: string; meaning: string }[]>(
      categoriesRoute,
      anika,
      `${BASE}/categories`,
    );
    expect(res.data!.map((c) => c.key)).toEqual(['geo', 'seo']);
  });
});
