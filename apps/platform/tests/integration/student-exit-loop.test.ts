/**
 * The student's way in and out across workspaces, on the real services of both modules (owner:
 * "student entering, no point of exiting"): enrolled through the handoff, exit recorded in Ops,
 * Academic's enrolment ends, a replay does nothing, readmission and reactivation bring the same
 * person back, and db:clear-samples still clears all of it. Fictional sample data only.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { toIsoDate } from '@elevate/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicEnrolments,
  academicStudents,
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsExitRecords,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { ACADEMIC_CONSUMERS } from '@elevate/shared-contracts';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { listStudents, runEnrolmentExits, runEnrolmentIntake, type Actor as AcademicActor } from '@elevate/academic-os/server';
import { clearSamples, seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { changeStudentLifecycle, processEnrolmentReplies, requestEnrolment } from '@elevate/business-ops-os/server';
import { seeds as platformSeeds } from '../../seed';

const ctx = setupTestDatabase();
let manager: TestUser;
let manager2: TestUser;
const today = toIsoDate();

const statusOf = async (enrolmentId: string | null) => (await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.id, enrolmentId as never)))[0]?.status;
const caseAt = async (id: string) => (await ctx.db.select().from(opsAdmissions).where(eq(opsAdmissions.id, id as never)))[0]!;
const enrolledCases = () => ctx.db.select().from(opsAdmissions).where(eq(opsAdmissions.status, 'enrolled'));
const exit = (admissionId: string, by: TestUser = manager, over: object = {}) =>
  changeStudentLifecycle(ctx.db, by, admissionId, { action: 'exit', exitStatus: 'withdrawn', exitDate: today, reason: 'Family moved (fictional)', materialStatus: 'not_recorded', reactivationAllowed: true, ...over } as never);
/** The handoff after a case is back at `admitted`. */
async function enrolAgain(admissionId: string) {
  await requestEnrolment(ctx.db, manager, admissionId);
  expect(await runEnrolmentIntake(ctx.db)).toMatchObject({ failed: 0 });
  expect(await processEnrolmentReplies(ctx.db)).toMatchObject({ failed: 0 });
  return caseAt(admissionId);
}

beforeAll(async () => {
  await runSeeds(ctx.db, [...coreSeeds, ...opsSeeds, ...platformSeeds], { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} });
  manager = await createTestUser(ctx.db, { roles: ['operations_manager'] });
  manager2 = await createTestUser(ctx.db, { roles: ['operations_manager'] });
});

describe('the sample set', () => {
  it('its exits reached Academic through the real consumer; nothing failed', async () => {
    const closed = await ctx.db.select().from(opsAdmissions).where(inArray(opsAdmissions.status, ['withdrawn', 'completed', 'transferred']));
    expect(closed).toHaveLength(6);
    const want = { withdrawn: 'withdrawn', completed: 'completed', transferred: 'withdrawn' } as const;
    for (const c of closed) expect(await statusOf(c.enrolmentId)).toBe(want[c.status as keyof typeof want]);
    const stuck = await ctx.db.select().from(eventDeliveries).where(and(eq(eventDeliveries.consumer, ACADEMIC_CONSUMERS.enrolmentExit), inArray(eventDeliveries.status, ['failed', 'dead'])));
    expect(stuck).toEqual([]);
    expect(await statusOf((await enrolledCases())[0]!.enrolmentId)).toBe('active');
  });
});

describe('entry, exit, replay, return', () => {
  it('exit ends the one enrolment; a replay does nothing; readmission gives the same person a new enrolment; exiting again ends only that one', async () => {
    // A student with one enrolment: a second one keeps them current after this exit.
    const enrolments = await ctx.db.select().from(academicEnrolments);
    const old = (await enrolledCases()).find((c) => enrolments.filter((e) => e.studentId === c.academicStudentId).length === 1);
    const firstEnrolment = old!.enrolmentId;
    await exit(old!.id);
    expect(await statusOf(firstEnrolment)).toBe('active'); // Academic is told when the consumer runs
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    expect(await statusOf(firstEnrolment)).toBe('withdrawn');
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 0, failed: 0 });

    const coordinator: AcademicActor = { user: await createTestUser(ctx.db, { roles: ['academic_coordinator'] }), requestId: 'test' };
    const left = (await listStudents(ctx.db, coordinator, { state: 'left' })).map((s) => s.id);
    expect(left).toContain(old!.academicStudentId);

    const application = (await changeStudentLifecycle(ctx.db, manager, old!.id, { action: 'readmit', reason: 'Family returned (fictional)' } as never)) as { admissionId: string };
    await ctx.db.update(opsAdmissions).set({ status: 'admitted', admittedAt: new Date() }).where(eq(opsAdmissions.id, application.admissionId as never)); // final confirmation has its own tests
    const back = await enrolAgain(application.admissionId);
    expect(back).toMatchObject({ status: 'enrolled', academicStudentId: old!.academicStudentId, studentId: old!.studentId });
    expect(back.enrolmentId).not.toBe(firstEnrolment);
    expect(await statusOf(back.enrolmentId)).toBe('active');
    expect(await caseAt(old!.id)).toMatchObject({ status: 'withdrawn', admissionNumber: old!.admissionNumber });
    expect((await listStudents(ctx.db, coordinator)).map((s) => s.id)).toContain(old!.academicStudentId);

    await exit(back.id, manager, { exitStatus: 'completed' });
    await runEnrolmentExits(ctx.db);
    expect(await statusOf(back.enrolmentId)).toBe('completed');
    expect(await statusOf(firstEnrolment)).toBe('withdrawn');
  });

  it('reactivation: the exit waiting in the outbox is applied before the new request, so it is not refused as a duplicate', async () => {
    const [c] = await enrolledCases();
    const first = c!.enrolmentId;
    await exit(c!.id);
    const reactivated = (await changeStudentLifecycle(ctx.db, manager2, c!.id, { action: 'reactivate', reason: 'Family returned (fictional)' } as never)) as { status: string };
    expect(reactivated.status).toBe('admitted');
    const back = await enrolAgain(c!.id);
    expect(back.status).toBe('enrolled');
    expect(back.enrolmentId).not.toBe(first);
    expect(await statusOf(first)).toBe('withdrawn');
    expect(await statusOf(back.enrolmentId)).toBe('active');
    const [record] = await ctx.db.select().from(opsExitRecords).where(eq(opsExitRecords.admissionId, c!.id));
    expect(record!.reactivatedBy).toBe(manager2.id);
  });
});

describe('db:clear-samples', () => {
  it('still clears everything, and closes an exit still waiting so no consumer trips over it later', async () => {
    const [c] = await enrolledCases();
    await exit(c!.id);
    const events = await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.type, 'ops.enrolment.closed'));
    const counts = await clearSamples(ctx.db);
    expect(counts['academic.enrolments']).toBeGreaterThan(0);
    expect(counts['core.event_deliveries (closed)']).toBeGreaterThan(0);
    expect(await ctx.db.$count(academicEnrolments)).toBe(0);
    expect(await ctx.db.$count(academicStudents)).toBe(0);
    expect(await ctx.db.$count(opsAdmissions)).toBe(0);
    expect(await ctx.db.$count(integrationEvents, eq(integrationEvents.type, 'ops.enrolment.closed'))).toBe(events.length); // history stays
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 0, failed: 0 });
    expect(await clearSamples(ctx.db)).toEqual({});
  });
});
