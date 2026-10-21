/**
 * The sample set end to end (D-036): Ops seeds + `platform.sample-enrolments` take the sample
 * admissions through the real enrolment handoff, so Active / On hold / Former all have rows,
 * and db:clear-samples removes Academic's copies with the rest.
 */
import { describe, expect, it } from 'vitest';
import { count, eq, isNotNull } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  academicEnrolments,
  academicStudents,
  eventDeliveries,
  integrationEvents,
  opsAdmissions,
  opsExitRecords,
  opsLeads,
  programmes,
  users,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { runEnrolmentIntake } from '@elevate/academic-os/server';
import { processEnrolmentReplies } from '@elevate/business-ops-os/server';
import { clearSamples, seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as platformSeeds } from '../../seed';

const ctx = setupTestDatabase();
const all = [...coreSeeds, ...opsSeeds, ...platformSeeds];
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };

const statuses = async () =>
  Object.fromEntries(
    (
      await ctx.db
        .select({ s: opsAdmissions.status, n: count() })
        .from(opsAdmissions)
        .where(isNotNull(opsAdmissions.admissionNumber))
        .groupBy(opsAdmissions.status)
    ).map((r) => [r.s, r.n]),
  );

describe('platform.sample-enrolments', () => {
  it('enrols the sample admissions through both consumers, then holds and exits (idempotent)', async () => {
    await runSeeds(ctx.db, all, context);
    await runSeeds(ctx.db, all, context);
    expect(await statuses()).toEqual({
      enrolled: 7,
      on_hold: 1,
      withdrawn: 1,
      completed: 1,
      transferred: 1,
      cancelled_before_enrolment: 1,
    }); // the admission_pending sample has no number yet: numbers come at final confirmation (D-040)
    const [held] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.status, 'on_hold'));
    expect(held).toMatchObject({ heldFromStatus: 'enrolled', handoffStatus: 'enrolled' });
    expect(held!.holdReviewDate).not.toBeNull();
    expect(await ctx.db.$count(opsExitRecords)).toBe(4);
    const academic = await ctx.db.select().from(academicStudents);
    expect(academic).toHaveLength(11);
    expect(academic.every((s) => / Sample Student$/.test(s.fullName) && !s.phone)).toBe(true);
  });

  it('db:clear-samples also removes the Academic student and enrolment of each sample admission', async () => {
    const counts = await clearSamples(ctx.db);
    expect(counts['academic.students']).toBe(11);
    expect(counts['academic.enrolments']).toBe(11);
    expect(await ctx.db.$count(academicStudents)).toBe(0);
    expect(await ctx.db.$count(academicEnrolments)).toBe(0);
    expect(await ctx.db.$count(opsAdmissions)).toBe(0);
    expect(await clearSamples(ctx.db)).toEqual({});
  });

  it('does nothing while a real (non-sample) enrolment request waits', async () => {
    await runSeeds(ctx.db, [...coreSeeds, ...opsSeeds], context);
    const zoya = eq(opsLeads.studentEmail, 'zoya.sample@example.test');
    await ctx.db.update(opsLeads).set({ isSample: false }).where(zoya);
    await runSeeds(ctx.db, all, context);
    expect((await statuses()).enrolled).toBeUndefined();
    await ctx.db.update(opsLeads).set({ isSample: true }).where(zoya);
    // Clearing closes the waiting requests: a later run never enrols a removed sample.
    expect((await clearSamples(ctx.db))['core.event_deliveries (closed)']).toBe(11);
    expect((await runEnrolmentIntake(ctx.db)).processed).toBe(0);
    expect(await ctx.db.$count(academicStudents)).toBe(0);
  });

  it('closes enrolment events whose admission is already gone, never a real one', async () => {
    const event = (type: string, admissionId: string) =>
      ctx.db
        .insert(integrationEvents)
        .values({
          type,
          version: 1,
          producer: 'academic',
          idempotencyKey: type + admissionId,
          payload: { admissionId },
        })
        .returning()
        .then((rows) => rows[0]!);
    // Left by an earlier clear (owner's local DB, 21 Oct): a failed reply for a removed admission.
    const orphan = await event(
      'academic.enrolment.confirmed',
      '00000000-0000-4000-8000-000000000001',
    );
    await ctx.db.insert(eventDeliveries).values({
      eventId: orphan.id,
      consumer: 'ops.enrolment-replies',
      status: 'failed',
      attempts: 3,
    });
    // A real admission's waiting request stays open.
    await runSeeds(ctx.db, [...coreSeeds, ...opsSeeds], context);
    const [user] = await ctx.db.select({ id: users.id }).from(users).limit(1);
    const [programme] = await ctx.db.select({ id: programmes.id }).from(programmes).limit(1);
    const [lead] = await ctx.db
      .insert(opsLeads)
      .values({
        code: 'LEAD-900001',
        studentName: 'Real Student (fictional)',
        studentEmail: 'real-student@example.test',
        currentStage: 'class_12',
        firstReceivedAt: new Date(),
        createdBy: user!.id,
      })
      .returning();
    const [real] = await ctx.db
      .insert(opsAdmissions)
      .values({
        code: 'ADM-900001',
        leadId: lead!.id,
        programmeId: programme!.id,
        status: 'admitted',
        createdBy: user!.id,
      })
      .returning();
    const request = await event('ops.admission.enrolment_requested', real!.id);

    await clearSamples(ctx.db);
    const deliveries = await ctx.db.select().from(eventDeliveries);
    expect(deliveries.find((d) => d.eventId === orphan.id)).toMatchObject({ status: 'dead' });
    expect(deliveries.some((d) => d.eventId === request.id)).toBe(false);
    expect((await processEnrolmentReplies(ctx.db)).failed).toBe(0);
  });
});
