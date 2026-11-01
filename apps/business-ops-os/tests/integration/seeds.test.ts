import { EOD_FACTS_FORMAT } from '../../src/domain/eod';
import { describe, expect, it } from 'vitest';
import { count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
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
  opsLeads,
  opsLeadSources,
  opsStaffDepartments,
  opsStaffManagerHistory,
  opsStaffProfiles,
  staffMembers,
  students,
  opsTeacherStudentFeedback,
  notifications,
  opsEodReports,
  opsStaffTasks,
  opsTaskEvents,
  opsTaskSubmissions,
  opsTaskUpdates,
  userRoles,
  users,
  academicBatches,
  academicCourses,
  academicStudents,
  opsEodReportVersions,
  opsTaskDependencies,
  programmes,
} from '@elevate/database';
import {
  COVER_TEACHERS,
  coreSeeds,
  FAKE_PHONE_PATTERN,
  PEOPLE,
  runSeeds,
  SUBJECT_TEACHERS,
} from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { clearSamples, seeds } from '../../seed';
import { SAMPLE_LEAD_COUNT, SAMPLE_STUDENTS } from '../../seed/samples';
import { SAMPLE_MARKETING_LEADS } from '../../seed/sample-leads';
import { ALLOWED_PROGRAMME_COMBINATIONS } from '../../src/domain/catalog';
import { istToday } from '../../src/domain';
import { OWNER_SUPPLIED_STAFF, seedTeachers } from '../../seed/teachers';
import {
  NO_MANAGER_CODE,
  SAMPLE_MANAGER,
  SAMPLE_STAFF_LABEL,
  SAMPLE_TEACHER_STAFF,
} from '../../seed/sample-staff';
import { SAMPLE_EODS, SAMPLE_TASKS } from '../../seed/sample-work';

const ctx = setupTestDatabase();
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const NORMAL_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const FAKE_PHONE = new RegExp(FAKE_PHONE_PATTERN);

describe('Business Ops seeds (D-036 sample set)', () => {
  it('are idempotent and hold one sample set of made-up people, no owner-supplied staff', async () => {
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);

    expect((await ctx.db.select().from(opsLeadSources)).map((s) => s.code)).toContain('UNKNOWN');

    const leads = await ctx.db.select().from(opsLeads);
    expect(leads).toHaveLength(SAMPLE_LEAD_COUNT + SAMPLE_MARKETING_LEADS.length);
    expect(new Set(leads.map((l) => l.studentName)).size).toBe(leads.length);
    for (const l of leads) {
      expect(l.isSample).toBe(true);
      expect(l.studentPhone).toMatch(FAKE_PHONE);
      expect(l.guardianPhone).toMatch(FAKE_PHONE);
      expect(l.studentName).toMatch(NORMAL_NAME);
      expect(l.studentEmail).toMatch(/@example\.test$/);
    }
    expect((await ctx.db.select().from(students)).every((s) => s.isSample)).toBe(true);

    // Staff: made-up people with a sample profile; the real people come from the reference seed only.
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
    expect(staff.filter((s) => ownerSupplied.has(s.fullName))).toEqual([]);
    expect(staff.filter((s) => !s.isSample || !NORMAL_NAME.test(s.fullName))).toEqual([]);

    // HR history (open rows) equals the current department and manager after seeding twice.
    expect(await ctx.db.$count(opsStaffDepartments)).toBeGreaterThan(0);
    expect(await ctx.db.$count(opsStaffManagerHistory)).toBeGreaterThan(0);
    const drift = (await ctx.db.execute(sql`SELECT m.full_name FROM core.staff_members m
      LEFT JOIN ops.staff_departments d ON d.staff_id = m.id AND d.is_primary AND d.to_date IS NULL
      LEFT JOIN ops.staff_manager_history h ON h.staff_id = m.id AND h.to_date IS NULL
      WHERE m.department_id IS DISTINCT FROM d.department_id
        OR m.manager_id IS DISTINCT FROM h.manager_staff_id`)) as { rows: unknown[] };
    expect(drift.rows).toEqual([]);

    // Every demo session has the sample teacher of its subject.
    const sessions = await ctx.db
      .select({ subject: opsDemoSessions.subject, teacher: staffMembers.fullName })
      .from(opsDemoSessions)
      .innerJoin(staffMembers, eq(staffMembers.id, opsDemoSessions.teacherStaffId));
    expect(sessions).toHaveLength(SAMPLE_STUDENTS.length * 3);
    for (const s of sessions)
      expect(s.teacher).toBe(
        s.subject === 'Mathematics'
          ? PEOPLE.mathsTeacher
          : SUBJECT_TEACHERS.find(([, subject]) => subject === s.subject)![0],
      );

    // Cases: outcomes, applications, admission numbers (3 digits, D-037), fee plans.
    const counts = async (rows: Promise<{ k: string | null; n: number }[]>) =>
      Object.fromEntries((await rows).map((r) => [r.k, r.n]));
    expect(
      await counts(
        ctx.db.select({ k: opsDemos.outcome, n: count() }).from(opsDemos).groupBy(opsDemos.outcome),
      ),
    ).toEqual({ converted: 20, declined: 1, not_converted: 1, open: 5, withdrawn: 1 });
    const numbers = await ctx.db
      .select({ n: opsAdmissions.admissionNumber })
      .from(opsAdmissions)
      .where(isNotNull(opsAdmissions.admissionNumber));
    // 13 conversions → 13 applications; 12 sample cases admitted (Saanvi waits for her fee agreement approval).
    // Admitted samples carry no approval: "Legacy — verification required" (seed/samples.ts admitSample).
    expect(numbers.map((r) => r.n).sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(3, '0')),
    );
    expect(await ctx.db.$count(opsApplications)).toBe(20);
    expect(await ctx.db.$count(opsAdmissionApprovals)).toBe(13);
    expect(
      await ctx.db.$count(opsAdmissions, eq(opsAdmissions.legacyVerification, 'required')),
    ).toBe(1);
    // Without Academic OS the enrolment requests wait (the platform seed runs the consumers).
    expect(
      await ctx.db.$count(opsAdmissions, eq(opsAdmissions.status, 'enrolment_requested')),
    ).toBe(24);
    expect((await ctx.db.select().from(opsFeePlans)).map((p) => p.status).sort()).toEqual([
      ...Array(15).fill('active'),
      ...Array(2).fill('closed'),
      ...Array(4).fill('draft'),
    ]);
    const ledger = await ctx.db.select().from(opsFeeRecords);
    expect(
      await counts(
        ctx.db
          .select({ k: opsFeeRecords.kind, n: count() })
          .from(opsFeeRecords)
          .groupBy(opsFeeRecords.kind),
      ),
    ).toEqual({ received: 49, discount: 1, waiver: 5, due: 33, refund: 3, adjustment: 2 });
    expect(ledger.length).toBe(93); // Owner, 31 Oct 2026: sample payments may read as paid and verified.
    // The only approval is Saanvi's agreement request; no inert admission-level approvals.
    expect((await ctx.db.select().from(approvals)).map((a) => a.status).sort()).toEqual([
      ...Array(18).fill('approved'),
      'pending',
      'rejected',
    ]);
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
    // Teacher reviews of students are Academic's now (owner answer 1): Ops seeds none.
    expect(await ctx.db.$count(opsTeacherStudentFeedback)).toBe(0);
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
  }, 120_000);

  it('holds 12 distinct linked sample teachers with their sample work, sending nothing (brief 2 test 14)', async () => {
    const teachers = await ctx.db
      .select({
        code: opsStaffProfiles.staffCode,
        staffId: staffMembers.id,
        name: staffMembers.fullName,
        managerId: staffMembers.managerId,
        email: users.email,
        userId: users.id,
        role: userRoles.role,
        isSample: opsStaffProfiles.isSample,
        note: opsStaffProfiles.sourceNote,
      })
      .from(opsStaffProfiles)
      .innerJoin(staffMembers, eq(staffMembers.id, opsStaffProfiles.staffId))
      .innerJoin(users, eq(users.id, staffMembers.userId))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(
        inArray(
          opsStaffProfiles.staffCode,
          SAMPLE_TEACHER_STAFF.map(([c]) => c),
        ),
      );
    expect(teachers.map((t) => t.code).sort()).toEqual(SAMPLE_TEACHER_STAFF.map(([c]) => c));
    expect(new Set(teachers.map((t) => t.userId)).size).toBe(12);
    const [manager] = await ctx.db
      .select({ staffId: staffMembers.id, role: userRoles.role })
      .from(users)
      .innerJoin(staffMembers, eq(staffMembers.userId, users.id))
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(users.email, SAMPLE_MANAGER.email));
    expect(manager!.role).toBe('academic_coordinator');
    for (const t of teachers) {
      expect(t).toMatchObject({ role: 'teacher', isSample: true, note: SAMPLE_STAFF_LABEL });
      expect(t.name).toMatch(NORMAL_NAME);
      expect(t.email).toMatch(/^[a-z]+\.[a-z]+@example\.test$/);
      expect(t.managerId).toBe(t.code === NO_MANAGER_CODE ? null : manager!.staffId);
    }

    // The sample teachers' work (the marketing team's tasks are in seeds-marketing-team.test.ts).
    const teacherIds = new Set<string>(teachers.map((t) => t.staffId));
    const tasks = (await ctx.db.select().from(opsStaffTasks)).filter((t) =>
      teacherIds.has(t.staffId),
    );
    const taskIds = new Set<string>(tasks.map((t) => t.id));
    expect(tasks).toHaveLength(SAMPLE_TASKS.length); // not doubled by the second run
    expect(tasks.every((t) => t.isSample)).toBe(true);
    expect(new Set(tasks.map((t) => t.status))).toEqual(
      new Set(['pending', 'in_progress', 'in_review', 'done', 'cancelled']),
    );
    // R4: blocked is a flag on a task that keeps its status; a resubmission is version 2.
    expect(tasks.filter((t) => t.blockedAt)).toEqual([
      expect.objectContaining({ status: 'in_progress', blockedKind: 'blocked' }),
    ]);
    expect(
      (await ctx.db.select().from(opsTaskSubmissions))
        .filter((v) => taskIds.has(v.taskId))
        .map((v) => v.version)
        .sort(),
    ).toEqual([1, 1, 2]);
    expect(tasks.filter((t) => t.status === 'pending' && !t.acknowledgedAt)).toHaveLength(1);
    const events = (await ctx.db.select().from(opsTaskEvents)).filter((e) => taskIds.has(e.taskId));
    const kinds = events.map((e) => e.kind);
    // Same shapes as the task services: `created` names owner and status; no separate `assigned`.
    expect(kinds).not.toContain('assigned');
    for (const e of events.filter((x) => x.kind === 'created'))
      expect(e.toStatus === 'pending' && e.toStaffId !== null).toBe(true);
    for (const e of events.filter((x) => x.kind === 'status_changed'))
      expect(e.fromStatus !== null && e.toStatus !== null).toBe(true);
    for (const k of ['reassigned', 'reopened', 'cancelled', 'submitted_for_review'] as const)
      expect(kinds).toContain(k);
    const updates = await ctx.db.select().from(opsTaskUpdates);
    const ist = (d: Date | null) => (d ? istToday(d) : null);
    expect(updates.some((u) => u.startedAt && ist(u.startedAt) !== ist(u.endedAt))).toBe(true); // across midnight
    expect(updates.some((u) => ist(u.recordedAt)! > u.occurredOn)).toBe(true); // late entry
    expect(
      (await ctx.db.select({ s: opsEodReports.status }).from(opsEodReports)).map((r) => r.s).sort(),
    ).toEqual(['acknowledged', 'draft', 'revision_requested', 'submitted']);
    expect(SAMPLE_EODS).toHaveLength(4);
    // Built with O2's event-based facts (Academic marked unavailable), versions too.
    for (const r of await ctx.db.select().from(opsEodReports))
      expect(r.snapshot).toMatchObject({
        format: EOD_FACTS_FORMAT,
        academic: { status: 'unavailable' },
      });
    expect(
      (await ctx.db.select().from(opsEodReportVersions)).every(
        (v) => (v.snapshot as { format?: string }).format === EOD_FACTS_FORMAT,
      ),
    ).toBe(true);
    // Nothing was sent or notified to the sample staff.
    expect(
      await ctx.db.$count(
        notifications,
        inArray(
          notifications.userId,
          teachers.map((t) => t.userId),
        ),
      ),
    ).toBe(0);
  });

  it('db:clear-samples refuses while a real task waits on a sample task (nothing deleted)', async () => {
    const [sample] = await ctx.db.select().from(opsStaffTasks).limit(1);
    const [real] = await ctx.db
      .insert(opsStaffTasks)
      .values({
        staffId: sample!.staffId,
        title: 'Real task',
        dueOn: sample!.dueOn,
        originalDueOn: sample!.dueOn,
        createdBy: sample!.createdBy,
      })
      .returning();
    await ctx.db.insert(opsTaskDependencies).values({
      taskId: real!.id,
      dependsOnTaskId: sample!.id,
      createdByUserId: sample!.createdBy,
    });
    await expect(clearSamples(ctx.db)).rejects.toThrow();
    expect(await ctx.db.$count(opsLeads)).toBe(SAMPLE_LEAD_COUNT + SAMPLE_MARKETING_LEADS.length);
    await ctx.db.delete(opsTaskDependencies).where(eq(opsTaskDependencies.taskId, real!.id));
    await ctx.db.delete(opsStaffTasks).where(eq(opsStaffTasks.id, real!.id));
  });

  it('db:clear-samples removes every sample row and keeps the owner-supplied staff', async () => {
    await seedTeachers(ctx.db);
    // An Academic sample batch and student (normally from the Academic seed) go too.
    const [programme] = await ctx.db.select().from(programmes).limit(1);
    const [course] = await ctx.db
      .insert(academicCourses)
      .values({
        programmeId: programme!.id,
        code: 'ZZ-SAMPLE',
        familyCode: 'ZZ',
        name: 'Sample course',
      })
      .returning();
    await ctx.db.insert(academicBatches).values({
      code: 'SAMPLE-ZZ',
      name: 'Sample batch',
      courseId: course!.id,
      programmeId: programme!.id,
      isSample: true,
    });
    await ctx.db
      .insert(academicStudents)
      .values({ code: 'STU-ZZ', fullName: 'Zed Sample Student', isSample: true });
    const counts = await clearSamples(ctx.db);
    expect(counts['academic.batches']).toBe(1);
    expect(counts['academic.students']).toBe(1);
    expect(counts['ops.leads']).toBe(SAMPLE_LEAD_COUNT + SAMPLE_MARKETING_LEADS.length);
    expect(counts['core.staff_members']).toBe(SUBJECT_TEACHERS.length + COVER_TEACHERS.length); // the sample teachers without logins
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
      opsStaffTasks,
      opsTaskEvents,
      opsEodReports,
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
