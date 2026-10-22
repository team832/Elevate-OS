/**
 * Teacher reviews of students (owner answer 1, 21 Oct 2026 — supersedes D-043; brief §13).
 *
 * - Versioned: every version shares `review_key`; a submitted version is never edited. "Revise"
 *   opens a draft version + 1 that supersedes it; submitting checks that nothing newer was
 *   submitted meanwhile (a stale version never overwrites a newer one).
 * - Drafts are visible only to their author. Withdrawing marks every submitted version
 *   withdrawn, so the review disappears from Business Ops on its next read.
 * - Writing: only a student CURRENTLY in the author's scope — an open placement in a batch
 *   with an active assignment of theirs today, or a demo attendee of a session they taught or
 *   substituted. Coordinators (students:read all) may review any student.
 * - Reading follows current scope: authors always read their own; teachers read submitted
 *   reviews of students in their current scope; academic:reviews:read `all` reads all.
 * - No ratings, scores or labels: structured evidence fields only. No submitted review =
 *   "pending", never negative.
 */
import { and, desc, eq, gte, inArray, lte, max, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { scopeFor } from '@elevate/authorization';
import {
  academicBatches,
  academicBatchPlacements,
  academicClassSessions,
  academicEnrolments,
  academicSessionDemoAttendees,
  academicStudents,
  academicSubjects,
  academicTeacherAssignments,
  academicTeacherReviews,
  staffMembers,
  students as coreStudents,
  type AcademicReviewId,
  type AcademicReviewKey,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { academicStudentReviewsV1Schema, ConflictError, ForbiddenError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { StaffMemberId, StudentId, StudentIdentityId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assignmentActiveOn, audit, resolveScope, staffIdForUser, todayIst, type Actor } from '../context';
import { MODULE_PATHS } from '../paths';
import { taughtBy } from './session-guards';
import type { createReviewBody, internalReviewsQuery, reviewsQuery, updateReviewBody } from '../schemas-teaching';

type Review = typeof academicTeacherReviews.$inferSelect;
type Content = Omit<z.output<typeof updateReviewBody>, 'updatedAt'>;

const TEXT_FIELDS = ['strengths', 'areasForSupport', 'attendanceEvidence', 'homeworkEvidence', 'academicConcerns', 'suggestedAction'] as const;

/** `col` is unbounded (null) or satisfies `col op value`. */
const openEnded = (col: unknown, op: '<=' | '>=', value: string) => sql`(${col} IS NULL OR ${col} ${sql.raw(op)} ${value})`;

/**
 * Academic students the staff member may review TODAY (open placement × assignment active today).
 * Not context.studentIdsInScope: that one keeps students of ended assignment windows (read history).
 */
async function placedStudentIds(db: Database, staffId: StaffMemberId, today: string): Promise<StudentId[]> {
  const rows = await db
    .selectDistinct({ id: academicEnrolments.studentId })
    .from(academicBatchPlacements)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
    .innerJoin(academicTeacherAssignments, eq(academicTeacherAssignments.batchId, academicBatchPlacements.batchId))
    .where(
      and(
        eq(academicTeacherAssignments.staffMemberId, staffId),
        assignmentActiveOn(today),
        lte(academicBatchPlacements.startDate, today),
        openEnded(academicBatchPlacements.endDate, '>=', today),
      ),
    );
  return rows.map((r) => r.id);
}

const attendeeRef = { coreStudentId: academicSessionDemoAttendees.coreStudentId, opsDemoSessionId: academicSessionDemoAttendees.opsDemoSessionId, sessionId: academicSessionDemoAttendees.sessionId };

/** Demo attendees of sessions the staff member taught or was added to (e.g. as substitute). */
async function demoAttendeesOf(db: Database, staffId: StaffMemberId) {
  return db.selectDistinct(attendeeRef).from(academicSessionDemoAttendees).innerJoin(academicClassSessions, eq(academicClassSessions.id, academicSessionDemoAttendees.sessionId)).where(taughtBy(db, staffId));
}

/** Who the actor is and which students they may review / read right now. `null` sets = any student. */
async function reviewer(db: Database, actor: Actor, now: Date) {
  const staffId = await staffIdForUser(db, actor.user.id);
  if (scopeFor(actor.user, 'academic:students:read') === 'all') return { staffId, placed: null, demos: null };
  if (!staffId) return { staffId, placed: [] as StudentId[], demos: [] as Awaited<ReturnType<typeof demoAttendeesOf>> };
  return { staffId, placed: await placedStudentIds(db, staffId, todayIst(now)), demos: await demoAttendeesOf(db, staffId) };
}

type StudentRef = { academicStudentId: string | null; coreStudentId: string | null; opsDemoSessionId: string | null; sessionId: string | null; subjectId?: string | null };

/** The actor may review this student now; a named class must be one they taught; the subject must be in the student's course. */
async function assertMayReview(db: Database, actor: Actor, ref: StudentRef, now: Date) {
  const who = await reviewer(db, actor, now);
  if (!who.staffId) throw new ForbiddenError('Only a staff member can write teacher reviews.');
  let sessionId = ref.sessionId;
  if (ref.academicStudentId) {
    const [student] = await db.select({ id: academicStudents.id }).from(academicStudents).where(eq(academicStudents.id, ref.academicStudentId as StudentId));
    if (!student || (who.placed && !who.placed.includes(student.id))) throw new NotFoundError('Student not found.');
    if (sessionId) {
      const [taught] = await db.select({ id: academicClassSessions.id }).from(academicClassSessions).where(and(eq(academicClassSessions.id, sessionId as never), taughtBy(db, who.staffId)));
      if (!taught) throw new ValidationError('Link the review to a class you taught.');
    }
  } else {
    const attendees = who.demos ?? (await db.select(attendeeRef).from(academicSessionDemoAttendees).where(eq(academicSessionDemoAttendees.coreStudentId, ref.coreStudentId as StudentIdentityId)));
    const match = attendees.find((a) => a.coreStudentId === ref.coreStudentId && a.opsDemoSessionId === ref.opsDemoSessionId && (!ref.sessionId || a.sessionId === ref.sessionId));
    if (!match) throw new NotFoundError('Demo student not found on any of your classes.');
    sessionId = match.sessionId;
  }
  if (ref.subjectId) {
    const courses = ref.academicStudentId
      ? db.select({ id: academicEnrolments.courseId }).from(academicEnrolments).where(eq(academicEnrolments.studentId, ref.academicStudentId as StudentId))
      : db.select({ id: academicBatches.courseId }).from(academicClassSessions).innerJoin(academicBatches, eq(academicBatches.id, academicClassSessions.batchId)).where(eq(academicClassSessions.id, sessionId as never));
    const [fits] = await db.select({ id: academicSubjects.id }).from(academicSubjects).where(and(eq(academicSubjects.id, ref.subjectId as never), inArray(academicSubjects.courseId, courses)));
    if (!fits) throw new ValidationError('The subject is not part of the student’s course.');
  }
  return { staffId: who.staffId, sessionId };
}

function assertSubmittable(review: Pick<Review, 'reviewType' | 'periodFrom' | 'periodTo' | (typeof TEXT_FIELDS)[number]>) {
  if (!TEXT_FIELDS.some((f) => review[f]?.trim())) throw new ValidationError('Write at least one of: strengths, areas needing support, attendance or homework evidence, academic concerns, suggested action.');
  if (review.reviewType === 'periodic_progress' && (!review.periodFrom || !review.periodTo)) throw new ValidationError('A periodic progress review needs its review period (from and to).');
}

const contentOf = (input: Content) => ({
  subjectId: (input.subjectId as never) ?? null,
  periodFrom: input.periodFrom ?? null,
  periodTo: input.periodTo ?? null,
  ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, input[f] || null])),
  followUpOn: input.followUpOn ?? null,
  visibility: input.visibility,
});

/** Submitting draft `draft`: the newest non-draft version must be draft.version − 1 and still submitted. */
async function assertNotStale(tx: Database, draft: Review) {
  const [latest] = await tx
    .select({ version: academicTeacherReviews.version, status: academicTeacherReviews.status })
    .from(academicTeacherReviews)
    .where(and(eq(academicTeacherReviews.reviewKey, draft.reviewKey), ne(academicTeacherReviews.status, 'draft')))
    .orderBy(desc(academicTeacherReviews.version))
    .limit(1);
  if ((latest?.version ?? 0) !== draft.version - 1) throw new ConflictError('A newer version of this review was submitted since you opened it. Reload to see it.');
  if (latest?.status === 'withdrawn') throw new InvalidStateTransitionError('This review was withdrawn; write a new review instead.');
}

export async function createReview(db: Database, actor: Actor, input: z.output<typeof createReviewBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  if (input.coreStudentId && input.reviewType !== 'demo_session') throw new ValidationError('A review of a demo student must be a demo-session review.');
  const { staffId, sessionId } = await assertMayReview(db, actor, { academicStudentId: input.academicStudentId ?? null, coreStudentId: input.coreStudentId ?? null, opsDemoSessionId: input.opsDemoSessionId ?? null, sessionId: input.sessionId ?? null, subjectId: input.subjectId }, now);
  const values = {
    ...contentOf(input),
    reviewKey: crypto.randomUUID() as AcademicReviewKey,
    authorStaffId: staffId,
    academicStudentId: (input.academicStudentId as StudentId) ?? null,
    coreStudentId: (input.coreStudentId as StudentIdentityId) ?? null,
    opsDemoSessionId: input.opsDemoSessionId ?? null,
    sessionId: (sessionId as never) ?? null,
    reviewType: input.reviewType,
    status: input.submit ? ('submitted' as const) : ('draft' as const),
    submittedAt: input.submit ? now : null,
    createdByUserId: actor.user.id,
  };
  if (input.submit) assertSubmittable(values as never);
  return withTransaction(db, async (tx) => {
    if (sessionId) {
      const [session] = await tx.select({ subjectId: academicClassSessions.subjectId }).from(academicClassSessions).where(eq(academicClassSessions.id, sessionId as never));
      if (!session) throw new ValidationError('Session not found.');
      values.subjectId ??= session.subjectId as never;
    }
    const [row] = await tx.insert(academicTeacherReviews).values(values).returning();
    await audit(tx, actor, { action: input.submit ? 'teacher_review.submitted' : 'teacher_review.draft_saved', entityType: 'teacher_review', entityId: row!.id, after: row });
    return row!;
  });
}

/** Lock EVERY version of the review (so revise, submit and withdraw serialise), then return the author's row. */
async function lockOwn(tx: Database, actor: Actor, id: string) {
  const staffId = await staffIdForUser(tx, actor.user.id);
  const keyOf = tx.select({ key: academicTeacherReviews.reviewKey }).from(academicTeacherReviews).where(eq(academicTeacherReviews.id, id as AcademicReviewId));
  const versions = await tx.select().from(academicTeacherReviews).where(inArray(academicTeacherReviews.reviewKey, keyOf)).for('update');
  const row = versions.find((v) => v.id === id);
  if (!row || !staffId || row.authorStaffId !== staffId) throw new NotFoundError('Review not found.');
  return row;
}

/** The author edits their draft and may submit it (scope re-checked; stale versions refused). */
export async function updateReview(db: Database, actor: Actor, id: string, { updatedAt, ...input }: z.output<typeof updateReviewBody>, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  return withTransaction(db, async (tx) => {
    const draft = await lockOwn(tx, actor, id);
    if (draft.status !== 'draft') throw new InvalidStateTransitionError('A submitted review is never edited. Use "Revise" to write a new version.');
    if (new Date(updatedAt).getTime() !== draft.updatedAt.getTime()) throw new ConflictError('This draft changed since you opened it. Reload the page to see the latest text.');
    await assertMayReview(tx, actor, { ...draft, subjectId: input.subjectId }, now);
    const next = { ...draft, ...contentOf(input), subjectId: (input.subjectId as never) ?? draft.subjectId };
    if (input.submit) {
      assertSubmittable(next);
      await assertNotStale(tx, draft);
    }
    const [row] = await tx
      .update(academicTeacherReviews)
      .set({ ...contentOf(input), subjectId: next.subjectId, ...(input.submit ? { status: 'submitted' as const, submittedAt: now } : {}) })
      .where(eq(academicTeacherReviews.id, draft.id))
      .returning();
    await audit(tx, actor, { action: input.submit ? 'teacher_review.submitted' : 'teacher_review.draft_saved', entityType: 'teacher_review', entityId: draft.id, before: draft, after: row });
    return row!;
  });
}

/** Open a draft version + 1 of the author's latest submitted version (its words as the starting point). */
export async function reviseReview(db: Database, actor: Actor, id: string, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  return withTransaction(db, async (tx) => {
    const base = await lockOwn(tx, actor, id);
    if (base.status !== 'submitted') throw new InvalidStateTransitionError(`Only a submitted review can be revised (this one is ${base.status}).`);
    await assertMayReview(tx, actor, base, now);
    const [newer] = await tx.select({ status: academicTeacherReviews.status }).from(academicTeacherReviews).where(and(eq(academicTeacherReviews.reviewKey, base.reviewKey), sql`${academicTeacherReviews.version} > ${base.version}`));
    if (newer) throw new ConflictError(newer.status === 'draft' ? 'A draft revision of this review already exists; open it.' : 'A newer version exists; revise that one.');
    const { id: _id, createdAt: _c, updatedAt: _u, submittedAt: _s, ...content } = base;
    const [row] = await tx.insert(academicTeacherReviews).values({ ...content, version: base.version + 1, status: 'draft', supersedesId: base.id, createdByUserId: actor.user.id }).returning();
    await audit(tx, actor, { action: 'teacher_review.revision_started', entityType: 'teacher_review', entityId: row!.id, after: row, metadata: { supersedes: base.id } });
    return row!;
  });
}

/** Withdraw a review: every submitted version is marked withdrawn (content kept in Academic only). */
export async function withdrawReview(db: Database, actor: Actor, id: string, input: { reason: string }, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  return withTransaction(db, async (tx) => {
    const base = await lockOwn(tx, actor, id);
    if (base.status !== 'submitted') throw new InvalidStateTransitionError(`Only a submitted review can be withdrawn (this one is ${base.status}).`);
    const rows = await tx
      .update(academicTeacherReviews)
      .set({ status: 'withdrawn', withdrawnAt: now, withdrawnReason: input.reason })
      .where(and(eq(academicTeacherReviews.reviewKey, base.reviewKey), eq(academicTeacherReviews.status, 'submitted')))
      .returning();
    await audit(tx, actor, { action: 'teacher_review.withdrawn', entityType: 'teacher_review', entityId: base.id, before: base, metadata: { reason: input.reason, versions: rows.map((r) => r.version) } });
    return rows.find((r) => r.id === base.id)!;
  });
}

/**
 * Rows the actor may read. `all` scope: own (any status) + every non-draft version.
 * Own scope: own (any status) + SUBMITTED versions of students in current scope (never others' withdrawn text).
 */
async function visibility(db: Database, actor: Actor, now: Date) {
  const scope = await resolveScope(db, actor, 'academic:reviews:read');
  const who = await reviewer(db, actor, now);
  const own = who.staffId ? eq(academicTeacherReviews.authorStaffId, who.staffId) : sql`false`;
  if (scope.kind === 'all') return { scope, who, own, visible: or(own, ne(academicTeacherReviews.status, 'draft')) };
  const inScope = who.placed === null ? undefined : or(inArray(academicTeacherReviews.academicStudentId, who.placed), inArray(academicTeacherReviews.coreStudentId, who.demos.map((d) => d.coreStudentId)));
  return { scope, who, own, visible: or(own, and(eq(academicTeacherReviews.status, 'submitted'), inScope)) };
}

const author = alias(staffMembers, 'review_author');
const coreStudent = alias(coreStudents, 'core_student');

function selectReviews(db: Database) {
  return db
    .select({
      review: academicTeacherReviews,
      authorName: author.fullName,
      subjectName: academicSubjects.name,
      sessionDate: academicClassSessions.date,
      studentName: sql<string>`coalesce(${academicStudents.fullName}, ${coreStudent.fullName})`,
      studentCoreId: sql<StudentIdentityId | null>`coalesce(${academicTeacherReviews.coreStudentId}, ${academicStudents.coreStudentId})`,
    })
    .from(academicTeacherReviews)
    .innerJoin(author, eq(author.id, academicTeacherReviews.authorStaffId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, academicTeacherReviews.subjectId))
    .leftJoin(academicClassSessions, eq(academicClassSessions.id, academicTeacherReviews.sessionId))
    .leftJoin(academicStudents, eq(academicStudents.id, academicTeacherReviews.academicStudentId))
    .leftJoin(coreStudent, eq(coreStudent.id, academicTeacherReviews.coreStudentId));
}
const flat = ({ review, ...joined }: Awaited<ReturnType<ReturnType<typeof selectReviews>['where']>>[number]) => ({ ...review, ...joined });

export async function listReviews(db: Database, actor: Actor, filter: Partial<z.output<typeof reviewsQuery>> = {}, now = new Date()) {
  const { own, visible } = await visibility(db, actor, now);
  const conditions = [visible];
  if (filter.academicStudentId) conditions.push(eq(academicTeacherReviews.academicStudentId, filter.academicStudentId as StudentId));
  if (filter.coreStudentId) conditions.push(eq(academicTeacherReviews.coreStudentId, filter.coreStudentId as StudentIdentityId));
  if (filter.status) conditions.push(eq(academicTeacherReviews.status, filter.status));
  if (filter.mine) conditions.push(own);
  const rows = await selectReviews(db).where(and(...conditions)).orderBy(desc(academicTeacherReviews.updatedAt), desc(academicTeacherReviews.version)).limit(500);
  return rows.map(flat);
}

/** One review with its visible version history (newest first). */
export async function getReview(db: Database, actor: Actor, id: string, now = new Date()) {
  const { who, visible } = await visibility(db, actor, now);
  const [row] = await selectReviews(db).where(and(eq(academicTeacherReviews.id, id as AcademicReviewId), visible));
  if (!row) throw new NotFoundError('Review not found.');
  const versions = await selectReviews(db).where(and(eq(academicTeacherReviews.reviewKey, row.review.reviewKey), visible)).orderBy(desc(academicTeacherReviews.version));
  return { ...flat(row), versions: versions.map(flat), isAuthor: who.staffId === row.review.authorStaffId };
}

/** A student's reviews for the profile; `pending` = no submitted review yet (never a negative signal). */
export async function listStudentReviews(db: Database, actor: Actor, academicStudentId: string, now = new Date()) {
  const { scope, who } = await visibility(db, actor, now);
  const [student] = await db.select({ id: academicStudents.id }).from(academicStudents).where(eq(academicStudents.id, academicStudentId as StudentId));
  if (!student || (scope.kind === 'own' && who.placed && !who.placed.includes(student.id))) throw new NotFoundError('Student not found.');
  const reviews = await listReviews(db, actor, { academicStudentId }, now);
  return { reviews, pending: !reviews.some((r) => r.status === 'submitted') };
}

/**
 * AcademicStudentReviewsV1 for Business Ops (R4): submitted versions and withdrawn markers
 * (withdrawn content is NOT returned), never drafts. `superseded` = a later SUBMITTED version exists.
 */
export async function buildStudentReviewsV1(db: Database, query: z.output<typeof internalReviewsQuery>, now = new Date()) {
  const academicIds = query.coreStudentId
    ? (await db.select({ id: academicStudents.id }).from(academicStudents).where(eq(academicStudents.coreStudentId, query.coreStudentId as StudentIdentityId))).map((r) => r.id)
    : [];
  const istDate = sql`(${academicTeacherReviews.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`;
  const rows = await selectReviews(db)
    .where(
      and(
        ne(academicTeacherReviews.status, 'draft'),
        query.coreStudentId ? or(eq(academicTeacherReviews.coreStudentId, query.coreStudentId as StudentIdentityId), inArray(academicTeacherReviews.academicStudentId, academicIds)) : undefined,
        query.authorStaffId ? eq(academicTeacherReviews.authorStaffId, query.authorStaffId as StaffMemberId) : undefined,
        query.from ? gte(istDate, query.from) : undefined,
        query.to ? lte(istDate, query.to) : undefined,
      ),
    )
    .orderBy(desc(academicTeacherReviews.submittedAt), desc(academicTeacherReviews.version))
    .limit(1000);
  const keys = [...new Set(rows.map((r) => r.review.reviewKey))];
  const latest = new Map(
    keys.length
      ? (await db.select({ key: academicTeacherReviews.reviewKey, v: max(academicTeacherReviews.version) }).from(academicTeacherReviews).where(and(inArray(academicTeacherReviews.reviewKey, keys), eq(academicTeacherReviews.status, 'submitted'))).groupBy(academicTeacherReviews.reviewKey)).map((r) => [r.key, r.v])
      : [],
  );
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return academicStudentReviewsV1Schema.parse({
    contract: 'academic.student_reviews',
    version: 1,
    generatedAt: now.toISOString(),
    student: query.coreStudentId ? { coreStudentId: query.coreStudentId, academicStudentId: academicIds[0] ?? null } : null,
    reviews: rows.map(({ review: r, ...j }) => {
      const withdrawn = r.status === 'withdrawn';
      return {
        reviewKey: r.reviewKey,
        version: r.version,
        coreStudentId: j.studentCoreId,
        academicStudentId: r.academicStudentId,
        studentName: j.studentName,
        status: r.status,
        superseded: r.version < (latest.get(r.reviewKey) ?? r.version),
        authorStaffId: r.authorStaffId,
        authorName: j.authorName,
        subjectName: j.subjectName,
        reviewType: r.reviewType,
        sessionDate: j.sessionDate,
        opsDemoSessionId: r.opsDemoSessionId,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, withdrawn ? null : r[f]])),
        followUpOn: withdrawn ? null : r.followUpOn,
        visibility: r.visibility,
        submittedAt: iso(r.submittedAt),
        withdrawnAt: iso(r.withdrawnAt),
        sourcePath: MODULE_PATHS.review(r.id),
      };
    }),
  });
}

/** Students the actor may write a review for now (enrolled; demo students come from roster links). */
export async function reviewableStudents(db: Database, actor: Actor, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  const { placed } = await reviewer(db, actor, now);
  if (placed?.length === 0) return [];
  return db
    .select({ id: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName })
    .from(academicStudents)
    .where(placed ? inArray(academicStudents.id, placed) : undefined)
    .orderBy(academicStudents.fullName)
    .limit(1000);
}

/** The prefilled student of /reviews/new, checked against the actor's current scope. */
export async function reviewTarget(db: Database, actor: Actor, ref: { studentId?: string; sessionId?: string; coreStudentId?: string; opsDemoSessionId?: string }, now = new Date()) {
  await resolveScope(db, actor, 'academic:reviews:write');
  const { sessionId } = await assertMayReview(db, actor, { academicStudentId: ref.studentId ?? null, coreStudentId: ref.coreStudentId ?? null, opsDemoSessionId: ref.opsDemoSessionId ?? null, sessionId: ref.sessionId ?? null }, now);
  const [name] = ref.studentId
    ? await db.select({ fullName: academicStudents.fullName }).from(academicStudents).where(eq(academicStudents.id, ref.studentId as StudentId))
    : await db.select({ fullName: coreStudents.fullName }).from(coreStudents).where(eq(coreStudents.id, ref.coreStudentId as StudentIdentityId));
  return { name: name!.fullName, demo: !ref.studentId, sessionId };
}
