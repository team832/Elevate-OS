/**
 * OWNER: Academic OS team (see docs/BUILD_PLAN.md — file ownership).
 *
 * Curriculum tables of the `academic` schema: courses (versions under a core programme),
 * subjects, chapters, curriculum plans and their items, concept-book indices. Same rules as
 * academic.ts (`academic.table`, `academic` prefix, UUID PKs, FKs only within academic or
 * into core, only `import type` from workspace packages). Plans are PLANNED, never delivered.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { BatchId, Brand, CourseId, ProgrammeId, UserId } from '@elevate/shared-types';
import { academic, createdAt, inList, updatedAt } from './academic-columns';
import { programmes, users } from './core';

export type AcademicSubjectId = Brand<string, 'AcademicSubjectId'>;
export type AcademicChapterId = Brand<string, 'AcademicChapterId'>;
export type AcademicPlanId = Brand<string, 'AcademicPlanId'>;
export type AcademicPlanItemId = Brand<string, 'AcademicPlanItemId'>;

export const ACADEMIC_PLAN_STATUSES = ['locked', 'provisional', 'proposed', 'superseded'] as const;
/** Label of a plan's counts or dates separately from the plan itself (BR-ACD-6). */
export const ACADEMIC_LABEL_STATUSES = [
  'locked',
  'approved',
  'provisional',
  'proposed',
  'draft',
  'unverified',
  'unknown',
] as const;
export const ACADEMIC_MODES = ['offline', 'online', 'hybrid'] as const;

/**
 * A course is one VERSION of a curriculum under a core programme, e.g.
 * `IPMAT-C12-2027` (IPMAT Class 12, 2027–28 cycle). Class length lives here
 * (with its own status) because a programme can run 75-minute offline and
 * 60-minute online courses (BR-ACD-1..3, ACD-005).
 */
export const academicCourses = academic.table(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<CourseId>(),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'restrict' })
      .$type<ProgrammeId>(),
    code: text('code').notNull(),
    /** Stable family code shared by all versions, e.g. `IPMAT-C12`. */
    familyCode: text('family_code').notNull(),
    version: integer('version').notNull().default(1),
    name: text('name').notNull(),
    description: text('description'),
    mode: text('mode', { enum: ACADEMIC_MODES }),
    /** Planned class length in minutes; null = not decided (never assume). */
    classMinutes: integer('class_minutes'),
    classMinutesStatus: text('class_minutes_status', { enum: ACADEMIC_LABEL_STATUSES })
      .notNull()
      .default('unknown'),
    status: text('status', { enum: ['draft', 'active', 'paused', 'archived'] })
      .notNull()
      .default('draft'),
    /** Provenance, e.g. `data/legacy/academic/class12-plan.json`. */
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('courses_code_key').on(t.code),
    uniqueIndex('courses_family_version_key').on(t.familyCode, t.version),
    index('courses_programme_idx').on(t.programmeId),
    check('courses_version_positive', sql`${t.version} >= 1`),
    check(
      'courses_class_minutes_range',
      sql`${t.classMinutes} IS NULL OR (${t.classMinutes} BETWEEN 15 AND 300)`,
    ),
    check('courses_mode_check', sql`${t.mode} IS NULL OR ${t.mode} IN (${inList(ACADEMIC_MODES)})`),
    check(
      'courses_class_minutes_status_check',
      sql`${t.classMinutesStatus} IN (${inList(ACADEMIC_LABEL_STATUSES)})`,
    ),
    check('courses_status_check', sql`${t.status} IN ('draft', 'active', 'paused', 'archived')`),
  ],
);

export const academicSubjects = academic.table(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicSubjectId>(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => academicCourses.id, { onDelete: 'cascade' })
      .$type<CourseId>(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('subjects_course_code_key').on(t.courseId, t.code)],
);

/**
 * Chapters / units. Codes are STABLE and never renumbered (ACD-001, BR-ACD-10):
 * a retired or moved chapter stays as a row with `status` retired/moved and
 * `aliasOfChapterId` pointing at the current record.
 */
export const academicChapters = academic.table(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicChapterId>(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => academicCourses.id, { onDelete: 'cascade' })
      .$type<CourseId>(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => academicSubjects.id, { onDelete: 'cascade' })
      .$type<AcademicSubjectId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Relative importance used by catch-up prioritisation (1–10, default 1 = unweighted). */
    weight: integer('weight').notNull().default(1),
    status: text('status', { enum: ['active', 'retired', 'moved'] })
      .notNull()
      .default('active'),
    aliasOfChapterId: uuid('alias_of_chapter_id')
      .references((): AnyPgColumn => academicChapters.id, { onDelete: 'restrict' })
      .$type<AcademicChapterId>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('chapters_course_code_key').on(t.courseId, t.code),
    index('chapters_subject_idx').on(t.subjectId),
    check('chapters_status_check', sql`${t.status} IN ('active', 'retired', 'moved')`),
    check('chapters_weight_range', sql`${t.weight} BETWEEN 1 AND 10`),
    check(
      'chapters_alias_rule',
      sql`(${t.status} = 'active' AND ${t.aliasOfChapterId} IS NULL) OR ${t.status} <> 'active'`,
    ),
  ],
);

/**
 * Curriculum plan versions (ACD-004). A plan belongs to a course and optionally
 * to one batch (a batch-scoped override never alters the template). A locked
 * plan is immutable; a change is a NEW plan that `supersedes` it and becomes
 * locked/provisional only through a core approval (policy
 * `academic.curriculum_plan.status_change`). Counts and dates carry their own
 * labels: the Class 12 override has locked counts and provisional dates.
 */
export const academicCurriculumPlans = academic.table(
  'curriculum_plans',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicPlanId>(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => academicCourses.id, { onDelete: 'restrict' })
      .$type<CourseId>(),
    /** Set for a batch-scoped override (no FK cycle: validated in the service). */
    batchId: uuid('batch_id').$type<BatchId>(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: ACADEMIC_PLAN_STATUSES }).notNull().default('proposed'),
    countsStatus: text('counts_status', { enum: ACADEMIC_LABEL_STATUSES })
      .notNull()
      .default('proposed'),
    datesStatus: text('dates_status', { enum: ACADEMIC_LABEL_STATUSES })
      .notNull()
      .default('unknown'),
    supersedesPlanId: uuid('supersedes_plan_id')
      .references((): AnyPgColumn => academicCurriculumPlans.id, { onDelete: 'restrict' })
      .$type<AcademicPlanId>(),
    /** Status requested in the pending core approval (locked | provisional); null when none. */
    pendingTargetStatus: text('pending_target_status', { enum: ['locked', 'provisional'] }),
    /** Class length the plan's minutes were computed with. */
    classMinutes: integer('class_minutes'),
    scopeNote: text('scope_note'),
    changeLog: text('change_log'),
    sourceRef: text('source_ref'),
    /** Who approved the current status (null for legacy imports: see sourceRef). */
    approvedByUserId: uuid('approved_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Date recorded in the legacy source for a lock, e.g. 2026-09-10. */
    legacyApprovedOn: date('legacy_approved_on', { mode: 'string' }),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .$type<UserId>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('curriculum_plans_code_key').on(t.code),
    index('curriculum_plans_course_idx').on(t.courseId, t.status),
    index('curriculum_plans_batch_idx').on(t.batchId),
    check('curriculum_plans_status_check', sql`${t.status} IN (${inList(ACADEMIC_PLAN_STATUSES)})`),
    check(
      'curriculum_plans_label_check',
      sql`${t.countsStatus} IN (${inList(ACADEMIC_LABEL_STATUSES)}) AND ${t.datesStatus} IN (${inList(ACADEMIC_LABEL_STATUSES)})`,
    ),
    check('curriculum_plans_version_positive', sql`${t.version} >= 1`),
    check(
      'curriculum_plans_not_self_superseding',
      sql`${t.supersedesPlanId} IS NULL OR ${t.supersedesPlanId} <> ${t.id}`,
    ),
    check(
      'curriculum_plans_pending_target_check',
      sql`${t.pendingTargetStatus} IS NULL OR ${t.pendingTargetStatus} IN ('locked', 'provisional')`,
    ),
  ],
);

/** Lesson sequence of a plan: planned class counts and minutes (PLANNED, never delivered). */
export const academicPlanItems = academic.table(
  'plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<AcademicPlanItemId>(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => academicCurriculumPlans.id, { onDelete: 'cascade' })
      .$type<AcademicPlanId>(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => academicChapters.id, { onDelete: 'restrict' })
      .$type<AcademicChapterId>(),
    sequence: integer('sequence').notNull(),
    /** Legacy lesson id, e.g. `Quant-001`, or a block code. */
    lessonCode: text('lesson_code').notNull(),
    sessionType: text('session_type', { enum: ['teaching', 'practice'] }).notNull(),
    plannedClasses: integer('planned_classes').notNull().default(1),
    plannedMinutes: integer('planned_minutes').notNull(),
    /** Provisional planned date (see the plan's datesStatus); null = undated. */
    plannedDate: date('planned_date', { mode: 'string' }),
    coverage: text('coverage'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('plan_items_plan_sequence_key').on(t.planId, t.sequence),
    uniqueIndex('plan_items_plan_lesson_key').on(t.planId, t.lessonCode),
    index('plan_items_chapter_idx').on(t.chapterId),
    check('plan_items_session_type_check', sql`${t.sessionType} IN ('teaching', 'practice')`),
    check('plan_items_counts_positive', sql`${t.plannedClasses} >= 1 AND ${t.plannedMinutes} >= 1`),
  ],
);

/**
 * Concept-book indices (ACD-023): index only, content deliberately empty.
 * Question counts are PLANNED allocations (`questionCountStatus = 'planned'`),
 * never written questions.
 */
export const academicConceptBookChapters = academic.table(
  'concept_book_chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookCode: text('book_code').notNull(),
    bookTitle: text('book_title').notNull(),
    chapterCode: text('chapter_code').notNull(),
    chapterNumber: integer('chapter_number'),
    section: text('section'),
    title: text('title').notNull(),
    subtopics: text('subtopics')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status', { enum: ['active', 'retired', 'moved', 'opening_unit'] })
      .notNull()
      .default('active'),
    /** For retired/moved ids: the code that now holds the content. */
    aliasOfCode: text('alias_of_code'),
    indexStatus: text('index_status', { enum: ACADEMIC_LABEL_STATUSES })
      .notNull()
      .default('locked'),
    contentStatus: text('content_status').notNull().default('not_started'),
    plannedConceptQuestions: integer('planned_concept_questions'),
    plannedPracticeQuestions: integer('planned_practice_questions'),
    plannedRankerQuestions: integer('planned_ranker_questions'),
    /** Always `planned` when counts are present; null counts = not decided (OD-024). */
    questionCountStatus: text('question_count_status'),
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('concept_book_chapters_code_key').on(t.chapterCode),
    index('concept_book_chapters_book_idx').on(t.bookCode),
    check(
      'concept_book_chapters_status_check',
      sql`${t.status} IN ('active', 'retired', 'moved', 'opening_unit')`,
    ),
    check(
      'concept_book_chapters_count_label',
      sql`${t.questionCountStatus} IS NULL OR ${t.questionCountStatus} = 'planned'`,
    ),
    check(
      'concept_book_chapters_index_status_check',
      sql`${t.indexStatus} IN (${inList(ACADEMIC_LABEL_STATUSES)})`,
    ),
  ],
);
