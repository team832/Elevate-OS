/**
 * AcademicDeliverySummaryV1 (ACD-027, D-011.2). MISSING IS NOT ZERO: a metric
 * with no trustworthy source data is `missing` with a reason. Planned figures
 * are never reported as delivered (D-016).
 *
 * Planned vs delivered HOURS are not fields of the v1 contract; they are
 * returned in `extensions` (outside the contract, stripped by contract parsers)
 * until Integration adds them (see docs/INTEGRATION_REQUESTS.md IR-ACD-03).
 */
import { and, count, countDistinct, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  academicAssessments,
  academicAttendance,
  academicBatches,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicPlanItems,
  academicResultRuns,
  programmes,
  type Database,
} from '@elevate/database';
import { academicDeliverySummaryV1Schema, metric, type AcademicDeliverySummaryV1, type Metric } from '@elevate/shared-contracts';
import { summariseAttendance } from '../../domain';
import { currentPlanForBatch } from './curriculum';

type Window = { from: string; to: string };

async function metricsFor(db: Database, window: Window, programmeId: string | null) {
  const meta = (definition: string, unit: Metric['unit']) => ({ definition, window, unit });
  const batchFilter = programmeId ? eq(academicBatches.programmeId, programmeId as never) : undefined;
  const batches = await db.select().from(academicBatches).where(batchFilter);
  const batchIds = batches.map((b) => b.id);
  const inBatches = (col: AnyPgColumn) => (batchIds.length ? inArray(col, batchIds as string[]) : sql`false`);

  const [{ students } = { students: 0 }] = await db
    .select({ students: countDistinct(academicEnrolments.studentId) })
    .from(academicEnrolments)
    .where(and(eq(academicEnrolments.status, 'active'), programmeId ? eq(academicEnrolments.programmeId, programmeId as never) : undefined));
  const activeBatches = batches.filter((b) => b.status === 'active').length;

  const sessions = await db
    .select({ id: academicClassSessions.id, status: academicClassSessions.status, batchId: academicClassSessions.batchId })
    .from(academicClassSessions)
    .where(and(inBatches(academicClassSessions.batchId), gte(academicClassSessions.date, window.from), lte(academicClassSessions.date, window.to)));
  const [{ anySessions } = { anySessions: 0 }] = await db.select({ anySessions: count() }).from(academicClassSessions).where(inBatches(academicClassSessions.batchId));
  const verified = await db
    .select({ sessionId: academicClassRecords.sessionId, minutes: academicClassRecords.actualMinutes })
    .from(academicClassRecords)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicClassRecords.sessionId))
    .where(and(eq(academicClassRecords.state, 'verified'), inBatches(academicClassRecords.batchId), gte(academicClassSessions.date, window.from), lte(academicClassSessions.date, window.to)));
  const deliveredSessions = new Set(verified.map((v) => v.sessionId)).size;
  const noTimetable = 'No class sessions have been timetabled for these batches, so delivery cannot be measured.';

  const held = sessions.filter((s) => s.status === 'held').map((s) => s.id);
  const marks = held.length ? await db.select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status }).from(academicAttendance).where(inArray(academicAttendance.sessionId, held)) : [];
  // Rate over all marks (per-student rows); summariseAttendance works per session, so compute directly.
  const att = summariseAttendance(marks.map((_, i) => String(i)), marks.map((m, i) => ({ sessionId: String(i), status: m.status })));

  const assessments = await db
    .select({ id: academicAssessments.id, status: academicAssessments.status })
    .from(academicAssessments)
    .where(and(inBatches(academicAssessments.batchId), gte(academicAssessments.scheduledDate, window.from), lte(academicAssessments.scheduledDate, window.to)));
  const [{ anyAssessments } = { anyAssessments: 0 }] = await db.select({ anyAssessments: count() }).from(academicAssessments).where(inBatches(academicAssessments.batchId));
  const finalised = await db
    .select({ n: countDistinct(academicResultRuns.assessmentId) })
    .from(academicResultRuns)
    .innerJoin(academicAssessments, eq(academicAssessments.id, academicResultRuns.assessmentId))
    .where(and(eq(academicResultRuns.version, 1), inBatches(academicAssessments.batchId), gte(sql`(${academicResultRuns.finalisedAt} AT TIME ZONE 'Asia/Kolkata')::date`, window.from), lte(sql`(${academicResultRuns.finalisedAt} AT TIME ZONE 'Asia/Kolkata')::date`, window.to)));

  // Syllabus completion and hours: verified minutes vs the planned minutes of the batches' current plans.
  let plannedMinutes = 0;
  let plansFound = 0;
  for (const b of batches.filter((x) => x.status === 'active')) {
    const plan = await currentPlanForBatch(db, b);
    if (!plan) continue;
    plansFound += 1;
    const [{ m } = { m: 0 }] = await db.select({ m: sql<number>`coalesce(sum(${academicPlanItems.plannedMinutes}), 0)`.mapWith(Number) }).from(academicPlanItems).where(eq(academicPlanItems.planId, plan.id));
    plannedMinutes += m;
  }
  const activeIds = batches.filter((b) => b.status === 'active').map((b) => b.id);
  const [{ vm } = { vm: 0 }] = activeIds.length
    ? await db.select({ vm: sql<number>`coalesce(sum(${academicClassRecords.actualMinutes}), 0)`.mapWith(Number) }).from(academicClassRecords).where(and(eq(academicClassRecords.state, 'verified'), inArray(academicClassRecords.batchId, activeIds)))
    : [{ vm: 0 }];

  const metrics = {
    activeStudents: metric.ok(Number(students), meta('Students with an active enrolment at generation time (not limited to the window).', 'count')),
    activeBatches: metric.ok(activeBatches, meta('Batches with status active at generation time.', 'count')),
    classesPlanned:
      Number(anySessions) === 0 ? metric.missing(noTimetable, meta('Class sessions on the timetable dated in the window (any status).', 'count')) : metric.ok(sessions.length, meta('Class sessions on the timetable dated in the window (any status).', 'count')),
    classesDelivered:
      Number(anySessions) === 0 ? metric.missing(noTimetable, meta('Sessions in the window with at least one VERIFIED class record.', 'count')) : metric.ok(deliveredSessions, meta('Sessions in the window with at least one VERIFIED class record.', 'count')),
    classesCancelled:
      Number(anySessions) === 0 ? metric.missing(noTimetable, meta('Sessions in the window cancelled with a reason.', 'count')) : metric.ok(sessions.filter((s) => s.status === 'cancelled').length, meta('Sessions in the window cancelled with a reason.', 'count')),
    attendanceRate:
      att.ratePercent === null
        ? metric.missing('No attendance has been recorded for held sessions in the window.', meta('(present + late + partial) ÷ (recorded − excused) over held sessions in the window.', 'percent'))
        : metric.ok(att.ratePercent, meta('(present + late + partial) ÷ (recorded − excused) over held sessions in the window.', 'percent')),
    assessmentsPlanned:
      Number(anyAssessments) === 0 ? metric.missing('No assessments have been set up for these batches.', meta('Assessments (not cancelled) scheduled in the window.', 'count')) : metric.ok(assessments.filter((a) => a.status !== 'cancelled').length, meta('Assessments (not cancelled) scheduled in the window.', 'count')),
    assessmentsConducted:
      Number(anyAssessments) === 0 ? metric.missing('No assessments have been set up for these batches.', meta('Assessments whose results were first finalised in the window.', 'count')) : metric.ok(Number(finalised[0]?.n ?? 0), meta('Assessments whose results were first finalised in the window.', 'count')),
    studentsAtRisk: metric.missing('Automated risk rules are not implemented (ACD-022 Proposed); see open interventions in Academic OS.', meta('Students flagged at risk by rule.', 'count')),
    syllabusCompletionRate:
      plansFound === 0 || plannedMinutes === 0
        ? metric.missing('No active batch has a locked or provisional curriculum plan.', meta('Verified class minutes ÷ planned minutes of the active batches’ current plans (all time).', 'percent'))
        : metric.ok(Math.round((vm / plannedMinutes) * 1000) / 10, meta('Verified class minutes ÷ planned minutes of the active batches’ current plans (all time).', 'percent')),
  };
  const extensions = {
    hoursPlanned: plansFound === 0 ? null : Math.round((plannedMinutes / 60) * 100) / 100,
    hoursDelivered: plansFound === 0 ? null : Math.round((vm / 60) * 100) / 100,
    hoursDeliveredInWindow: Number(anySessions) === 0 ? null : Math.round((verified.reduce((a, v) => a + v.minutes, 0) / 60) * 100) / 100,
  };
  return { metrics, extensions };
}

export async function buildAcademicDeliverySummary(db: Database, window: Window, now = new Date()) {
  const overall = await metricsFor(db, window, null);
  const progs = await db.select().from(programmes).where(inArray(programmes.status, ['active', 'planned', 'paused']));
  const perProgramme = [];
  for (const p of progs) {
    const m = await metricsFor(db, window, p.id);
    perProgramme.push({ programmeCode: p.code, metrics: m.metrics, extensions: m.extensions });
  }
  const summary: AcademicDeliverySummaryV1 = academicDeliverySummaryV1Schema.parse({
    contract: 'academic.delivery_summary',
    version: 1,
    generatedAt: now.toISOString(),
    window,
    metrics: overall.metrics,
    programmes: perProgramme.map(({ programmeCode, metrics }) => ({ programmeCode, metrics })),
  });
  return {
    ...summary,
    extensions: {
      note: 'Not part of AcademicDeliverySummaryV1; null = missing. Hours = verified class minutes ÷ 60 against planned minutes of current plans.',
      overall: overall.extensions,
      programmes: perProgramme.map(({ programmeCode, extensions }) => ({ programmeCode, ...extensions })),
    },
  };
}
