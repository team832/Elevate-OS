/**
 * Results (ACD-018): validation before finalising, immutable result versions,
 * re-scoring into a new version (audited, previous kept), result listing, and
 * the assessment scheduling check (ACD-012/024/026).
 */
import { and, asc, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import {
  academicAnswerKeys,
  academicAssessmentSections,
  academicAssessments,
  academicAttempts,
  academicBatches,
  academicEnrolments,
  academicPlanItems,
  academicResultRuns,
  academicResults,
  academicStudents,
  programmes,
  type Database,
} from '@elevate/database';
import { publishEvent, withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, NotFoundError, ValidationError } from '@elevate/shared-contracts';
import type { z } from 'zod';
import {
  aggregateResults,
  checkAssessmentSchedule,
  toNumericString,
  validateForFinalise,
  type AssessmentCandidate,
  type BlackoutWindow,
  type FinaliseInput,
  type SectionSpec,
} from '../../domain';
import { assertBatchInScope, audit, getBatchOrThrow, resolveScope, studentIdsInScope, type Actor } from '../context';
import type { scheduleCheckBody } from '../schemas';
import { getAssessmentOrThrow } from './assessments';
import { currentPlanForBatch } from './curriculum';
import { getSetting } from './settings';
import { batchClassesBetween, datedExclusionsFor } from './timetable';

/** Load everything validateForFinalise needs (latest answer key = current key). */
async function finaliseInput(db: Database, assessmentId: string) {
  const assessment = await getAssessmentOrThrow(db, assessmentId);
  const sectionRows = await db.select().from(academicAssessmentSections).where(eq(academicAssessmentSections.assessmentId, assessment.id)).orderBy(asc(academicAssessmentSections.sortOrder));
  const [key] = await db.select().from(academicAnswerKeys).where(eq(academicAnswerKeys.assessmentId, assessment.id)).orderBy(desc(academicAnswerKeys.version)).limit(1);
  const attempts = await db.select().from(academicAttempts).where(eq(academicAttempts.assessmentId, assessment.id));
  const enrolled = await db
    .select({ id: academicEnrolments.studentId })
    .from(academicEnrolments)
    .where(and(eq(academicEnrolments.batchId, assessment.batchId), eq(academicEnrolments.status, 'active')));
  const sections: SectionSpec[] = sectionRows.map((s) => ({
    code: s.code,
    name: s.name,
    questionCount: s.questionCount,
    answerFormat: s.answerFormat,
    options: s.options,
    marksPerCorrect: s.marksPerCorrect,
    marksPerWrong: s.marksPerWrong,
    marksUnattempted: s.marksUnattempted,
    capMarks: s.capMarks,
  }));
  const input: FinaliseInput = {
    assessmentRule: { marksPerCorrect: assessment.marksPerCorrect, marksPerWrong: assessment.marksPerWrong, marksUnattempted: assessment.marksUnattempted },
    sections,
    key: key ? { version: key.version, answers: key.answers } : null,
    attempts: attempts.map((a) => ({ attemptId: a.id, studentId: a.studentId, status: a.status, responses: a.responses, keyVersion: a.keyVersion })),
    enrolledStudentIds: [...new Set(enrolled.map((e) => e.id as string))],
  };
  return { assessment, input, keyId: key?.id ?? null };
}

export async function validateAssessment(db: Database, actor: Actor, assessmentId: string) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  const { assessment, input } = await finaliseInput(db, assessmentId);
  assertBatchInScope(scope, assessment.batchId);
  const v = validateForFinalise(input);
  return { ok: v.ok, issues: v.issues, keyVersion: input.key?.version ?? null, attempts: input.attempts.length, enrolled: input.enrolledStudentIds.length };
}

/** Score, write an immutable result version, publish academic.assessment.finalised v1. */
async function writeRun(tx: Database, actor: Actor, assessmentId: string, version: number, reason: string | null) {
  const { assessment, input, keyId } = await finaliseInput(tx, assessmentId);
  const v = validateForFinalise(input);
  if (!v.ok) throw new ValidationError('The assessment is not ready to finalise; fix every issue first.', { details: v.issues });
  const agg = aggregateResults(input.sections, v.rules, input.key!.answers, input.attempts);
  const snapshot = { assessmentRule: input.assessmentRule, sections: input.sections, keyVersion: input.key!.version };
  const [run] = await tx
    .insert(academicResultRuns)
    .values({ assessmentId: assessment.id, version, answerKeyId: keyId!, status: 'final', ruleSnapshot: snapshot, reason, studentsScored: agg.scored, studentsAbsent: agg.absent, finalisedByUserId: actor.user.id })
    .returning();
  const maxUnits = agg.results.find((r) => r.score)?.score?.maxUnits ?? 0;
  if (agg.results.length > 0) {
    await tx.insert(academicResults).values(
      agg.results.map((r) => ({
        runId: run!.id,
        assessmentId: assessment.id,
        attemptId: r.attemptId as never,
        studentId: r.studentId as never,
        totalScore: r.score ? toNumericString(r.score.totalUnits) : null,
        maxScore: toNumericString(r.score?.maxUnits ?? maxUnits),
        percentile: r.percentile,
        rank: r.rank,
        sectionScores: r.score?.sections ?? [],
        absent: r.absent,
      })),
    );
  }
  await tx.update(academicAssessments).set({ status: 'finalised' }).where(eq(academicAssessments.id, assessment.id));
  const [batch] = await tx.select({ programmeCode: programmes.code }).from(academicBatches).innerJoin(programmes, eq(programmes.id, academicBatches.programmeId)).where(eq(academicBatches.id, assessment.batchId));
  await publishEvent(tx, {
    type: 'academic.assessment.finalised',
    version: 1,
    idempotencyKey: `assessment-finalised:${assessment.id}:v${version}`,
    payload: {
      assessmentId: assessment.id,
      assessmentCode: assessment.code,
      kind: assessment.kind,
      batchId: assessment.batchId,
      programmeCode: batch!.programmeCode,
      resultVersion: version,
      studentsScored: agg.scored,
      studentsAbsent: agg.absent,
      finalisedAt: run!.finalisedAt.toISOString(),
      finalisedByUserId: actor.user.id,
    } as never,
  });
  return { assessment, run: run!, aggregate: agg };
}

export async function finaliseAssessment(db: Database, actor: Actor, assessmentId: string) {
  return withTransaction(db, async (tx) => {
    const [locked] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, assessmentId as never)).for('update');
    if (!locked) throw new NotFoundError('Assessment not found.');
    if (locked.status === 'finalised') throw new InvalidStateTransitionError('Results are already final; re-score to create a new version.');
    if (locked.status === 'cancelled') throw new InvalidStateTransitionError('The assessment is cancelled.');
    const { run, aggregate } = await writeRun(tx, actor, locked.id, 1, null);
    await audit(tx, actor, { action: 'assessment.finalised', entityType: 'assessment', entityId: locked.id, before: { status: locked.status }, after: { status: 'finalised', runId: run.id, version: 1, scored: aggregate.scored, absent: aggregate.absent } });
    return { run, scored: aggregate.scored, absent: aggregate.absent, sectionStats: aggregate.sectionStats };
  });
}

/** Re-score with the current key/rule/responses: previous run → superseded (rows kept), new run version + 1. */
export async function rescoreAssessment(db: Database, actor: Actor, assessmentId: string, reason: string) {
  return withTransaction(db, async (tx) => {
    const [locked] = await tx.select().from(academicAssessments).where(eq(academicAssessments.id, assessmentId as never)).for('update');
    if (!locked) throw new NotFoundError('Assessment not found.');
    if (locked.status !== 'finalised') throw new InvalidStateTransitionError('Only finalised results can be re-scored; finalise first.');
    const [previous] = await tx.select().from(academicResultRuns).where(and(eq(academicResultRuns.assessmentId, locked.id), eq(academicResultRuns.status, 'final'))).for('update');
    if (!previous) throw new InvalidStateTransitionError('No final result version exists.');
    const previousResults = await tx.select({ studentId: academicResults.studentId, totalScore: academicResults.totalScore }).from(academicResults).where(eq(academicResults.runId, previous.id));
    await tx.update(academicResultRuns).set({ status: 'superseded', supersededAt: new Date() }).where(eq(academicResultRuns.id, previous.id));
    const { run, aggregate } = await writeRun(tx, actor, locked.id, previous.version + 1, reason);
    await audit(tx, actor, {
      action: 'assessment.rescored',
      entityType: 'assessment',
      entityId: locked.id,
      before: { runId: previous.id, version: previous.version, totals: previousResults },
      after: { runId: run.id, version: run.version, totals: aggregate.results.map((r) => ({ studentId: r.studentId, totalScore: r.score?.total ?? null })) },
      metadata: { reason },
    });
    return { run, previousVersion: previous.version, scored: aggregate.scored, absent: aggregate.absent };
  });
}

export async function getResults(db: Database, actor: Actor, assessmentId: string, version?: number) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  const assessment = await getAssessmentOrThrow(db, assessmentId);
  assertBatchInScope(scope, assessment.batchId);
  const runs = await db.select().from(academicResultRuns).where(eq(academicResultRuns.assessmentId, assessment.id)).orderBy(desc(academicResultRuns.version));
  const run = version ? runs.find((r) => r.version === version) : runs.find((r) => r.status === 'final');
  if (!run) return { assessment, run: null, versions: runs.map((r) => ({ version: r.version, status: r.status, reason: r.reason, finalisedAt: r.finalisedAt })), results: [] };
  const visible = await studentIdsInScope(db, scope);
  const rows = await db
    .select({ result: academicResults, code: academicStudents.code, fullName: academicStudents.fullName })
    .from(academicResults)
    .innerJoin(academicStudents, eq(academicStudents.id, academicResults.studentId))
    .where(and(eq(academicResults.runId, run.id), visible ? inArray(academicResults.studentId, visible.length ? visible : ['00000000-0000-4000-8000-000000000000' as never]) : undefined))
    .orderBy(asc(academicResults.rank), asc(academicStudents.fullName));
  return {
    assessment,
    run: { id: run.id, version: run.version, status: run.status, reason: run.reason, finalisedAt: run.finalisedAt, studentsScored: run.studentsScored, studentsAbsent: run.studentsAbsent },
    versions: runs.map((r) => ({ version: r.version, status: r.status, reason: r.reason, finalisedAt: r.finalisedAt })),
    results: rows.map((r) => ({ ...r.result, studentCode: r.code, studentName: r.fullName })),
  };
}

/**
 * Check assessment dates for a batch: either the given candidates, or every
 * not-cancelled assessment of the batch that has a date. Blackouts = the
 * batch's target exam date (with its status) + exam_blackout exclusions
 * (dated or windows) + dated holiday/school-exam closures.
 */
export async function checkAssessmentScheduleFor(db: Database, actor: Actor, input: z.output<typeof scheduleCheckBody>) {
  const scope = await resolveScope(db, actor, 'academic:assessments:read');
  assertBatchInScope(scope, input.batchId);
  const batch = await getBatchOrThrow(db, input.batchId);
  const existing = await db
    .select()
    .from(academicAssessments)
    .where(and(eq(academicAssessments.batchId, batch.id), ne(academicAssessments.status, 'cancelled')));
  const plan = await currentPlanForBatch(db, batch);
  const items = plan ? await db.select({ chapterId: academicPlanItems.chapterId, plannedDate: academicPlanItems.plannedDate }).from(academicPlanItems).where(eq(academicPlanItems.planId, plan.id)) : [];
  const completionOf = (chapterIds: readonly string[]) => {
    const dates = items.filter((i) => chapterIds.includes(i.chapterId) && i.plannedDate).map((i) => i.plannedDate!);
    return dates.length > 0 ? dates.sort().at(-1)! : null;
  };
  const candidates: AssessmentCandidate[] = input.candidates
    ? input.candidates.map((c) => ({ id: c.id, label: c.label, date: c.date, startTime: c.startTime ?? null, durationMinutes: c.durationMinutes ?? null, discussionDate: c.discussionDate ?? null, prerequisiteCompletion: completionOf(c.chapterIds) }))
    : existing
        .filter((a) => a.scheduledDate)
        .map((a) => ({ id: a.id, label: a.code, date: a.scheduledDate!, startTime: a.startTime, durationMinutes: a.durationMinutes, discussionDate: null, prerequisiteCompletion: completionOf(a.chapterIds) }));
  const others = input.candidates
    ? existing.filter((a) => a.scheduledDate).map((a) => ({ id: a.id, label: a.code, date: a.scheduledDate!, startTime: a.startTime, durationMinutes: a.durationMinutes }))
    : [];
  const dates = candidates.flatMap((c) => [c.date, c.discussionDate ?? c.date]).sort();
  const classes = dates.length ? await batchClassesBetween(db, batch.id, dates[0]!, dates.at(-1)!) : [];
  const exclusions = await datedExclusionsFor(db, batch.id);
  const blackouts: BlackoutWindow[] = [];
  if (batch.targetExamDate) {
    blackouts.push({ label: batch.targetExam ?? 'Target exam', kind: 'exam', from: batch.targetExamDate, to: batch.targetExamDate, status: batch.targetExamDateStatus ?? 'unverified' });
  }
  for (const x of exclusions) {
    if (x.kind === 'exam_blackout') {
      const from = x.date ?? x.periodStart;
      const to = x.date ?? x.periodEnd;
      if (from && to) blackouts.push({ label: x.label, kind: x.date ? 'exam' : 'mock_phase', from, to, status: x.status });
    } else if (x.date) {
      blackouts.push({ label: x.label, kind: 'closure', from: x.date, to: x.date, status: x.status });
    }
  }
  const gap = await getSetting(db, 'assessments.min_gap_days');
  const result = checkAssessmentSchedule({
    candidates,
    otherAssessments: others,
    classes: classes.map((c) => ({ id: c.id, label: `Class ${c.date} ${c.startTime}`, date: c.date, startTime: c.startTime, durationMinutes: c.durationMinutes })),
    blackouts,
    minGap: gap.value.minDays > 0 ? gap.value : null,
  });
  return { batch: { id: batch.id, code: batch.code }, blackouts, minGap: { ...gap.value, status: gap.status }, checked: candidates.length, ...result };
}

/** Assessments of a batch in a window (progress, catch-up). */
export async function assessmentsBetween(db: Database, batchIds: string[], from: string, to: string) {
  if (batchIds.length === 0) return [];
  return db
    .select()
    .from(academicAssessments)
    .where(and(inArray(academicAssessments.batchId, batchIds as never[]), gte(academicAssessments.scheduledDate, from), lte(academicAssessments.scheduledDate, to), ne(academicAssessments.status, 'cancelled')));
}
