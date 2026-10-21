import { beforeAll, describe, expect, it } from 'vitest';
import { opsDemos } from '@elevate/database';
import { toIsoDateTime } from '@elevate/shared-types';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { addDays, istToday, type IsoDate } from '../../src/domain';
import { activitySeries, perDay } from '../../src/server/dashboard';
import { closeFollowUp, createFollowUp } from '../../src/server/follow-ups';
import { createLead } from '../../src/server/leads';
import { phone, setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let other: StaffUser;
let teacher: TestUser;
/** The counsellor's follow-up counts before the four added below (lead intake adds its own). */
let baseline: Awaited<ReturnType<typeof activitySeries>>['followUps'];
const today = istToday(new Date());

describe('perDay (OPS-024 chart series)', () => {
  it('buckets by Asia/Kolkata day, oldest first; empty days are 0; dates outside are ignored', () => {
    const to = '2026-10-21' as IsoDate;
    const series = perDay(
      [
        new Date('2026-10-20T19:00:00Z'), // 21 Oct 00:30 IST
        new Date('2026-10-21T10:00:00Z'),
        new Date('2026-10-19T06:00:00Z'),
        new Date('2026-10-10T06:00:00Z'), // before the window
      ],
      to,
      3,
    );
    expect(series).toEqual([
      { date: '2026-10-19', count: 1 },
      { date: '2026-10-20', count: 0 },
      { date: '2026-10-21', count: 2 },
    ]);
  });
});

async function lead(owner: StaffUser, daysAgo: number) {
  const { lead: l, admission } = await createLead(ctx.db, owner, {
    studentName: `Series Test ${daysAgo} (fictional)`,
    studentPhone: phone(),
    interestMode: 'undecided',
    sourceCode: 'UNKNOWN',
    receivedAt: toIsoDateTime(new Date(`${addDays(today, -daysAgo)}T06:00:00+05:30`)),
  });
  return { leadId: l.id as string, admissionId: admission.id as string };
}

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  other = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });

  const mine = await lead(counsellor, 0);
  await lead(counsellor, 3);
  await lead(other, 1);
  await lead(other, 40); // outside the 30 days
  baseline = (await activitySeries(ctx.db, counsellor)).followUps;
  for (const [days, done] of [
    [-2, false],
    [0, false],
    [3, false],
    [-1, true],
  ] as const) {
    const f = await createFollowUp(ctx.db, counsellor, {
      leadId: mine.leadId,
      kind: 'general',
      dueDate: addDays(today, days),
    });
    if (done)
      await closeFollowUp(ctx.db, counsellor, f.id, {
        action: 'complete',
        outcome: 'Called the family (test)',
      });
  }
  await ctx.db.insert(opsDemos).values({
    admissionId: mine.admissionId as never,
    leadId: mine.leadId as never,
    feeTermsState: 'proposed',
    plannedSessionCount: 1,
    counsellorStaffId: counsellor.staffId,
    outcome: 'converted',
    outcomeAt: new Date(),
    outcomeBy: manager.id,
    convertedAdmissionId: mine.admissionId as never,
    createdBy: manager.id,
  });
});

describe('activitySeries (dashboard and report cards)', () => {
  it('needs ops:leads:read', async () => {
    await expect(activitySeries(ctx.db, teacher)).rejects.toThrow();
  });

  it('all scope: 30 daily points ending today, follow-ups by due state, conversions', async () => {
    const s = await activitySeries(ctx.db, manager);
    expect(s.scope).toBe('all');
    expect(s.leadsPerDay).toHaveLength(30);
    expect(s.leadsPerDay.at(-1)).toEqual({ date: today, count: 1 });
    expect(s.leadsPerDay.reduce((n, d) => n + d.count, 0)).toBe(3);
    expect(s.newLeadsThisWeek).toBeGreaterThanOrEqual(1);
    expect(s.conversionsPerDay.at(-1)?.count).toBe(1);
  });

  it('own scope counts only the counsellor’s leads, demos and follow-ups', async () => {
    const mine = await activitySeries(ctx.db, counsellor);
    expect(mine.scope).toBe('own');
    expect(mine.leadsPerDay.reduce((n, d) => n + d.count, 0)).toBe(2);
    expect(mine.conversionsPerDay.at(-1)?.count).toBe(1);
    expect(mine.followUps).toEqual({
      overdue: baseline.overdue + 1,
      dueToday: baseline.dueToday + 1,
      upcoming: baseline.upcoming + 1,
      doneInWindow: baseline.doneInWindow + 1,
    });
    const theirs = await activitySeries(ctx.db, other);
    expect(theirs.leadsPerDay.reduce((n, d) => n + d.count, 0)).toBe(1);
    expect(theirs.followUps.doneInWindow).toBe(0);
    const all = (await activitySeries(ctx.db, manager)).followUps;
    for (const k of Object.keys(all) as (keyof typeof all)[])
      expect(all[k]).toBe(mine.followUps[k] + theirs.followUps[k]);
    expect(theirs.conversionsPerDay.every((d) => d.count === 0)).toBe(true);
  });
});
