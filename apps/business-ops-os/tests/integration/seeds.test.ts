import { describe, expect, it } from 'vitest';
import { count, eq, inArray, isNotNull } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  approvals,
  opsAdmissionApprovals,
  opsAdmissions,
  opsApplications,
  opsAppointments,
  opsDemos,
  opsDemoSessions,
  opsFeePlans,
  opsFeeRecords,
  opsFeeStructures,
  opsFollowUps,
  opsLeadHandoffReceipts,
  opsLeads,
  opsLeadSources,
  opsStaffProfiles,
  staffMembers,
  students,
  opsTeacherStudentFeedback,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { clearSamples, seeds } from '../../seed';
import { SAMPLE_LEAD_COUNT, SAMPLE_STUDENTS } from '../../seed/samples';
import { ALLOWED_PROGRAMME_COMBINATIONS } from '../../src/domain/catalog';
import { istToday } from '../../src/domain';
import { OWNER_SUPPLIED_STAFF } from '../../seed/teachers';

const ctx = setupTestDatabase();
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const SAMPLE_NAME = /^(\w+ Sample Student|Tanisha Demo Student)$/;

describe('Business Ops seeds (D-036 sample set)', () => {
  it('are idempotent and hold one clearly-named sample set plus the owner-supplied staff', async () => {
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);

    expect((await ctx.db.select().from(opsLeadSources)).map((s) => s.code)).toContain('UNKNOWN');

    const leads = await ctx.db.select().from(opsLeads);
    expect(leads).toHaveLength(SAMPLE_LEAD_COUNT); // demo cases + mock Marketing handoffs
    expect(new Set(leads.map((l) => l.studentName)).size).toBe(leads.length);
    for (const l of leads) {
      expect(l).toMatchObject({ isSample: true, studentPhone: null, guardianPhone: null });
      expect(l.studentName).toMatch(SAMPLE_NAME);
      expect(l.studentEmail).toMatch(/@example\.test$/);
    }
    expect((await ctx.db.select().from(students)).every((s) => s.isSample)).toBe(true);

    // Staff: owner-supplied real people, or "Sample …" with a sample profile.
    const staff = await ctx.db
      .select({
        id: staffMembers.id,
        fullName: staffMembers.fullName,
        userId: staffMembers.userId,
        isSample: opsStaffProfiles.isSample,
      })
      .from(staffMembers)
      .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id));
    const ownerSupplied = new Set<string>(OWNER_SUPPLIED_STAFF.map((s) => s.fullName));
    const real = staff.filter((s) => ownerSupplied.has(s.fullName));
    expect(real).toHaveLength(OWNER_SUPPLIED_STAFF.length);
    expect(real.every((s) => s.userId === null && !s.isSample)).toBe(true);
    expect(
      staff
        .filter((s) => !ownerSupplied.has(s.fullName))
        .every((s) => s.isSample && s.fullName.startsWith('Sample ')),
    ).toBe(true);

    // Real teachers are never given a sample class or meeting.
    const realIds = real.map((s) => s.id);
    expect(
      await ctx.db.$count(opsDemoSessions, inArray(opsDemoSessions.teacherStaffId, realIds)),
    ).toBe(0);
    expect(await ctx.db.$count(opsAppointments, inArray(opsAppointments.staffId, realIds))).toBe(0);

    // Every demo session has the sample teacher of its subject.
    const sessions = await ctx.db
      .select({ subject: opsDemoSessions.subject, teacher: staffMembers.fullName })
      .from(opsDemoSessions)
      .innerJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId));
    expect(sessions).toHaveLength(SAMPLE_STUDENTS.length * 3);
    for (const s of sessions)
      expect(s.teacher).toBe(
        s.subject === 'Mathematics' ? 'Sample Maths Teacher' : `Sample ${s.subject} Teacher`,
      );

    // Cases: outcomes, applications, admission numbers (3 digits, D-037), fee plans, handoffs.
    const counts = async (rows: Promise<{ k: string | null; n: number }[]>) =>
      Object.fromEntries((await rows).map((r) => [r.k, r.n]));
    expect(
      await counts(
        ctx.db.select({ k: opsDemos.outcome, n: count() }).from(opsDemos).groupBy(opsDemos.outcome),
      ),
    ).toEqual({ converted: 13, declined: 1, not_converted: 1, open: 5, withdrawn: 1 });
    const numbers = await ctx.db
      .select({ n: opsAdmissions.admissionNumber })
      .from(opsAdmissions)
      .where(isNotNull(opsAdmissions.admissionNumber));
    // 13 conversions → 13 applications; 12 sample cases admitted (Saanvi waits for her fee agreement approval).
    // Admitted samples carry no approval: "Legacy — verification required" (seed/samples.ts admitSample).
    expect(numbers.map((r) => r.n).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(3, '0')),
    );
    expect(await ctx.db.$count(opsApplications)).toBe(13);
    expect(await ctx.db.$count(opsAdmissionApprovals)).toBe(0);
    expect(
      await ctx.db.$count(opsAdmissions, eq(opsAdmissions.legacyVerification, 'required')),
    ).toBe(12);
    // Without Academic OS the enrolment requests wait (the platform seed runs the consumers).
    expect(
      await ctx.db.$count(opsAdmissions, eq(opsAdmissions.status, 'enrolment_requested')),
    ).toBe(11);
    expect((await ctx.db.select().from(opsFeePlans)).map((p) => p.status).sort()).toEqual([
      ...Array(7).fill('active'),
      'draft', // Saanvi's agreement waits for approval
    ]);
    const ledger = await ctx.db.select().from(opsFeeRecords);
    expect(
      await counts(
        ctx.db
          .select({ k: opsFeeRecords.kind, n: count() })
          .from(opsFeeRecords)
          .groupBy(opsFeeRecords.kind),
      ),
    ).toEqual({ received: 9 });
    expect(ledger.every((r) => r.status === 'recorded' && r.notes?.includes('not a payment'))).toBe(
      true,
    );
    expect(
      (await ctx.db.select().from(opsLeadHandoffReceipts)).map((r) => r.status).sort(),
    ).toEqual(['accepted', 'duplicate_review']);
    // The only approval is Saanvi's agreement request; no inert admission-level approvals.
    expect((await ctx.db.select().from(approvals)).map((a) => [a.policy, a.status]).sort()).toEqual(
      [
        ...Array(7).fill(['ops.fee_agreement.version', 'approved']),
        ['ops.fee_agreement.version', 'pending'],
      ],
    );
    expect(
      new Set(
        (await ctx.db.select({ t: opsAppointments.type }).from(opsAppointments)).map((r) => r.t),
      ),
    ).toEqual(
      new Set([
        'student_counselling',
        'guardian_counselling',
        'parent_teacher_meeting',
        'demo_review',
        'teacher_academic',
      ]),
    );
    // One counselling per case + the table's meetings, not doubled by the second run.
    expect(await ctx.db.$count(opsAppointments)).toBe(
      SAMPLE_STUDENTS.reduce((n, s) => n + 1 + (s.meetings?.length ?? 0), 0),
    );
    expect(await ctx.db.$count(opsTeacherStudentFeedback)).toBe(2);
    const today = istToday(new Date());
    const open = await ctx.db.select().from(opsFollowUps).where(eq(opsFollowUps.status, 'open'));
    expect(open.some((f) => f.dueDate === today)).toBe(true);
    expect(open.some((f) => f.dueDate < today)).toBe(true);

    // Fee structure: one sample row per combination + the two website-stated prices (drafts).
    const structures = await ctx.db.select().from(opsFeeStructures);
    expect(structures.filter((r) => r.source === 'sample')).toHaveLength(
      ALLOWED_PROGRAMME_COMBINATIONS.length,
    );
    expect(
      structures
        .filter((r) => r.source === 'website_stated')
        .map((r) => [r.amountPaise, r.billingPeriod, r.isSample]),
    ).toEqual([
      [10_000_00, 'per_month', false],
      [12_000_00, 'per_month', false],
    ]);
    expect(structures.every((r) => r.status === 'draft')).toBe(true);
  });

  it('db:clear-samples removes every sample row and keeps the owner-supplied staff', async () => {
    const counts = await clearSamples(ctx.db);
    expect(counts['ops.leads']).toBe(SAMPLE_LEAD_COUNT);
    expect(counts['core.staff_members']).toBe(6); // the sample teachers without logins
    expect(counts['ops.fee_structures']).toBe(ALLOWED_PROGRAMME_COMBINATIONS.length);
    for (const table of [
      opsLeads,
      opsDemos,
      opsAdmissions,
      opsAppointments,
      opsFeePlans,
      opsFeeRecords,
      opsFollowUps,
      opsTeacherStudentFeedback,
      approvals,
      students,
    ])
      expect(await ctx.db.$count(table)).toBe(0);
    // Website-stated prices are not sample data and stay.
    expect((await ctx.db.select().from(opsFeeStructures)).map((r) => r.source)).toEqual([
      'website_stated',
      'website_stated',
    ]);
    const left = await ctx.db.select({ fullName: staffMembers.fullName }).from(staffMembers);
    for (const s of OWNER_SUPPLIED_STAFF) expect(left.map((r) => r.fullName)).toContain(s.fullName);
    expect(await clearSamples(ctx.db)).toEqual({});
  });
});
