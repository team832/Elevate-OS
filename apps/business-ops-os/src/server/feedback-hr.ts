/** HR Overview counts for student feedback about teachers (PLAN fixed interface `hrFeedbackCounts`). */
import { and, count, eq, ne, type AnyColumn } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsStudentTeacherFeedback as feedback,
  opsTeacherDevelopmentActions as actions,
  opsTeacherFeedbackSummaries as summaries,
  type Database,
} from '@elevate/database';
import { istToday } from '../domain/dates';
import { staffIdForUser, type Actor } from './context';
import { feedbackScope } from './feedback-access';
import { pastDue } from './feedback-summaries';

const HREF = '/ops/hr/feedback';

/**
 * `{ key, label, value, href }` per count; nothing without ops:teacher_feedback:read, 403 for HR
 * staff who teach (round 7). Work about the reader is never counted for them.
 */
export async function hrFeedbackCounts(db: Database, user: Actor, now = new Date()) {
  if (!can(user, 'ops:teacher_feedback:read')) return [];
  await feedbackScope(db, user, 'ops:teacher_feedback:read');
  const me = await staffIdForUser(db, user.id);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const notMe = (col: AnyColumn) => (me ? ne(col, me) : undefined);
  const [pending, drafts, overdue] = await Promise.all([
    n(
      db
        .select({ n: count() })
        .from(feedback)
        .where(and(eq(feedback.moderationStatus, 'pending'), notMe(feedback.teacherStaffId))),
    ),
    n(
      db
        .select({ n: count() })
        .from(summaries)
        .where(and(eq(summaries.status, 'draft'), notMe(summaries.teacherStaffId))),
    ),
    n(
      db
        .select({ n: count() })
        .from(actions)
        .where(and(pastDue(istToday(now)), notMe(actions.teacherStaffId))),
    ),
  ]);
  return [
    {
      key: 'feedback_pending',
      label: 'Feedback awaiting moderation',
      value: pending,
      href: `${HREF}?tab=responses&moderation=pending`,
    },
    {
      key: 'summaries_draft',
      label: 'Feedback summaries in draft',
      value: drafts,
      href: `${HREF}?tab=summaries&status=draft`,
    },
    {
      key: 'actions_past_due',
      label: 'Development actions past due',
      value: overdue,
      href: `${HREF}?tab=actions&due=past`,
    },
  ];
}
