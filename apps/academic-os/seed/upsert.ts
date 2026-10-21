/**
 * Idempotent upserts on natural keys (codes) used by the Academic OS seeds.
 * Running a seed twice leaves every row as it was.
 */
import { eq } from 'drizzle-orm';
import {
  academicChapters,
  academicCourses,
  academicCurriculumPlans,
  academicPlanItems,
  academicSubjects,
  programmes,
  type AcademicChapterId,
  type AcademicPlanId,
  type AcademicSubjectId,
  type Database,
} from '@elevate/database';
import type { CourseId, ProgrammeId } from '@elevate/shared-types';

type CourseInsert = typeof academicCourses.$inferInsert;
type PlanInsert = typeof academicCurriculumPlans.$inferInsert;

export async function programmeId(db: Database, code: string): Promise<ProgrammeId> {
  const [row] = await db.select({ id: programmes.id }).from(programmes).where(eq(programmes.code, code));
  if (!row) throw new Error(`Programme ${code} is missing — run the core.programmes seed first.`);
  return row.id;
}

export async function upsertCourse(db: Database, values: CourseInsert): Promise<CourseId> {
  const { code: _code, ...set } = values;
  const [row] = await db
    .insert(academicCourses)
    .values(values)
    .onConflictDoUpdate({ target: academicCourses.code, set })
    .returning({ id: academicCourses.id });
  return row!.id;
}

export async function upsertSubject(
  db: Database,
  courseId: CourseId,
  code: string,
  name: string,
  sortOrder: number,
): Promise<AcademicSubjectId> {
  const [row] = await db
    .insert(academicSubjects)
    .values({ courseId, code, name, sortOrder })
    .onConflictDoUpdate({ target: [academicSubjects.courseId, academicSubjects.code], set: { name, sortOrder } })
    .returning({ id: academicSubjects.id });
  return row!.id;
}

export async function upsertChapter(
  db: Database,
  values: { courseId: CourseId; subjectId: AcademicSubjectId; code: string; title: string; sortOrder: number; weight?: number },
): Promise<AcademicChapterId> {
  const [row] = await db
    .insert(academicChapters)
    .values(values)
    .onConflictDoUpdate({
      target: [academicChapters.courseId, academicChapters.code],
      // weight undefined → drizzle leaves the column out, so seeds without weights never reset it.
      set: { subjectId: values.subjectId, title: values.title, sortOrder: values.sortOrder, weight: values.weight },
    })
    .returning({ id: academicChapters.id });
  return row!.id;
}

/** Upsert a legacy-imported plan by code (status labels exactly as the source records them). */
export async function upsertPlan(db: Database, values: PlanInsert): Promise<AcademicPlanId> {
  const { code: _code, ...set } = values;
  const [row] = await db
    .insert(academicCurriculumPlans)
    .values(values)
    .onConflictDoUpdate({ target: academicCurriculumPlans.code, set })
    .returning({ id: academicCurriculumPlans.id });
  return row!.id;
}

export interface SeedItem {
  chapterId: AcademicChapterId;
  lessonCode: string;
  sessionType: 'teaching' | 'practice';
  plannedClasses: number;
  plannedMinutes: number;
  plannedDate?: string | null;
  coverage?: string | null;
}

/** Upsert plan items by (plan, lessonCode); sequence = position in the given list (1-based). */
export async function upsertItems(db: Database, planId: AcademicPlanId, items: readonly SeedItem[]): Promise<void> {
  for (const [i, item] of items.entries()) {
    const values = {
      planId,
      chapterId: item.chapterId,
      sequence: i + 1,
      lessonCode: item.lessonCode,
      sessionType: item.sessionType,
      plannedClasses: item.plannedClasses,
      plannedMinutes: item.plannedMinutes,
      plannedDate: item.plannedDate ?? null,
      coverage: item.coverage ?? null,
    };
    await db
      .insert(academicPlanItems)
      .values(values)
      .onConflictDoUpdate({
        target: [academicPlanItems.planId, academicPlanItems.lessonCode],
        set: {
          chapterId: values.chapterId,
          sequence: values.sequence,
          sessionType: values.sessionType,
          plannedClasses: values.plannedClasses,
          plannedMinutes: values.plannedMinutes,
          plannedDate: values.plannedDate,
          coverage: values.coverage,
        },
      });
  }
}
