/**
 * HR seeds (brief 23 Oct 2026 §4, R10): the Satish development-assumption login is linked to the
 * owner-supplied staff record, refuses foreign accounts and is switched off (and unlinked, the
 * real record staying active) by db:clear-samples; clear-samples removes the new HR sample rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  departments,
  opsDailyAttendance,
  opsLeaveRecords,
  opsStaffDepartments,
  opsStaffProfiles,
  opsTeacherFeedbackSummaries,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import {
  DEV_ASSUMPTION_ACCOUNTS,
  disableDemoAccounts,
  seedDevAssumptionAccounts,
} from '@elevate/database/seed';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { clearSamples } from '../../seed';
import { seedTeachers } from '../../seed/teachers';
import { setupReference } from './fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const EMAIL = DEV_ASSUMPTION_ACCOUNTS[0].email;
const satish = async () =>
  (
    await db().select().from(staffMembers).where(eq(staffMembers.fullName, 'Satish Raghuvanshi'))
  )[0]!;

beforeAll(async () => {
  await setupReference(db());
});

describe('teacher logins (development assumptions)', () => {
  it('refuses before the owner-supplied staff exist', async () => {
    await expect(seedDevAssumptionAccounts(db(), 'test-only-hash-1')).rejects.toThrow(/db:seed/);
  });

  it('is linked to Satish’s staff record as a teacher, labelled, and repeatable', async () => {
    await seedTeachers(db());
    await seedDevAssumptionAccounts(db(), 'test-only-hash-1');
    await seedDevAssumptionAccounts(db(), 'test-only-hash-2');
    const [u] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(u).toMatchObject({ status: 'active', passwordHash: 'test-only-hash-2' });
    expect(u!.displayName).toMatch(/development assumption/);
    expect((await satish()).userId).toBe(u!.id);
    const roles = await db().select().from(userRoles).where(eq(userRoles.userId, u!.id));
    expect(roles.map((r) => r.role)).toEqual(['teacher']);
  });

  it.each([
    ['soma@elevateeducation.in', 'Soma'],
    ['nikunjbindal@elevateeducation.in', 'Nikunj Bindal'],
    ['tushar@elevateeducation.in', 'Tushar Bhakte'],
  ])('%s is linked to the staff record "%s" only, as a teacher', async (email, name) => {
    const [u] = await db().select().from(users).where(eq(users.email, email));
    const linked = await db().select().from(staffMembers).where(eq(staffMembers.userId, u!.id));
    expect(linked.map((s) => s.fullName)).toEqual([name]);
    const roles = await db().select().from(userRoles).where(eq(userRoles.userId, u!.id));
    expect(roles.map((r) => r.role)).toEqual(['teacher']);
    if (name === 'Soma') expect(u!.displayName).toMatch(/owner to confirm/);
  });

  it('never links soma@ to Soma Tiwari', async () => {
    const [tiwari] = await db()
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.fullName, 'Soma Tiwari'));
    expect(tiwari!.userId).toBeNull();
  });

  it('db:clear-samples disables and unlinks it; Satish’s record stays active', async () => {
    expect(await disableDemoAccounts(db())).toBe(DEV_ASSUMPTION_ACCOUNTS.length);
    const [u] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(u).toMatchObject({ status: 'disabled', passwordHash: null });
    expect(await satish()).toMatchObject({ userId: null, status: 'active' });
  });

  it('never takes over a real account with that email', async () => {
    await db().update(users).set({ displayName: 'Real Person' }).where(eq(users.email, EMAIL));
    await expect(seedDevAssumptionAccounts(db(), 'test-only-hash-3')).rejects.toThrow(
      /already belong/,
    );
  });
});

describe('db:clear-samples and the HR sample tables', () => {
  it('removes sample attendance, leave, feedback summaries and a sample person’s history', async () => {
    const hr = await createTestUser(db(), { roles: ['hr_manager'] });
    const [sample] = await db()
      .insert(staffMembers)
      .values({ fullName: 'Sample HR Clear Teacher' })
      .returning();
    await db().insert(opsStaffProfiles).values({ staffId: sample!.id, isSample: true });
    const real = await satish();
    const [dept] = await db().select().from(departments).limit(1);
    await db().insert(opsStaffDepartments).values({
      staffId: sample!.id,
      departmentId: dept!.id,
      isPrimary: true,
      createdBy: hr.id,
    });
    await db()
      .insert(opsDailyAttendance)
      .values([
        { staffId: sample!.id, workDate: '2026-10-20', status: 'present', isSample: true },
        { staffId: real.id, workDate: '2026-10-20', status: 'present' },
      ]);
    await db().insert(opsLeaveRecords).values({
      staffId: sample!.id,
      fromDate: '2026-10-21',
      toDate: '2026-10-21',
      kind: 'casual',
      status: 'approved',
      isSample: true,
      approvedBy: hr.id,
    });
    await db()
      .insert(opsTeacherFeedbackSummaries)
      .values({
        teacherStaffId: sample!.id,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        responseCount: 6,
        ratingScaleMax: 5,
        categoryMeans: { categories: {} },
        isSample: true,
        createdBy: hr.id,
      });
    const counts = await clearSamples(db());
    expect(counts).toMatchObject({
      'ops.daily_attendance': 1,
      'ops.leave_records': 1,
      'ops.teacher_feedback_summaries': 1,
      'ops.staff_departments': 1,
      'core.staff_members': 1,
    });
    expect(await db().select().from(opsDailyAttendance)).toHaveLength(1); // the real row stays
  });
});
