/**
 * Insert-once helpers on natural keys (codes) for the Academic OS seeds. A row that already exists
 * stays exactly as it is, because a person may have edited it: seed text never overwrites it.
 */
import { and, eq } from 'drizzle-orm';
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

/** The id of the row `find` returns, inserting it only when there is none. */
export async function ensure<Id>(
  find: () => PromiseLike<{ id: Id }[]>,
  insert: () => PromiseLike<{ id: Id }[]>,
): Promise<Id> {
  const [found] = await find();
  return found ? found.id : (await insert())[0]!.id;
}

export async function programmeId(db: Database, code: string): Promise<ProgrammeId> {
  const [row] = await db.select({ id: programmes.id }).from(programmes).where(eq(programmes.code, code));
  if (!row) throw new Error(`Programme ${code} is missing — run the core.programmes seed first.`);
  return row.id;
}

export const ensureCourse = (db: Database, values: CourseInsert): Promise<CourseId> =>
  ensure(
    () => db.select({ id: academicCourses.id }).from(academicCourses).where(eq(academicCourses.code, values.code)),
    () => db.insert(academicCourses).values(values).returning({ id: academicCourses.id }),
  );

export const ensureSubject = (
  db: Database,
  courseId: CourseId,
  code: string,
  name: string,
  sortOrder: number,
): Promise<AcademicSubjectId> =>
  ensure(
    () =>
      db
        .select({ id: academicSubjects.id })
        .from(academicSubjects)
        .where(and(eq(academicSubjects.courseId, courseId), eq(academicSubjects.code, code))),
    () =>
      db.insert(academicSubjects).values({ courseId, code, name, sortOrder }).returning({ id: academicSubjects.id }),
  );

export const ensureChapter = (
  db: Database,
  values: { courseId: CourseId; subjectId: AcademicSubjectId; code: string; title: string; sortOrder: number; weight?: number },
): Promise<AcademicChapterId> =>
  ensure(
    () =>
      db
        .select({ id: academicChapters.id })
        .from(academicChapters)
        .where(and(eq(academicChapters.courseId, values.courseId), eq(academicChapters.code, values.code))),
    () => db.insert(academicChapters).values(values).returning({ id: academicChapters.id }),
  );

/** A legacy-imported plan by code (status labels exactly as the source records them). */
export const ensurePlan = (db: Database, values: PlanInsert): Promise<AcademicPlanId> =>
  ensure(
    () =>
      db
        .select({ id: academicCurriculumPlans.id })
        .from(academicCurriculumPlans)
        .where(eq(academicCurriculumPlans.code, values.code)),
    () => db.insert(academicCurriculumPlans).values(values).returning({ id: academicCurriculumPlans.id }),
  );

export interface SeedItem {
  chapterId: AcademicChapterId;
  lessonCode: string;
  sessionType: 'teaching' | 'practice';
  plannedClasses: number;
  plannedMinutes: number;
  plannedDate?: string | null;
  coverage?: string | null;
}

/** Plan items by (plan, lessonCode); sequence = position in the given list (1-based). */
export async function ensureItems(db: Database, planId: AcademicPlanId, items: readonly SeedItem[]): Promise<void> {
  for (const [i, item] of items.entries()) {
    await db
      .insert(academicPlanItems)
      .values({
        planId,
        chapterId: item.chapterId,
        sequence: i + 1,
        lessonCode: item.lessonCode,
        sessionType: item.sessionType,
        plannedClasses: item.plannedClasses,
        plannedMinutes: item.plannedMinutes,
        plannedDate: item.plannedDate ?? null,
        coverage: item.coverage ?? null,
      })
      .onConflictDoNothing();
  }
}
