import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { opsAdmissions, opsDemos, opsDemoSessions } from '@elevate/database';
import { callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as report } from '../../src/app/api/v1/admissions/report/route';
import type { FunnelStage } from '../../src/domain/admissions-funnel';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { get, pendingCase } from './admissions-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let coordinator: TestUser;

type Group = {
  group: string;
  demos: number;
  decided: number;
  converted: number;
  ratePct: number | null;
};
type FunnelReport = {
  scope: string;
  funnel: FunnelStage[];
  demoConversion: {
    total: number;
    byProgramme: Group[];
    byCounsellor: Group[];
    bySource: Group[] | null;
    byOutcome: Group[];
  };
  students: { active: number; on_hold: number; former: number };
};
const funnelOf = async (user: { token: string }) =>
  (await callRoute<{ funnelReport: FunnelReport }>(report, get(user))).data!.funnelReport;
const stages = (f: FunnelReport) =>
  f.funnel.map((s) => [s.key, s.count, s.of?.count ?? null, s.ratePct]);

/** A demo of `admission`: 3 planned days, one class a day (or all on day 1), `present` attended. */
async function demo(
  c: { leadId: string; admissionId: string },
  present: number,
  outcome: { outcome: 'open' | 'converted' | 'declined' } = { outcome: 'open' },
  oneDay = false,
) {
  const decided = outcome.outcome !== 'open';
  const [d] = await ctx.db
    .insert(opsDemos)
    .values({
      admissionId: c.admissionId as never,
      leadId: c.leadId as never,
      feeTermsState: 'proposed',
      plannedSessionCount: 3,
      counsellorStaffId: counsellor.staffId,
      outcome: outcome.outcome,
      outcomeAt: decided ? new Date() : null,
      outcomeBy: decided ? manager.id : null,
      outcomeReason: outcome.outcome === 'declined' ? 'Family chose another centre (test)' : null,
      convertedAdmissionId: outcome.outcome === 'converted' ? (c.admissionId as never) : null,
      createdBy: manager.id,
    })
    .returning();
  for (let n = 1; n <= 3; n += 1)
    await ctx.db.insert(opsDemoSessions).values({
      demoId: d!.id,
      sessionNumber: n,
      dayNumber: oneDay ? 1 : n,
      startsAt: new Date(Date.now() - (4 - n) * 3_600_000),
      attendance: n <= present ? 'present' : 'scheduled',
      recordedAt: n <= present ? new Date() : null,
      recordedBy: n <= present ? manager.id : null,
    });
}

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
});

describe('admissions funnel and demo conversion (A-REP-1, A-REP-2)', () => {
  it('403 without ops:admissions:read', async () => {
    expect((await callRoute(report, get(coordinator))).status).toBe(403);
  });

  it('no data: counts are 0 and every rate is "not enough data" (null), never 0 %', async () => {
    const f = await funnelOf(manager);
    expect(f.funnel.every((s) => s.count === 0 && s.ratePct === null)).toBe(true);
    expect(f.demoConversion.total).toBe(0);
    expect(f.students).toEqual({ active: 0, on_hold: 0, former: 0 });
  });

  it('counts persisted rows with their denominators; source/campaign only with attribution', async () => {
    const converted = await pendingCase(counsellor);
    const declined = await pendingCase(counsellor);
    await pendingCase(counsellor);
    await demo(converted, 3, { outcome: 'converted' });
    await ctx.db
      .update(opsAdmissions)
      .set({ enrolledAt: new Date() })
      .where(eq(opsAdmissions.id, converted.admissionId as never));
    await demo(declined, 1, { outcome: 'declined' });

    const f = await funnelOf(manager);
    expect(stages(f)).toEqual([
      ['leads', 3, null, null],
      ['demoBooked', 2, 3, 66.7],
      ['attended', 2, 2, 100],
      ['completed', 1, 2, 50],
      ['converted', 1, 2, 50],
      ['enrolled', 1, 1, 100],
    ]);
    expect(f.demoConversion.byProgramme).toEqual([
      expect.objectContaining({ demos: 2, decided: 2, converted: 1, ratePct: 50 }),
    ]);
    expect(f.demoConversion.bySource?.[0]).toMatchObject({ group: 'WEBINAR', demos: 2 });
    expect(f.demoConversion.byOutcome.map((g) => [g.group, g.demos])).toEqual([
      ['converted', 1],
      ['declined', 1],
    ]);

    const own = await funnelOf(counsellor);
    expect(own.scope).toBe('own');
    expect(own.funnel[0]?.count).toBe(3);
    expect(own.demoConversion.bySource).toBeNull();
  });

  it('completed = every planned demo DAY attended: three classes on day 1 are 1 of 3 days', async () => {
    const before = (await funnelOf(manager)).funnel.find((st) => st.key === 'completed')!.count;
    await demo(await pendingCase(counsellor), 3, { outcome: 'open' }, true);
    const f = await funnelOf(manager);
    expect(f.funnel.find((st) => st.key === 'attended')?.count).toBeGreaterThan(0);
    expect(f.funnel.find((st) => st.key === 'completed')?.count).toBe(before);
  });
});
