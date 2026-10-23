/**
 * Submission and review (owner brief 23 Oct 2026 §9–§10). Submitting needs a completion note and,
 * when the task names an expected deliverable, a deliverable file on the task or evidence text.
 * Submitting moves the task's deliverable files onto the new version, where they stay (X3).
 * Each submission is a new, never-edited version (unique per task); the first and latest
 * submission times are kept apart from the approval time, so a late approval never makes an
 * on-time submission late (R5). A review decision is tied to the latest submission; nobody
 * reviews their own work. Called inside task-actions' transaction (row already locked).
 */
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import {
  opsAttachments,
  opsStaffProfiles,
  opsTaskEvents,
  staffMembers,
  userRoles,
  opsTaskReviews as reviews,
  opsTaskSubmissions as submissions,
  users,
  type Database,
} from '@elevate/database';
import { ForbiddenError, InvalidStateTransitionError } from '@elevate/shared-contracts';
import type { TaskRole } from '../domain/task-lifecycle';
import type { Actor } from './context';
import { fieldError, opsAudit } from './ops-common';
import type { TaskActionBody } from './staff-tasks-schemas';
import type { TaskRow } from './task-store';

const fileAudit = opsAudit('attachment');

/** Live deliverables on the task (not yet submitted) or on submission versions. */
const deliverables = (db: Database, kind: 'task' | 'task_submission', ownerIds: string[]) =>
  db
    .select({
      id: opsAttachments.id,
      ownerId: opsAttachments.ownerId,
      name: opsAttachments.originalName,
      createdAt: opsAttachments.createdAt,
    })
    .from(opsAttachments)
    .where(
      and(
        eq(opsAttachments.ownerKind, kind),
        inArray(opsAttachments.ownerId, ownerIds),
        eq(opsAttachments.purpose, 'deliverable'),
        isNull(opsAttachments.deletedAt),
      ),
    )
    .orderBy(asc(opsAttachments.createdAt));

/** The task's latest submission version (0 before any). */
export async function latestVersion(db: Database, taskId: string) {
  const [last] = await db
    .select({ v: max(submissions.version) })
    .from(submissions)
    .where(eq(submissions.taskId, taskId as never));
  return last?.v ?? 0;
}

/** Record the next submission version; returns the task fields it sets and the event data. */
export async function submitWork(
  tx: Database,
  actor: Actor,
  t: TaskRow,
  body: TaskActionBody,
  now: Date,
) {
  if (!body.completionNote)
    throw fieldError('completionNote', 'Say what you did (the completion note).');
  const files = await deliverables(tx, 'task', [t.id]);
  if (t.expectedDeliverable && !body.evidence && !files.length)
    throw fieldError(
      'evidence',
      'This task expects a deliverable: attach the file to the task, or give a link or where to find it.',
    );
  const version = (await latestVersion(tx, t.id)) + 1;
  const [sub] = await tx
    .insert(submissions)
    .values({
      taskId: t.id,
      version,
      completionNote: body.completionNote,
      evidence: body.evidence ?? null,
      submittedByUserId: actor.id,
      submittedAt: now,
    })
    .returning();
  // X3: the deliverables go with this version (never removable: attachments.ts refuses).
  const ids = files.map((f) => f.id);
  if (ids.length) {
    await tx
      .update(opsAttachments)
      .set({ ownerKind: 'task_submission', ownerId: sub!.id })
      .where(inArray(opsAttachments.id, ids));
    for (const f of files)
      await fileAudit(tx, actor, f.id, 'attachment.submitted', {
        before: { ownerKind: 'task', ownerId: t.id },
        after: { ownerKind: 'task_submission', ownerId: sub!.id },
      });
  }
  return {
    set: { firstSubmittedAt: t.firstSubmittedAt ?? now, lastSubmittedAt: now },
    data: { version, submissionId: sub!.id, files: ids },
  };
}

/** Approve or request changes on the latest submission (never your own work). */
export async function reviewWork(
  tx: Database,
  actor: Actor,
  t: TaskRow,
  decision: 'approved' | 'changes_requested',
  note: string | null,
  roles: readonly TaskRole[],
  now: Date,
) {
  const [sub] = await tx
    .select()
    .from(submissions)
    .where(eq(submissions.taskId, t.id))
    .orderBy(desc(submissions.version))
    .limit(1);
  if (!sub) throw new InvalidStateTransitionError('There is no submission to review.');
  if (sub.submittedByUserId === actor.id || roles.includes('owner'))
    throw new ForbiddenError('You cannot review your own work: the reviewer or HR decides.');
  if (decision === 'approved') {
    // Versions, not clocks: each hand-over records the latest version it found (task-actions).
    const [moved] = await tx
      .select({
        v: sql<number | null>`max((${opsTaskEvents.data}->>'submissionVersion')::int)`,
      })
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.taskId, t.id), eq(opsTaskEvents.kind, 'reassigned')));
    if (sub.version <= (moved?.v ?? 0))
      throw new InvalidStateTransitionError(
        'This version was handed in before the task changed hands: ask for changes instead.',
      );
  }
  await tx.insert(reviews).values({
    taskId: t.id,
    submissionId: sub.id,
    decision,
    note,
    reviewerUserId: actor.id,
    createdAt: now,
  });
  return {
    set: decision === 'approved' ? { approvedAt: now } : {},
    data: { version: sub.version, submissionId: sub.id },
  };
}

/** A reviewer's comment is also a review note on the latest submission (if any). */
export async function reviewComment(tx: Database, actor: Actor, t: TaskRow, note: string) {
  const [sub] = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.taskId, t.id))
    .orderBy(desc(submissions.version))
    .limit(1);
  await tx.insert(reviews).values({
    taskId: t.id,
    submissionId: sub?.id ?? null,
    decision: 'comment',
    note,
    reviewerUserId: actor.id,
  });
}

/** Versions (oldest first) with their review decisions and the deliverables of each round. */
export async function submissionHistory(db: Database, taskId: string) {
  const [subs, revs, files] = await Promise.all([
    db
      .select({ s: submissions, by: users.displayName })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.submittedByUserId))
      .where(eq(submissions.taskId, taskId as never))
      .orderBy(asc(submissions.version)),
    db
      .select({ r: reviews, by: users.displayName })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.reviewerUserId))
      .where(eq(reviews.taskId, taskId as never))
      .orderBy(asc(reviews.createdAt)),
    deliverables(db, 'task', [taskId]),
  ]);
  const sent = await deliverables(
    db,
    'task_submission',
    subs.map((x) => x.s.id),
  );
  const names = await namesOf(db, [
    ...subs.map((x) => x.s.submittedByUserId),
    ...revs.map((x) => x.r.reviewerUserId),
  ]);
  return {
    submissions: subs.map(({ s, by }) => ({
      ...s,
      submittedBy: names.get(s.submittedByUserId)?.name ?? by,
      files: sent.filter((f) => f.ownerId === s.id),
    })),
    reviews: revs.map(({ r, by }) => ({
      ...r,
      reviewer: names.get(r.reviewerUserId)?.reviewer ?? by,
    })),
    pendingFiles: files,
  };
}
export type SubmissionHistory = Awaited<ReturnType<typeof submissionHistory>>;

/**
 * How people are named in task wording (brief §11: "Submitted by Satish at 4:42 PM.",
 * "Changes requested by HR: …"): the staff display name, else the login's; a reviewer who holds
 * hr_manager is "HR".
 */
export async function namesOf(db: Database, ids: readonly string[]) {
  const rows = ids.length
    ? await db
        .select({
          id: users.id,
          name: sql<string>`coalesce(${opsStaffProfiles.displayName}, ${users.displayName})`,
          hr: sql<boolean>`exists (select 1 from ${userRoles} where ${userRoles.userId} = ${users.id} and ${userRoles.role} = 'hr_manager')`,
        })
        .from(users)
        .leftJoin(staffMembers, eq(staffMembers.userId, users.id))
        .leftJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
        .where(inArray(users.id, ids as never[]))
    : [];
  return new Map(
    rows.map((r) => [r.id as string, { name: r.name, reviewer: r.hr ? 'HR' : r.name }]),
  );
}
