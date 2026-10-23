/**
 * OA-3 / R10: the real staff assignments from the owner brief of 23 Oct 2026 — 1 active, 4 pending,
 * none for Soma Tiwari, no CLAT for Satish — are not sample data, carry their source in the audit
 * log, add no delivery records, and are idempotent (a withdrawn one is not re-created).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicAttendance,
  academicBatches,
  academicClassRecords,
  academicClassSessions,
  academicCourses,
  academicSubjects,
  academicTeacherAssignments,
  academicTeacherReviews,
  auditEvents,
  staffMembers,
  type Database,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { OWNER_ASSIGNMENT_SOURCE, OWNER_ASSIGNMENTS } from '../../seed/owner-assignments';
import { withdrawAssignment } from '../../src/server';
import { opsSeedStubs } from './sample-seed-stubs';

const ctx = setupTestDatabase();
const NAMES = [...new Set([...OWNER_ASSIGNMENTS.map((a) => a.staff), 'Soma Tiwari'])];

/** Stand-in for ops.teachers: the staff records only (no logins, no activity). */
const teachers = async (db: Database) => {
  for (const fullName of NAMES) {
    const [found] = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.fullName, fullName));
    if (!found) await db.insert(staffMembers).values({ fullName, title: 'Teacher' });
  }
};
const seedAll = (db: Database) => runSeeds(db, [...coreSeeds, ...opsSeedStubs(undefined, teachers), ...seeds], { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} });

async function assignmentsByStaff(db: Database) {
  const rows = await db
    .select({ staff: staffMembers.fullName, course: academicCourses.code, subject: academicSubjects.code, batch: academicBatches.code, status: academicTeacherAssignments.status, id: academicTeacherAssignments.id })
    .from(academicTeacherAssignments)
    .innerJoin(staffMembers, eq(staffMembers.id, academicTeacherAssignments.staffMemberId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicTeacherAssignments.subjectId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
    .leftJoin(academicBatches, eq(academicBatches.id, academicTeacherAssignments.batchId))
    .where(inArray(staffMembers.fullName, NAMES));
  return rows.map((r) => [r.staff, `${r.course}/${r.subject}`, r.batch, r.status, r.id] as const);
}

describe('academic.owner-assignments seed (OA-3)', () => {
  it('Satish: IPMAT Quant active on IPMAT-C12-APR27, Class 11/12 Maths pending; Nikunj CA Accounting and Soma CLAT CA pending; Soma Tiwari none', async () => {
    await seedAll(ctx.db);
    await seedAll(ctx.db);
    const rows = await assignmentsByStaff(ctx.db);
    expect(rows.map(([staff, subject, batch, status]) => [staff, subject, batch, status]).sort()).toEqual(
      [
        ['Nikunj Bindal', 'CAF-ACC-SEP27/ACC', null, 'pending'],
        ['Satish Raghuvanshi', 'COM-C11-2627/MATH', null, 'pending'],
        ['Satish Raghuvanshi', 'COM-C12-2627/MATH', null, 'pending'],
        ['Satish Raghuvanshi', 'IPMAT-C12-2027/QUANT', 'IPMAT-C12-APR27', 'active'],
        ['Soma', 'CLAT-SYL-2027/CA', null, 'pending'],
      ].sort(),
    );
    const seeded = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'assignment.seeded'));
    expect(seeded).toHaveLength(5);
    expect(seeded.every((e) => (e.metadata as { source?: string }).source === OWNER_ASSIGNMENT_SOURCE)).toBe(true);
    // No delivery or evaluation records for real people.
    const staffIds = (await ctx.db.select({ id: staffMembers.id }).from(staffMembers).where(inArray(staffMembers.fullName, NAMES))).map((s) => s.id);
    expect(await ctx.db.$count(academicClassSessions, inArray(academicClassSessions.teacherStaffId, staffIds))).toBe(0);
    expect(await ctx.db.$count(academicClassRecords, inArray(academicClassRecords.teacherStaffId, staffIds))).toBe(0);
    expect(await ctx.db.$count(academicTeacherReviews, inArray(academicTeacherReviews.authorStaffId, staffIds))).toBe(0);
    expect(await ctx.db.$count(academicAttendance)).toBe(0);
  });

  it('a withdrawn pending assignment is not re-created by a later seed run', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const soma = (await assignmentsByStaff(ctx.db)).find(([staff]) => staff === 'Soma')!;
    await withdrawAssignment(ctx.db, { user: coordinator }, soma[4], 'Owner changed the plan (test)');
    await seedAll(ctx.db);
    const [somaStaff] = await ctx.db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.fullName, 'Soma'));
    expect(await ctx.db.$count(academicTeacherAssignments, and(eq(academicTeacherAssignments.staffMemberId, somaStaff!.id)))).toBe(0);
  });
});
