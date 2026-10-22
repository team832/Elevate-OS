/**
 * Ops acknowledges a teacher's submitted review version and may add its own follow-up (owner
 * answer 1, 21 Oct 2026; R4). One row per (review, version, person); the teacher's words stay in
 * Academic OS and are never copied or edited. The review is checked live against Academic: a
 * withdrawn, unknown or superseded version is refused, and so is any attempt while Academic
 * cannot be reached (nothing is recorded against a review Ops cannot see).
 */
import { opsReviewAcknowledgements, type Database } from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
} from '@elevate/shared-contracts';
import type { z } from 'zod';
import { counselledStudents, visibleReviews } from './academic-reviews';
import { fetchAcademicReviews } from './academic-summary';
import { accessScope, type Actor } from './context';
import { opsAudit } from './ops-common';
import type { reviewAckBody } from './report-schemas';

const audit = opsAudit('review_acknowledgement');

export async function acknowledgeReview(
  db: Database,
  actor: Actor,
  input: z.output<typeof reviewAckBody>,
  requestId?: string,
) {
  const access = await accessScope(db, actor, 'ops:feedback:acknowledge');
  if (
    access.scope === 'own' &&
    !(await counselledStudents(db, access.staffId, [input.coreStudentId])).size
  )
    throw new ForbiddenError('You can only acknowledge reviews of students you counsel.');
  const source = await fetchAcademicReviews({ coreStudentId: input.coreStudentId });
  if (source.status === 'unavailable')
    throw new ConflictError(
      `Academic OS could not be reached (${source.reason}), so the review cannot be checked. Try again later.`,
    );
  const review = visibleReviews(source.data.reviews).find(
    (r) =>
      r.reviewKey === input.reviewKey &&
      r.version === input.version &&
      r.coreStudentId === input.coreStudentId,
  );
  if (!review) throw new NotFoundError('Review not found in Academic OS (it may be withdrawn).');
  if (review.superseded)
    throw new InvalidStateTransitionError(
      'The teacher has submitted a newer version; acknowledge that one.',
    );
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(opsReviewAcknowledgements)
      .values({
        reviewKey: review.reviewKey,
        reviewVersion: review.version,
        acknowledgedByUserId: actor.id,
        note: input.note ?? null,
        followUp: input.followUp ?? null,
        followUpOn: input.followUpOn ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('You have already acknowledged this version.');
    await audit(
      tx,
      actor,
      row.id,
      'feedback.review_acknowledged',
      { after: { ...row, coreStudentId: input.coreStudentId } },
      requestId,
    );
    return row;
  });
}
