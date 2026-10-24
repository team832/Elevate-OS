/**
 * Marks entry (brief 16): per-student result state — scored (manual total), absent, exempt,
 * withheld (coordinator only) or pending (= no attempt row) — validated against the scheme.
 * Each attempt carries a version: a save against an older version is refused, so two markers
 * never overwrite each other silently. After finalisation a change takes effect only through a
 * re-score (new result version with a reason; ./results.ts).
 * Roster-managed assessments (Tests and Mock Tests): the sheet reads and writes the roster through
 * the one-writer path — a score is a verified mark of a present student; changing a verified mark
 * or final results needs a reason, so it is done in Business Operations.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicAttempts,
  academicResults,
  academicStudents,
  type AcademicAssessmentId,
  type Database,
} from '@elevate/database';
import { scopeFor } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { formatMarks, manualScoreProblem, toNumericString, parseMarks } from '../../domain';
import { audit, resolveScope, type Actor, type Scope } from '../context';
import { recordScoresLocked } from './assessment-ops';
import { boundsOf } from './assessment-roster';
import { assertAssessmentInScope, markStudentIds } from './assessment-scope';
import type { marksBody } from '../schemas-assessment';
import { eligibleStudentIds, getAssessmentOrThrow } from './assessments';

type Assessment = Awaited<ReturnType<typeof getAssessmentOrThrow>>;

/** Teachers mark only assessments of their batches and, when the assessment has a subject, their subject. */
async function assertCanMark(db: Database, actor: Actor, a: Assessment): Promise<Scope> {
  const scope = await resolveScope(db, actor, 'academic:assessments:mark');
  await assertAssessmentInScope(db, scope, a.id);
  return scope;
}

const canWithhold = (actor: Actor) => scopeFor(actor.user, 'academic:assessments:publish') !== null;

interface SheetRow {
  studentId: string;
  code: string;
  fullName: string;
  state: 'scored' | 'absent' | 'exempt' | 'withheld' | 'pending';
  manualScore: string | null;
  /** Roster-managed only: imported (for review) or verified. */
  marksState: 'not_entered' | 'imported' | 'verified' | null;
  hasResponses: boolean;
  version: number;
  updatedAt: Date | null;
}

/** The roster as the marks sheet (roster-managed assessments). */
async function rosterRows(db: Database, a: Assessment, visible: string[] | null): Promise<SheetRow[]> {
  const R = academicAssessmentRoster;
  const rows = await db.select({ r: R, code: academicStudents.code }).from(R).innerJoin(academicStudents, eq(academicStudents.id, R.studentId)).where(and(eq(R.assessmentId, a.id), isNull(R.removedAt))).orderBy(asc(R.displayNameSnapshot));
  return rows.filter(({ r }) => !visible || visible.includes(r.studentId)).map(({ r, code }) => ({
    studentId: r.studentId,
    code,
    fullName: r.displayNameSnapshot,
    state: r.attendance === 'absent' ? ('absent' as const) : r.attendance === 'excused' ? ('exempt' as const) : r.score !== null ? ('scored' as const) : ('pending' as const),
    manualScore: r.score === null ? null : formatMarks(parseMarks(r.score)!),
    marksState: r.marksState,
    hasResponses: false,
    version: r.version,
    updatedAt: r.updatedAt,
  }));
}

const ROSTER_FACTS = {
  scored: { attendance: 'present', marksState: 'verified' },
  absent: { attendance: 'absent', marksState: 'not_entered' },
  exempt: { attendance: 'excused', marksState: 'not_entered' },
  pending: { attendance: 'unmarked', marksState: 'not_entered' },
} as const;

export async function getMarksSheet(db: Database, actor: Actor, assessmentId: string) {
  const a = await getAssessmentOrThrow(db, assessmentId);
  const scope = await assertCanMark(db, actor, a);
  const bounds = await boundsOf(db, a);
  const sheet = { id: a.id, code: a.code, title: a.title, status: a.status, publishedAt: a.publishedAt, rosterManaged: Boolean(a.rosterSnapshotAt) };
  const shownBounds = bounds && { min: formatMarks(bounds.minUnits), max: formatMarks(bounds.maxUnits), negativeAllowed: bounds.negativeAllowed };
  if (a.rosterSnapshotAt) return { assessment: sheet, bounds: shownBounds, canWithhold: false, rows: await rosterRows(db, a, await markStudentIds(db, scope, a)) };
  const attempts = await db.select().from(academicAttempts).where(eq(academicAttempts.assessmentId, a.id));
  const ids = [...new Set([...(await eligibleStudentIds(db, a)), ...attempts.map((t) => t.studentId as string)])];
  const students = ids.length ? await db.select({ id: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName }).from(academicStudents).where(inArray(academicStudents.id, ids as StudentId[])).orderBy(asc(academicStudents.fullName)) : [];
  const byStudent = new Map(attempts.map((t) => [t.studentId as string, t]));
  return {
    assessment: sheet,
    bounds: shownBounds,
    canWithhold: canWithhold(actor),
    rows: students.map((s): SheetRow => {
      const t = byStudent.get(s.id);
      return {
        studentId: s.id,
        code: s.code,
        fullName: s.fullName,
        state: !t ? ('pending' as const) : t.status === 'submitted' ? ('scored' as const) : t.status,
        manualScore: t?.manualScore ? formatMarks(parseMarks(t.manualScore)!) : null,
        marksState: null,
        hasResponses: Boolean(t?.responses),
        version: t?.version ?? 0,
        updatedAt: t?.updatedAt ?? null,
      };
    }),
  };
}

export async function enterMarks(db: Database, actor: Actor, assessmentId: string, input: z.output<typeof marksBody>) {
  return withTransaction(db, async (tx) => {
    const [a] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, assessmentId as AcademicAssessmentId)).for('update');
    if (!a) throw new NotFoundError('Assessment not found.');
    const scope = await assertCanMark(tx, actor, a);
    if (a.status === 'cancelled') throw new InvalidStateTransitionError('The assessment is cancelled.');
    if (a.rosterSnapshotAt) {
      if (a.status === 'finalised') throw new InvalidStateTransitionError('Results are final: a correction needs a reason, so ask the academic coordinator to correct it in Tests and Mock Tests.');
      const rows = input.marks.map(({ studentId, version, state, manualScore }) => {
        if (state === 'withheld') throw new ValidationError('This test’s roster is managed in Tests and Mock Tests: a result cannot be withheld here.');
        return { studentId: studentId as StudentId, version, ...ROSTER_FACTS[state], score: state === 'scored' ? (manualScore ?? null) : null };
      });
      const visible = await markStudentIds(tx, scope, a);
      if (visible && rows.some((r) => !visible.includes(r.studentId))) throw new NotFoundError('Student not found.');
      const result = await recordScoresLocked(tx, actor, a, { source: 'manual', overwriteVerified: false, rows });
      return { saved: result.changed, afterFinalisation: false, note: null };
    }
    if (input.marks.some((m) => m.state === 'withheld') && !canWithhold(actor)) throw new ForbiddenError('Only an academic coordinator can withhold a result.');
    const ids = input.marks.map((m) => m.studentId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('A student appears twice; nothing was saved.');
    const enrolled = new Set(await eligibleStudentIds(tx, a));
    const outsiders = ids.filter((id) => !enrolled.has(id));
    if (outsiders.length) throw new ValidationError('Some students were not placed in the assessment’s batch on its date; nothing was saved.', { details: { studentIds: outsiders } });
    const bounds = await boundsOf(tx, a);
    const problems = input.marks.flatMap((m) => {
      if (m.state !== 'scored') return [];
      if (!bounds) return [{ studentId: m.studentId, message: 'Configure the scoring rule and sections first: the maximum is not known.' }];
      const problem = manualScoreProblem(m.manualScore ?? '', bounds);
      return problem ? [{ studentId: m.studentId, message: problem }] : [];
    });
    if (problems.length) throw new ValidationError('Some marks do not fit the scheme; nothing was saved.', { details: problems });
    const before = await tx.select().from(academicAttempts).where(and(eq(academicAttempts.assessmentId, a.id), inArray(academicAttempts.studentId, ids as StudentId[]))).for('update');
    const current = new Map(before.map((t) => [t.studentId as string, t]));
    const stale = input.marks.filter((m) => (current.get(m.studentId)?.version ?? 0) !== m.version);
    if (stale.length) throw new ConflictError('These marks changed since you opened it; reload the sheet and enter them again.', { details: { studentIds: stale.map((m) => m.studentId) } });
    for (const m of input.marks) {
      const existing = current.get(m.studentId);
      if (existing?.status === 'withheld' && !canWithhold(actor)) throw new ForbiddenError('A coordinator withheld this result; only a coordinator can change it.');
      if (m.state !== 'pending' && existing?.responses) throw new ValidationError('This student has recorded answers. Clear the recorded answers first (set Pending marking), then enter the result.', { details: { studentId: m.studentId } });
      if (m.state === 'pending') {
        if (!existing) continue;
        const [used] = await tx.select({ id: academicResults.id }).from(academicResults).where(eq(academicResults.attemptId, existing.id)).limit(1);
        if (used) throw new InvalidStateTransitionError('A student with a finalised result cannot go back to pending; enter absent, exempt or a score, then ask the academic coordinator to re-score.');
        await tx.delete(academicAttempts).where(eq(academicAttempts.id, existing.id));
        continue;
      }
      const values = {
        status: m.state === 'scored' ? ('submitted' as const) : m.state,
        manualScore: m.state === 'scored' ? toNumericString(parseMarks(m.manualScore)!) : null,
        responses: null,
        keyVersion: null,
        markedByUserId: actor.user.id,
        enteredByUserId: actor.user.id,
      };
      if (existing) await tx.update(academicAttempts).set({ ...values, version: sql`${academicAttempts.version} + 1` }).where(eq(academicAttempts.id, existing.id));
      else await tx.insert(academicAttempts).values({ ...values, assessmentId: a.id, studentId: m.studentId as StudentId });
    }
    if (a.status === 'draft' || a.status === 'scheduled') await tx.update(academicAssessments).set({ status: 'conducted' }).where(eq(academicAssessments.id, a.id));
    await audit(tx, actor, {
      action: 'marks.entered',
      entityType: 'assessment',
      entityId: a.id,
      before: before.map((t) => ({ studentId: t.studentId, status: t.status, manualScore: t.manualScore, responses: t.responses, keyVersion: t.keyVersion, version: t.version })),
      after: input.marks,
      metadata: { afterFinalisation: a.status === 'finalised' },
    });
    return { saved: input.marks.length, afterFinalisation: a.status === 'finalised', note: a.status === 'finalised' ? 'Saved. Results are final: ask the academic coordinator to re-score so this change counts.' : null };
  });
}
