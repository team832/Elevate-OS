/**
 * What a teacher sees of student feedback about them (brief 23 Oct 2026 §15, ruling R8):
 * their own APPROVED summaries (through `teacherFacing`, which hides figures and comments below
 * the minimum group size) and the development actions agreed with them. This file reads only the
 * summary and action tables — never raw feedback rows, student ids or names, imports or files.
 * Always the signed-in person's own staff record, whatever the scope of the grant.
 */
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import {
  opsTeacherDevelopmentActions as actions,
  opsTeacherFeedbackSummaries as summaries,
  staffMembers,
  type Database,
} from '@elevate/database';
import { teacherFacing } from '../domain/feedback';
import { accessScope, notFound, staffIdForUser, type Actor } from './context';
import { feedbackPolicy } from './feedback-refs';

/** Actions a teacher sees: those with an approved summary or none (needs the summaries join). */
export const sharedWithTeacher = or(isNull(actions.summaryId), eq(summaries.status, 'approved'));

async function mine(db: Database, actor: Actor) {
  await accessScope(db, actor, 'ops:teacher_feedback_summaries:read');
  const [staffId, policy] = await Promise.all([staffIdForUser(db, actor.id), feedbackPolicy(db)]);
  const show = (s: typeof summaries.$inferSelect) =>
    teacherFacing(s, {
      minGroupSize: policy.minGroupSize,
      showComments: policy.teacherVisibility === 'approved_summaries_and_comments',
    });
  // 'nothing' (setting feedback.teacher_visibility) or no staff record: nothing to show.
  return { staffId: policy.teacherVisibility === 'nothing' ? null : staffId, policy, show };
}

const agreedActions = (db: Database, staffId: string, summaryId?: string) =>
  db
    .select({
      id: actions.id,
      summaryId: actions.summaryId,
      action: actions.action,
      dueOn: actions.dueOn,
      status: actions.status,
      agreedAt: actions.agreedAt,
      ownerName: staffMembers.fullName,
    })
    .from(actions)
    .leftJoin(summaries, eq(summaries.id, actions.summaryId))
    .leftJoin(staffMembers, eq(staffMembers.id, actions.ownerStaffId))
    .where(
      and(
        eq(actions.teacherStaffId, staffId as never),
        summaryId ? eq(actions.summaryId, summaryId as never) : sharedWithTeacher,
      ),
    )
    .orderBy(asc(actions.status), asc(actions.dueOn));

/** GET <base>/api/v1/feedback/mine — the teacher's approved summaries and agreed actions. */
export async function myFeedback(db: Database, actor: Actor) {
  const { staffId, policy, show } = await mine(db, actor);
  const base = {
    visibility: policy.teacherVisibility,
    minGroupSize: policy.minGroupSize,
    categories: policy.categories,
  };
  if (!staffId) return { ...base, summaries: [], actions: [] };
  const [rows, acts] = await Promise.all([
    db
      .select()
      .from(summaries)
      .where(and(eq(summaries.teacherStaffId, staffId), eq(summaries.status, 'approved')))
      .orderBy(desc(summaries.periodEnd)),
    agreedActions(db, staffId),
  ]);
  return { ...base, summaries: rows.map(show), actions: acts };
}

/** One approved summary of the signed-in teacher; anything else is 404. */
export async function mySummary(db: Database, actor: Actor, id: string) {
  const { staffId, show } = await mine(db, actor);
  const [row] = staffId
    ? await db
        .select()
        .from(summaries)
        .where(
          and(
            eq(summaries.id, id as never),
            eq(summaries.teacherStaffId, staffId),
            eq(summaries.status, 'approved'),
          ),
        )
    : [];
  if (!row) notFound('Summary');
  return { ...show(row), actions: await agreedActions(db, staffId!, row.id) };
}
