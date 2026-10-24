/**
 * Writes behind the Academic internal assessment API for Business Ops (owner answer 1: ONE test
 * record in Academic). Ops checks its own permission, then calls with its service token and the
 * acting user, who is the audit actor here. Every write runs in one transaction; a change to
 * final results re-scores (result version + 1) and re-publishes when a version is current.
 */
import { eq, inArray } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  academicAssessmentBatches,
  academicAssessmentSections,
  academicAssessments,
  academicAttempts,
  academicBatches,
  academicSubjects,
  staffMembers,
  users,
  type AcademicAssessmentId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  type createAssessmentInternalBody,
  type publishResultsBody,
  type recordScoresBody,
  type rosterCorrectionBody,
  type rosterSnapshotBody,
  type updateAssessmentInternalBody,
} from '@elevate/shared-contracts';
import type { BatchId, SessionId } from '@elevate/shared-types';
import type { z } from 'zod';
import { parseMarks } from '../../domain';
import { audit, type Actor } from '../context';
import { sectionBody } from '../schemas';
import { publishLocked, withdrawLocked } from './assessment-publish';
import {
  correctRoster,
  rosterMarked,
  snapshotRoster,
  writeRosterScores,
  type AssessmentRow,
} from './assessment-roster';
import { dbMark, sectionValues } from './assessments';
import { rescoreLocked } from './results';

type Fields = z.output<typeof updateAssessmentInternalBody>;

/** The Ops user the call acts for (audit actor). Internal actors hold no roles here. */
export async function internalActor(
  db: Database,
  userId: string,
  requestId: string,
): Promise<Actor> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId as never));
  if (!user) throw new ValidationError('The acting user does not exist.');
  if (user.status !== 'active') throw new ForbiddenError('The acting user is disabled.');
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: [],
      sessionId: '' as SessionId,
    } as AuthenticatedUser,
    requestId,
  };
}

async function lock(tx: Database, id: string): Promise<AssessmentRow> {
  const [a] = await tx
    .select()
    .from(academicAssessments)
    .where(eq(academicAssessments.id, id as AcademicAssessmentId))
    .for('update');
  if (!a) throw new NotFoundError('Assessment not found.');
  return a;
}

/** Validate references and map body fields to columns (only the fields given; `current` on update). */
async function columns(tx: Database, f: Fields, current?: AssessmentRow) {
  const out: Partial<typeof academicAssessments.$inferInsert> = {};
  let courseId: string | undefined;
  if (f.batchIds) {
    const batches = await tx
      .select({ id: academicBatches.id, courseId: academicBatches.courseId })
      .from(academicBatches)
      .where(inArray(academicBatches.id, f.batchIds as BatchId[]));
    if (batches.length !== f.batchIds.length)
      throw new ValidationError('Some batches do not exist.');
    if (new Set(batches.map((b) => b.courseId)).size > 1)
      throw new ValidationError('All eligible batches must belong to one course.');
    courseId = batches[0]!.courseId;
    out.batchId = f.batchIds[0] as BatchId;
  }
  const subjectId =
    f.subjectId === undefined ? (f.batchIds ? current?.subjectId : null) : f.subjectId;
  if (subjectId) {
    courseId ??= (
      await tx
        .select({ courseId: academicBatches.courseId })
        .from(academicBatches)
        .where(eq(academicBatches.id, current!.batchId))
    )[0]?.courseId;
    const [subject] = await tx
      .select({ courseId: academicSubjects.courseId })
      .from(academicSubjects)
      .where(eq(academicSubjects.id, subjectId as never));
    if (!subject || subject.courseId !== courseId)
      throw new ValidationError('The subject is not part of the batches’ course.');
  }
  const staff = [f.responsibleTeacherStaffId, f.evaluatorStaffId].filter((s) =>
    Boolean(s),
  ) as string[];
  if (staff.length) {
    const found = await tx
      .select({ id: staffMembers.id })
      .from(staffMembers)
      .where(inArray(staffMembers.id, staff as never[]));
    if (new Set(found.map((s) => s.id)).size !== new Set(staff).size)
      throw new ValidationError('The responsible teacher or evaluator is not a staff member.');
  }
  if (f.maxMarks && parseMarks(f.maxMarks)! <= 0)
    throw new ValidationError('Maximum marks must be more than 0.');
  const copy = [
    'title',
    'academicYear',
    'subjectId',
    'scheduledDate',
    'startTime',
    'durationMinutes',
    'responsibleTeacherStaffId',
    'evaluatorStaffId',
  ] as const;
  for (const k of copy) if (f[k] !== undefined) Object.assign(out, { [k]: f[k] });
  for (const k of ['maxMarks', 'marksPerCorrect', 'marksPerWrong', 'marksUnattempted'] as const)
    if (f[k] !== undefined) out[k] = dbMark(f[k]);
  return out;
}

async function replaceBatchesAndSections(tx: Database, id: AcademicAssessmentId, f: Fields) {
  if (f.batchIds) {
    await tx
      .delete(academicAssessmentBatches)
      .where(eq(academicAssessmentBatches.assessmentId, id));
    await tx
      .insert(academicAssessmentBatches)
      .values(f.batchIds.map((batchId) => ({ assessmentId: id, batchId: batchId as BatchId })));
  }
  if (f.sections) {
    await tx
      .delete(academicAssessmentSections)
      .where(eq(academicAssessmentSections.assessmentId, id));
    if (f.sections.length)
      await tx.insert(academicAssessmentSections).values(
        sectionValues(
          id,
          f.sections.map((s) => sectionBody.parse(s)),
        ),
      );
  }
}

export async function createAssessmentInternal(
  db: Database,
  actor: Actor,
  body: z.output<typeof createAssessmentInternalBody>,
) {
  return withTransaction(db, async (tx) => {
    const [dupe] = await tx
      .select({ id: academicAssessments.id })
      .from(academicAssessments)
      .where(eq(academicAssessments.code, body.code));
    if (dupe) throw new ConflictError(`An assessment with code ${body.code} already exists.`);
    const values = await columns(tx, body);
    const [row] = await tx
      .insert(academicAssessments)
      .values({
        ...values,
        code: body.code,
        title: body.title,
        kind: body.kind,
        batchId: values.batchId!,
        status: body.scheduledDate ? 'scheduled' : 'draft',
        createdByUserId: actor.user.id,
      })
      .returning();
    await replaceBatchesAndSections(tx, row!.id, body);
    await audit(tx, actor, {
      action: 'assessment.created',
      entityType: 'assessment',
      entityId: row!.id,
      after: row,
      metadata: { via: 'ops', batchIds: body.batchIds, sections: body.sections?.length ?? 0 },
    });
    return row!.id;
  });
}

/** Change fields, schedule or cancel. Batches change only before the roster; the marking rule only before marks. */
export async function updateAssessmentInternal(
  db: Database,
  actor: Actor,
  id: string,
  body: Fields,
) {
  return withTransaction(db, async (tx) => {
    const a = await lock(tx, id);
    if (a.status === 'finalised' || a.status === 'cancelled')
      throw new InvalidStateTransitionError(
        `The assessment is ${a.status}; it can no longer change.`,
      );
    if (body.batchIds && a.rosterSnapshotAt)
      throw new ConflictError(
        'The roster was taken; correct the roster instead of changing the batches.',
      );
    const scoring = (
      ['maxMarks', 'marksPerCorrect', 'marksPerWrong', 'marksUnattempted', 'sections'] as const
    ).some((k) => body[k] !== undefined);
    if (scoring) {
      const marked = await rosterMarked(tx, a.id);
      const [attempt] = await tx
        .select({ id: academicAttempts.id })
        .from(academicAttempts)
        .where(eq(academicAttempts.assessmentId, a.id))
        .limit(1);
      if (marked || attempt)
        throw new ConflictError(
          'Marks have been entered; the marking rule and sections can no longer change.',
        );
    }
    const values = await columns(tx, body, a);
    const date = body.scheduledDate === undefined ? a.scheduledDate : body.scheduledDate;
    const status = body.status ?? (a.status === 'draft' && date ? 'scheduled' : a.status);
    if (status === 'scheduled' && !date)
      throw new ValidationError('A scheduled assessment needs a date.');
    if (body.status === 'scheduled' && a.status !== 'draft' && a.status !== 'scheduled')
      throw new InvalidStateTransitionError(
        `A ${a.status} assessment cannot go back to scheduled.`,
      );
    const [row] = await tx
      .update(academicAssessments)
      .set({ ...values, status })
      .where(eq(academicAssessments.id, a.id))
      .returning();
    await replaceBatchesAndSections(tx, a.id, body);
    await audit(tx, actor, {
      action: status === 'cancelled' ? 'assessment.cancelled' : 'assessment.updated',
      entityType: 'assessment',
      entityId: a.id,
      before: a,
      after: row,
      metadata: { via: 'ops', reason: body.reason ?? null },
    });
  });
}

export async function snapshotRosterInternal(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof rosterSnapshotBody>,
) {
  return withTransaction(db, async (tx) => snapshotRoster(tx, actor, await lock(tx, id), body));
}

/** A change to final results needs a reason and re-scores (re-publishing when published); a no-op needs neither. */
async function afterChange(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  changed: boolean,
  reason: string | undefined,
) {
  if (a.status !== 'finalised' || !changed) return;
  if (!reason)
    throw new ValidationError(
      'Results are final: say why they change (the change creates a new result version).',
      { details: [{ location: 'body', path: ['reason'], message: 'Required' }] },
    );
  await rescoreLocked(tx, actor, a, reason);
}

export async function correctRosterInternal(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof rosterCorrectionBody>,
) {
  return withTransaction(db, async (tx) => {
    const a = await lock(tx, id);
    await correctRoster(tx, actor, a, body);
    await afterChange(tx, actor, a, true, body.reason);
  });
}

/** Record scores on the roster (one writer); Academic teacher marking uses the same path. */
export async function recordScoresLocked(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  body: z.output<typeof recordScoresBody>,
) {
  const result = await writeRosterScores(tx, actor, a, body);
  await afterChange(tx, actor, a, result.changed > 0, body.reason);
  return result;
}

export async function recordScores(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof recordScoresBody>,
) {
  return withTransaction(db, async (tx) => recordScoresLocked(tx, actor, await lock(tx, id), body));
}

export async function publishInternal(
  db: Database,
  actor: Actor,
  id: string,
  body: z.output<typeof publishResultsBody>,
) {
  return withTransaction(db, async (tx) => publishLocked(tx, actor, await lock(tx, id), body));
}

export async function withdrawInternal(
  db: Database,
  actor: Actor,
  id: string,
  version: number,
  reason: string,
) {
  return withTransaction(db, async (tx) =>
    withdrawLocked(tx, actor, await lock(tx, id), version, reason),
  );
}
