/**
 * Cross-module end-to-end test of the admission → enrolment handoff
 * (IR-OPS-03, INTEGRATION_CONTRACT §6): Ops `requestEnrolment` → Academic
 * consumer `academic.enrolment-intake` → reply → Ops `processEnrolmentReplies`.
 *
 * The platform app sits outside the module-import rule, so it may import both
 * modules' published `./server` entry points. Ops admissions are inserted at
 * `admitted` directly (the confirmation gate has its own tests in Business Ops);
 * everything after that runs through the real services of both modules.
 *
 * `@elevate/business-ops-os` and `@elevate/academic-os` are devDependencies of
 * apps/platform (workspace links).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  academicEnrolments,
  academicStudents,
  integrationEvents,
  opsAdmissions,
  opsEnrolmentAttempts,
  opsLeads,
  programmes,
  staffMembers,
} from '@elevate/database';
import { SEED_PROGRAMMES } from '@elevate/database/seed';
import { processEvents } from '@elevate/server-kit';
import { ACADEMIC_CONSUMERS } from '@elevate/shared-contracts';
import type { BatchId, LeadId, StaffMemberId } from '@elevate/shared-types';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  processEnrolmentReplies,
  requestEnrolment,
  retryEnrolmentHandoff,
} from '@elevate/business-ops-os/server';
import { runEnrolmentIntake } from '@elevate/academic-os/server';

const ctx = setupTestDatabase();
let counsellor: TestUser;
let staffId: StaffMemberId;
let n = 0;

beforeAll(async () => {
  for (const [code, name, description, status] of SEED_PROGRAMMES)
    await ctx.db
      .insert(programmes)
      .values({ code, name, description, status })
      .onConflictDoNothing();
  counsellor = await createTestUser(ctx.db, {
    roles: ['admissions_counsellor'],
    displayName: 'Handoff Counsellor (fictional)',
  });
  const [staff] = await ctx.db
    .insert(staffMembers)
    .values({ userId: counsellor.id, fullName: counsellor.displayName })
    .returning({ id: staffMembers.id });
  staffId = staff!.id;
});

async function programmeId(code: string) {
  const [p] = await ctx.db
    .select({ id: programmes.id })
    .from(programmes)
    .where(eq(programmes.code, code));
  return p!.id;
}

/** A fictional lead with an admission already at `admitted` (gate tested elsewhere). */
async function admitted(options: { programme?: string; batchId?: string; leadId?: LeadId } = {}) {
  n += 1;
  let leadId = options.leadId;
  if (!leadId) {
    const [lead] = await ctx.db
      .insert(opsLeads)
      .values({
        code: `LEAD-${String(900000 + n)}`,
        studentName: `Handoff Student ${n} (fictional)`,
        studentEmail: `handoff-${n}@example.test`,
        currentStage: 'class_12',
        guardianName: `Handoff Guardian ${n} (fictional)`,
        guardianRelationship: 'mother',
        guardianEmail: `handoff-guardian-${n}@example.test`,
        firstReceivedAt: new Date(),
        ownerStaffId: staffId,
        createdBy: counsellor.id,
      })
      .returning({ id: opsLeads.id });
    leadId = lead!.id;
  }
  const [admission] = await ctx.db
    .insert(opsAdmissions)
    .values({
      code: `ADM-${String(900000 + n)}`,
      leadId,
      programmeId: await programmeId(options.programme ?? 'IPMAT'),
      status: 'admitted',
      admittedAt: new Date(),
      counsellorStaffId: staffId,
      intendedBatchId: (options.batchId as BatchId | undefined) ?? null,
      createdBy: counsellor.id,
    })
    .returning();
  return { leadId, admissionId: admission!.id };
}

const admissionRow = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, id as never))
  )[0]!;
const studentsFor = (admissionId: string) =>
  ctx.db.select().from(academicStudents).where(eq(academicStudents.sourceAdmissionId, admissionId));
const enrolmentsFor = (admissionId: string) =>
  ctx.db
    .select()
    .from(academicEnrolments)
    .where(eq(academicEnrolments.sourceAdmissionId, admissionId));

/** Run both consumers until nothing is left (what a scheduler would do). */
async function settle() {
  await runEnrolmentIntake(ctx.db);
  await processEnrolmentReplies(ctx.db);
}

describe('admission → enrolment handoff across Business Ops and Academic OS', () => {
  it('success: Academic creates the student and enrolment; Ops becomes enrolled with the references', async () => {
    const { admissionId } = await admitted();
    const req = await requestEnrolment(ctx.db, counsellor, admissionId);
    expect(req.attempt).toBe(1);
    expect((await admissionRow(admissionId)).status).toBe('enrolment_requested');
    await settle();
    const row = await admissionRow(admissionId);
    const [student] = await studentsFor(admissionId);
    const [enrolment] = await enrolmentsFor(admissionId);
    expect(row).toMatchObject({
      status: 'enrolled',
      handoffStatus: 'enrolled',
      studentId: student!.id,
      enrolmentId: enrolment!.id,
      academicExistingStudent: false,
    });
    const [attempt] = await ctx.db
      .select()
      .from(opsEnrolmentAttempts)
      .where(eq(opsEnrolmentAttempts.admissionId, admissionId as never));
    expect(attempt).toMatchObject({ attempt: 1, kind: 'initial', outcome: 'confirmed' });
  });

  it('repeated request and redelivery never create a second enrolment or student', async () => {
    const { admissionId } = await admitted();
    await requestEnrolment(ctx.db, counsellor, admissionId);
    await expect(requestEnrolment(ctx.db, counsellor, admissionId)).rejects.toMatchObject({
      status: 409,
    });
    await settle();
    expect(await runEnrolmentIntake(ctx.db)).toMatchObject({ processed: 0 });
    expect(await processEnrolmentReplies(ctx.db)).toMatchObject({ processed: 0 });
    expect(await studentsFor(admissionId)).toHaveLength(1);
    expect(await enrolmentsFor(admissionId)).toHaveLength(1);
    const events = (
      await ctx.db
        .select()
        .from(integrationEvents)
        .where(eq(integrationEvents.type, 'ops.admission.enrolment_requested'))
    ).filter((e) => (e.payload as { admissionId: string }).admissionId === admissionId);
    expect(events).toHaveLength(1);
  });

  it('invalid batch: rejected with a visible reason; corrected re-request (attempt 2) enrols once', async () => {
    const { admissionId } = await admitted({ batchId: crypto.randomUUID() });
    await requestEnrolment(ctx.db, counsellor, admissionId);
    await settle();
    const rejected = await admissionRow(admissionId);
    expect(rejected).toMatchObject({
      status: 'admitted',
      handoffStatus: 'rejected',
      rejectionCode: 'BATCH_NOT_FOUND',
    });
    expect(rejected.rejectionReason).toMatch(/batch/i);
    expect(await enrolmentsFor(admissionId)).toHaveLength(0);
    await ctx.db
      .update(opsAdmissions)
      .set({ intendedBatchId: null })
      .where(eq(opsAdmissions.id, admissionId));
    const again = await requestEnrolment(ctx.db, counsellor, admissionId);
    expect(again.attempt).toBe(2);
    await settle();
    expect((await admissionRow(admissionId)).status).toBe('enrolled');
    expect(await enrolmentsFor(admissionId)).toHaveLength(1);
    expect(await studentsFor(admissionId)).toHaveLength(1);
    const attempts = await ctx.db
      .select()
      .from(opsEnrolmentAttempts)
      .where(eq(opsEnrolmentAttempts.admissionId, admissionId as never));
    expect(attempts.map((a) => [a.attempt, a.kind, a.outcome]).sort()).toEqual([
      [1, 'initial', 'rejected'],
      [2, 'after_rejection', 'confirmed'],
    ]);
  });

  it('recoverable failure: the Academic handler throws once, the automatic retry succeeds', async () => {
    const { admissionId } = await admitted();
    await requestEnrolment(ctx.db, counsellor, admissionId);
    const failed = await processEvents(ctx.db, {
      consumer: ACADEMIC_CONSUMERS.enrolmentIntake,
      maxAttempts: 5,
      handlers: {
        'ops.admission.enrolment_requested': async () => {
          throw new Error('Transient Academic failure (test)');
        },
      },
    });
    expect(failed.failed).toBeGreaterThanOrEqual(1);
    expect(await enrolmentsFor(admissionId)).toHaveLength(0); // rolled back
    await settle();
    expect((await admissionRow(admissionId)).status).toBe('enrolled');
    expect(await enrolmentsFor(admissionId)).toHaveLength(1);
  });

  it('failure that needs a person: dead delivery → audited retry (attempt 2) → one enrolment', async () => {
    const { admissionId } = await admitted();
    await requestEnrolment(ctx.db, counsellor, admissionId);
    await processEvents(ctx.db, {
      consumer: ACADEMIC_CONSUMERS.enrolmentIntake,
      maxAttempts: 1,
      handlers: {
        'ops.admission.enrolment_requested': async () => {
          throw new Error('Academic outage (test)');
        },
      },
    });
    await settle(); // the dead delivery is never picked up again
    expect((await admissionRow(admissionId)).status).toBe('enrolment_requested');
    const retried = await retryEnrolmentHandoff(ctx.db, counsellor, admissionId, {
      reason: 'Academic outage fixed (test)',
    });
    expect(retried.attempt).toBe(2);
    await settle();
    expect((await admissionRow(admissionId)).status).toBe('enrolled');
    expect(await enrolmentsFor(admissionId)).toHaveLength(1);
    expect(await studentsFor(admissionId)).toHaveLength(1);
  });

  it('same person, second programme: Ops sends the known Academic student id (existingStudentId)', async () => {
    const first = await admitted();
    await requestEnrolment(ctx.db, counsellor, first.admissionId);
    await settle();
    const knownStudentId = (await admissionRow(first.admissionId)).studentId;
    expect(knownStudentId).not.toBeNull();
    const second = await admitted({ leadId: first.leadId, programme: 'CLAT' });
    const req = await requestEnrolment(ctx.db, counsellor, second.admissionId);
    const [event] = await ctx.db
      .select()
      .from(integrationEvents)
      .where(and(eq(integrationEvents.id, req.eventId)));
    expect(event?.payload).toMatchObject({ existingStudentId: knownStudentId });
  });

  // IR-OPS-ADM-1 (Academic OS): intake dedupes only by source_admission_id, so it
  // still creates a second academic.students row for the second programme. When
  // Academic honours `existingStudentId`, turn this into a real assertion:
  // one academic.students row for both admissions, existingStudent = true.
  it.todo('Academic reuses existingStudentId for a second programme (pending IR-OPS-ADM-1)');
});
