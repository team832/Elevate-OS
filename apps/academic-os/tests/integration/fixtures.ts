/**
 * Test fixtures for Academic OS integration tests. Fictional people only; core
 * rows (programmes, staff) are inserted directly as test fixtures because the
 * in-memory database starts empty.
 */
import { eq } from 'drizzle-orm';
import { createTestUser, type TestUser } from '@elevate/testing';
import { programmes, staffMembers, type Database } from '@elevate/database';
import type { RoleKey, StaffMemberId } from '@elevate/shared-types';
import { createAssignment, createBatch, createChapter, createCourse, createSubject } from '../../src/server';
import type { Actor } from '../../src/server';

let counter = 0;
export const uniq = (prefix = 'T') => `${prefix}${Date.now().toString(36).toUpperCase()}${++counter}`;

export const actor = (user: TestUser): Actor => ({ user, requestId: 'test-request' });

export async function staffFor(db: Database, user: TestUser | null, name = 'Staff Member (fictional)'): Promise<StaffMemberId> {
  if (user) {
    const [existing] = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.userId, user.id));
    if (existing) return existing.id;
  }
  const [row] = await db.insert(staffMembers).values({ userId: user?.id ?? null, fullName: name, status: 'active' }).returning({ id: staffMembers.id });
  return row!.id;
}

export async function users(db: Database) {
  const make = (role: RoleKey) => createTestUser(db, { roles: [role] });
  return {
    coordinator: await make('academic_coordinator'),
    coordinator2: await make('academic_coordinator'),
    teacher: await make('teacher'),
    teacher2: await make('teacher'),
    director: await make('director'),
    auditor: await make('auditor'),
    counsellor: await make('admissions_counsellor'),
    marketing: await make('marketing_manager'),
  };
}
export type Users = Awaited<ReturnType<typeof users>>;

/**
 * A programme, a 75-minute (locked) course with two subjects and three chapters,
 * an active batch from 2026-09-01, the teacher assigned to QUANT and teacher2 to VERBAL.
 */
export async function world(
  db: Database,
  u: Users,
  opts: { capacity?: number; programmeStatus?: 'active' | 'planned' | 'paused'; teacher?: TestUser; teacher2?: TestUser } = {},
) {
  const programmeCode = uniq('P');
  const [programme] = await db.insert(programmes).values({ code: programmeCode, name: `Programme ${programmeCode}`, status: opts.programmeStatus ?? 'active' }).returning();
  const coord = actor(u.coordinator);
  const course = await createCourse(db, coord, {
    programmeCode,
    code: uniq('C-'),
    familyCode: uniq('F-'),
    version: 1,
    name: 'Test course (fictional)',
    classMinutes: 75,
    classMinutesStatus: 'locked',
    status: 'active',
  });
  const quant = await createSubject(db, coord, course.id, { code: 'QUANT', name: 'Quant', sortOrder: 0 });
  const verbal = await createSubject(db, coord, course.id, { code: 'VERBAL', name: 'Verbal', sortOrder: 1 });
  const ch1 = await createChapter(db, coord, course.id, { subjectId: quant.id, code: 'Q-01', title: 'Numbers', sortOrder: 0, weight: 2 });
  const ch2 = await createChapter(db, coord, course.id, { subjectId: quant.id, code: 'Q-02', title: 'Algebra', sortOrder: 1, weight: 1 });
  const ch3 = await createChapter(db, coord, course.id, { subjectId: verbal.id, code: 'V-01', title: 'Grammar', sortOrder: 0, weight: 1 });
  const batch = await createBatch(db, coord, {
    code: uniq('B-'),
    name: 'Test batch (fictional)',
    courseId: course.id,
    startDate: '2026-09-01',
    status: 'active',
    capacity: opts.capacity,
  });
  const teacherStaff = await staffFor(db, opts.teacher ?? u.teacher, 'Tina Teacher (fictional)');
  const teacher2Staff = await staffFor(db, opts.teacher2 ?? u.teacher2, 'Tom Teacher (fictional)');
  await createAssignment(db, coord, { batchId: batch.id, subjectId: quant.id, staffMemberId: teacherStaff });
  await createAssignment(db, coord, { batchId: batch.id, subjectId: verbal.id, staffMemberId: teacher2Staff });
  return { programme: programme!, programmeCode, course, quant, verbal, ch1, ch2, ch3, batch, teacherStaff, teacher2Staff };
}
export type World = Awaited<ReturnType<typeof world>>;
