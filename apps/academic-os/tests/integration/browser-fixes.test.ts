/** Browser-pass fixes (22 Oct 2026): sample flag on intake, log chapters by subject, teacher pickers list only teaching staff. */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicStudents, students as coreStudents } from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { enrolmentKeys, type EventPayload } from '@elevate/shared-contracts';
import { setupTestDatabase } from '@elevate/testing';
import { createSessions, createStudent, getSessionLog, listStaff, runEnrolmentIntake } from '../../src/server';
import { actor, staffFor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;

const request = (over: Record<string, unknown>) => {
  const admissionId = crypto.randomUUID();
  const payload = {
    admissionId,
    leadId: crypto.randomUUID(),
    attempt: 1,
    programmeCode: w.programmeCode,
    student: { fullName: 'Sample Ira Example', email: 'ira@example.test' },
    counsellorStaffId: w.teacherStaff,
    requestedByUserId: u.counsellor.id,
    ...over,
  } as unknown as EventPayload<'ops.admission.enrolment_requested', 1>;
  return withTransaction(ctx.db, (tx) => publishEvent(tx, { type: 'ops.admission.enrolment_requested', version: 1, idempotencyKey: enrolmentKeys.request(admissionId, 1), payload }));
};
const sampleCore = async () => (await ctx.db.insert(coreStudents).values({ fullName: 'Sample Core Student', isSample: true }).returning())[0]!;

describe('intake copies the sample flag from the linked core student (D-036)', () => {
  it('a new academic student created for a sample core student is is_sample', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const core = await sampleCore();
    await request({ coreStudentId: core.id });
    expect(await runEnrolmentIntake(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    const [student] = await ctx.db.select().from(academicStudents).where(eq(academicStudents.coreStudentId, core.id));
    expect(student!.isSample).toBe(true);
  });

  it('linking an existing academic student to a sample core student marks it sample', async () => {
    const existing = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Sample Existing Student' });
    expect(existing.isSample).toBe(false);
    const core = await sampleCore();
    await request({ existingStudentId: existing.id, coreStudentId: core.id });
    expect(await runEnrolmentIntake(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    const [student] = await ctx.db.select().from(academicStudents).where(eq(academicStudents.id, existing.id));
    expect(student).toMatchObject({ coreStudentId: core.id, isSample: true });
  });
});

describe('teaching log page', () => {
  it("offers only the chapters of the class's subject", async () => {
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), [
      { batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 },
    ]);
    const log = await getSessionLog(ctx.db, actor(u.teacher), sessions[0]!.id);
    expect(log.chapters.map((c) => c.code)).toEqual(['Q-01', 'Q-02']);
  });
});

describe('teacher pickers', () => {
  it('teachingOnly lists staff with a teaching assignment, not every staff member', async () => {
    const office = await staffFor(ctx.db, null, 'Sample Office Staff');
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(await listStaff(ctx.db))).toContain(office);
    const teaching = ids(await listStaff(ctx.db, { teachingOnly: true }));
    expect(teaching).toEqual(expect.arrayContaining([w.teacherStaff, w.teacher2Staff]));
    expect(teaching).not.toContain(office);
  });
});
