/**
 * Teachers' submitted student reviews, read from Academic OS (owner answer 1, 21 Oct 2026; R4).
 * `ops:feedback:read` is checked before Academic is called; own scope keeps the reviews about
 * students the reader counsels (case counsellor, lead owner or demo counsellor), and a reader with
 * no linked staff record gets `unavailable`, never an empty list.
 * Withdrawn reviews are hidden (every version); superseded versions stay, marked. When Academic
 * cannot be reached the result says so — never "no reviews". Ops' acknowledgements and
 * follow-ups (server/review-acks.ts) are attached per version; the teacher's words are never edited.
 */
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { can } from '@elevate/authorization';
import {
  opsAdmissions,
  opsDemos,
  opsLeads,
  opsReviewAcknowledgements as acks,
  users,
  type Database,
} from '@elevate/database';
import type { AcademicStudentReviewsV1 } from '@elevate/shared-contracts';
import type { StaffMemberId, StudentIdentityId } from '@elevate/shared-types';
import { istToday } from '../domain';
import { fetchAcademicReviews } from './academic-summary';
import { ownAdmissionFilter } from './admissions';
import { accessScope, type AccessScope, type Actor } from './context';

export type AcademicReview = AcademicStudentReviewsV1['reviews'][number];

/** The core students among `ids` this staff member counsels (own scope of feedback rights). */
export async function counselledStudents(
  db: Database,
  staffId: StaffMemberId | null,
  ids: readonly (string | null)[],
) {
  const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))] as StudentIdentityId[];
  if (!staffId || !wanted.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ id: opsAdmissions.studentId })
    .from(opsAdmissions)
    .leftJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .leftJoin(opsDemos, eq(opsDemos.admissionId, opsAdmissions.id))
    .where(
      and(
        inArray(opsAdmissions.studentId, wanted),
        or(ownAdmissionFilter({ scope: 'own', staffId }), eq(opsDemos.counsellorStaffId, staffId)),
      ),
    );
  return new Set(rows.map((r) => r.id as string));
}

/** Every version of a review whose current version is withdrawn is hidden. */
export function visibleReviews(reviews: readonly AcademicReview[]) {
  const gone = new Set(
    reviews.filter((r) => r.status === 'withdrawn' && !r.superseded).map((r) => r.reviewKey),
  );
  return reviews.filter((r) => !gone.has(r.reviewKey));
}

/** The day a review is about: the class, the end of its period, or the day it was submitted. */
export const reviewDate = (r: AcademicReview) =>
  r.sessionDate ?? r.periodTo ?? istToday(new Date(r.submittedAt));

async function inScope(db: Database, access: AccessScope, reviews: AcademicReview[]) {
  if (access.scope === 'all') return reviews;
  const counselled = await counselledStudents(
    db,
    access.staffId,
    reviews.map((r) => r.coreStudentId),
  );
  return reviews.filter((r) => r.coreStudentId && counselled.has(r.coreStudentId));
}

/** Acknowledgements per version; Ops' notes and follow-ups only for holders of the right (#11). */
async function withAcknowledgements(db: Database, reviews: AcademicReview[], details: boolean) {
  const rows = reviews.length
    ? await db
        .select({
          reviewKey: acks.reviewKey,
          reviewVersion: acks.reviewVersion,
          id: acks.id,
          by: users.displayName,
          byUserId: acks.acknowledgedByUserId,
          note: acks.note,
          followUp: acks.followUp,
          followUpOn: acks.followUpOn,
          at: acks.createdAt,
        })
        .from(acks)
        .innerJoin(users, eq(users.id, acks.acknowledgedByUserId))
        .where(
          inArray(
            acks.reviewKey,
            reviews.map((r) => r.reviewKey),
          ),
        )
        .orderBy(asc(acks.createdAt))
    : [];
  return reviews.map((r) => ({
    ...r,
    acknowledgements: rows
      .filter((a) => a.reviewKey === r.reviewKey && a.reviewVersion === r.version)
      .map((a) => (details ? a : { ...a, note: null, followUp: null, followUpOn: null })),
  }));
}

export type ReviewsResult =
  | {
      status: 'available';
      checkedAt: string;
      reviews: Awaited<ReturnType<typeof withAcknowledgements>>;
    }
  | { status: 'unavailable'; reason: string; checkedAt: string };

async function readReviews(
  db: Database,
  actor: Actor,
  query: { coreStudentId: string } | { authorStaffId: string },
): Promise<ReviewsResult> {
  const access = await accessScope(db, actor, 'ops:feedback:read');
  if (access.scope === 'own' && !access.staffId)
    return {
      status: 'unavailable',
      reason: 'Your account is not linked to a staff record',
      checkedAt: new Date().toISOString(),
    };
  const r = await fetchAcademicReviews(query);
  if (r.status === 'unavailable')
    return { status: 'unavailable', reason: r.reason, checkedAt: r.fetchedAt };
  // Only rows about what was asked, whatever the source returns.
  const asked = r.data.reviews.filter((x) =>
    'coreStudentId' in query
      ? x.coreStudentId === query.coreStudentId
      : x.authorStaffId === query.authorStaffId,
  );
  return {
    status: 'available',
    checkedAt: r.fetchedAt,
    reviews: await withAcknowledgements(
      db,
      await inScope(db, access, visibleReviews(asked)),
      can(actor, 'ops:feedback:acknowledge'),
    ),
  };
}

/** Submitted reviews of one student (profile Feedback tab, demo record, reports). */
export const studentReviews = (db: Database, actor: Actor, coreStudentId: string) =>
  readReviews(db, actor, { coreStudentId });

/** Submitted reviews one teacher wrote (teacher profile), each checked against the reader's scope. */
export const reviewsAuthored = (db: Database, actor: Actor, authorStaffId: string) =>
  readReviews(db, actor, { authorStaffId });

/**
 * Academic page that opens the review form (A3), shown only to teachers: by the Academic student
 * id, or for a demo class on an Academic roster by core student + Ops demo class.
 */
export const writeReviewHref = (
  q: { studentId: string } | { coreStudentId: string; opsDemoSessionId: string },
) => `/academic/reviews/new?${new URLSearchParams(q)}`;
