/**
 * A corrected student name (HMO-016) reaches every live view: Ops' canonical student and the
 * person's other leads at once, Academic through `ops.student.renamed` v1, idempotently. Issued
 * documents are tested in Ops (applications.test.ts). Fictional sample data only.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicStudents,
  auditEvents,
  integrationEvents,
  opsAdmissions,
  opsFeePlans,
  opsLeads,
  students,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { runEnrolmentExits, runEnrolmentIntake } from '@elevate/academic-os/server';
import { seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { requestEnrolment } from '@elevate/business-ops-os/server';
import { seeds as platformSeeds } from '../../seed';
import { outstandingInstalments } from '../../../business-ops-os/src/server/fee-collections';
import { feeYear } from '../../../business-ops-os/src/server/fee-year';
import { updateLead } from '../../../business-ops-os/src/server/leads';

const ctx = setupTestDatabase();
let manager: TestUser;

const renamed = () => ctx.db.$count(integrationEvents, eq(integrationEvents.type, 'ops.student.renamed'));
const academicName = async (studentId: string) =>
  (
    await ctx.db
      .select({ name: academicStudents.fullName })
      .from(academicStudents)
      .where(eq(academicStudents.coreStudentId, studentId as never))
  )[0]?.name;
const coreName = async (studentId: string) =>
  (await ctx.db.select({ name: students.fullName }).from(students).where(eq(students.id, studentId as never)))[0]?.name;
const enrolled = async () => {
  const [c] = await ctx.db
    .select()
    .from(opsAdmissions)
    .where(and(eq(opsAdmissions.status, 'enrolled'), isNotNull(opsAdmissions.studentId)));
  return c!;
};

beforeAll(async () => {
  await runSeeds(ctx.db, [...coreSeeds, ...opsSeeds, ...platformSeeds], { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} });
  manager = await createTestUser(ctx.db, { roles: ['operations_manager'] });
});

describe('a corrected student name', () => {
  it('reaches the canonical student and Academic; a replay does nothing; only a real change publishes', async () => {
    const c = await enrolled();
    const before = await renamed();
    const oldName = await academicName(c.studentId!);
    await updateLead(ctx.db, manager, c.leadId, { studentName: 'Sample Corrected Spelling' } as never);

    expect(await coreName(c.studentId!)).toBe('Sample Corrected Spelling');
    expect(await renamed()).toBe(before + 1);
    expect(await academicName(c.studentId!)).toBe(oldName); // Academic is told when the consumer runs
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 1, failed: 0 });
    expect(await academicName(c.studentId!)).toBe('Sample Corrected Spelling');
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ processed: 0, failed: 0 });

    await updateLead(ctx.db, manager, c.leadId, { studentName: 'Sample Corrected Spelling' } as never);
    expect(await renamed()).toBe(before + 1);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'student.renamed'), eq(auditEvents.entityId, c.studentId!)));
    expect(audit).toHaveLength(1);
  });

  it('shows on the Ops lists that read the canonical student', async () => {
    const [row] = await ctx.db
      .select({ leadId: opsAdmissions.leadId })
      .from(opsFeePlans)
      .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsFeePlans.admissionId))
      .where(and(eq(opsFeePlans.status, 'active'), eq(opsAdmissions.status, 'enrolled')))
      .limit(1);
    const name = 'Sample Shown Everywhere';
    await updateLead(ctx.db, manager, row!.leadId, { studentName: name } as never);
    const year = await feeYear(ctx.db, manager, {});
    expect(year.rows.map((r) => r.studentName)).toContain(name);
    const owing = await outstandingInstalments(ctx.db, manager, new Date());
    expect(owing.map((r) => r.studentName)).toContain(name);
  });

  it("reaches the same person's other lead", async () => {
    const c = await enrolled();
    const [other] = await ctx.db
      .select({ id: opsAdmissions.id, leadId: opsAdmissions.leadId })
      .from(opsAdmissions)
      .where(sql`${opsAdmissions.leadId} <> ${c.leadId} and ${opsAdmissions.studentId} is null`)
      .limit(1);
    await ctx.db.update(opsAdmissions).set({ studentId: c.studentId }).where(eq(opsAdmissions.id, other!.id));
    await updateLead(ctx.db, manager, c.leadId, { studentName: 'Sample Second Correction' } as never);
    const [lead] = await ctx.db.select({ name: opsLeads.studentName }).from(opsLeads).where(eq(opsLeads.id, other!.leadId));
    expect(lead!.name).toBe('Sample Second Correction');
    await ctx.db.update(opsAdmissions).set({ studentId: null }).where(eq(opsAdmissions.id, other!.id));
  });

  it('a lead with no student record yet publishes nothing', async () => {
    const [c] = await ctx.db.select().from(opsAdmissions).where(sql`${opsAdmissions.studentId} is null`).limit(1);
    const before = await renamed();
    await updateLead(ctx.db, manager, c!.leadId, { studentName: 'Sample Early Correction' } as never);
    expect(await renamed()).toBe(before);
  });

  it('a request still waiting for Academic takes the corrected name when it is processed', async () => {
    const [spare] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(and(sql`${opsAdmissions.studentId} is null`, isNotNull(opsAdmissions.programmeId)))
      .limit(1);
    const [person] = await ctx.db.insert(students).values({ fullName: 'Sample Misspelt', isSample: true }).returning();
    const [admitted] = await ctx.db
      .update(opsAdmissions)
      .set({ status: 'admitted', admittedAt: new Date(), studentId: person!.id })
      .where(eq(opsAdmissions.id, spare!.id))
      .returning();
    await requestEnrolment(ctx.db, manager, admitted!.id);
    await updateLead(ctx.db, manager, admitted!.leadId, { studentName: 'Sample Corrected In Time' } as never);
    expect(await runEnrolmentExits(ctx.db)).toMatchObject({ failed: 0 }); // no student at Academic yet: nothing to do
    expect(await runEnrolmentIntake(ctx.db)).toMatchObject({ failed: 0 });
    expect(await academicName(admitted!.studentId!)).toBe('Sample Corrected In Time');
  });
});
