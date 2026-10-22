/**
 * Curriculum service (ACD-001, ACD-004..006, ACD-023): courses (versions under a
 * core programme), subjects, chapters, curriculum plan versions with approval-
 * gated status changes, coverage and concept-book indices.
 */
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  academicChapters,
  academicClassRecords,
  academicConceptBookChapters,
  academicCourses,
  academicCurriculumPlans,
  academicPlanItems,
  academicSubjects,
  programmes,
  type AcademicPlanId,
  type Database,
} from '@elevate/database';
import {
  decideApproval,
  defineApprovalPolicy,
  findPendingApproval,
  listApprovalHistory,
  requestApproval,
  withTransaction,
} from '@elevate/server-kit';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@elevate/shared-contracts';
import type { ApprovalId, BatchId, CourseId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  canEditPlanItems,
  canRequestApproval,
  canTransitionPlan,
  computeCoverage,
  plannedHours,
  supersessionProblem,
  type PlanStatus,
} from '../../domain';
import { assertBatchInScope, audit, getBatchOrThrow, resolveScope, type Actor } from '../context';
import type {
  createChapterBody,
  createCourseBody,
  createPlanBody,
  createSubjectBody,
  decidePlanApprovalBody,
  planItemsBody,
  requestPlanApprovalBody,
  retireChapterBody,
} from '../schemas';

/**
 * Locking, making provisional or superseding a curriculum plan needs a core
 * approval decided by an academic coordinator other than the requester.
 */
export const planStatusPolicy = defineApprovalPolicy({
  key: 'academic.curriculum_plan.status_change',
  module: 'academic',
  subjectType: 'curriculum_plan',
  deciderPermission: 'academic:curriculum:approve',
  requesterPermission: 'academic:courses:write',
  allowSelfApproval: false,
  requireCommentOnReject: true,
  description:
    'A proposed curriculum plan version becomes locked or provisional (and supersedes its predecessor) only after another academic coordinator approves.',
});

// --- programmes and courses ---------------------------------------------------------------

export async function listProgrammes(db: Database) {
  return db.select().from(programmes).orderBy(asc(programmes.code));
}

export async function listCourses(db: Database) {
  const rows = await db
    .select({ course: academicCourses, programmeCode: programmes.code })
    .from(academicCourses)
    .innerJoin(programmes, eq(programmes.id, academicCourses.programmeId))
    .orderBy(asc(programmes.code), asc(academicCourses.familyCode), asc(academicCourses.version));
  const planRows = await db
    .select({ courseId: academicCurriculumPlans.courseId, status: academicCurriculumPlans.status, n: count() })
    .from(academicCurriculumPlans)
    .groupBy(academicCurriculumPlans.courseId, academicCurriculumPlans.status);
  return rows.map(({ course, programmeCode }) => ({
    ...course,
    programmeCode,
    plansByStatus: Object.fromEntries(
      planRows.filter((p) => p.courseId === course.id).map((p) => [p.status, Number(p.n)]),
    ) as Partial<Record<PlanStatus, number>>,
  }));
}

export async function createCourse(db: Database, actor: Actor, input: z.output<typeof createCourseBody>) {
  return withTransaction(db, async (tx) => {
    const [programme] = await tx.select().from(programmes).where(eq(programmes.code, input.programmeCode));
    if (!programme) throw new ValidationError(`Programme ${input.programmeCode} is not in the catalogue.`);
    const [row] = await tx
      .insert(academicCourses)
      .values({
        programmeId: programme.id,
        code: input.code,
        familyCode: input.familyCode,
        version: input.version,
        name: input.name,
        description: input.description ?? null,
        mode: input.mode ?? null,
        classMinutes: input.classMinutes ?? null,
        classMinutesStatus: input.classMinutes ? input.classMinutesStatus : 'unknown',
        status: input.status,
      })
      .returning();
    await audit(tx, actor, { action: 'course.created', entityType: 'course', entityId: row!.id, after: row });
    return row!;
  });
}

export async function getCourse(db: Database, courseId: string) {
  const [row] = await db
    .select({ course: academicCourses, programmeCode: programmes.code })
    .from(academicCourses)
    .innerJoin(programmes, eq(programmes.id, academicCourses.programmeId))
    .where(eq(academicCourses.id, courseId as CourseId));
  if (!row) throw new NotFoundError('Course not found.');
  const subjects = await db
    .select()
    .from(academicSubjects)
    .where(eq(academicSubjects.courseId, row.course.id))
    .orderBy(asc(academicSubjects.sortOrder), asc(academicSubjects.code));
  const chapters = await db
    .select()
    .from(academicChapters)
    .where(eq(academicChapters.courseId, row.course.id))
    .orderBy(asc(academicChapters.sortOrder), asc(academicChapters.code));
  const plans = await db
    .select()
    .from(academicCurriculumPlans)
    .where(eq(academicCurriculumPlans.courseId, row.course.id))
    .orderBy(desc(academicCurriculumPlans.createdAt));
  return { ...row.course, programmeCode: row.programmeCode, subjects, chapters, plans };
}

export async function createSubject(
  db: Database,
  actor: Actor,
  courseId: string,
  input: z.output<typeof createSubjectBody>,
) {
  return withTransaction(db, async (tx) => {
    const [course] = await tx.select().from(academicCourses).where(eq(academicCourses.id, courseId as CourseId));
    if (!course) throw new NotFoundError('Course not found.');
    const [row] = await tx.insert(academicSubjects).values({ courseId: course.id, ...input }).returning();
    await audit(tx, actor, { action: 'subject.created', entityType: 'subject', entityId: row!.id, after: row });
    return row!;
  });
}

export async function createChapter(
  db: Database,
  actor: Actor,
  courseId: string,
  input: z.output<typeof createChapterBody>,
) {
  return withTransaction(db, async (tx) => {
    const [subject] = await tx
      .select()
      .from(academicSubjects)
      .where(and(eq(academicSubjects.id, input.subjectId as never), eq(academicSubjects.courseId, courseId as CourseId)));
    if (!subject) throw new ValidationError('The subject does not belong to this course.');
    const [row] = await tx
      .insert(academicChapters)
      .values({
        courseId: subject.courseId,
        subjectId: subject.id,
        code: input.code,
        title: input.title,
        sortOrder: input.sortOrder,
        weight: input.weight,
      })
      .returning();
    await audit(tx, actor, { action: 'chapter.created', entityType: 'chapter', entityId: row!.id, after: row });
    return row!;
  });
}

/** Retire or move a chapter: the code is kept and becomes an alias of the current chapter (ACD-001). */
export async function retireChapter(
  db: Database,
  actor: Actor,
  chapterId: string,
  input: z.output<typeof retireChapterBody>,
) {
  return withTransaction(db, async (tx) => {
    const [chapter] = await tx.select().from(academicChapters).where(eq(academicChapters.id, chapterId as never)).for('update');
    if (!chapter) throw new NotFoundError('Chapter not found.');
    if (chapter.status !== 'active') throw new InvalidStateTransitionError(`The chapter is already ${chapter.status}.`);
    const [target] = await tx.select().from(academicChapters).where(eq(academicChapters.id, input.aliasOfChapterId as never));
    if (!target || target.courseId !== chapter.courseId || target.status !== 'active' || target.id === chapter.id) {
      throw new ValidationError('The alias target must be another active chapter of the same course.');
    }
    const [row] = await tx
      .update(academicChapters)
      .set({ status: input.status, aliasOfChapterId: target.id })
      .where(eq(academicChapters.id, chapter.id))
      .returning();
    await audit(tx, actor, { action: `chapter.${input.status}`, entityType: 'chapter', entityId: chapter.id, before: chapter, after: row, metadata: { reason: input.reason } });
    return row!;
  });
}

// --- curriculum plans ---------------------------------------------------------------------------

export async function listPlans(db: Database, filter: { courseId?: string } = {}) {
  const rows = await db
    .select({
      plan: academicCurriculumPlans,
      courseCode: academicCourses.code,
      items: sql<number>`(select count(*) from ${academicPlanItems} where ${academicPlanItems.planId} = ${academicCurriculumPlans.id})`.mapWith(Number),
      classes: sql<number>`(select coalesce(sum(${academicPlanItems.plannedClasses}), 0) from ${academicPlanItems} where ${academicPlanItems.planId} = ${academicCurriculumPlans.id})`.mapWith(Number),
      minutes: sql<number>`(select coalesce(sum(${academicPlanItems.plannedMinutes}), 0) from ${academicPlanItems} where ${academicPlanItems.planId} = ${academicCurriculumPlans.id})`.mapWith(Number),
    })
    .from(academicCurriculumPlans)
    .innerJoin(academicCourses, eq(academicCourses.id, academicCurriculumPlans.courseId))
    .where(filter.courseId ? eq(academicCurriculumPlans.courseId, filter.courseId as CourseId) : undefined)
    .orderBy(asc(academicCourses.code), desc(academicCurriculumPlans.createdAt));
  return rows.map((r) => ({
    ...r.plan,
    courseCode: r.courseCode,
    itemCount: r.items,
    plannedClasses: r.classes,
    plannedMinutes: r.minutes,
    plannedHours: plannedHours(r.minutes),
  }));
}

export async function getPlan(db: Database, planId: string) {
  const [plan] = await db.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, planId as AcademicPlanId));
  if (!plan) throw new NotFoundError('Plan not found.');
  const items = await db
    .select({
      item: academicPlanItems,
      chapterCode: academicChapters.code,
      chapterTitle: academicChapters.title,
      subjectCode: academicSubjects.code,
    })
    .from(academicPlanItems)
    .innerJoin(academicChapters, eq(academicChapters.id, academicPlanItems.chapterId))
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicChapters.subjectId))
    .where(eq(academicPlanItems.planId, plan.id))
    .orderBy(asc(academicPlanItems.sequence));
  const bySubject = new Map<string, { subjectCode: string; teaching: number; practice: number; minutes: number }>();
  for (const { item, subjectCode } of items) {
    const s = bySubject.get(subjectCode) ?? { subjectCode, teaching: 0, practice: 0, minutes: 0 };
    s[item.sessionType] += item.plannedClasses;
    s.minutes += item.plannedMinutes;
    bySubject.set(subjectCode, s);
  }
  const totals = [...bySubject.values()].map((s) => ({ ...s, total: s.teaching + s.practice, hours: plannedHours(s.minutes) }));
  const approvals = await listApprovalHistory(db, { module: 'academic', subjectType: 'curriculum_plan', subjectId: plan.id });
  const [supersededBy] = await db
    .select({ id: academicCurriculumPlans.id, code: academicCurriculumPlans.code, status: academicCurriculumPlans.status })
    .from(academicCurriculumPlans)
    .where(eq(academicCurriculumPlans.supersedesPlanId, plan.id));
  return {
    plan,
    items: items.map((r) => ({ ...r.item, chapterCode: r.chapterCode, chapterTitle: r.chapterTitle, subjectCode: r.subjectCode })),
    totals,
    totalClasses: totals.reduce((a, t) => a + t.total, 0),
    totalHours: plannedHours(totals.reduce((a, t) => a + t.minutes, 0)),
    approvals,
    supersededBy: supersededBy ?? null,
  };
}

export async function createPlan(db: Database, actor: Actor, input: z.output<typeof createPlanBody>) {
  return withTransaction(db, async (tx) => {
    const [course] = await tx.select().from(academicCourses).where(eq(academicCourses.id, input.courseId as CourseId));
    if (!course) throw new ValidationError('Course not found.');
    if (input.batchId) {
      const batch = await getBatchOrThrow(tx, input.batchId);
      if (batch.courseId !== course.id) throw new ValidationError('The batch does not follow this course.');
    }
    let predecessor: typeof academicCurriculumPlans.$inferSelect | undefined;
    if (input.supersedesPlanId) {
      [predecessor] = await tx.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, input.supersedesPlanId as AcademicPlanId));
      if (!predecessor) throw new ValidationError('The plan to supersede does not exist.');
      const problem = supersessionProblem(
        { id: 'new', courseId: course.id, batchId: input.batchId ?? null, status: 'proposed' },
        { id: predecessor.id, courseId: predecessor.courseId, batchId: predecessor.batchId, status: predecessor.status },
      );
      if (problem) throw new ValidationError(problem);
    }
    const [plan] = await tx
      .insert(academicCurriculumPlans)
      .values({
        courseId: course.id,
        batchId: (input.batchId as BatchId | undefined) ?? null,
        code: input.code,
        title: input.title,
        version: predecessor ? predecessor.version + 1 : 1,
        status: 'proposed',
        countsStatus: input.countsStatus,
        datesStatus: input.datesStatus,
        supersedesPlanId: predecessor?.id ?? null,
        classMinutes: input.classMinutes ?? predecessor?.classMinutes ?? course.classMinutes,
        scopeNote: input.scopeNote ?? null,
        changeLog: input.changeLog ?? null,
        createdByUserId: actor.user.id,
      })
      .returning();
    if (predecessor && input.copyItems) {
      const items = await tx.select().from(academicPlanItems).where(eq(academicPlanItems.planId, predecessor.id));
      if (items.length > 0) {
        await tx.insert(academicPlanItems).values(
          items.map(({ id: _id, planId: _p, createdAt: _c, ...rest }) => ({ ...rest, planId: plan!.id })),
        );
      }
    }
    await audit(tx, actor, { action: 'curriculum_plan.created', entityType: 'curriculum_plan', entityId: plan!.id, after: plan, metadata: { supersedes: predecessor?.id ?? null, copiedItems: Boolean(predecessor && input.copyItems) } });
    return plan!;
  });
}

export async function addPlanItems(db: Database, actor: Actor, planId: string, input: z.output<typeof planItemsBody>) {
  return withTransaction(db, async (tx) => {
    const [plan] = await tx.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, planId as AcademicPlanId)).for('update');
    if (!plan) throw new NotFoundError('Plan not found.');
    if (!canEditPlanItems(plan.status)) {
      throw new InvalidStateTransitionError(`A ${plan.status} plan is immutable; create a new version that supersedes it.`);
    }
    const chapterIds = [...new Set(input.items.map((i) => i.chapterId))];
    const chapters = await tx.select().from(academicChapters).where(and(inArray(academicChapters.id, chapterIds as never[]), eq(academicChapters.courseId, plan.courseId)));
    if (chapters.length !== chapterIds.length) throw new ValidationError('Every chapter must belong to the plan’s course.');
    if (chapters.some((c) => c.status !== 'active')) throw new ValidationError('Retired or moved chapters cannot be planned; use their alias.');
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${academicPlanItems.sequence}), 0)`.mapWith(Number) })
      .from(academicPlanItems)
      .where(eq(academicPlanItems.planId, plan.id));
    const values = input.items.map((item, i) => {
      const minutes = item.plannedMinutes ?? (plan.classMinutes ? plan.classMinutes * item.plannedClasses : null);
      if (minutes === null) throw new ValidationError(`Item ${item.lessonCode}: give plannedMinutes (the plan has no class length).`);
      return {
        planId: plan.id,
        chapterId: item.chapterId as never,
        sequence: next + i + 1,
        lessonCode: item.lessonCode,
        sessionType: item.sessionType,
        plannedClasses: item.plannedClasses,
        plannedMinutes: minutes,
        plannedDate: item.plannedDate ?? null,
        coverage: item.coverage ?? null,
      };
    });
    const rows = await tx.insert(academicPlanItems).values(values).returning();
    await audit(tx, actor, { action: 'curriculum_plan.items_added', entityType: 'curriculum_plan', entityId: plan.id, after: { count: rows.length, lessonCodes: rows.map((r) => r.lessonCode) } });
    return rows;
  });
}

export async function requestPlanStatusChange(db: Database, actor: Actor, planId: string, input: z.output<typeof requestPlanApprovalBody>) {
  return withTransaction(db, async (tx) => {
    const [plan] = await tx.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, planId as AcademicPlanId)).for('update');
    if (!plan) throw new NotFoundError('Plan not found.');
    if (!canRequestApproval(plan.status, input.targetStatus)) {
      throw new InvalidStateTransitionError(`A ${plan.status} plan cannot become ${input.targetStatus}.`);
    }
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(academicPlanItems).where(eq(academicPlanItems.planId, plan.id));
    if (Number(n) === 0) throw new ValidationError('A plan needs at least one item before approval.');
    const approval = await requestApproval(tx, { policy: planStatusPolicy, subjectId: plan.id, requestedBy: actor.user, comment: input.comment ?? `Make ${plan.code} ${input.targetStatus}`, requestId: actor.requestId });
    const [updated] = await tx.update(academicCurriculumPlans).set({ pendingTargetStatus: input.targetStatus }).where(eq(academicCurriculumPlans.id, plan.id)).returning();
    await audit(tx, actor, { action: 'curriculum_plan.approval_requested', entityType: 'curriculum_plan', entityId: plan.id, before: plan, after: updated, metadata: { approvalId: approval.id, targetStatus: input.targetStatus } });
    return { plan: updated!, approval };
  });
}

/** Decide the pending approval; on approval apply the status and supersede the predecessor. */
export async function decidePlanStatusChange(db: Database, actor: Actor, planId: string, input: z.output<typeof decidePlanApprovalBody>) {
  return withTransaction(db, async (tx) => {
    const [plan] = await tx.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, planId as AcademicPlanId)).for('update');
    if (!plan) throw new NotFoundError('Plan not found.');
    const pending = await findPendingApproval(tx, planStatusPolicy, plan.id);
    if (!pending || !plan.pendingTargetStatus) throw new InvalidStateTransitionError('There is no pending approval for this plan.');
    const target = plan.pendingTargetStatus;
    const approval = await decideApproval(tx, { policy: planStatusPolicy, approvalId: pending.id as ApprovalId, decider: actor.user, decision: input.decision, comment: input.comment ?? null, requestId: actor.requestId });
    if (input.decision === 'rejected') {
      const [updated] = await tx.update(academicCurriculumPlans).set({ pendingTargetStatus: null }).where(eq(academicCurriculumPlans.id, plan.id)).returning();
      await audit(tx, actor, { action: 'curriculum_plan.approval_rejected', entityType: 'curriculum_plan', entityId: plan.id, before: plan, after: updated });
      return { plan: updated!, approval, superseded: null };
    }
    if (!canTransitionPlan(plan.status, target)) throw new InvalidStateTransitionError(`A ${plan.status} plan cannot become ${target}.`);
    let superseded: typeof academicCurriculumPlans.$inferSelect | null = null;
    if (plan.supersedesPlanId) {
      const [predecessor] = await tx.select().from(academicCurriculumPlans).where(eq(academicCurriculumPlans.id, plan.supersedesPlanId)).for('update');
      if (!predecessor || !canTransitionPlan(predecessor.status, 'superseded')) {
        throw new ConflictError('The plan this version supersedes is no longer current; create a new version from the current plan.');
      }
      const [row] = await tx.update(academicCurriculumPlans).set({ status: 'superseded' }).where(eq(academicCurriculumPlans.id, predecessor.id)).returning();
      superseded = row ?? null;
      await audit(tx, actor, { action: 'curriculum_plan.superseded', entityType: 'curriculum_plan', entityId: predecessor.id, before: predecessor, after: superseded, metadata: { supersededBy: plan.id } });
    }
    const [updated] = await tx
      .update(academicCurriculumPlans)
      .set({ status: target, pendingTargetStatus: null, approvedByUserId: actor.user.id, approvedAt: new Date() })
      .where(eq(academicCurriculumPlans.id, plan.id))
      .returning();
    await audit(tx, actor, { action: `curriculum_plan.${target}`, entityType: 'curriculum_plan', entityId: plan.id, before: plan, after: updated, metadata: { approvalId: approval.id } });
    return { plan: updated!, approval, superseded };
  });
}

// --- coverage ----------------------------------------------------------------------------------------

/**
 * The plan that currently applies to a batch: its own batch-scoped plan if one
 * is locked/provisional, otherwise the course template (locked before provisional).
 */
export async function currentPlanForBatch(db: Database, batch: { id: string; courseId: string }) {
  const candidates = await db
    .select()
    .from(academicCurriculumPlans)
    .where(
      and(
        eq(academicCurriculumPlans.courseId, batch.courseId as CourseId),
        inArray(academicCurriculumPlans.status, ['locked', 'provisional']),
        or(eq(academicCurriculumPlans.batchId, batch.id as BatchId), sql`${academicCurriculumPlans.batchId} IS NULL`),
      ),
    );
  const rank = (p: (typeof candidates)[number]) => (p.batchId ? 0 : 2) + (p.status === 'locked' ? 0 : 1);
  return candidates.sort((a, b) => rank(a) - rank(b) || b.version - a.version)[0] ?? null;
}

export async function getBatchCoverage(db: Database, actor: Actor, batchId: string, asOf: string | null) {
  const scope = await resolveScope(db, actor, 'academic:batches:read');
  assertBatchInScope(scope, batchId);
  const batch = await getBatchOrThrow(db, batchId);
  const plan = await currentPlanForBatch(db, batch);
  const subjects = await db.select().from(academicSubjects).where(eq(academicSubjects.courseId, batch.courseId));
  const chapters = await db.select().from(academicChapters).where(eq(academicChapters.courseId, batch.courseId));
  const items = plan ? await db.select().from(academicPlanItems).where(eq(academicPlanItems.planId, plan.id)) : [];
  const records = await db
    .select({ chapterId: academicClassRecords.chapterId, actualMinutes: academicClassRecords.actualMinutes, state: academicClassRecords.state, activity: academicClassRecords.activity, completion: academicClassRecords.completion })
    .from(academicClassRecords)
    .where(and(eq(academicClassRecords.batchId, batch.id), inArray(academicClassRecords.state, ['submitted', 'verified'])));
  const coverage = computeCoverage({
    items: items.map((i) => ({ chapterId: i.chapterId, plannedMinutes: i.plannedMinutes, plannedClasses: i.plannedClasses, plannedDate: i.plannedDate })),
    chapters: chapters.map((c) => ({ id: c.id, subjectId: c.subjectId, code: c.code, title: c.title })),
    subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    records,
    asOf,
  });
  return {
    batch: { id: batch.id, code: batch.code, name: batch.name },
    plan: plan ? { id: plan.id, code: plan.code, status: plan.status, countsStatus: plan.countsStatus, datesStatus: plan.datesStatus } : null,
    asOf,
    coverage,
    note: plan
      ? 'Taught = submitted or verified first-teaching logs; each chapter counts once. Verified minutes = minutes from coordinator-verified logs only. Revision, practice and tests are evidence, not new coverage. This is what the batch was taught, not what any student has mastered.'
      : 'No locked or provisional plan applies to this batch, so nothing is planned.',
  };
}

// --- concept books ---------------------------------------------------------------------------------------

export async function listConceptBooks(db: Database) {
  const rows = await db
    .select()
    .from(academicConceptBookChapters)
    .orderBy(asc(academicConceptBookChapters.bookCode), asc(academicConceptBookChapters.chapterNumber), asc(academicConceptBookChapters.chapterCode));
  const books = new Map<string, { bookCode: string; bookTitle: string; chapters: typeof rows; numberedChapters: number }>();
  for (const r of rows) {
    const b = books.get(r.bookCode) ?? { bookCode: r.bookCode, bookTitle: r.bookTitle, chapters: [], numberedChapters: 0 };
    b.chapters.push(r);
    if (r.status === 'active' && r.chapterNumber !== null) b.numberedChapters += 1;
    books.set(r.bookCode, b);
  }
  const list = [...books.values()];
  return {
    books: list,
    numberedChapters: list.reduce((a, b) => a + b.numberedChapters, 0),
    note: 'Indices only; content is deliberately empty. Question counts are planned allocations, not written questions.',
  };
}
