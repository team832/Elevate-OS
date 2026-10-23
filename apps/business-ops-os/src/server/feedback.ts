/**
 * The two feedback directions (owner brief 20 Oct 2026 §8H, §12; 21 Oct §3, §5), in two stores:
 * - teacher → student: written, versioned and withdrawn in Academic OS (owner answer 21 Oct 2026,
 *   supersedes D-043) and read through server/academic-reviews.ts. `ops.teacher_student_feedback`
 *   keeps the reviews recorded in Business Ops before 21 Oct 2026 as read-only history.
 * - student/guardian → teacher: HR's raw rows, in feedback-responses.ts (ops:teacher_feedback:*).
 */
import { and, asc, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsLeads,
  opsTeacherStudentFeedback as aboutStudents,
  staffMembers,
  students,
  type Database,
} from '@elevate/database';
import { ForbiddenError } from '@elevate/shared-contracts';
import type { StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import {
  demoReviewGrid,
  matchDemoReviews,
  reviewSessions,
  type ReviewState,
} from '../domain/feedback';
import {
  counselledStudents,
  reviewsAuthored,
  studentReviews,
  type ReviewsResult,
} from './academic-reviews';
import {
  academicDemoMarks,
  staffNames,
  withMarks,
  type AcademicDemoMarks,
} from './academic-summary';
import { accessScope, scopeCovers, staffIdForUser, type Actor } from './context';
import { rowById } from './ops-common';

/** Older Ops reviews a reader may see: submitted ones, and their own drafts. */
const legacyVisible = (me: StaffMemberId | null) =>
  me
    ? or(eq(aboutStudents.status, 'final'), eq(aboutStudents.teacherStaffId, me))
    : eq(aboutStudents.status, 'final');

const withSuperseded = <R extends { id: string; supersedesId: string | null }>(
  rows: readonly R[],
) => {
  const ids = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  return rows.map((r) => ({ ...r, superseded: ids.has(r.id) }));
};

/**
 * Review state per demo day per teacher: submitted (an Academic review of that day's class, or
 * an older Ops one) / pending / not due, from the classes actually taught — for a class linked
 * to Academic, its actual teachers and the teacher's mark (owner answer 3). States need the demo
 * (ops:leads:read; own = demo/case counsellor or lead owner) or feedback access (own = a teacher
 * of one of its classes). Reviews come only through ops:feedback:read. When Academic's reviews
 * cannot be read, "pending" becomes "Source unavailable"; when its marks cannot be read, so does
 * "not due" (a linked class may have been attended).
 */
export async function demoFeedbackByDay(
  db: Database,
  actor: Actor,
  demoId: string,
  prefetched?: AcademicDemoMarks,
) {
  const [feedback, leads] = await Promise.all(
    (['ops:feedback:read', 'ops:leads:read'] as const).map((p) =>
      can(actor, p) ? accessScope(db, actor, p) : null,
    ),
  );
  if (!feedback && !leads) await accessScope(db, actor, 'ops:leads:read');
  const demo = await rowById(db, opsDemos, demoId, 'Demo');
  const plain = await db
    .select()
    .from(opsDemoSessions)
    .where(eq(opsDemoSessions.demoId, demo.id))
    .orderBy(asc(opsDemoSessions.dayNumber), asc(opsDemoSessions.sessionNumber));
  const marks =
    prefetched ??
    (await academicDemoMarks(
      db,
      plain.map((s) => s.id),
    ));
  const sessions = reviewSessions(withMarks(plain, marks));
  const owners = await demoOwners(db, demo);
  const teachesHere =
    feedback &&
    scopeCovers(
      feedback,
      sessions.map((s) => s.teacherStaffId),
    );
  if (!teachesHere && !(leads && scopeCovers(leads, owners.staff))) {
    throw new ForbiddenError('You can only see reviews for demos you run or teach.');
  }
  const me = await staffIdForUser(db, actor.id);
  const [academic, legacy] = await Promise.all([
    feedback && owners.studentId ? studentReviews(db, actor, owners.studentId) : null,
    plain.length
      ? db
          .select()
          .from(aboutStudents)
          .where(
            and(
              inArray(
                aboutStudents.demoSessionId,
                plain.map((s) => s.id),
              ),
              legacyVisible(me),
            ),
          )
      : [],
  ]);
  const matched =
    academic?.status === 'available' ? matchDemoReviews(sessions, academic.reviews) : [];
  const older = withSuperseded(legacy);
  const grid = demoReviewGrid(sessions, [...older, ...matched]);
  const names = await staffNames(
    db,
    grid.flatMap((d) => d.teachers.map((t) => t.staffId)),
  );
  const mayRead = (staffId: string) => Boolean(feedback && scopeCovers(feedback, [staffId]));
  const unknown = (state: ReviewState): ReviewState =>
    (state === 'pending' && academic?.status !== 'available') ||
    (state === 'not_due' && marks.status === 'unavailable')
      ? 'unknown'
      : state;
  return {
    days: grid.map((d) => ({
      ...d,
      teachers: d.teachers.map(({ reviewIds, ...t }) => ({
        ...t,
        state: unknown(t.state),
        teacherName: names.get(t.staffId) ?? 'Unknown teacher',
        // Academic reviews already passed the reader's scope; older Ops rows need it here.
        reviewIds: reviewIds.filter((id) => id.includes(':') || mayRead(t.staffId)),
      })),
    })),
    /** This student's Academic reviews of the demo's classes (ids `reviewKey:version`). */
    reviews: matchedReviews(academic, matched),
    /** Reviews recorded in Business Ops before 21 Oct 2026 (read-only history). */
    legacy: older.filter((r) => !r.superseded && mayRead(r.teacherStaffId)),
  };
}

function matchedReviews(academic: ReviewsResult | null, matched: readonly { id: string }[]) {
  if (academic?.status !== 'available') return academic;
  const ids = new Set(matched.map((m) => m.id));
  return {
    ...academic,
    reviews: academic.reviews.filter((r) => ids.has(`${r.reviewKey}:${r.version}`)),
  };
}

async function demoOwners(db: Database, demo: typeof opsDemos.$inferSelect) {
  const [row] = await db
    .select({
      caseCounsellor: opsAdmissions.counsellorStaffId,
      leadOwner: opsLeads.ownerStaffId,
      studentId: opsAdmissions.studentId,
    })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsAdmissions.id, demo.admissionId));
  return {
    staff: [demo.counsellorStaffId, row?.caseCounsellor, row?.leadOwner],
    studentId: row?.studentId ?? null,
  };
}

export const REVIEWS_DUE_DAYS = 30;

/**
 * Demo classes in the last 30 days a teacher took (for a linked class: was an actual teacher of
 * in Academic) where the student attended and no review exists yet, in Academic or the older Ops
 * rows. `onRoster` = the class is on an Academic class roster, where the review form starts
 * (null when Academic could not be read).
 * `shared: false` = the reader may not see this teacher's reviews.
 */
export async function demoReviewsDue(
  db: Database,
  actor: Actor,
  teacherStaffId: string,
  now = new Date(),
) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && access.staffId !== teacherStaffId)
    return { shared: false as const, unavailable: null, rows: [] };
  const plain = await db
    .select({
      id: opsDemoSessions.id,
      dayNumber: opsDemoSessions.dayNumber,
      startsAt: opsDemoSessions.startsAt,
      subject: opsDemoSessions.subject,
      attendance: opsDemoSessions.attendance,
      teacherStaffId: opsDemoSessions.teacherStaffId,
      isSubstitute: opsDemoSessions.isSubstitute,
      studentId: students.id,
      studentName: students.fullName,
      isSample: students.isSample,
      legacyReviewId: aboutStudents.id,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .innerJoin(students, eq(students.id, opsAdmissions.studentId))
    .leftJoin(
      aboutStudents,
      and(
        eq(aboutStudents.demoSessionId, opsDemoSessions.id),
        eq(aboutStudents.teacherStaffId, teacherStaffId as StaffMemberId),
        eq(aboutStudents.status, 'final'),
      ),
    )
    .where(
      and(
        inArray(opsDemoSessions.attendance, ['present', 'late', 'scheduled', 'not_recorded']),
        gte(opsDemoSessions.startsAt, new Date(+now - REVIEWS_DUE_DAYS * 86_400_000)),
        lt(opsDemoSessions.startsAt, now),
      ),
    )
    .orderBy(asc(opsDemoSessions.startsAt));
  const [marks, authored] = await Promise.all([
    academicDemoMarks(
      db,
      plain.map((s) => s.id),
    ),
    reviewsAuthored(db, actor, teacherStaffId),
  ]);
  const reviewed = new Set(
    authored.status === 'available'
      ? authored.reviews
          .filter((r) => r.reviewType === 'demo_session')
          .map((r) => r.opsDemoSessionId ?? `${r.coreStudentId}:${r.sessionDate}`)
      : [],
  );
  const due = reviewSessions(withMarks(plain, marks)).filter(
    (s) =>
      s.teacherStaffId === teacherStaffId &&
      ['present', 'late'].includes(s.attendance) &&
      !s.legacyReviewId &&
      !reviewed.has(s.id) &&
      !reviewed.has(`${s.studentId}:${istToday(s.startsAt)}`),
  );
  return {
    shared: true as const,
    /** Academic could not be read: some of these may already be reviewed. */
    unavailable: [marks, authored].find((r) => r.status === 'unavailable') ?? null,
    // null = Academic's rosters could not be read.
    rows: due.map((s) => ({
      ...s,
      onRoster: marks.status === 'unavailable' ? null : Boolean(s.academic),
    })),
  };
}

/**
 * Reviews recorded in Business Ops before 21 Oct 2026 (read-only history), current and older
 * versions; drafts only for their author. Own scope: the ones you wrote, or all of a student you
 * counsel.
 */
export async function listStudentFeedback(db: Database, actor: Actor, studentId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && !access.staffId) return [];
  const counsels =
    access.scope === 'all' || (await counselledStudents(db, access.staffId, [studentId])).size > 0;
  const rows = await db
    .select({ f: aboutStudents, teacherName: staffMembers.fullName })
    .from(aboutStudents)
    .innerJoin(staffMembers, eq(staffMembers.id, aboutStudents.teacherStaffId))
    .where(
      and(
        eq(aboutStudents.studentId, studentId as StudentIdentityId),
        counsels ? undefined : eq(aboutStudents.teacherStaffId, access.staffId!),
        legacyVisible(await staffIdForUser(db, actor.id)),
      ),
    )
    .orderBy(desc(aboutStudents.observedOn), desc(aboutStudents.version));
  return withSuperseded(rows.map(({ f, teacherName }) => ({ ...f, teacherName })));
}

/** Older Ops reviews a teacher wrote (latest versions; read-only history). */
export async function listFeedbackByTeacher(db: Database, actor: Actor, teacherStaffId: string) {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && access.staffId !== teacherStaffId) return [];
  const rows = await db
    .select({ f: aboutStudents, studentName: students.fullName, studentSample: students.isSample })
    .from(aboutStudents)
    .innerJoin(students, eq(students.id, aboutStudents.studentId))
    .where(
      and(
        eq(aboutStudents.teacherStaffId, teacherStaffId as StaffMemberId),
        legacyVisible(await staffIdForUser(db, actor.id)),
      ),
    )
    .orderBy(desc(aboutStudents.observedOn));
  return withSuperseded(rows.map(({ f, ...s }) => ({ ...f, ...s }))).filter((r) => !r.superseded);
}

/** Student/guardian → teacher rows moved to feedback-responses.ts (HR, brief 23 Oct 2026 §15). */
export { listFeedbackAboutTeacher } from './feedback-responses';
