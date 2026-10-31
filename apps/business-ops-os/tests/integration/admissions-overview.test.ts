/**
 * Admissions overview (owner brief §4): KPI read with date/programme filters, own scope, fee
 * figures, onboarding and the confirmation gap check. Fictional data only.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  opsAdmissionChecks,
  opsAdmissions,
  opsApplications,
  opsDemos,
  opsDemoSessions,
  opsFeePlans,
  opsFeeRecords,
  opsOnboardingItems,
  opsSignatureConfirmations,
  type Database,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { addDays, istToday, READINESS_GAP_LABELS } from '../../src/domain';
import { buildAdmissionsOverview } from '../../src/server/admissions-overview';
import { approvalChecks, confirmationCheck } from '../../src/server/applications';
import { listApplications } from '../../src/server/applications-read';
import { applicationListQuery } from '../../src/server/applications-schemas';
import { loadSettings } from '../../src/server/settings';
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

describe('Approval blocked: the tile and the list it opens agree', () => {
  it('lists only signed applications an item still blocks', async () => {
    const blockedList = () =>
      listApplications(
        ctx.db,
        manager,
        applicationListQuery.parse({ status: 'signatures_confirmed', blocked: '1' }),
      );
    await signedApplication(ctx.db, people, { name: 'Sample Signed Clean' });
    expect((await blockedList()).total).toBe(0);
    const held = await signedApplication(ctx.db, people, { name: 'Sample Signed Held' });
    await ctx.db
      .delete(opsSignatureConfirmations)
      .where(eq(opsSignatureConfirmations.applicationId, held.applicationId as never));
    const list = await blockedList();
    expect(list.items.map((a) => a.id)).toEqual([held.applicationId]);
    expect((await overview(manager)).applications.approvalBlocked).toBe(list.total);
  });

  it('checked together each application reads as it does alone, in the same few statements (RVD-004)', async () => {
    const unverified = await signedApplication(ctx.db, people, {
      name: 'Sample Signed Unverified',
    });
    await ctx.db
      .delete(opsAdmissionChecks)
      .where(eq(opsAdmissionChecks.admissionId, unverified.admissionId as never));
    const rows = await ctx.db
      .select({ app: opsApplications, admission: opsAdmissions })
      .from(opsApplications)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsApplications.admissionId))
      .where(eq(opsApplications.status, 'signatures_confirmed'));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    await ctx.db.insert(opsFeeRecords).values({
      code: 'FEE-990001',
      admissionId: unverified.admissionId as never,
      leadId: rows.find((r) => r.admission.id === unverified.admissionId)!.admission.leadId,
      kind: 'received',
      amountPaise: 7_000_00,
      recordedBy: manager.id,
    });
    const settings = await loadSettings(ctx.db);
    const select = vi.spyOn(ctx.db, 'select');
    const statements = async (of: typeof rows) => {
      select.mockClear();
      const checks = await approvalChecks(ctx.db, of, settings);
      return { checks, count: select.mock.calls.length };
    };
    const [one, many] = [await statements(rows.slice(0, 1)), await statements(rows)];
    select.mockRestore();
    expect(many.count).toBe(one.count);
    expect(many.count).toBeLessThan(20);
    for (const { app, admission } of rows) {
      const alone = await confirmationCheck(ctx.db, app, admission, settings);
      expect(many.checks.find((c) => c.id === app.id)).toEqual({ id: app.id, ...alone });
    }
    const gapsOf = (id: string) => many.checks.find((c) => c.id === id)!.gaps.map((g) => g.message);
    expect(gapsOf(unverified.applicationId)).toEqual(
      expect.arrayContaining([READINESS_GAP_LABELS.fee_verification_1]),
    );
    const named = many.checks.find((c) => c.id === unverified.applicationId)!;
    expect(named.live.student.fullName).toBe('Sample Signed Unverified');
    expect(named.live.feeAgreement?.instalments).toHaveLength(3);
    // One application's money stays its own.
    expect(many.checks.map((c) => c.paid.tuitionPaise).sort((a, b) => b - a)).toEqual([
      7_000_00,
      ...many.checks.slice(1).map(() => 0),
    ]);
    expect(named.paid.tuitionPaise).toBe(7_000_00);
    expect(
      many.checks.filter((c) => c.gaps.length === 0).map((c) => c.live.student.fullName),
    ).toContain('Sample Signed Clean');
  });
});
