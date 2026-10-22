/**
 * AcademicDeliverySummaryV1 follows R11/R12: delivered sessions = sessions marked delivered (held);
 * syllabus completion and hours count first-teaching (main) verified minutes only.
 */
import { describe, expect, it } from 'vitest';
import { academicClassRecords, academicCurriculumPlans, academicPlanItems } from '@elevate/database';
import { buildAcademicDeliverySummary, createSessions } from '../../src/server';
import { markHeld } from './a4-helpers';
import { setupTestDatabase } from '@elevate/testing';
import { actor, users, world } from './fixtures';

const ctx = setupTestDatabase();

describe('delivery summary (R11, R12)', () => {
  it('counts held sessions as delivered and never adds revision minutes to coverage', async () => {
    const u = await users(ctx.db);
    const w = await world(ctx.db, u);
    const at = (date: string) => ({ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, actor(u.coordinator), ['2026-09-07', '2026-09-08', '2026-09-09'].map(at));
    const [s1, s2, s3] = sessions.map((s) => s.id as string) as [string, string, string];
    await markHeld(ctx.db, [s1, s2, s3]); // s3 delivered without a log yet: still delivered
    const [plan] = await ctx.db
      .insert(academicCurriculumPlans)
      .values({ courseId: w.course.id, code: 'PLAN-T (fictional)', title: 'Test plan (fictional)', status: 'provisional', classMinutes: 75, createdByUserId: u.coordinator.id } as never)
      .returning();
    await ctx.db.insert(academicPlanItems).values({ planId: plan!.id, chapterId: w.ch1.id, sequence: 1, lessonCode: 'L1', sessionType: 'teaching', plannedMinutes: 120 } as never);
    const record = (sessionId: string, activity: 'main' | 'revision', minutes: number) => ({
      sessionId,
      batchId: w.batch.id,
      chapterId: w.ch1.id,
      teacherStaffId: w.teacherStaff,
      activity,
      completion: 'completed' as const,
      actualMinutes: minutes,
      state: 'verified' as const,
      submittedAt: new Date(),
      verifiedAt: new Date(),
      verifiedByUserId: u.coordinator.id,
      recordedByUserId: u.teacher.id,
    });
    await ctx.db.insert(academicClassRecords).values([record(s1, 'main', 60), record(s2, 'revision', 30)] as never);
    const summary = await buildAcademicDeliverySummary(ctx.db, { from: '2026-09-01', to: '2026-09-30' });
    expect(summary.metrics.classesPlanned).toMatchObject({ value: 3 });
    expect(summary.metrics.classesDelivered).toMatchObject({ value: 3 });
    expect(summary.metrics.syllabusCompletionRate).toMatchObject({ value: 50 });
    expect(summary.extensions.overall).toMatchObject({ hoursPlanned: 2, hoursDelivered: 1, hoursDeliveredInWindow: 1 });
  });
});
