import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '@elevate/authentication';
import {
  academicAttempts,
  academicBatches,
  academicAttendance,
  academicChapters,
  academicClassRecords,
  academicConceptBookChapters,
  academicCourses,
  academicCurriculumPlans,
  academicPlanItems,
  academicResults,
  academicStudents,
  academicSubjects,
  academicTeacherAssignments,
  type Database,
} from '@elevate/database';
import { coreSeeds, runSeeds } from '@elevate/database/seed';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { readSyllabus } from '../../seed/syllabus';
import { getBatchFeasibility } from '../../src/server';
import { opsSeedStubs } from './sample-seed-stubs';

const ctx = setupTestDatabase();

const TABLES = [
  'courses',
  'subjects',
  'chapters',
  'curriculum_plans',
  'plan_items',
  'concept_book_chapters',
  'batches',
  'teacher_assignments',
  'calendar_rules',
  'calendar_exclusions',
  'students',
  'enrolments',
  'settings',
] as const;

async function counts(db: Database) {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = (await db.execute(
      sql.raw(`select count(*)::int as n from academic.${t}`),
    )) as unknown as {
      rows: { n: number }[];
    };
    out[t] = Number(r.rows[0]!.n);
  }
  return out;
}

async function seedAll(db: Database) {
  await runSeeds(db, [...coreSeeds, ...opsSeedStubs(), ...seeds], {
    seedUserPassword: 'test-only-seed-password',
    hashPassword,
    log: () => {},
  });
}

async function planTotals(db: Database, code: string) {
  const [plan] = await db
    .select()
    .from(academicCurriculumPlans)
    .where(eq(academicCurriculumPlans.code, code));
  const rows = await db
    .select({
      subject: academicSubjects.code,
      classes: academicPlanItems.plannedClasses,
      minutes: academicPlanItems.plannedMinutes,
    })
    .from(academicPlanItems)
    .innerJoin(academicChapters, eq(academicChapters.id, academicPlanItems.chapterId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicChapters.subjectId))
    .where(eq(academicPlanItems.planId, plan!.id));
  const bySubject: Record<string, number> = {};
  for (const r of rows) bySubject[r.subject] = (bySubject[r.subject] ?? 0) + r.classes;
  return {
    plan: plan!,
    classes: rows.reduce((a, r) => a + r.classes, 0),
    minutes: rows.reduce((a, r) => a + r.minutes, 0),
    bySubject,
  };
}

describe('Academic OS seeds (legacy planning data, fictional people)', () => {
  it('are idempotent: a second run changes no row counts', async () => {
    await seedAll(ctx.db);
    const first = await counts(ctx.db);
    await seedAll(ctx.db);
    expect(await counts(ctx.db)).toEqual(first);
    expect(first.settings).toBe(0); // defaults stay proposed; no settings rows seeded
    expect(first.batches).toBe(5); // 2 planning batches + 3 sample batches
    expect(first.students).toBe(6);
    expect(first.enrolments).toBe(6);
  });

  it('IPMAT locked baseline: 253 teaching classes, 316.25 h', async () => {
    const t = await planTotals(ctx.db, 'IPMAT-BASELINE-253');
    expect(t.plan).toMatchObject({
      status: 'locked',
      countsStatus: 'locked',
      legacyApprovedOn: '2026-09-10',
      approvedByUserId: null,
    });
    expect(t.classes).toBe(253);
    expect(t.minutes / 60).toBe(316.25);
    expect(t.bySubject).toEqual({ QUANT: 151, VERBAL: 57, LR: 32, DI: 13 });
  });

  it('Class 12 override: 305 classes / 381.25 h (locked counts, provisional dates) supersedes 313', async () => {
    const t = await planTotals(ctx.db, 'IPMAT-C12-305');
    expect(t.classes).toBe(305);
    expect(t.minutes / 60).toBe(381.25);
    expect(t.bySubject).toEqual({ QUANT: 178, VERBAL: 70, LR: 39, DI: 18 });
    expect(t.plan).toMatchObject({
      status: 'locked',
      countsStatus: 'locked',
      datesStatus: 'provisional',
    });
    const [old] = await ctx.db
      .select()
      .from(academicCurriculumPlans)
      .where(eq(academicCurriculumPlans.code, 'IPMAT-C12-313'));
    expect(old!.status).toBe('superseded');
    expect(t.plan.supersedesPlanId).toBe(old!.id);
    const chapters = await ctx.db
      .select()
      .from(academicChapters)
      .where(eq(academicChapters.courseId, t.plan.courseId));
    expect(chapters).toHaveLength(104);
  });

  it('provisional CA Foundation (150 h = 9000 min) and online Class 12 Accountancy (118 CBSE h)', async () => {
    const ca = await planTotals(ctx.db, 'CAF-ACC-V0.2');
    expect(ca.plan.status).toBe('provisional');
    expect(ca.minutes).toBe(9000);
    const online = await planTotals(ctx.db, 'ONL-C12-ACC-226');
    expect(online.plan.status).toBe('provisional');
    expect(online.minutes / 60).toBe(118);
    expect(online.classes).toBe(118);
  });

  it('concept books: 133 numbered chapters, planned (not written) question counts only', async () => {
    const rows = await ctx.db.select().from(academicConceptBookChapters);
    expect(rows.filter((r) => r.status === 'active' && r.chapterNumber !== null)).toHaveLength(133);
    expect(rows.filter((r) => r.status === 'opening_unit').map((r) => r.chapterCode)).toEqual([
      'B2-OPEN',
    ]);
    expect(rows.find((r) => r.chapterCode === 'B4-11')).toMatchObject({
      status: 'retired',
      aliasOfCode: 'B4-10',
    });
    const cr = rows.filter((r) => r.questionCountStatus === 'planned');
    expect(
      cr.reduce(
        (a, r) =>
          a + r.plannedConceptQuestions! + r.plannedPracticeQuestions! + r.plannedRankerQuestions!,
        0,
      ),
    ).toBe(1150);
    expect(rows.every((r) => r.contentStatus === 'not_started')).toBe(true);
  });

  it('seeds nothing as delivered and only sample students (D-036: no phones, is_sample)', async () => {
    for (const table of [
      academicClassRecords,
      academicAttendance,
      academicAttempts,
      academicResults,
    ]) {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(table);
      expect(n).toBe(0);
    }
    const students = await ctx.db.select().from(academicStudents);
    for (const s of students) {
      expect(s).toMatchObject({ isSample: true, phone: null, guardianPhone: null });
      expect(s.fullName).toMatch(/^\w+ Sample Student$/);
      expect(s.email).toMatch(/@example\.test$/);
    }
    const batches = await ctx.db.select().from(academicBatches);
    expect(
      batches
        .filter((b) => b.isSample)
        .map((b) => b.code)
        .sort(),
    ).toEqual(['SAMPLE-CAF', 'SAMPLE-IPMAT-A', 'SAMPLE-IPMAT-B']);
    expect(
      batches
        .filter((b) => !b.isSample)
        .map((b) => b.code)
        .sort(),
    ).toEqual(['CAF-SEP27-REG', 'IPMAT-C12-APR27']);
  });

  it('draft syllabus courses match the reviewed distribution; IPMAT-BASE gets weights only', async () => {
    const byCourse = new Map(readSyllabus().programmes.map((p) => [p.courseCode, p]));
    const courses = await ctx.db
      .select()
      .from(academicCourses)
      .where(inArray(academicCourses.code, [...byCourse.keys()]));
    expect(courses).toHaveLength(6);
    for (const c of courses) {
      const p = byCourse.get(c.code)!;
      if (c.code === 'IPMAT-BASE')
        expect(c.status).toBe('active'); // set by academic.ipmat-baseline, not by this seed
      else
        expect(c).toMatchObject({
          status: 'draft',
          mode: null,
          classMinutes: null,
          description: expect.stringMatching(
            /^Draft syllabus — pending owner verification\..*retrieved 2026-10-21/,
          ),
        });
      const rows = await ctx.db
        .select({
          subject: academicSubjects.code,
          code: academicChapters.code,
          title: academicChapters.title,
          sortOrder: academicChapters.sortOrder,
          weight: academicChapters.weight,
        })
        .from(academicChapters)
        .innerJoin(academicSubjects, eq(academicSubjects.id, academicChapters.subjectId))
        .where(eq(academicChapters.courseId, c.id));
      const expected = p.subjects.flatMap((s) =>
        s.chapters.map((ch) => ({
          subject: s.code,
          code: ch.code,
          title: ch.title,
          sortOrder: ch.sortOrder,
          weight: ch.weight,
        })),
      );
      expect(rows.sort((a, b) => a.code.localeCompare(b.code))).toEqual(
        expected.sort((a, b) => a.code.localeCompare(b.code)),
      );
    }
    const subjects = await ctx.db
      .select({
        course: academicCourses.code,
        code: academicSubjects.code,
        name: academicSubjects.name,
      })
      .from(academicSubjects)
      .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
      .where(inArray(academicSubjects.code, ['MATH', 'AMATH']));
    for (const course of ['COM-C11-2627', 'COM-C12-2627']) {
      expect(
        subjects
          .filter((s) => s.course === course)
          .map((s) => s.name)
          .sort(),
      ).toEqual(['Applied Mathematics (241)', 'Mathematics (041)']);
    }
    expect(courses.find((c) => c.code === 'CUET-SYL-2026')!.description).toMatch(/pick five/);
  });

  it('CA Foundation CAF-ACC-SEP27 converges to active on re-run (D-037); no teachers on syllabus drafts', async () => {
    await ctx.db
      .update(academicCourses)
      .set({ status: 'paused' })
      .where(eq(academicCourses.code, 'CAF-ACC-SEP27'));
    await seedAll(ctx.db);
    const [ca] = await ctx.db
      .select()
      .from(academicCourses)
      .where(eq(academicCourses.code, 'CAF-ACC-SEP27'));
    expect(ca!.status).toBe('active');
    expect((await planTotals(ctx.db, 'IPMAT-BASELINE-253')).classes).toBe(253);
    const onSyllabus = await ctx.db
      .select({ id: academicTeacherAssignments.id })
      .from(academicTeacherAssignments)
      .innerJoin(academicSubjects, eq(academicSubjects.id, academicTeacherAssignments.subjectId))
      .innerJoin(academicCourses, eq(academicCourses.id, academicSubjects.courseId))
      .where(sql`${academicCourses.sourceRef} like 'data/syllabus/%'`);
    expect(onSyllabus).toHaveLength(0);
  });

  it('the seeded Class 12 calendar reproduces 345 − 28 = 317 net vs 305 required (headroom 12)', async () => {
    const coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
    const [batch] = await ctx.db
      .select()
      .from(academicBatches)
      .where(eq(academicBatches.code, 'IPMAT-C12-APR27'));
    const f = await getBatchFeasibility(ctx.db, { user: coordinator }, batch!.id, {});
    expect(f.plan?.code).toBe('IPMAT-C12-305');
    expect(f.result).toMatchObject({
      grossSlots: 345,
      excludedSlots: 28,
      netSlots: 317,
      requiredClasses: 305,
      headroom: 12,
      verdict: 'feasible',
    });
  });
});
