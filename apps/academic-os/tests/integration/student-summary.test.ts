import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicBatchPlacements, academicClassSessions, academicEnrolments } from '@elevate/database';
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import { buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as summaryRoute } from '../../src/app/api/internal/v1/students/[id]/summary/route';
import {
  addAnswerKey,
  createAssessment,
  createSessions,
  createStudent,
  enrolManually,
  finaliseAssessment,
  publishResults,
  recordClass,
  upsertAttempts,
} from '../../src/server';
import { attemptsBody, createAssessmentBody } from '../../src/server/schemas';
import { attend, markHeld } from './a4-helpers';
import { actor, uniq, users, world } from './fixtures';

const ctx = setupTestDatabase();
const path = (id: string, query = '') => `/academic/api/internal/v1/students/${id}/summary${query}`;
const internal = (id: string, query = '', caller = 'ops') =>
  buildRequest(path(id, query), {
    headers: {
      authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`,
      'x-elevate-caller': caller,
    },
  });
const call = (id: string, query = '', caller = 'ops') =>
  callRoute<AcademicStudentSummaryV1>(summaryRoute, internal(id, query, caller), { id });

describe('GET /academic/api/internal/v1/students/{id}/summary (IR-OPS-STU-1)', () => {
  it('serves only Business Ops with the service token; 400 on a bad window; 404 for an unknown student', async () => {
    const id = crypto.randomUUID();
    expect((await callRoute(summaryRoute, buildRequest(path(id)), { id })).status).toBe(401);
    expect((await call(id, '', 'platform')).status).toBe(403);
    expect((await call(id, '', 'marketing')).status).toBe(403);
    expect((await call(id, '?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect((await call(id)).status).toBe(404);
  });

  it('counts attendance per status, keeps absent results unscored, and names the teacher who taught at the time', async () => {
    const u = await users(ctx.db);
    const w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    const asha = await createStudent(ctx.db, coord, { fullName: 'Asha Example (fictional)' });
    const ravi = await createStudent(ctx.db, coord, { fullName: 'Ravi Example (fictional)' });
    for (const s of [asha, ravi])
      await enrolManually(ctx.db, coord, {
        studentId: s.id,
        batchId: w.batch.id,
        startDate: '2026-09-01',
        reason: 'Test (fictional)',
      });
    const { sessions } = await createSessions(ctx.db, coord, [
      {
        batchId: w.batch.id,
        subjectId: w.quant.id,
        teacherStaffId: w.teacherStaff,
        sessionType: 'teaching',
        date: '2026-09-07',
        startTime: '09:00',
        durationMinutes: 75,
      },
      {
        batchId: w.batch.id,
        subjectId: w.quant.id,
        teacherStaffId: w.teacherStaff,
        sessionType: 'teaching',
        date: '2026-09-08',
        startTime: '09:00',
        durationMinutes: 75,
      },
      {
        batchId: w.batch.id,
        subjectId: w.verbal.id,
        teacherStaffId: w.teacher2Staff,
        sessionType: 'teaching',
        date: '2026-09-09',
        startTime: '09:00',
        durationMinutes: 75,
      },
    ]);
    const [s1, s2, s3] = sessions.map((s) => s.id as string) as [string, string, string];
    await markHeld(ctx.db, [s1, s2, s3]);
    await recordClass(ctx.db, actor(u.teacher), {
      sessionId: s1,
      chapterId: w.ch1.id,
      completion: 'completed',
      actualMinutes: 75,
      activity: 'main',
      submit: true,
    });
    await attend(ctx.db, actor(u.teacher), s1, [
        { studentId: asha.id, status: 'present' },
        { studentId: ravi.id, status: 'present' },
      ]);
    await attend(ctx.db, actor(u.teacher), s2, [{ studentId: asha.id, status: 'absent' }]);
    await attend(ctx.db, actor(u.teacher2), s3, [{ studentId: asha.id, status: 'late' }]);
    // A later timetable change names another teacher on the logged session: history keeps the class record's teacher.
    await ctx.db
      .update(academicClassSessions)
      .set({ teacherStaffId: w.teacher2Staff })
      .where(eq(academicClassSessions.id, s1 as never));

    const assessment = await createAssessment(
      ctx.db,
      coord,
      createAssessmentBody.parse({
        code: uniq('CT-'),
        title: 'Chapter test (fictional)',
        kind: 'chapter_test',
        batchId: w.batch.id,
        subjectId: w.quant.id,
        chapterIds: [w.ch1.id],
        scheduledDate: '2026-09-20',
        marksPerCorrect: '1',
        marksPerWrong: '0',
        marksUnattempted: '0',
        sections: [{ code: 'QA', name: 'Quant', questionCount: 4 }],
      }),
    );
    await addAnswerKey(ctx.db, coord, assessment.id, { answers: { QA: ['A', 'B', 'C', 'D'] } });
    await upsertAttempts(
      ctx.db,
      coord,
      assessment.id,
      attemptsBody.parse({
        attempts: [
          {
            studentId: ravi.id,
            status: 'submitted',
            keyVersion: 1,
            responses: { QA: ['A', 'B', 'C', null] },
          },
          { studentId: asha.id, status: 'absent' },
        ],
      }),
    );
    await finaliseAssessment(ctx.db, coord, assessment.id);
    expect((await call(asha.id, '?from=2026-09-01&to=2026-09-30')).data!.results).toEqual([]); // unpublished never leaves Academic
    await publishResults(ctx.db, coord, assessment.id);

    const res = await call(asha.id, '?from=2026-09-01&to=2026-09-30');
    expect(res.status).toBe(200);
    const d = res.data!;
    expect(d).toMatchObject({
      contract: 'academic.student_summary',
      version: 1,
      studentId: asha.id,
      window: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(d.attendance).toEqual({
      held: 3,
      present: 1,
      partial: 0,
      late: 1,
      absent: 1,
      excused: 0,
    });
    expect(d.enrolments).toHaveLength(1);
    expect(d.enrolments[0]!.batchName).toBe('Test batch (fictional)');
    expect(d.enrolments[0]!.teachers).toEqual(
      expect.arrayContaining([
        { staffId: w.teacherStaff, subject: 'Quant' },
        { staffId: w.teacher2Staff, subject: 'Verbal' },
      ]),
    );
    expect(
      d.enrolments[0]!.teachers.find((t) => t.staffId === w.teacher2Staff && t.subject === 'Quant'),
    ).toBeUndefined();
    expect(d.results).toEqual([
      expect.objectContaining({
        assessmentId: assessment.id,
        subject: 'Quant',
        examType: 'chapter_test',
        heldOn: '2026-09-20',
        state: 'absent',
        score: null,
        maxScore: 4,
        percentile: null,
        rank: null,
        cohort: { label: 'Test batch (fictional)', scored: 1 },
        resultVersion: 1,
      }),
    ]);
    const other = (await call(ravi.id, '?from=2026-09-01&to=2026-09-30')).data!;
    expect(other.results[0]).toMatchObject({ state: 'scored', score: 3, maxScore: 4, rank: null }); // rank policy not approved

    const outside = (await call(asha.id, '?from=2026-10-01&to=2026-10-31')).data!;
    expect(outside.attendance.held).toBe(0);
    expect(outside.results).toEqual([]);
  });
  it('a transfer: each batch counts only sessions inside its placement; later teachers of the old batch are not listed', async () => {
    const u = await users(ctx.db);
    const w = await world(ctx.db, u);
    const w2 = await world(ctx.db, u, { teacher: await createTestUser(ctx.db, { roles: ['teacher'] }), teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    const coord = actor(u.coordinator);
    const mira = await createStudent(ctx.db, coord, { fullName: 'Sample Mira (fictional)' });
    const enrolment = await enrolManually(ctx.db, coord, { studentId: mira.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const at = (batchId: string, subjectId: string, teacherStaffId: string, date: string) => ({ batchId, subjectId, teacherStaffId, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
    const { sessions } = await createSessions(ctx.db, coord, [
      at(w.batch.id, w.quant.id, w.teacherStaff, '2026-09-07'),
      at(w.batch.id, w.verbal.id, w.teacher2Staff, '2026-09-21'),
      at(w2.batch.id, w2.quant.id, w2.teacherStaff, '2026-09-22'),
    ]);
    await markHeld(ctx.db, sessions.map((s) => s.id));
    await attend(ctx.db, actor(u.teacher), sessions[0]!.id, [{ studentId: mira.id, status: 'present' }]);
    // Mira moves to the second batch from 11 Sep (same enrolment, new placement).
    const [first] = await ctx.db.select().from(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, enrolment.id));
    await ctx.db.update(academicBatchPlacements).set({ endDate: '2026-09-10', endedReason: 'Transfer (fictional)', endedByUserId: u.coordinator.id }).where(eq(academicBatchPlacements.id, first!.id));
    await ctx.db.insert(academicBatchPlacements).values({ enrolmentId: enrolment.id, batchId: w2.batch.id, startDate: '2026-09-11', reason: 'Transfer (fictional)', transferFromPlacementId: first!.id, placedByUserId: u.coordinator.id });
    const d = (await call(mira.id, '?from=2026-09-01&to=2026-09-30')).data!;
    expect(d.attendance).toEqual({ held: 2, present: 1, partial: 0, late: 0, absent: 0, excused: 0 }); // 7 Sep (A) + 22 Sep (B, not recorded)
    expect(d.enrolments[0]!.teachers).toEqual(
      expect.arrayContaining([
        { staffId: w.teacherStaff, subject: 'Quant' },
        { staffId: w2.teacherStaff, subject: 'Quant' },
      ]),
    );
    expect(d.enrolments[0]!.teachers.find((t) => t.staffId === w.teacher2Staff)).toBeUndefined();
    expect((await call(mira.id, '?from=2020-01-01&to=2026-09-30')).status).toBe(400); // window > 3 years
  });

  it('a closed enrolment with no placement history is reported as not recorded, never as 0 held', async () => {
    const u = await users(ctx.db);
    const w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    const old = await createStudent(ctx.db, coord, { fullName: 'Sample Ola (fictional)' });
    const e = await enrolManually(ctx.db, coord, { studentId: old.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
    const { sessions } = await createSessions(ctx.db, coord, [{ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-09-07', startTime: '09:00', durationMinutes: 75 }]);
    await markHeld(ctx.db, [sessions[0]!.id]);
    // Pre-0009 shape: a closed enrolment whose batch history was never recorded.
    await ctx.db.delete(academicBatchPlacements).where(eq(academicBatchPlacements.enrolmentId, e.id));
    await ctx.db.update(academicEnrolments).set({ status: 'withdrawn' }).where(eq(academicEnrolments.id, e.id));
    const res = await call(old.id, '?from=2026-09-01&to=2026-09-30');
    const d = res.data! as AcademicStudentSummaryV1 & { extensions?: { attendanceNotRecorded: { enrolmentId: string; reason: string }[] } };
    expect(d.attendance.held).toBe(0);
    expect(d.extensions!.attendanceNotRecorded).toEqual([{ enrolmentId: e.id, reason: 'Not recorded — no batch history before 21 Oct 2026' }]);
  });
});
