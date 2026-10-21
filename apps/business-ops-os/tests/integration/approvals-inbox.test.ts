import { describe, expect, it } from 'vitest';
import { callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as inbox } from '../../src/app/api/v1/operations/approvals/route';
import { listApprovalInbox, type ApprovalSource } from '../../src/server/approvals';

const ctx = setupTestDatabase();

describe('approvals inbox (OPS-068, fee agreements and arrangements since D-032)', () => {
  it('401 without a session; only roles that decide fee arrangements see that source', async () => {
    const res = await callRoute(inbox, new Request('http://localhost/ops/api/v1/x'));
    expect(res.status).toBe(401);
    const counsellor = await createTestUser(ctx.db, { roles: ['admissions_counsellor'] });
    expect((await listApprovalInbox(ctx.db, counsellor)).sources).toEqual([]);
    const director = await createTestUser(ctx.db, { roles: ['director'] });
    const r = await listApprovalInbox(ctx.db, director);
    expect(r.sources.map((s) => s.key)).toEqual(['ops.fee_agreements', 'ops.fee_arrangements']);
    expect(r).toMatchObject({ total: 0, unavailable: 0 });
  });

  it('registry: self-requested items are dropped; a failing source is unavailable, not zero', async () => {
    const user = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    const item = (id: string, requestedByUserId: typeof user.id | null) => ({
      id,
      title: id,
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
      list: async () => [item('mine', user.id), item('other', null)],
    };
    const broken: ApprovalSource = {
      ...fake,
      key: 'test.broken',
      list: async () => {
        throw new Error('boom');
      },
    };
    const hidden: ApprovalSource = {
      ...fake,
      key: 'test.hidden',
      permission: 'marketing:content:approve',
    };
    const r = await listApprovalInbox(ctx.db, user, [fake, broken, hidden]);
    expect(r.sources.map((s) => s.key)).toEqual(['test.fake', 'test.broken']);
    expect(r.sources[0]?.items.map((i) => i.id)).toEqual(['other']);
    expect(r.sources[1]).toMatchObject({ status: 'unavailable', count: null });
    expect(r).toMatchObject({ total: 1, unavailable: 1 });
    expect((await listApprovalInbox(ctx.db, user, [broken])).total).toBeNull();
  });
});
