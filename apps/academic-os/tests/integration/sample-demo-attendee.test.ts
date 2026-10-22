import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicBatches,
  academicEnrolments,
  academicSessionDemoAttendees,
  academicStudents,
  academicTeacherReviews,
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsLeads,
  staffMembers,
  students as coreStudents,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, defineSeed, runSeeds } from '@elevate/database/seed';
import { addDays, toIsoDate } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_TEACHING_EMAILS } from '../../seed/samples';

const ctx = setupTestDatabase();

/** Stand-ins for the Ops seeds: the sample teachers and Diya's demo (class 3, 19 days ago, 10:00 IST). */
const opsStubs = [
  defineSeed({
    name: 'ops.sample-staff',
    module: 'ops',
    description: 'test stub',
    run: async ({ db }) => {
      for (const email of SAMPLE_TEACHING_EMAILS) {
        const [u] = await db
          .insert(users)
          .values({ email, displayName: `Sample ${email}`, status: 'active' })
          .onConflictDoNothing()
          .returning({ id: users.id });
        if (u) await db.insert(staffMembers).values({ userId: u.id, fullName: `Sample ${email}` });
      }
    },
  }),
  defineSeed({
    name: 'ops.samples',
    module: 'ops',
    dependsOn: ['ops.sample-staff'],
    description: 'test stub',
    run: async ({ db }) => {
      if (await db.$count(opsLeads)) return;
      const [by] = await db.select({ id: users.id }).from(users).limit(1);
      const [student] = await db
        .insert(coreStudents)
        .values({ fullName: 'Diya Sample Student', isSample: true })
        .returning();
      const [lead] = await db
        .insert(opsLeads)
        .values({
          code: 'LEAD-990001',
          studentName: 'Diya Sample Student',
          studentEmail: 'diya.sample@example.test',
          firstReceivedAt: new Date(),
          isSample: true,
          createdBy: by!.id,
        } as never)
        .returning();
      const [admission] = await db
        .insert(opsAdmissions)
        .values({
          code: 'ADM-990001',
          leadId: lead!.id,
          studentId: student!.id,
          createdBy: by!.id,
        } as never)
        .returning();
      const [demo] = await db
        .insert(opsDemos)
        .values({
          admissionId: admission!.id,
          leadId: lead!.id,
          feeTermsState: 'not_discussed',
          plannedSessionCount: 3,
          createdBy: by!.id,
        } as never)
        .returning();
      const day = addDays(toIsoDate(new Date()), -19);
      await db.insert(opsDemoSessions).values({
        demoId: demo!.id,
        sessionNumber: 3,
        dayNumber: 3,
        startsAt: new Date(`${day}T10:00:00+05:30`),
        subject: 'Logical Reasoning',
      } as never);
    },
  }),
];
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const seedAll = (db: Database) => runSeeds(db, [...coreSeeds, ...opsStubs, ...seeds], context);

describe('academic sample seeds: demo attendee and the real planning batch', () => {
  it('puts the sample demo student on an Academic roster with a demo review', async () => {
    await seedAll(ctx.db);
    await seedAll(ctx.db);
    const [attendee] = await ctx.db.select().from(academicSessionDemoAttendees);
    expect(attendee).toMatchObject({
      displayName: 'Diya Sample Student',
      demoDayNumber: 3,
      status: 'present',
      isSample: true,
    });
    expect(await ctx.db.$count(academicSessionDemoAttendees)).toBe(1);
    expect(
      await ctx.db.$count(
        academicTeacherReviews,
        eq(academicTeacherReviews.reviewType, 'demo_session'),
      ),
    ).toBe(1);
  }, 120_000);

  it('takes sample students off the real planning batch on re-seed', async () => {
    const [planning] = await ctx.db
      .select()
      .from(academicBatches)
      .where(eq(academicBatches.code, 'IPMAT-C12-APR27'));
    const [student] = await ctx.db
      .select()
      .from(academicStudents)
      .where(eq(academicStudents.code, 'STU-DEMO0001'));
    await ctx.db.insert(academicEnrolments).values({
      studentId: student!.id,
      programmeId: planning!.programmeId,
      courseId: planning!.courseId,
      batchId: planning!.id,
      source: 'manual',
      manualReason: 'Left by an older seed',
    });
    await seedAll(ctx.db);
    expect(
      await ctx.db.$count(
        academicEnrolments,
        and(
          eq(academicEnrolments.batchId, planning!.id),
          eq(academicEnrolments.studentId, student!.id),
        ),
      ),
    ).toBe(0);
  }, 120_000);
});
