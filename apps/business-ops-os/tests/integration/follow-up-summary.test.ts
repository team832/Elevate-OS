/** followUpDaySummary (D-073): Marketing OS Overview counts, same scope rules as listFollowUps. */
import { beforeAll, describe, expect, it } from 'vitest';
import { opsFollowUps } from '@elevate/database';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { followUpDaySummary } from '../../src/leads';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const BEFORE_MIDNIGHT = new Date('2026-10-22T18:29:59Z'); // 23:59:59 IST, 22 Oct
const MIDNIGHT = new Date('2026-10-22T18:30:00Z'); // 00:00 IST, 23 Oct
let mm: StaffUser;
let mc: StaffUser;
let om: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  mm = await staffUser(ctx.db, ['marketing_manager'], { name: 'Sample Manager' });
  mc = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Contributor' });
  om = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  const adm = await caseOf(ctx.db, om.id, null, 'admitted');
  const row = (owner: StaffUser, dueDate: string, extra: object = {}) => ({
    leadId: adm.leadId,
    kind: 'general' as const,
    title: 'Sample follow-up',
    dueDate,
    ownerStaffId: owner.staffId,
    source: 'manual' as const,
    createdBy: om.id,
    ...extra,
  });
  await ctx.db.insert(opsFollowUps).values([
    row(mc, '2026-10-21'),
    row(mc, '2026-10-22'),
    row(mm, '2026-10-22'),
    row(mc, '2026-10-22', { admissionId: adm.id }), // admission case: hidden from Marketing
    row(mc, '2026-10-22', { status: 'cancelled', outcome: 'Sample: not needed' }),
    row(mc, '2026-10-24'), // inside the 2-day upcoming window on both days
    row(mc, '2026-10-30'), // later: not counted
  ]);
});

describe('followUpDaySummary', () => {
  it.each([
    ['manager: every lead follow-up, no admission ones', () => mm, BEFORE_MIDNIGHT, [1, 2, 1]],
    ['contributor: own only', () => mc, BEFORE_MIDNIGHT, [1, 1, 1]],
    ['contributor at 00:00 IST: yesterday turns overdue', () => mc, MIDNIGHT, [2, 0, 1]],
    ['operations manager: admission follow-ups too', () => om, BEFORE_MIDNIGHT, [1, 3, 1]],
  ])('%s', async (_, who, now, [overdue, dueToday, upcoming]) => {
    expect(await followUpDaySummary(ctx.db, who(), now)).toMatchObject({
      overdue,
      dueToday,
      upcoming,
      day: now === MIDNIGHT ? '2026-10-23' : '2026-10-22',
      upcomingWindowDays: 2,
    });
  });

  it('null for own scope without a staff record; refused without ops:leads:read', async () => {
    const loose = await createTestUser(ctx.db, { roles: ['marketing_contributor'] });
    expect(await followUpDaySummary(ctx.db, loose)).toBeNull();
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    await expect(followUpDaySummary(ctx.db, teacher)).rejects.toThrow();
  });
});
