/** Brief §6 privacy: a teacher reads only students of their own batches, never contact, guardian, KYC or fee data. Page and API. */
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@elevate/authentication';
import type { Database } from '@elevate/database';
import { authedRequest, callRoute, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as listRoute } from '../../src/app/api/v1/students/route';
import { GET as studentRoute } from '../../src/app/api/v1/students/[id]/route';
import StudentPage from '../../src/app/students/[id]/page';
import { createStudent, enrolManually } from '../../src/server';
import { LoadError } from '../../src/ui/shell';
import { actor, users, world } from './fixtures';

const as = vi.hoisted(() => ({ user: null as AuthenticatedUser | null, db: null as unknown }));
vi.mock('@elevate/authentication/next', () => ({ getCurrentUser: async () => as.user }));
vi.mock('@elevate/database', async (original) => ({ ...(await original<object>()), getDb: () => as.db as Database }));

const ctx = setupTestDatabase();
const PRIVATE = /guardian|email|phone|dateOfBirth/i;
const NEVER = /kyc|aadhaar|pan|fee|paise|amount|document/i;

/** Every private field is present but null, and no KYC/fee field exists at all. */
function assertMinimised(student: Record<string, unknown>) {
  expect(Object.keys(student).filter((k) => NEVER.test(k))).toEqual([]);
  expect(Object.fromEntries(Object.entries(student).filter(([k]) => PRIVATE.test(k)))).toEqual({ dateOfBirth: null, email: null, phone: null, guardianName: null, guardianRelationship: null, guardianEmail: null, guardianPhone: null });
  expect(student.contactsHidden).toBe(true);
}

describe('teacher privacy', () => {
  let teacherB: TestUser;
  let teacherA: TestUser;
  let studentId: string;

  it('teacher A cannot open teacher B’s student by page or API (404, no data); B can, without private fields', async () => {
    as.db = ctx.db; // routes and pages call getDb()
    const u = await users(ctx.db);
    teacherA = u.teacher;
    teacherB = await createTestUser(ctx.db, { roles: ['teacher'] });
    const b = await world(ctx.db, u, { teacher: teacherB, teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    await world(ctx.db, u); // teacher A's own batch
    const s = await createStudent(ctx.db, actor(u.coordinator), {
      fullName: 'Sample Meera Student',
      email: 'meera@example.test',
      dateOfBirth: '2009-04-01',
      guardianName: 'Sample Guardian Name',
      guardianRelationship: 'mother',
      guardianEmail: 'guardian@example.test',
    });
    studentId = s.id;
    await enrolManually(ctx.db, actor(u.coordinator), { studentId, batchId: b.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const get = (user: TestUser) => callRoute<{ student: Record<string, unknown> }>(studentRoute, authedRequest(user, `/academic/api/v1/students/${studentId}`), { id: studentId });

    expect((await get(teacherA)).status).toBe(404);
    expect((await callRoute<unknown[]>(listRoute, authedRequest(teacherA, '/academic/api/v1/students'))).data).toEqual([]);
    const own = await get(teacherB);
    expect(own.status).toBe(200);
    assertMinimised(own.data!.student);
    const listed = await callRoute<Record<string, unknown>[]>(listRoute, authedRequest(teacherB, '/academic/api/v1/students'));
    expect(listed.data!.map((r) => r.id)).toEqual([studentId]);
    assertMinimised(listed.data![0]!);
    // The coordinator (students:write) still sees the contact details.
    expect((await get(u.coordinator)).data!.student).toMatchObject({ guardianName: 'Sample Guardian Name', email: 'meera@example.test' });
  });

  it.each([
    ['teacher A (unassigned)', () => teacherA, false],
    ['teacher B (assigned)', () => teacherB, true],
  ])('student page for %s', async (_label, who, allowed) => {
    as.user = who();
    const page = await StudentPage({ params: Promise.resolve({ id: studentId }) });
    const json = JSON.stringify(page);
    expect(json.includes('Sample Meera Student')).toBe(allowed);
    for (const secret of ['Sample Guardian Name', 'meera@example.test', 'guardian@example.test', '2009-04-01', '/ops/']) expect(json).not.toContain(secret);
    if (!allowed) {
      expect(page.props.children.type).toBe(LoadError);
      expect(page.props.children.props.error).toMatchObject({ status: 404 });
    }
  });
});
