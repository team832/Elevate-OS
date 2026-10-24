/**
 * The assessment roster (brief §18, fnd-acd-contract one-writer rule): the snapshot of the
 * eligible batches' active enrolments on the scheduled date, corrections with reasons, and the
 * ONE place attendance, marks state and totals are written for a roster-managed assessment.
 * Attempts only mirror the roster at finalisation (`mirrorRosterToAttempts`).
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  academicAnswerKeys,
  academicAssessmentBatches,
  academicAssessmentRoster,
  academicAssessmentSections,
  academicAssessments,
  academicAttempts,
  academicBatchPlacements,
  academicEnrolments,
  academicStudents,
  type Database,
} from '@elevate/database';
import {
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  rosterFactsProblem,
  type RosterCounts,
  type recordScoresBody,
  type rosterCorrectionBody,
  type rosterSnapshotBody,
} from '@elevate/shared-contracts';
import type { BatchId, StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import {
  assessmentBounds,
  formatMarks,
  manualScoreProblem,
  parseMarks,
  resolveRules,
  scoreAttempt,
  toNumericString,
} from '../../domain';
import { audit, type Actor } from '../context';

const R = academicAssessmentRoster;
export type AssessmentRow = typeof academicAssessments.$inferSelect;

/** Eligible batches, primary first (an assessment without batch rows is legacy: its batch only). */
export async function eligibleBatchIds(db: Database, a: AssessmentRow): Promise<BatchId[]> {
  const rows = await db
    .select({ id: academicAssessmentBatches.batchId })
    .from(academicAssessmentBatches)
    .where(eq(academicAssessmentBatches.assessmentId, a.id));
  return [a.batchId, ...rows.map((r) => r.id).filter((id) => id !== a.batchId)];
}

/** The sections (in order) and the latest answer-key version (the current key) of an assessment. */
export async function sectionsAndKey(db: Database, assessmentId: AssessmentRow['id']) {
  const sections = await db
    .select()
    .from(academicAssessmentSections)
    .where(eq(academicAssessmentSections.assessmentId, assessmentId))
    .orderBy(asc(academicAssessmentSections.sortOrder));
  const [key] = await db
    .select()
    .from(academicAnswerKeys)
    .where(eq(academicAnswerKeys.assessmentId, assessmentId))
    .orderBy(desc(academicAnswerKeys.version))
    .limit(1);
  return { sections, key: key ?? null };
}

/** Roster rows with marks exist: the marking rule and sections are then frozen. */
export async function rosterMarked(
  db: Database,
  assessmentId: AssessmentRow['id'],
): Promise<boolean> {
  const [row] = await db
    .select({ id: R.id })
    .from(R)
    .where(and(eq(R.assessmentId, assessmentId), ne(R.marksState, 'not_entered')))
    .limit(1);
  return Boolean(row);
}

/** Score bounds from the current rule, sections and latest key (or the entered maximum); null = unknown. */
export async function boundsOf(db: Database, a: AssessmentRow) {
  const { sections, key } = await sectionsAndKey(db, a.id);
  return assessmentBounds({
    assessmentRule: a,
    sections,
    key: key?.answers ?? null,
    maxMarks: a.maxMarks,
  });
}

const emptyCounts = (): RosterCounts => ({
  active: 0,
  present: 0,
  absent: 0,
  excused: 0,
  unmarked: 0,
  notEntered: 0,
  imported: 0,
  verified: 0,
  removed: 0,
});
const markKey = { not_entered: 'notEntered', imported: 'imported', verified: 'verified' } as const;

/** Roster counts per assessment, plus present students without marks (a completeness issue). */
export async function rosterTally(db: Database, ids: string[]) {
  const out = new Map(ids.map((id) => [id, { counts: emptyCounts(), presentNotEntered: 0 }]));
  if (ids.length === 0) return out;
  const removed = sql<boolean>`${R.removedAt} is not null`;
  const rows = await db
    .select({
      id: R.assessmentId,
      attendance: R.attendance,
      marksState: R.marksState,
      removed,
      n: count(),
    })
    .from(R)
    .where(inArray(R.assessmentId, ids as never[]))
    .groupBy(R.assessmentId, R.attendance, R.marksState, removed);
  for (const r of rows) {
    const t = out.get(r.id)!;
    const n = Number(r.n);
    if (r.removed) t.counts.removed += n;
    else {
      t.counts.active += n;
      t.counts[r.attendance] += n;
      t.counts[markKey[r.marksState]] += n;
      if (r.attendance === 'present' && r.marksState === 'not_entered') t.presentNotEntered += n;
    }
  }
  return out;
}

/** What blocks a final (non-provisional) publication. */
export function completenessIssues(t: { counts: RosterCounts; presentNotEntered: number }) {
  return [
    { code: 'UNMARKED', count: t.counts.unmarked, message: 'Attendance not marked' },
    { code: 'UNVERIFIED', count: t.counts.imported, message: 'Imported marks not verified' },
    { code: 'PRESENT_NO_MARKS', count: t.presentNotEntered, message: 'Present without marks' },
  ].filter((i) => i.count > 0);
}

const p = academicBatchPlacements;
/** Students with an ACTIVE enrolment placed in one of the batches on the date (optionally one student). */
const placedOn = (db: Database, batchIds: BatchId[], date: string, studentId?: StudentId) =>
  db
    .select({
      studentId: academicEnrolments.studentId,
      batchId: p.batchId,
      fullName: academicStudents.fullName,
      coreStudentId: academicStudents.coreStudentId,
    })
    .from(p)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(
      and(
        inArray(p.batchId, batchIds),
        eq(academicEnrolments.status, 'active'),
        lte(p.startDate, date),
        or(isNull(p.endDate), gte(p.endDate, date)),
        studentId ? eq(academicEnrolments.studentId, studentId) : undefined,
      ),
    );

/**
 * Snapshot (once): students with an ACTIVE enrolment placed in one of the selected batches on the
 * scheduled date; a student placed in two of them sits with the first listed. Later batch changes
 * never touch these rows. Admission numbers come from the caller (Academic holds none).
 */
export async function snapshotRoster(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  input: z.output<typeof rosterSnapshotBody>,
) {
  if (a.rosterSnapshotAt)
    throw new ConflictError('The roster was already taken; correct it instead.');
  if (!['scheduled', 'conducted'].includes(a.status) || !a.scheduledDate)
    throw new InvalidStateTransitionError(
      'Schedule the assessment (with a date) before taking its roster.',
    );
  const batchIds = await eligibleBatchIds(tx, a);
  const date = a.scheduledDate;
  const found = await placedOn(tx, batchIds, date);
  found.sort((x, y) => batchIds.indexOf(x.batchId) - batchIds.indexOf(y.batchId));
  const numbers = new Map(input.admissionNumbers.map((n) => [n.coreStudentId, n.admissionNumber]));
  const seen = new Set<string>();
  const rows = found.filter((f) => !seen.has(f.studentId) && seen.add(f.studentId));
  if (rows.length > 0) {
    await tx.insert(R).values(
      rows.map((f) => ({
        assessmentId: a.id,
        studentId: f.studentId,
        batchId: f.batchId,
        displayNameSnapshot: f.fullName,
        admissionNumberSnapshot: (f.coreStudentId && numbers.get(f.coreStudentId)) || null,
        isSample: a.isSample,
      })),
    );
  }
  await tx
    .update(academicAssessments)
    .set({ rosterSnapshotAt: new Date() })
    .where(eq(academicAssessments.id, a.id));
  await audit(tx, actor, {
    action: 'roster.snapshotted',
    entityType: 'assessment',
    entityId: a.id,
    after: { students: rows.length, batchIds, date },
  });
  return rows.length;
}

/** Add (with a reason and batch), remove (kept, with a reason) or restore one roster row. */
export async function correctRoster(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  input: z.output<typeof rosterCorrectionBody>,
) {
  if (!a.rosterSnapshotAt) throw new InvalidStateTransitionError('Take the roster snapshot first.');
  if (a.status === 'cancelled')
    throw new InvalidStateTransitionError('The assessment is cancelled.');
  const [row] = await tx
    .select()
    .from(R)
    .where(and(eq(R.assessmentId, a.id), eq(R.studentId, input.studentId as StudentId)))
    .for('update');
  let after;
  if (input.action === 'add') {
    if (row)
      throw new ConflictError(
        row.removedAt
          ? 'The student was removed from this roster; restore them instead.'
          : 'The student is already on the roster.',
      );
    if (!(await eligibleBatchIds(tx, a)).includes(input.batchId as BatchId))
      throw new ValidationError('Choose one of the assessment’s eligible batches.');
    const [student] = await placedOn(
      tx,
      [input.batchId as BatchId],
      a.scheduledDate!,
      input.studentId as StudentId,
    );
    if (!student)
      throw new ValidationError(
        'The student has no active placement in that batch on the test date.',
      );
    if (input.admissionNumber) {
      const [taken] = await tx
        .select({ id: R.id })
        .from(R)
        .where(and(eq(R.assessmentId, a.id), eq(R.admissionNumberSnapshot, input.admissionNumber)))
        .limit(1);
      if (taken)
        throw new ConflictError(
          'Another student on this roster already has that admission number.',
        );
    }
    [after] = await tx
      .insert(R)
      .values({
        assessmentId: a.id,
        studentId: input.studentId as StudentId,
        batchId: input.batchId as BatchId,
        displayNameSnapshot: student.fullName,
        admissionNumberSnapshot: input.admissionNumber ?? null,
        addedReason: input.reason,
        isSample: a.isSample,
      })
      .returning();
  } else {
    if (!row) throw new NotFoundError('The student is not on this roster.');
    const removing = input.action === 'remove';
    if (removing === Boolean(row.removedAt))
      throw new ConflictError(
        removing ? 'The student is already removed.' : 'The student is not removed.',
      );
    [after] = await tx
      .update(R)
      .set({
        removedAt: removing ? new Date() : null,
        removedReason: removing ? input.reason : null,
        rank: null,
        version: sql`${R.version} + 1`,
      })
      .where(eq(R.id, row.id))
      .returning();
  }
  await audit(tx, actor, {
    action: `roster.${input.action === 'add' ? 'added' : input.action === 'remove' ? 'removed' : 'restored'}`,
    entityType: 'assessment',
    entityId: a.id,
    before: row ?? null,
    after,
    metadata: { studentId: input.studentId, reason: input.reason },
  });
}

type ScoresInput = Pick<
  z.output<typeof recordScoresBody>,
  'rows' | 'source' | 'importRef' | 'overwriteVerified' | 'reason'
>;

/**
 * Write attendance / marks state / score rows, all or none. Omitted attendance = unchanged; a row
 * equal to what is stored is skipped (so a repeated import changes nothing); a changed row needs
 * the version it was read at (else 409); changing a verified row needs `overwriteVerified` (409
 * `overwriteRequired` otherwise). Scores must fit the scheme's bounds. Audited old → new.
 */
export async function writeRosterScores(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  input: ScoresInput,
) {
  if (!a.rosterSnapshotAt)
    throw new InvalidStateTransitionError(
      'Take the roster snapshot first; scores are recorded on the roster.',
    );
  if (a.status === 'cancelled')
    throw new InvalidStateTransitionError('The assessment is cancelled.');
  const ids = input.rows.map((r) => r.studentId as StudentId);
  if (new Set(ids).size !== ids.length)
    throw new ValidationError('A student appears twice; nothing was saved.');
  const stored = await tx
    .select()
    .from(R)
    .where(and(eq(R.assessmentId, a.id), inArray(R.studentId, ids)))
    .for('update');
  const byStudent = new Map(
    stored.filter((r) => !r.removedAt).map((r) => [r.studentId as string, r]),
  );
  const unknown = ids.filter((id) => !byStudent.has(id));
  if (unknown.length)
    throw new ValidationError('Some students are not on the active roster; nothing was saved.', {
      details: { studentIds: unknown },
    });
  const bounds = input.rows.some((r) => r.score !== null) ? await boundsOf(tx, a) : null;
  const problems: { studentId: string; message: string }[] = [];
  const changes = [];
  for (const r of input.rows) {
    const old = byStudent.get(r.studentId)!;
    const attendance = r.attendance ?? old.attendance;
    const problem =
      rosterFactsProblem({ attendance, marksState: r.marksState, score: r.score }) ??
      (r.score === null
        ? null
        : bounds
          ? manualScoreProblem(r.score, bounds)
          : 'The maximum marks are not known: set the maximum, or the sections and marking rule, first.');
    if (problem) problems.push({ studentId: r.studentId, message: problem });
    const score = r.score === null || problem ? null : toNumericString(parseMarks(r.score)!);
    const sameScore =
      score === null
        ? old.score === null
        : old.score !== null && parseMarks(old.score) === parseMarks(score);
    if (
      !problem &&
      !(attendance === old.attendance && r.marksState === old.marksState && sameScore)
    )
      changes.push({ old, version: r.version, attendance, marksState: r.marksState, score });
  }
  if (problems.length)
    throw new ValidationError(
      'Some rows do not fit the roster rules or the marking scheme; nothing was saved.',
      { details: problems },
    );
  const stale = changes.filter((c) => c.old.version !== c.version).map((c) => c.old.studentId);
  if (stale.length)
    throw new ConflictError(
      'These roster rows changed since they were read; reload and try again. Nothing was saved.',
      { details: { stale } },
    );
  const overwritten = changes
    .filter((c) => c.old.marksState === 'verified')
    .map((c) => c.old.studentId);
  if (overwritten.length && !input.overwriteVerified)
    throw new ConflictError(
      'Verified marks would change. Review the overwrite and confirm it with a reason; nothing was saved.',
      { details: { overwriteRequired: overwritten } },
    );
  const now = new Date();
  for (const c of changes) {
    const verified = c.marksState === 'verified';
    await tx
      .update(R)
      .set({
        attendance: c.attendance,
        marksState: c.marksState,
        score: c.score,
        rank: null,
        verifiedAt: verified ? now : null,
        verifiedByUserId: verified ? actor.user.id : null,
        version: sql`${R.version} + 1`,
      })
      .where(eq(R.id, c.old.id));
  }
  if (changes.length > 0) {
    if (a.status === 'draft' || a.status === 'scheduled')
      await tx
        .update(academicAssessments)
        .set({ status: 'conducted' })
        .where(eq(academicAssessments.id, a.id));
    const facts = (x: { attendance: string; marksState: string; score: string | null }) => ({
      attendance: x.attendance,
      marksState: x.marksState,
      score: x.score,
    });
    await audit(tx, actor, {
      action: 'roster.scores_recorded',
      entityType: 'assessment',
      entityId: a.id,
      before: changes.map((c) => ({
        studentId: c.old.studentId,
        version: c.old.version,
        ...facts(c.old),
      })),
      after: changes.map((c) => ({ studentId: c.old.studentId, ...facts(c) })),
      metadata: {
        source: input.source,
        importRef: input.importRef ?? null,
        overwriteVerified: input.overwriteVerified,
        overwritten,
        reason: input.reason ?? null,
        unchanged: input.rows.length - changes.length,
      },
    });
  }
  return {
    changed: changes.length,
    unchanged: input.rows.length - changes.length,
    overwritten: overwritten.length,
  };
}

/**
 * Finalisation mirror (one-writer rule): one attempt per ACTIVE roster row — present + verified →
 * submitted (the roster score, unless per-question responses exist), absent → absent, excused →
 * exempt, anything else → withheld. Removed rows get none (finaliseInput ignores their attempts).
 */
export async function mirrorRosterToAttempts(
  tx: Database,
  actor: Actor,
  assessmentId: AssessmentRow['id'],
) {
  const T = academicAttempts;
  const rows = await tx
    .select()
    .from(R)
    .where(and(eq(R.assessmentId, assessmentId), isNull(R.removedAt)));
  const existing = new Map(
    (await tx.select().from(T).where(eq(T.assessmentId, assessmentId))).map((t) => [
      t.studentId as string,
      t,
    ]),
  );
  for (const r of rows) {
    const status =
      r.attendance === 'absent'
        ? 'absent'
        : r.attendance === 'excused'
          ? 'exempt'
          : r.attendance === 'present' && r.marksState === 'verified'
            ? 'submitted'
            : 'withheld';
    const old = existing.get(r.studentId);
    const responses =
      status === 'submitted' || status === 'withheld' ? (old?.responses ?? null) : null;
    const values = {
      status,
      responses,
      keyVersion: responses ? (old?.keyVersion ?? null) : null,
      manualScore: status === 'submitted' && !responses ? r.score : null,
      enteredByUserId: actor.user.id,
    } as const;
    await tx
      .insert(T)
      .values({ assessmentId, studentId: r.studentId, ...values })
      .onConflictDoUpdate({
        target: [T.assessmentId, T.studentId],
        set: { ...values, version: sql`${T.version} + 1` },
      });
  }
}

/**
 * Per-question responses on a roster-managed assessment (one-writer rule): the roster row gets
 * the computed total as `imported` (present) when the rule and the matching key version allow
 * scoring, else present without marks; an absent attempt marks the row absent.
 */
export async function rosterFromResponses(
  tx: Database,
  actor: Actor,
  a: AssessmentRow,
  attempts: readonly {
    studentId: string;
    status: 'submitted' | 'absent';
    keyVersion: number | null;
    responses: Record<string, (string | null)[]> | null;
  }[],
) {
  const { sections, key } = await sectionsAndKey(tx, a.id);
  const { rules, problems } = resolveRules(a, sections);
  const scoreOf = (t: (typeof attempts)[number]) => {
    if (!key || problems.length > 0 || sections.length === 0 || t.keyVersion !== key.version)
      return null;
    try {
      return formatMarks(scoreAttempt(sections, rules, key.answers, t.responses ?? {}).totalUnits);
    } catch {
      return null; // invalid responses: validation before finalising reports them
    }
  };
  const versions = new Map(
    (
      await tx
        .select({ studentId: R.studentId, version: R.version })
        .from(R)
        .where(eq(R.assessmentId, a.id))
    ).map((r) => [r.studentId as string, r.version]),
  );
  const rows = attempts.map((t) => {
    const score = t.status === 'absent' ? null : scoreOf(t);
    return {
      studentId: t.studentId as StudentId,
      version: versions.get(t.studentId)!,
      attendance: t.status === 'absent' ? ('absent' as const) : ('present' as const),
      marksState: score === null ? ('not_entered' as const) : ('imported' as const),
      score,
    };
  });
  return writeRosterScores(tx, actor, a, { rows, source: 'manual', overwriteVerified: false });
}
