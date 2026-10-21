/**
 * Admissions overview (owner brief §4): KPI read with date/programme filters, own scope, fee
 * figures, onboarding and the confirmation gap check. Fictional data only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsFeePlans,
  opsFeeRecords,
  opsOnboardingItems,
  type Database,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { addDays, istToday } from '../../src/domain';
import { buildAdmissionsOverview } from '../../src/server/admissions-overview';
import { pendingCase } from './admissions-fixtures';
import { confirmAs, signedApplication, type People } from './application-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let other: StaffUser;
let director: TestUser;
let finance: TestUser;
let coordinator: TestUser;
let people: People;

const overview = (user: TestUser, options: Parameters<typeof buildAdmissionsOverview>[2] = {}) =>
  buildAdmissionsOverview(ctx.db as Database, user, options);
const today = () => istToday(new Date());

/** A demo of the case: three classes, all on demo day 1, all attended. */
async function oneDayDemo(c: { leadId: string; admissionId: string }) {
  const [d] = await ctx.db
    .insert(opsDemos)
    .values({
      admissionId: c.admissionId as never,
      leadId: c.leadId as never,
      feeTermsState: 'proposed',
      plannedSessionCount: 3,
      counsellorStaffId: counsellor.staffId,
      createdBy: manager.id,
    })
    .returning();
  for (let n = 1; n <= 3; n += 1)
    await ctx.db.insert(opsDemoSessions).values({
      demoId: d!.id,
      sessionNumber: n,
      dayNumber: 1,
      startsAt: new Date(Date.now() - (4 - n) * 3_600_000),
      attendance: 'present',
      recordedAt: new Date(),
      recordedBy: manager.id,
    });
}

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  other = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  director = await createTestUser(ctx.db, { roles: ['director'] });
  finance = await createTestUser(ctx.db, { roles: ['finance_officer'] });
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  people = { counsellor, manager, director };
});

describe('admissions overview (brief §4)', () => {
  it('403 without ops:admissions:read', async () => {
    await expect(overview(coordinator)).rejects.toMatchObject({ status: 403 });
  });

  it('no data: rates and unknowns are missing, never 0', async () => {
    const o = await overview(manager);
    expect(o.window).toEqual({ from: addDays(today(), -29), to: today() });
    expect(o.demos.days.daysAttended.status).toBe('missing');
    expect(o.conversion.rate.status).toBe('missing');
    expect(o.onboarding.items.status).toBe('missing');
    expect(o.fees).toEqual({ collected: null, outstanding: null });
    expect(Object.values(o.applications.awaiting).map((m) => m.value)).toEqual([0, 0, 0, 0]);
    expect(o.confirmed.metric.value).toBe(0);
  });

  it('counts days not classes, waiting approvals, confirmations, onboarding and fees', async () => {
    await oneDayDemo(await pendingCase(counsellor, { counselledOnly: true }));
    const signed = await signedApplication(ctx.db, people, { name: 'Overview Test Student' });

    let o = await overview(manager);
    expect(o.demos.days).toMatchObject({ demos: 1, plannedDays: 3, allDaysAttended: 0 });
    expect(o.demos.days.daysAttended.value).toBe(1);
    expect(o.demos.list).toMatchObject({ current: 1 });
    // First demo day is today: still inside the conversion window, so not in the denominator.
    expect(o.conversion).toMatchObject({ cohort: 0, waiting: 1, converted: 0 });
    expect(o.conversion.rate.status).toBe('missing');
    expect(o.applications.awaiting.signatures_confirmed.value).toBe(1);
    expect(o.applications.approvalBlocked).toBe(0);

    const done = await confirmAs(director, signed.applicationId, {
      password: director.password,
      applicationVersion: signed.version,
    });
    expect(done.status).toBe(201);
    // signedApplication left an active ₹1,00,000 agreement on the case.
    const [plan] = await ctx.db
      .select()
      .from(opsFeePlans)
      .where(eq(opsFeePlans.admissionId, signed.admissionId as never));
    const [lead] = await ctx.db
      .select({ leadId: opsAdmissions.leadId })
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, signed.admissionId as never));
    await ctx.db.insert(opsFeeRecords).values({
      code: 'FEE-900001',
      admissionId: signed.admissionId as never,
      leadId: lead!.leadId,
      kind: 'received',
      chargeCategory: 'tuition',
      planId: plan!.id,
      amountPaise: 40_000_00,
      paymentDate: today(),
      recordedBy: manager.id,
    });
    await ctx.db.insert(opsOnboardingItems).values({
      admissionId: signed.admissionId as never,
      itemKey: 'id_card',
      label: 'ID card issued',
      kind: 'check',
      dueDate: addDays(today(), -1),
      addedExplicitly: true,
      createdBy: manager.id,
    });

    o = await overview(manager);
    expect(o.applications.awaiting.signatures_confirmed.value).toBe(0);
    expect(o.confirmed.metric.value).toBe(1);
    expect(o.confirmed.rows[0]).toMatchObject({
      admissionNumber: done.data!.admissionNumber,
      studentName: 'Overview Test Student',
    });
    expect(o.onboarding.items.value).toBe(1);
    expect(o.onboarding.rows[0]).toMatchObject({ label: 'ID card issued', status: 'not_started' });
    expect(o.fees?.collected).toMatchObject({ netPaise: 40_000_00 });
    expect(o.fees?.outstanding).toMatchObject({ agreements: 1, outstandingPaise: 60_000_00 });
  });

  it('programme filter and own scope narrow every figure', async () => {
    const clat = await overview(manager, { programme: 'CLAT' });
    expect(clat.confirmed.metric.value).toBe(0);
    expect(clat.demos.days.demos).toBe(0);
    expect(clat.fees?.collected).toBeNull();

    const own = await overview(counsellor);
    expect(own.scope).toBe('own');
    expect(own.confirmed.metric.value).toBe(1);
    const stranger = await overview(other);
    expect(stranger.confirmed.metric.value).toBe(0);
    expect(stranger.demos.days.demos).toBe(0);
    expect(stranger.fees).toEqual({ collected: null, outstanding: null });
  });

  it('a past period leaves today out; no ops:leads:read → no demo-list figures', async () => {
    const past = await overview(manager, {
      from: addDays(today(), -60),
      to: addDays(today(), -31),
    });
    expect(past.confirmed.metric.value).toBe(0);
    expect(past.demos.days.daysAttended.status).toBe('missing');
    const f = await overview(finance);
    expect(f.demos.list).toBeNull();
    expect(f.fees?.outstanding?.agreements).toBe(1);
  });
});
