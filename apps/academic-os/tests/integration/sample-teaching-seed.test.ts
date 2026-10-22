import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicAttendance,
  academicBatchPlacements,
  academicClassRecords,
  academicClassSessions,
  academicSessionTeachers,
  academicTeacherAssignments,
  academicTeacherReviews,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_SESSIONS, SAMPLE_TEACHING_EMAILS, sampleAnchorDate } from '../../seed/samples';
import { opsSeedStubs } from './sample-seed-stubs';

const ctx = setupTestDatabase();

/** The sample teachers' core identities, as the Ops seed `ops.sample-staff` creates them. */
async function sampleStaff(db: Database) {
  for (const email of SAMPLE_TEACHING_EMAILS) {
    const [user] = await db
      .insert(users)
      .values({ email, displayName: `Sample ${email}`, status: 'active' })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (user)
      await db.insert(staffMembers).values({ userId: user.id, fullName: `Sample ${email}` });
  }
}

const staffId = async (email: string) =>
  (
    await ctx.db
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .where(eq(users.email, email))
  )[0]!.id;

describe('academic.sample-teaching (brief 2 §14, owner answer 4)', () => {
  it('seeds every class case once, all inside sample batches', async () => {
    const all = [...coreSeeds, ...opsSeedStubs(sampleStaff), ...seeds];
    const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
    await runSeeds(ctx.db, all, context);
    await runSeeds(ctx.db, all, context);

    const sessions = await ctx.db.select().from(academicClassSessions);
    expect(sessions).toHaveLength(SAMPLE_SESSIONS.length);
    const byStatus = (s: string) => sessions.filter((r) => r.status === s);
    expect([
      byStatus('held').length,
      byStatus('cancelled').length,
      byStatus('scheduled').length,
    ]).toEqual([3, 1, 4]);
    expect(byStatus('held').every((s) => s.deliveredAt && s.deliveredByUserId)).toBe(true);
    const [makeup] = sessions.filter((s) => s.kind === 'makeup');
    expect(makeup!.makeupForSessionId).toBe(byStatus('cancelled')[0]!.id);

    const [sub] = await ctx.db
      .select()
      .from(academicSessionTeachers)
      .where(eq(academicSessionTeachers.role, 'substitute'));
    expect(sub).toMatchObject({
      participation: 'actual',
      replacesStaffId: await staffId('isha.nair@example.test'),
    });
    expect(sub!.authorisedByUserId).not.toBeNull();

    const logged = new Set(
      (await ctx.db.select().from(academicClassRecords)).map((r) => r.sessionId),
    );
    expect(byStatus('held').filter((s) => !logged.has(s.id))).toHaveLength(1); // log pending

    const arjun = await staffId('arjun.menon@example.test');
    const batchesOf = await ctx.db
      .select({ b: academicTeacherAssignments.batchId })
      .from(academicTeacherAssignments)
      .where(eq(academicTeacherAssignments.staffMemberId, arjun));
    expect(new Set(batchesOf.map((r) => r.b)).size).toBe(2);
    const nisha = await staffId('nisha.rao@example.test');
    const anchor = sampleAnchorDate();
    expect(sessions.filter((s) => s.teacherStaffId === nisha && s.date === anchor)).toHaveLength(0);

    const marks = (await ctx.db.select().from(academicAttendance)).map((a) => a.status);
    expect(marks).toHaveLength(3 * 6);
    expect(new Set(marks)).toEqual(new Set(['present', 'late', 'absent', 'excused']));
    expect(
      await ctx.db.$count(
        academicBatchPlacements,
        and(eq(academicBatchPlacements.isSample, true), isNull(academicBatchPlacements.endDate)),
      ),
    ).toBe(6);
    const reviews = await ctx.db.select().from(academicTeacherReviews);
    expect(reviews.map((r) => r.status).sort()).toEqual(['draft', 'submitted']);
    expect(reviews.every((r) => r.isSample)).toBe(true);
  }, 120_000);
});
