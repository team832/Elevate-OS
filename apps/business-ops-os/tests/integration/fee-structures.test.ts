import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditEvents, opsFeeStructures } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as list } from '../../src/app/api/v1/fee-structures/route';
import { PATCH as update } from '../../src/app/api/v1/fee-structures/[id]/route';
import { setupReference, staffUser } from './fixtures';

const ctx = setupTestDatabase();
type Row = typeof opsFeeStructures.$inferSelect;
let users: Record<'manager' | 'finance' | 'counsellor' | 'teacher', TestUser>;
let id: string;

beforeAll(async () => {
  await setupReference(ctx.db);
  users = {
    manager: await staffUser(ctx.db, ['operations_manager']),
    finance: await staffUser(ctx.db, ['finance_officer']),
    counsellor: await staffUser(ctx.db, ['admissions_counsellor']),
    teacher: await createTestUser(ctx.db, { roles: ['teacher'] }),
  };
  const [row] = await ctx.db
    .insert(opsFeeStructures)
    .values({
      programmeCodes: ['CLASS_12', 'CLAT'],
      label: 'Class 12 Commerce + CLAT — sample figure',
      mode: 'both',
      amountPaise: 150_000_00,
      source: 'sample',
      isSample: true,
      updatedBy: users.manager.id,
    })
    .returning();
  id = row!.id;
});

const patch = (who: keyof typeof users, json: unknown) =>
  callRoute<Row>(
    update,
    authedRequest(users[who], `/ops/api/v1/fee-structures/${id}`, { method: 'PATCH', json }),
    { id },
  );

describe('fee structure (GET/PATCH /fee-structures)', () => {
  it('lists for fees readers only', async () => {
    expect((await callRoute(list, buildRequest('/ops/api/v1/fee-structures'))).status).toBe(401);
    expect((await callRoute(list, authedRequest(users.teacher, '/x'))).status).toBe(403);
    const res = await callRoute<{ items: Row[]; anyApproved: boolean }>(
      list,
      authedRequest(users.counsellor, '/x'),
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ items: [{ source: 'sample' }], anyApproved: false });
  });

  it.each([
    ['counsellor', { label: 'x' }, 403, 'no ops:fees:record'],
    ['finance', { amountPaise: -5 }, 400, 'amount must be positive'],
    ['finance', { amountRupees: '1,40,000' }, 200, 'finance edits a sample figure'],
    [
      'finance',
      { source: 'owner_approved', reason: 'Owner said so on 21 Oct.' },
      403,
      'approval needs the permission',
    ],
    [
      'manager',
      { status: 'approved', reason: 'Owner said so on 21 Oct.' },
      400,
      'a sample figure cannot be approved',
    ],
    ['manager', { source: 'owner_approved' }, 400, 'promoting needs a reason'],
    [
      'manager',
      {
        source: 'owner_approved',
        status: 'approved',
        reason: 'Owner confirmed by phone, 21 Oct 2026.',
      },
      200,
      'owner-approved and approved',
    ],
    ['finance', { amountPaise: 1_00 }, 403, 'an approved fee needs the permission to change'],
    ['finance', { billingNote: 'Payable by bank transfer' }, 403, 'any term of an approved fee'],
  ] as const)('%s %j → %i (%s)', async (who, body, status, _why) => {
    expect((await patch(who, body)).status).toBe(status);
  });

  it('ends owner-approved, no longer sample, with an audit row per change', async () => {
    const [row] = await ctx.db
      .select()
      .from(opsFeeStructures)
      .where(eq(opsFeeStructures.id, id as never));
    expect(row).toMatchObject({
      source: 'owner_approved',
      status: 'approved',
      isSample: false,
      amountPaise: 140_000_00,
    });
    const audits = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, 'fee_structure'), eq(auditEvents.entityId, id)));
    expect(audits.map((a) => (a.metadata as { reason: string | null }).reason)).toEqual(
      expect.arrayContaining([null, 'Owner confirmed by phone, 21 Oct 2026.']),
    );
    expect(audits).toHaveLength(2);
  });
});
