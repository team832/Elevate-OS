/**
 * Assessments (ACD-016, ACD-017): assessment records, configurable scoring
 * rules (per assessment, overridable per section), answer-key versions and
 * student attempts (responses). Finalisation and results: ./results.ts.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  academicAnswerKeys,
  academicAssessmentSections,
  academicAssessments,
  academicAttempts,
  academicBatches,
  academicChapters,
  academicBatchPlacements,
  academicEnrolments,
  academicResultRuns,
  academicStudents,
  academicSubjects,
  type AcademicAssessmentId,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { BatchId, StudentId } from '@elevate/shared-types';
import type { z } from 'zod';
import { parseResponsesCsv, toNumericString, parseMarks } from '../../domain';
import { assertBatchInScope, audit, getBatchOrThrow, resolveScope, type Actor } from '../context';
import type { answerKeyBody, attemptsBody, createAssessmentBody, scoringBody, sectionBody } from '../schemas';

const dbMark = (v: string | null | undefined) => (v === null || v === undefined ? null : toNumericString(parseMarks(v)!));

/**
 * Students expected to sit an assessment (R13): a placement in its batch covering the scheduled
 * date; with no date, an open placement. A student who sat and then transferred still counts;
 * one who joined after the date does not.
 */
export async function eligibleStudentIds(db: Database, a: { batchId: string; scheduledDate: string | null }): Promise<string[]> {
  const p = academicBatchPlacements;
  const covers = a.scheduledDate ? and(lte(p.startDate, a.scheduledDate), or(isNull(p.endDate), gte(p.endDate, a.scheduledDate))) : isNull(p.endDate);
  const rows = await db
    .selectDistinct({ id: academicEnrolments.studentId })
    .from(p)
    .innerJoin(academicEnrolments, eq(academicEnrolments.id, p.enrolmentId))
    .where(and(eq(p.batchId, a.batchId as BatchId), covers));
  return rows.map((r) => r.id as string);
}

export async function getAssessmentOrThrow(db: Database, id: string) {
  const [row] = await db.select().from(academicAssessments).where(eq(academicAssessments.id, id as AcademicAssessmentId));
  if (!row) throw new NotFoundError('Assessment not found.');
  return row;
}

export async function listAssessments(db: Database, actor: Actor, filter: { batchId?: string } = {}) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  if (scope.kind === 'own' && scope.batchIds.length === 0) return [];
  const conditions = [];
  if (filter.batchId) conditions.push(eq(academicAssessments.batchId, filter.batchId as BatchId));
  if (scope.kind === 'own') conditions.push(inArray(academicAssessments.batchId, scope.batchIds));
  const rows = await db
    .select({ a: academicAssessments, batchCode: academicBatches.code })
    .from(academicAssessments)
    .innerJoin(academicBatches, eq(academicBatches.id, academicAssessments.batchId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(academicAssessments.scheduledDate), asc(academicAssessments.code))
    .limit(1000);
  return rows.map((r) => ({ ...r.a, batchCode: r.batchCode }));
}

function sectionValues(assessmentId: AcademicAssessmentId, sections: z.output<typeof sectionBody>[]) {
  return sections.map((s, i) => ({
    assessmentId,
    code: s.code,
    name: s.name,
    sortOrder: i,
    questionCount: s.questionCount,
    answerFormat: s.answerFormat,
    options: s.options.map((o) => o.toUpperCase()),
    timeLimitMinutes: s.timeLimitMinutes ?? null,
    marksPerCorrect: dbMark(s.marksPerCorrect),
    marksPerWrong: dbMark(s.marksPerWrong),
    marksUnattempted: dbMark(s.marksUnattempted),
    capMarks: dbMark(s.capMarks),
  }));
}

export async function createAssessment(db: Database, actor: Actor, input: z.output<typeof createAssessmentBody>) {
  return withTransaction(db, async (tx) => {
    const batch = await getBatchOrThrow(tx, input.batchId);
    if (input.subjectId) {
      const [subject] = await tx.select().from(academicSubjects).where(eq(academicSubjects.id, input.subjectId as never));
      if (!subject || subject.courseId !== batch.courseId) throw new ValidationError('The subject is not part of the batch’s course.');
    }
    if (input.chapterIds.length > 0) {
      const chapters = await tx.select({ id: academicChapters.id }).from(academicChapters).where(and(inArray(academicChapters.id, input.chapterIds as never[]), eq(academicChapters.courseId, batch.courseId)));
      if (chapters.length !== new Set(input.chapterIds).size) throw new ValidationError('Every chapter must belong to the batch’s course.');
    }
    const [row] = await tx
      .insert(academicAssessments)
      .values({
        code: input.code,
        title: input.title,
        kind: input.kind,
        batchId: batch.id,
        subjectId: (input.subjectId as never) ?? null,
        chapterIds: input.chapterIds,
        scheduledDate: input.scheduledDate ?? null,
        startTime: input.startTime ?? null,
        durationMinutes: input.durationMinutes ?? null,
        discussionMinutes: input.discussionMinutes ?? null,
        status: input.scheduledDate ? 'scheduled' : 'draft',
        patternRef: input.patternRef ?? null,
        marksPerCorrect: dbMark(input.marksPerCorrect),
        marksPerWrong: dbMark(input.marksPerWrong),
        marksUnattempted: dbMark(input.marksUnattempted),
        createdByUserId: actor.user.id,
      })
      .returning();
    if (input.sections.length > 0) await tx.insert(academicAssessmentSections).values(sectionValues(row!.id, input.sections));
    await audit(tx, actor, { action: 'assessment.created', entityType: 'assessment', entityId: row!.id, after: row, metadata: { sections: input.sections.length } });
    return row!;
  });
}

export async function getAssessment(db: Database, actor: Actor, id: string) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  const assessment = await getAssessmentOrThrow(db, id);
  assertBatchInScope(scope, assessment.batchId);
  const [batch] = await db.select().from(academicBatches).where(eq(academicBatches.id, assessment.batchId));
  const sections = await db.select().from(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, assessment.id)).orderBy(asc(academicAssessmentSections.sortOrder));
  const keys = await db
    .select({ id: academicAnswerKeys.id, version: academicAnswerKeys.version, note: academicAnswerKeys.note, createdAt: academicAnswerKeys.createdAt })
    .from(academicAnswerKeys)
    .where(eq(academicAnswerKeys.assessmentId, assessment.id))
    .orderBy(desc(academicAnswerKeys.version));
  const attemptCounts = await db
    .select({ status: academicAttempts.status, n: count() })
    .from(academicAttempts)
    .where(eq(academicAttempts.assessmentId, assessment.id))
    .groupBy(academicAttempts.status);
  const runs = await db.select().from(academicResultRuns).where(eq(academicResultRuns.assessmentId, assessment.id)).orderBy(desc(academicResultRuns.version));
  return {
    ...assessment,
    batchCode: batch!.code,
    sections,
    answerKeys: keys,
    attempts: Object.fromEntries(attemptCounts.map((a) => [a.status, Number(a.n)])) as Partial<Record<(typeof attemptCounts)[number]['status'], number>>,
    resultRuns: runs.map(({ ruleSnapshot: _r, ...run }) => run),
  };
}

/** Replace the scoring rule. Sections can be restructured only while no attempts exist. */
export async function configureScoring(db: Database, actor: Actor, id: string, input: z.output<typeof scoringBody>) {
  return withTransaction(db, async (tx) => {
    const [assessment] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, id as AcademicAssessmentId)).for('update');
    if (!assessment) throw new NotFoundError('Assessment not found.');
    if (assessment.status === 'finalised' || assessment.status === 'cancelled') {
      throw new InvalidStateTransitionError(`The assessment is ${assessment.status}; its rule is frozen in the result version (re-score to apply a corrected key).`);
    }
    const codes = input.sections.map((s) => s.code);
    if (new Set(codes).size !== codes.length) throw new ValidationError('Section codes must be unique.');
    const before = await tx.select().from(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, assessment.id));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(academicAttempts).where(eq(academicAttempts.assessmentId, assessment.id));
    const structureChanged =
      before.length !== input.sections.length ||
      input.sections.some((s) => {
        const old = before.find((b) => b.code === s.code);
        return !old || old.questionCount !== s.questionCount || old.answerFormat !== s.answerFormat;
      });
    if (Number(n) > 0 && structureChanged) {
      throw new ConflictError('Responses have been entered; sections (codes, question counts, formats) can no longer change.');
    }
    const [updated] = await tx
      .update(academicAssessments)
      .set({ marksPerCorrect: dbMark(input.marksPerCorrect), marksPerWrong: dbMark(input.marksPerWrong), marksUnattempted: dbMark(input.marksUnattempted) })
      .where(eq(academicAssessments.id, assessment.id))
      .returning();
    await tx.delete(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, assessment.id));
    const sections = await tx.insert(academicAssessmentSections).values(sectionValues(assessment.id, input.sections)).returning();
    await audit(tx, actor, { action: 'assessment.scoring_configured', entityType: 'assessment', entityId: assessment.id, before: { rule: assessment, sections: before }, after: { rule: updated, sections } });
    return { assessment: updated!, sections };
  });
}

/** Add an answer-key version (version = previous + 1). Older versions are kept. */
export async function addAnswerKey(db: Database, actor: Actor, id: string, input: z.output<typeof answerKeyBody>) {
  return withTransaction(db, async (tx) => {
    const [assessment] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, id as AcademicAssessmentId)).for('update');
    if (!assessment) throw new NotFoundError('Assessment not found.');
    if (assessment.status === 'cancelled') throw new InvalidStateTransitionError('The assessment is cancelled.');
    const sections = await tx.select().from(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, assessment.id));
    if (sections.length === 0) throw new ValidationError('Configure the sections before entering an answer key.');
    const unknown = Object.keys(input.answers).filter((c) => !sections.some((s) => s.code === c));
    if (unknown.length > 0) throw new ValidationError(`Unknown section(s): ${unknown.join(', ')}.`);
    const [{ max } = { max: 0 }] = await tx
      .select({ max: sql<number>`coalesce(max(${academicAnswerKeys.version}), 0)`.mapWith(Number) })
      .from(academicAnswerKeys)
      .where(eq(academicAnswerKeys.assessmentId, assessment.id));
    const answers = Object.fromEntries(Object.entries(input.answers).map(([k, v]) => [k, v.map((a) => (a === null || a === '' ? null : a))]));
    const [row] = await tx
      .insert(academicAnswerKeys)
      .values({ assessmentId: assessment.id, version: max + 1, answers, note: input.note ?? null, createdByUserId: actor.user.id })
      .returning();
    await audit(tx, actor, { action: 'answer_key.added', entityType: 'assessment', entityId: assessment.id, after: { version: row!.version, note: row!.note } });
    return row!;
  });
}

/**
 * Enter or import attempts (CSV by student code, or JSON by student id).
 * Duplicates inside one import are rejected as a whole (nothing saved); an
 * existing attempt for a student is replaced and the change audited.
 */
export async function upsertAttempts(db: Database, actor: Actor, id: string, input: z.output<typeof attemptsBody>) {
  return withTransaction(db, async (tx) => {
    const [assessment] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, id as AcademicAssessmentId)).for('update');
    if (!assessment) throw new NotFoundError('Assessment not found.');
    if (assessment.status === 'cancelled') throw new InvalidStateTransitionError('The assessment is cancelled.');
    let rows: { studentId: string; status: 'submitted' | 'absent'; keyVersion: number | null; responses: Record<string, (string | null)[]> | null }[];
    if (input.csv !== undefined) {
      const parsed = parseResponsesCsv(input.csv);
      if (parsed.problems.length > 0) throw new ValidationError('The responses file has problems; nothing was saved.', { details: parsed.problems });
      const codes = parsed.attempts.map((a) => a.studentCode);
      const students = codes.length ? await tx.select({ id: academicStudents.id, code: academicStudents.code }).from(academicStudents).where(inArray(academicStudents.code, codes)) : [];
      const byCode = new Map(students.map((s) => [s.code, s.id]));
      const unknown = codes.filter((c) => !byCode.has(c));
      if (unknown.length > 0) throw new ValidationError(`Unknown student code(s): ${unknown.join(', ')}; nothing was saved.`);
      rows = parsed.attempts.map((a) => ({ studentId: byCode.get(a.studentCode)!, status: a.status, keyVersion: a.keyVersion, responses: a.responses }));
    } else {
      rows = input.attempts!.map((a) => ({ studentId: a.studentId, status: a.status, keyVersion: a.keyVersion ?? null, responses: a.status === 'absent' ? null : (a.responses ?? {}) }));
    }
    const ids = rows.map((r) => r.studentId);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length > 0) throw new ValidationError('Duplicate attempts in this import; nothing was saved.', { details: { studentIds: [...new Set(dupes)] } });
    const enrolled = new Set(
      await eligibleStudentIds(tx, assessment),
    );
    const outsiders = ids.filter((s) => !enrolled.has(s));
    if (outsiders.length > 0) throw new ValidationError('Some students were not placed in the batch on the assessment date; nothing was saved.', { details: { studentIds: outsiders } });
    const before = await tx.select().from(academicAttempts).where(and(eq(academicAttempts.assessmentId, assessment.id), inArray(academicAttempts.studentId, ids as StudentId[])));
    for (const r of rows) {
      await tx
        .insert(academicAttempts)
        .values({ assessmentId: assessment.id, studentId: r.studentId as StudentId, status: r.status, responses: r.responses, keyVersion: r.status === 'absent' ? null : r.keyVersion, enteredByUserId: actor.user.id })
        .onConflictDoUpdate({
          target: [academicAttempts.assessmentId, academicAttempts.studentId],
          set: { status: r.status, responses: r.responses, manualScore: null, keyVersion: r.status === 'absent' ? null : r.keyVersion, enteredByUserId: actor.user.id, version: sql`${academicAttempts.version} + 1` },
        });
    }
    if (assessment.status === 'draft' || assessment.status === 'scheduled') {
      await tx.update(academicAssessments).set({ status: 'conducted' }).where(eq(academicAssessments.id, assessment.id));
    }
    await audit(tx, actor, {
      action: before.length > 0 ? 'attempts.replaced' : 'attempts.entered',
      entityType: 'assessment',
      entityId: assessment.id,
      before: before.map((b) => ({ studentId: b.studentId, status: b.status, keyVersion: b.keyVersion, responses: b.responses })),
      after: rows,
      metadata: { afterFinalisation: assessment.status === 'finalised' },
    });
    return { saved: rows.length, replaced: before.length, submitted: rows.filter((r) => r.status === 'submitted').length, absent: rows.filter((r) => r.status === 'absent').length };
  });
}
