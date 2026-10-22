/**
 * Marks entry (brief 16): per-student result state — scored (manual total), absent, exempt,
 * withheld (coordinator only) or pending (= no attempt row) — validated against the scheme.
 * Each attempt carries a version: a save against an older version is refused, so two markers
 * never overwrite each other silently. After finalisation a change takes effect only through a
 * re-score (new result version with a reason; ./results.ts).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  academicAnswerKeys,
  academicAssessmentSections,
  academicAssessments,
  academicAttempts,
  academicResults,
  academicStudents,
  academicTeacherAssignments,
  type AcademicAssessmentId,
  type Database,
} from '@elevate/database';
import { scopeFor } from '@elevate/authorization';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, ForbiddenError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { formatMarks, manualScoreProblem, resolveRules, scoreBounds, toNumericString, parseMarks, type SectionSpec } from '../../domain';
import { assertBatchInScope, assignmentActiveOn, audit, resolveScope, todayIst, type Actor } from '../context';
import type { marksBody } from '../schemas-assessment';
import { eligibleStudentIds, getAssessmentOrThrow } from './assessments';

type Assessment = Awaited<ReturnType<typeof getAssessmentOrThrow>>;

/** Teachers mark only assessments of their batches and, when the assessment has a subject, their subject. */
async function assertCanMark(db: Database, actor: Actor, a: Assessment) {
  const scope = await resolveScope(db, actor, 'academic:assessments:mark');
  assertBatchInScope(scope, a.batchId);
  if (scope.kind === 'own' && a.subjectId) {
    const [assigned] = await db
      .select({ id: academicTeacherAssignments.id })
      .from(academicTeacherAssignments)
      .where(and(eq(academicTeacherAssignments.staffMemberId, scope.staffId!), eq(academicTeacherAssignments.batchId, a.batchId), eq(academicTeacherAssignments.subjectId, a.subjectId), assignmentActiveOn(todayIst())))
      .limit(1);
    if (!assigned) throw new NotFoundError('Assessment not found.');
  }
}

const canWithhold = (actor: Actor) => scopeFor(actor.user, 'academic:assessments:publish') !== null;

/** Score bounds from the current rule, sections and latest key; null while the rule is incomplete. */
async function boundsFor(db: Database, a: Assessment) {
  const sections: SectionSpec[] = await db.select().from(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, a.id)).orderBy(asc(academicAssessmentSections.sortOrder));
  const { rules, problems } = resolveRules({ marksPerCorrect: a.marksPerCorrect, marksPerWrong: a.marksPerWrong, marksUnattempted: a.marksUnattempted }, sections);
  if (sections.length === 0 || problems.length > 0) return null;
  const [key] = await db.select({ answers: academicAnswerKeys.answers }).from(academicAnswerKeys).where(eq(academicAnswerKeys.assessmentId, a.id)).orderBy(desc(academicAnswerKeys.version)).limit(1);
  return scoreBounds(sections, rules, key?.answers ?? null);
}

export async function getMarksSheet(db: Database, actor: Actor, assessmentId: string) {
  const a = await getAssessmentOrThrow(db, assessmentId);
  await assertCanMark(db, actor, a);
  const bounds = await boundsFor(db, a);
  const attempts = await db.select().from(academicAttempts).where(eq(academicAttempts.assessmentId, a.id));
  const ids = [...new Set([...(await eligibleStudentIds(db, a)), ...attempts.map((t) => t.studentId as string)])];
  const students = ids.length ? await db.select({ id: academicStudents.id, code: academicStudents.code, fullName: academicStudents.fullName }).from(academicStudents).where(inArray(academicStudents.id, ids as StudentId[])).orderBy(asc(academicStudents.fullName)) : [];
  const byStudent = new Map(attempts.map((t) => [t.studentId as string, t]));
  return {
    assessment: { id: a.id, code: a.code, title: a.title, status: a.status, publishedAt: a.publishedAt },
    bounds: bounds && { min: formatMarks(bounds.minUnits), max: formatMarks(bounds.maxUnits), negativeAllowed: bounds.negativeAllowed },
    canWithhold: canWithhold(actor),
    rows: students.map((s) => {
      const t = byStudent.get(s.id);
      return {
        studentId: s.id,
        code: s.code,
        fullName: s.fullName,
        state: !t ? ('pending' as const) : t.status === 'submitted' ? ('scored' as const) : t.status,
        manualScore: t?.manualScore ? formatMarks(parseMarks(t.manualScore)!) : null,
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
    await assertCanMark(tx, actor, a);
    if (a.status === 'cancelled') throw new InvalidStateTransitionError('The assessment is cancelled.');
    if (input.marks.some((m) => m.state === 'withheld') && !canWithhold(actor)) throw new ForbiddenError('Only an academic coordinator can withhold a result.');
    const ids = input.marks.map((m) => m.studentId);
    if (new Set(ids).size !== ids.length) throw new ValidationError('A student appears twice; nothing was saved.');
    const enrolled = new Set(await eligibleStudentIds(tx, a));
    const outsiders = ids.filter((id) => !enrolled.has(id));
    if (outsiders.length) throw new ValidationError('Some students were not placed in the assessment’s batch on its date; nothing was saved.', { details: { studentIds: outsiders } });
    const bounds = await boundsFor(tx, a);
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
