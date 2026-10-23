/**
 * Student/guardian feedback about teachers, the raw rows (brief 23 Oct 2026 §15, ruling R8).
 * HR-only: read with ops:teacher_feedback:read, record and moderate with
 * ops:teacher_feedback:manage. A row is never edited after entry except its moderation state;
 * a correction is a new row and the old one is hidden. The teacher it is about never moderates it.
 */
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsStudentTeacherFeedback as feedback,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ForbiddenError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import type { z } from 'zod';
import { canModerate, type ModerationAction, type ModerationStatus } from '../domain/feedback';
import type { moderationBody } from './appointments-schemas';
import { notFound, staffIdForUser, type Actor } from './context';
import { feedbackScope, isConflicted, notAboutViewer } from './feedback-access';
import type { FeedbackEntryInput, ResponsesFilter } from './feedback-schemas';
import {
  feedbackPolicy,
  matchBatch,
  studentsByAdmissionNumber,
  teacherBatches,
} from './feedback-refs';
import { fieldError, opsAudit, rowById } from './ops-common';

const audit = opsAudit('student_teacher_feedback');

/** Moderation (or hiding by a correction) of one row, or the refusal to throw. */
function moderation(
  status: ModerationStatus,
  action: ModerationAction,
  me: string | null,
  teacher: string,
) {
  const check = canModerate(status, action, { staffId: me }, teacher);
  if (check.ok) return check.to;
  throw check.reason === 'own_feedback'
    ? new ForbiddenError('Feedback about you must be handled by someone else.')
    : new InvalidStateTransitionError(`Feedback that is ${status} cannot be changed that way.`);
}
export const RESPONSES_PAGE = 25;

/** Rating and category values against the scale and categories in force. */
function checkRatings(
  input: FeedbackEntryInput,
  policy: Awaited<ReturnType<typeof feedbackPolicy>>,
) {
  const codes = new Set(policy.categories.map((c) => c.code));
  if (input.rating && input.rating > policy.scaleMax)
    throw fieldError('rating', `Ratings go from 1 to ${policy.scaleMax}.`);
  for (const [code, v] of Object.entries(input.categoryRatings ?? {})) {
    if (!codes.has(code)) throw fieldError(`categoryRatings.${code}`, 'Not a feedback category.');
    if (v > policy.scaleMax)
      throw fieldError(`categoryRatings.${code}`, `Ratings go from 1 to ${policy.scaleMax}.`);
  }
}

export async function recordStudentTeacherFeedback(
  db: Database,
  actor: Actor,
  input: FeedbackEntryInput,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  const teacher = await rowById(db, staffMembers, input.teacherStaffId, 'Teacher');
  const me = await staffIdForUser(db, actor.id);
  if (teacher.id === me)
    throw new ForbiddenError('Feedback about you must be recorded by someone else.');
  if (input.studentId) await rowById(db, students, input.studentId, 'Student');
  const studentId =
    input.studentId ??
    (input.admissionNumber
      ? (await studentsByAdmissionNumber(db, [input.admissionNumber])).get(input.admissionNumber)
      : null);
  if (input.admissionNumber && !studentId)
    throw fieldError('admissionNumber', 'No student has this admission number.');
  const policy = await feedbackPolicy(db);
  checkRatings(input, policy);
  let batch = null;
  if (input.batch) {
    const [code = '', subject] = input.batch.split('|');
    const match = matchBatch(
      (await teacherBatches([teacher.id])).get(teacher.id),
      code,
      subject ?? null,
    );
    if (!match.ok) throw fieldError('batch', match.message);
    batch = match;
  }
  const { batch: _b, admissionNumber: _a, correctsId, categoryRatings, ...rest } = input;
  return withTransaction(db, async (tx) => {
    const old = correctsId ? await rowById(tx, feedback, correctsId, 'Feedback', true) : null;
    if (old && old.teacherStaffId !== teacher.id)
      throw fieldError('correctsId', 'A correction must be about the same teacher.');
    // The corrected row is hidden under the same rules as by hand; one already hidden or
    // rejected stays as it is.
    const hide = old !== null && !['hidden', 'rejected'].includes(old.moderationStatus);
    if (old && hide) moderation(old.moderationStatus, 'hide', me, old.teacherStaffId);
    const [row] = await tx
      .insert(feedback)
      .values({
        ...rest,
        teacherStaffId: teacher.id,
        studentId: (studentId ?? null) as StudentIdentityId | null,
        categoryRatings:
          categoryRatings && Object.keys(categoryRatings).length ? categoryRatings : null,
        ratingScaleMax: policy.scaleMax,
        courseLabel: batch?.batchCode ?? null,
        subjectRef: batch?.subjectName ?? input.subjectRef ?? null,
        batchId: batch?.batchId ?? null,
        subjectId: batch?.subjectId ?? null,
        recordedBy: actor.id,
      })
      .returning();
    await audit(tx, actor, row!.id, 'feedback.student_teacher.recorded', { after: row }, requestId);
    if (old && hide) {
      const [hidden] = await tx
        .update(feedback)
        .set({
          moderationStatus: 'hidden',
          moderationNote: `Replaced by a corrected entry (${row!.id}).`,
          moderatedBy: actor.id,
          moderatedAt: new Date(),
        })
        .where(eq(feedback.id, old.id))
        .returning();
      await audit(
        tx,
        actor,
        old.id,
        'feedback.student_teacher.corrected',
        {
          before: old,
          after: hidden,
          metadata: { correctedBy: row!.id },
        },
        requestId,
      );
    }
    return row!;
  });
}

export async function moderateStudentTeacherFeedback(
  db: Database,
  actor: Actor,
  id: string,
  input: z.output<typeof moderationBody>,
  requestId?: string,
) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:manage');
  const me = await staffIdForUser(db, actor.id);
  return withTransaction(db, async (tx) => {
    const row = await rowById(tx, feedback, id, 'Feedback', true);
    const to = moderation(row.moderationStatus, input.action, me, row.teacherStaffId);
    const now = new Date();
    const [after] = await tx
      .update(feedback)
      .set({
        moderationStatus: to,
        moderationNote: input.note ?? row.moderationNote,
        visibility: input.visibility ?? row.visibility,
        moderatedBy: actor.id,
        moderatedAt: now,
        reviewedAt: row.reviewedAt ?? now,
        reviewedByUserId: row.reviewedByUserId ?? actor.id,
      })
      .where(eq(feedback.id, row.id))
      .returning();
    await audit(
      tx,
      actor,
      row.id,
      `feedback.student_teacher.${input.action}`,
      { before: row, after },
      requestId,
    );
    return after;
  });
}

/**
 * All feedback about one teacher for HR (teacher profile): every state for those who manage it,
 * approved rows otherwise. null without ops:teacher_feedback:read, for a reader who teaches
 * (round 7), and for feedback about the reader (nobody reads raw feedback about themselves). The summary averages approved rated rows
 * and states the denominator.
 */
export async function listFeedbackAboutTeacher(db: Database, actor: Actor, teacherStaffId: string) {
  if (!can(actor, 'ops:teacher_feedback:read') || (await isConflicted(db, actor))) return null;
  const me = await staffIdForUser(db, actor.id);
  if (me === teacherStaffId) return null;
  const rows = await db
    .select()
    .from(feedback)
    .where(
      and(
        eq(feedback.teacherStaffId, teacherStaffId as StaffMemberId),
        notAboutViewer(me),
        can(actor, 'ops:teacher_feedback:manage')
          ? undefined
          : eq(feedback.moderationStatus, 'approved'),
      ),
    )
    .orderBy(feedback.moderationStatus, desc(feedback.feedbackOn));
  const rated = rows.filter((r) => r.moderationStatus === 'approved' && r.rating !== null);
  return {
    rows,
    summary: {
      approved: rows.filter((r) => r.moderationStatus === 'approved').length,
      rated: rated.length,
      averageRating: rated.length ? rated.reduce((s, r) => s + r.rating!, 0) / rated.length : null,
    },
  };
}

/** HR Responses tab: filtered, newest first, one page. */
export async function listResponses(db: Database, actor: Actor, f: ResponsesFilter) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const me = await staffIdForUser(db, actor.id);
  const where = and(
    ...([
      notAboutViewer(me),
      f.teacher && eq(feedback.teacherStaffId, f.teacher as StaffMemberId),
      f.batch && sql`upper(${feedback.courseLabel}) = upper(${f.batch})`,
      f.from && gte(sql`coalesce(${feedback.periodEnd}, ${feedback.feedbackOn})`, f.from),
      f.to && lte(sql`coalesce(${feedback.periodStart}, ${feedback.feedbackOn})`, f.to),
      f.method && eq(feedback.collectionMethod, f.method),
      f.moderation && eq(feedback.moderationStatus, f.moderation),
    ].filter(Boolean) as SQL[]),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ f: feedback, teacherName: staffMembers.fullName, studentName: students.fullName })
      .from(feedback)
      .innerJoin(staffMembers, eq(staffMembers.id, feedback.teacherStaffId))
      .leftJoin(students, eq(students.id, feedback.studentId))
      .where(where)
      .orderBy(desc(feedback.createdAt))
      .limit(RESPONSES_PAGE)
      .offset((f.page - 1) * RESPONSES_PAGE),
    db.select({ n: count() }).from(feedback).where(where),
  ]);
  return {
    rows: rows.map(({ f: r, ...names }) => ({ ...r, ...names })),
    total: total?.n ?? 0,
    page: f.page,
    pageSize: RESPONSES_PAGE,
  };
}
export type ResponseRow = Awaited<ReturnType<typeof listResponses>>['rows'][number];

/** One row with the teacher's and student's names (HR record view). */
export async function responseDetail(db: Database, actor: Actor, id: string) {
  await feedbackScope(db, actor, 'ops:teacher_feedback:read');
  const [row] = await db
    .select({ f: feedback, teacherName: staffMembers.fullName, studentName: students.fullName })
    .from(feedback)
    .innerJoin(staffMembers, eq(staffMembers.id, feedback.teacherStaffId))
    .leftJoin(students, eq(students.id, feedback.studentId))
    .where(and(eq(feedback.id, id as never), notAboutViewer(await staffIdForUser(db, actor.id))));
  if (!row) return notFound('Feedback');
  return { ...row.f, teacherName: row.teacherName, studentName: row.studentName };
}
