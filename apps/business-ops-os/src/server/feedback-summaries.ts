/**
 * HR summaries of student feedback per teacher and period, and agreed development actions
 * (brief 23 Oct 2026 §15). A summary counts the APPROVED feedback rows in its period; HR writes
 * strengths and areas to improve beside the original comments (kept unchanged in their own
 * table) and approves it, after which the teacher sees it (feedback-teacher.ts). Nobody approves
 * a summary about themselves.
 */
import { and, asc, count, desc, eq, gte, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import {
  isUniqueViolation,
  opsStudentTeacherFeedback as feedback,
  opsTeacherDevelopmentActions as actions,
  opsTeacherFeedbackSummaries as summaries,
  staffMembers,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
} from '@elevate/shared-contracts';
import type { StaffMemberId } from '@elevate/shared-types';
import type { z } from 'zod';
import { categoryMeans, teacherFacing } from '../domain/feedback';
import { istToday } from '../domain/dates';
import { notFound, staffIdForUser, userIdsForStaff, type Actor } from './context';
import { feedbackScope, notAboutViewer } from './feedback-access';
import type {
  actionBody,
  actionPatchBody,
  summaryBody,
  summaryPatchBody,
} from './feedback-schemas';
import { feedbackPolicy } from './feedback-refs';
import { defined, fieldError, notifyOthers, opsAudit, rowById } from './ops-common';

const auditSummary = opsAudit('teacher_feedback_summary');
const auditAction = opsAudit('teacher_development_action');
const PAGE = 25;

/**
 * Approved rows of a teacher whose period (or date given, when no period) lies in the window;
 * with `viewer`, none that may be about that reader (raw reads).
 */
export const responsesIn = (
  db: Database,
  teacherStaffId: string,
  from: string,
  to: string,
  viewer?: string | null,
) =>
  db
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.teacherStaffId, teacherStaffId as StaffMemberId),
        eq(feedback.moderationStatus, 'approved'),
        gte(sql`coalesce(${feedback.periodStart}, ${feedback.feedbackOn})`, from),
        lte(sql`coalesce(${feedback.periodEnd}, ${feedback.feedbackOn})`, to),
        notAboutViewer(viewer ?? null),
      ),
    )
    .orderBy(asc(feedback.feedbackOn));

async function figures(db: Database, teacherStaffId: string, from: string, to: string) {
  const [rows, policy] = await Promise.all([
    responsesIn(db, teacherStaffId, from, to),
    feedbackPolicy(db),
  ]);
  return {
    responseCount: rows.length,
    ratingScaleMax: policy.scaleMax,
    categoryMeans: categoryMeans(rows, policy.scaleMax).means,
  };
}

/** Nobody prepares, approves or changes a summary about themselves (it carries their raw figures). */
async function notAboutMe(db: Database, actor: Actor, teacherStaffId: string, approve = false) {
  if (teacherStaffId === (await staffIdForUser(db, actor.id)))
    throw new ForbiddenError(
      approve
        ? 'A summary about you must be approved by someone else.'
        : 'Another HR person must prepare this.',
    );
}

const population = (eligible: number | null | undefined, responses: number) => {
  if (typeof eligible === 'number' && eligible < responses)
    throw fieldError('eligiblePopulation', `At least the ${responses} students who answered.`);
};

export async function createSummary(
  db: Database,
  actor: Actor,
  input: z.output<typeof summaryBody>,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  const teacher = await rowById(db, staffMembers, input.teacherStaffId, 'Teacher');
  await notAboutMe(db, actor, teacher.id);
  const f = await figures(db, teacher.id, input.periodStart, input.periodEnd);
  population(input.eligiblePopulation, f.responseCount);
  try {
    return await withTransaction(db, async (tx) => {
      // Overlapping periods would let one summary be subtracted from another (M7).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`feedback_summary:${teacher.id}`}))`,
      );
      const [overlap] = await tx
        .select({ id: summaries.id })
        .from(summaries)
        .where(
          and(
            eq(summaries.teacherStaffId, teacher.id),
            ne(summaries.status, 'withdrawn'),
            lte(summaries.periodStart, input.periodEnd),
            gte(summaries.periodEnd, input.periodStart),
          ),
        )
        .limit(1);
      if (overlap)
        throw new ConflictError(
          'This teacher already has a summary covering part of that period. Open it, or withdraw it first.',
        );
      const [row] = await tx
        .insert(summaries)
        .values({ ...input, ...f, teacherStaffId: teacher.id, createdBy: actor.id })
        .returning();
      await auditSummary(tx, actor, row!.id, 'feedback_summary.created', { after: row }, requestId);
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError(
        'This teacher already has a summary for that period. Open it instead.',
      );
    throw e;
  }
}

/** Edit a draft (figures are counted again), approve it, or withdraw it. */
export async function updateSummary(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof summaryPatchBody>,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  const current = await rowById(db, summaries, id, 'Summary');
  // Counted again on edit and on approval, so rows hidden after drafting are left out (I1).
  const f =
    input.action === 'withdraw'
      ? null
      : await figures(db, current.teacherStaffId, current.periodStart, current.periodEnd);
  const { teacherVisibility } = await feedbackPolicy(db);
  await notAboutMe(db, actor, current.teacherStaffId, input.action === 'approve');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, summaries, id, 'Summary', true);
    const allowed =
      input.action === 'withdraw' ? before.status !== 'withdrawn' : before.status === 'draft';
    if (!allowed)
      throw new InvalidStateTransitionError(
        `A ${before.status} summary cannot be changed that way.`,
      );
    const { action } = input;
    const texts =
      input.action === 'edit'
        ? (({ action: _, ...t }) => t)(input)
        : { eligiblePopulation: undefined };
    if (f) population(texts.eligiblePopulation ?? before.eligiblePopulation, f.responseCount);
    const set =
      action === 'edit'
        ? { ...defined(texts), ...f }
        : action === 'approve'
          ? { ...f, status: 'approved' as const, approvedBy: actor.id, approvedAt: new Date() }
          : { status: 'withdrawn' as const };
    const [after] = await tx
      .update(summaries)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(summaries.id, before.id))
      .returning();
    await auditSummary(tx, actor, id, `feedback_summary.${action}`, { before, after }, requestId);
    if (action === 'approve' && teacherVisibility !== 'nothing')
      await notifyOthers(tx, actor, await userIdsForStaff(tx, [before.teacherStaffId]), {
        kind: 'feedback_summary.approved',
        title: 'Your feedback summary is ready',
        body: `Student feedback for ${before.periodStart} to ${before.periodEnd}, with agreed follow-ups.`,
        link: '/academic/my-feedback',
        entityType: 'teacher_feedback_summary',
        entityId: before.id,
      });
    return after!;
  });
}

export async function listSummaries(
  db: Database,
  actor: Actor,
  filter: { status?: string; page: number },
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const me = await staffIdForUser(db, actor.id);
  const where = and(
    filter.status ? eq(summaries.status, filter.status as never) : undefined,
    me ? ne(summaries.teacherStaffId, me) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ s: summaries, teacherName: staffMembers.fullName })
      .from(summaries)
      .innerJoin(staffMembers, eq(staffMembers.id, summaries.teacherStaffId))
      .where(where)
      .orderBy(desc(summaries.periodEnd), asc(staffMembers.fullName))
      .limit(PAGE)
      .offset((filter.page - 1) * PAGE),
    db.select({ n: count() }).from(summaries).where(where),
  ]);
  return {
    rows: rows.map(({ s, teacherName }) => ({ ...s, teacherName })),
    total: total?.n ?? 0,
    page: filter.page,
    pageSize: PAGE,
  };
}

/** HR view of one summary: the original comments beside it, its actions, the teacher's preview. */
export async function summaryDetail(db: Database, actor: Actor, id: string) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const s = await rowById(db, summaries, id, 'Summary');
  // Its originals are raw feedback: never shown to the person it is about (M2).
  const me = await staffIdForUser(db, actor.id);
  if (s.teacherStaffId === me) notFound('Summary');
  const [teacher, originals, acts, policy] = await Promise.all([
    rowById(db, staffMembers, s.teacherStaffId, 'Teacher'),
    responsesIn(db, s.teacherStaffId, s.periodStart, s.periodEnd, me),
    db.select().from(actions).where(eq(actions.summaryId, s.id)).orderBy(asc(actions.createdAt)),
    feedbackPolicy(db),
  ]);
  return {
    ...s,
    teacherName: teacher.fullName,
    originals: originals.map((o) => ({
      id: o.id,
      feedbackOn: o.feedbackOn,
      rating: o.rating,
      ratingScaleMax: o.ratingScaleMax,
      comment: o.comment,
    })),
    actions: acts,
    preview: teacherFacing(s, {
      minGroupSize: policy.minGroupSize,
      showComments: policy.teacherVisibility === 'approved_summaries_and_comments',
    }),
    teacherVisibility: policy.teacherVisibility,
  };
}

export async function createAction(
  db: Database,
  actor: Actor,
  input: z.output<typeof actionBody>,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  const teacher = await rowById(db, staffMembers, input.teacherStaffId, 'Teacher');
  await notAboutMe(db, actor, teacher.id);
  if (input.summaryId) {
    const s = await rowById(db, summaries, input.summaryId, 'Summary');
    if (s.teacherStaffId !== teacher.id)
      throw fieldError('summaryId', 'That summary is about another teacher.');
  }
  if (input.ownerStaffId) await rowById(db, staffMembers, input.ownerStaffId, 'Owner');
  const { agreed, ...rest } = input;
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(actions)
      .values({
        ...rest,
        agreedAt: agreed ? new Date() : null,
        createdBy: actor.id,
      } as typeof actions.$inferInsert)
      .returning();
    await auditAction(tx, actor, row!.id, 'development_action.created', { after: row }, requestId);
    return row!;
  });
}

export async function updateAction(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof actionPatchBody>,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  return withTransaction(db, async (tx) => {
    const before = await rowById(tx, actions, id, 'Development action', true);
    await notAboutMe(tx, actor, before.teacherStaffId);
    const [after] = await tx
      .update(actions)
      .set({
        ...defined({ status: input.status }),
        ...(input.agreed === undefined
          ? {}
          : { agreedAt: input.agreed ? (before.agreedAt ?? new Date()) : null }),
        updatedAt: new Date(),
      })
      .where(eq(actions.id, before.id))
      .returning();
    await auditAction(tx, actor, id, 'development_action.updated', { before, after }, requestId);
    return after!;
  });
}

/** Open actions due before today count as past due. */
export const pastDue = (today: string) => and(eq(actions.status, 'open'), lt(actions.dueOn, today));

export async function listActions(
  db: Database,
  actor: Actor,
  filter: { status?: string; due?: string; page: number },
  now = new Date(),
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const me = await staffIdForUser(db, actor.id);
  const where = and(
    ...([
      me && ne(actions.teacherStaffId, me),
      filter.status && eq(actions.status, filter.status as never),
      filter.due === 'past' && pastDue(istToday(now)),
    ].filter(Boolean) as SQL[]),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ a: actions, teacherName: staffMembers.fullName, summaryStatus: summaries.status })
      .from(actions)
      .innerJoin(staffMembers, eq(staffMembers.id, actions.teacherStaffId))
      .leftJoin(summaries, eq(summaries.id, actions.summaryId))
      .where(where)
      .orderBy(asc(actions.status), sql`${actions.dueOn} NULLS LAST`)
      .limit(PAGE)
      .offset((filter.page - 1) * PAGE),
    db.select({ n: count() }).from(actions).where(where),
  ]);
  return {
    rows: rows.map(({ a, ...x }) => ({ ...a, ...x })),
    total: total?.n ?? 0,
    page: filter.page,
    pageSize: PAGE,
  };
}
