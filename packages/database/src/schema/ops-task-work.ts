/**
 * OWNER: Business Ops OS — what hangs off a staff task (owner brief 23 Oct 2026 §8–§11): the
 * checklist, submission versions, review decisions and permitted collaborators. Submission is
 * not approval: a review row records the decision on one submission. Rows are deleted only with
 * their (sample) task. Part of the `ops` Postgres schema, split across ops*.ts; same rules as
 * ops.ts.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Brand } from '@elevate/shared-types';
import { createdAt, filled, inList, instant, ops, staffRefRestrict, userRef } from './ops-columns';
import { opsStaffTasks, type OpsStaffTaskId } from './ops-tasks';

export type OpsTaskSubmissionId = Brand<string, 'OpsTaskSubmissionId'>;

export const OPS_TASK_REVIEW_DECISIONS = ['approved', 'changes_requested', 'comment'] as const;

const taskRef = () =>
  uuid('task_id')
    .notNull()
    .references(() => opsStaffTasks.id, { onDelete: 'cascade' })
    .$type<OpsStaffTaskId>();

export const opsTaskChecklistItems = ops.table(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: taskRef(),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    doneAt: instant('done_at'),
    doneBy: userRef('done_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('task_checklist_items_task_idx').on(t.taskId, t.position),
    check('task_checklist_items_text_check', filled(t.text)),
    check('task_checklist_items_position_check', sql`${t.position} >= 0`),
    check('task_checklist_items_done_check', sql`(${t.doneAt} IS NULL) = (${t.doneBy} IS NULL)`),
  ],
);

/** One submission for review; a resubmission is the next version. Never edited. */
export const opsTaskSubmissions = ops.table(
  'task_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<OpsTaskSubmissionId>(),
    taskId: taskRef(),
    version: integer('version').notNull(),
    completionNote: text('completion_note').notNull(),
    /** Text evidence (links, references); files are attachments (owner_kind task_submission). */
    evidence: text('evidence'),
    submittedByUserId: userRef('submitted_by_user_id').notNull(),
    submittedAt: instant('submitted_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('task_submissions_task_version_key').on(t.taskId, t.version),
    check('task_submissions_version_check', sql`${t.version} >= 1`),
    check('task_submissions_note_check', filled(t.completionNote)),
  ],
);

/** A reviewer's decision or comment. At most one decision per submission; changes need a reason. */
export const opsTaskReviews = ops.table(
  'task_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: taskRef(),
    submissionId: uuid('submission_id')
      .references(() => opsTaskSubmissions.id, { onDelete: 'cascade' })
      .$type<OpsTaskSubmissionId>(),
    decision: text('decision', { enum: OPS_TASK_REVIEW_DECISIONS }).notNull(),
    note: text('note'),
    reviewerUserId: userRef('reviewer_user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('task_reviews_task_idx').on(t.taskId, t.createdAt),
    uniqueIndex('task_reviews_one_decision_key')
      .on(t.submissionId)
      .where(sql`${t.decision} <> 'comment'`),
    check(
      'task_reviews_decision_check',
      sql`${t.decision} IN ${inList(OPS_TASK_REVIEW_DECISIONS)}`,
    ),
    check(
      'task_reviews_submission_check',
      sql`${t.decision} = 'comment' OR ${t.submissionId} IS NOT NULL`,
    ),
    check('task_reviews_note_check', sql`${t.decision} = 'approved' OR ${filled(t.note)}`),
  ],
);

/** People allowed to see and comment on a task with visibility `collaborators`. */
export const opsTaskCollaborators = ops.table(
  'task_collaborators',
  {
    taskId: taskRef(),
    staffId: staffRefRestrict('staff_id').notNull(),
    addedBy: userRef('added_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_collaborators_pkey', columns: [t.taskId, t.staffId] }),
    index('task_collaborators_staff_idx').on(t.staffId),
  ],
);
