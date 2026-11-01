/**
 * HR seeds (brief 23 Oct 2026 §4, R10; owner 31 Oct 2026, "made up everything"): the four
 * development-assumption logins are linked to made-up teachers, refuse foreign accounts and are
 * switched off by db:clear-samples; a real person an older database linked loses only the login.
 * clear-samples removes the new HR sample rows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  departments,
  opsDailyAttendance,
  opsLeaveApplications,
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
  COVER_TEACHERS,
  DEV_ASSUMPTION_ACCOUNTS,
  disableDemoAccounts,
  FORMER_DEV_LOGINS,
  seedDevAssumptionAccounts,
  SUBJECT_TEACHERS,
} from '@elevate/database/seed';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { clearSamples } from '../../seed';
import { seedStaff } from '../../seed/reference';
import { setupReference } from './fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const DEV = DEV_ASSUMPTION_ACCOUNTS[0]!;
const EMAIL = DEV.email;
const staffNamed = async (fullName: string) =>
  (await db().select().from(staffMembers).where(eq(staffMembers.fullName, fullName)))[0]!;

beforeAll(async () => {
  await setupReference(db());
});

describe('teacher logins (development assumptions)', () => {
  it('refuses before the made-up teachers exist', async () => {
    await expect(seedDevAssumptionAccounts(db(), 'test-only-hash-1')).rejects.toThrow(/db:seed/);
  });

  it('is linked to a made-up teacher, under that name, and repeatable', async () => {
    await seedStaff(db());
    await seedDevAssumptionAccounts(db(), 'test-only-hash-1');
    await seedDevAssumptionAccounts(db(), 'test-only-hash-2');
    const [u] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(u).toMatchObject({ status: 'active', passwordHash: 'test-only-hash-2' });
    expect(u!.displayName).toBe(DEV.staffFullName);
    expect((await staffNamed(DEV.staffFullName)).userId).toBe(u!.id);
    const roles = await db().select().from(userRoles).where(eq(userRoles.userId, u!.id));
    expect(roles.map((r) => r.role)).toEqual(['teacher']);
  });

  it.each(DEV_ASSUMPTION_ACCOUNTS.map((a) => [a.email, a.staffFullName] as const))(
    '%s is linked to the staff record "%s" only, as a teacher',
    async (email, name) => {
      const [u] = await db().select().from(users).where(eq(users.email, email));
      const linked = await db().select().from(staffMembers).where(eq(staffMembers.userId, u!.id));
      expect(linked.map((s) => s.fullName)).toEqual([name]);
      const roles = await db().select().from(userRoles).where(eq(userRoles.userId, u!.id));
      expect(roles.map((r) => r.role)).toEqual(['teacher']);
    },
  );

  it('an older database linked the login to a real person: the login moves, the person stays', async () => {
    const [u] = await db().select().from(users).where(eq(users.email, EMAIL));
    const madeUp = await staffNamed(DEV.staffFullName);
    await db().update(staffMembers).set({ userId: null }).where(eq(staffMembers.id, madeUp.id));
    const [person] = await db()
      .insert(staffMembers)
      .values({ fullName: 'Real Colleague', userId: u!.id })
      .returning();
    await seedDevAssumptionAccounts(db(), 'test-only-hash-1');
    expect(await staffNamed('Real Colleague')).toMatchObject({ id: person!.id, userId: null });
    expect((await staffNamed(DEV.staffFullName)).userId).toBe(u!.id);
    // Older still: linked when the logins go off. The person keeps working, without the login.
    await db().update(staffMembers).set({ userId: null }).where(eq(staffMembers.id, madeUp.id));
    await db().update(staffMembers).set({ userId: u!.id }).where(eq(staffMembers.id, person!.id));
    expect(await disableDemoAccounts(db())).toBe(DEV_ASSUMPTION_ACCOUNTS.length);
    expect(await staffNamed('Real Colleague')).toMatchObject({ userId: null, status: 'active' });
    await db().update(staffMembers).set({ userId: u!.id }).where(eq(staffMembers.id, madeUp.id));
  });

  it('a login an older seed made for a real teacher goes off; a real account at that address does not', async () => {
    const [older, own] = await db()
      .insert(users)
      .values([
        {
          email: FORMER_DEV_LOGINS[0]!,
          displayName: 'Old Name (development assumption)',
          status: 'active',
        },
        { email: FORMER_DEV_LOGINS[1]!, displayName: 'Real Person', status: 'active' },
      ])
      .returning();
    const [person] = await db()
      .insert(staffMembers)
      .values({ fullName: 'Real Teacher Linked', userId: older!.id })
      .returning();
    await disableDemoAccounts(db());
    const [olderAfter] = await db().select().from(users).where(eq(users.id, older!.id));
    const [ownAfter] = await db().select().from(users).where(eq(users.id, own!.id));
    expect(olderAfter!.status).toBe('disabled');
    expect(ownAfter!.status).toBe('active');
    expect(await staffNamed('Real Teacher Linked')).toMatchObject({
      id: person!.id,
      userId: null,
      status: 'active',
    });
  });

  it('db:clear-samples switches the logins off; made-up teachers go inactive and keep their login', async () => {
    await seedDevAssumptionAccounts(db(), 'test-only-hash-1');
    expect(await disableDemoAccounts(db())).toBeGreaterThanOrEqual(DEV_ASSUMPTION_ACCOUNTS.length);
    const [u] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(u).toMatchObject({ status: 'disabled', passwordHash: null });
    expect(await staffNamed(DEV.staffFullName)).toMatchObject({
      userId: u!.id,
      status: 'inactive',
    });
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
    const real = await staffNamed('Real Colleague');
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
    // Sample leave applications go first (one holds a sample leave record); a real one stays.
    const [sampleLeave] = await db().select({ id: opsLeaveRecords.id }).from(opsLeaveRecords);
    const application = { kind: 'Casual', reason: 'Sample reason', appliedBy: hr.id };
    await db()
      .insert(opsLeaveApplications)
      .values([
        {
          ...application,
          staffId: sample!.id,
          fromDate: '2026-10-21',
          toDate: '2026-10-21',
          status: 'approved',
          decidedBy: hr.id,
          decidedAt: new Date(),
          leaveRecordId: sampleLeave!.id,
          isSample: true,
        },
        {
          ...application,
          staffId: real.id,
          fromDate: '2026-10-22',
          toDate: '2026-10-22',
          isSample: true,
        },
        { ...application, staffId: real.id, fromDate: '2026-10-23', toDate: '2026-10-23' },
      ]);
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
      'ops.leave_applications': 2,
      'ops.leave_records': 1,
      'ops.teacher_feedback_summaries': 1,
      'ops.staff_departments': 1,
      // This one, and the made-up teachers without a login (the four linked ones keep theirs).
      'core.staff_members':
        1 + SUBJECT_TEACHERS.length + COVER_TEACHERS.length - DEV_ASSUMPTION_ACCOUNTS.length,
    });
    expect(await db().select().from(opsDailyAttendance)).toHaveLength(1); // the real row stays
    expect(await db().select().from(opsLeaveApplications)).toMatchObject([
      { staffId: real.id, fromDate: '2026-10-23', isSample: false },
    ]);
  });
});

describe('a real person who shares a made-up teacher’s name', () => {
  it('is someone else: the seed makes its own record and db:clear-samples leaves theirs', async () => {
    const name = SUBJECT_TEACHERS[0][0];
    await clearSamples(db());
    const [person] = await db().insert(staffMembers).values({ fullName: name }).returning();
    await db().insert(opsStaffProfiles).values({ staffId: person!.id });
    await seedStaff(db());
    const same = await db().select().from(staffMembers).where(eq(staffMembers.fullName, name));
    expect(same).toHaveLength(2);
    const [profile] = await db()
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, person!.id));
    expect(profile!.isSample).toBe(false);
    await clearSamples(db());
    expect(
      (await db().select().from(staffMembers).where(eq(staffMembers.fullName, name))).map(
        (s) => s.id,
      ),
    ).toEqual([person!.id]);
  });
});
