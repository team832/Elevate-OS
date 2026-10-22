/**
 * Marks entry, publication, regrade and analysis (owner brief 16; acceptance tests 16–18).
 */
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicBatchPlacements, academicEnrolments, academicResultRuns, auditEvents } from '@elevate/database';
import type { AcademicStudentSummaryV1 } from '@elevate/shared-contracts';
import { authedRequest, buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as marksGet, PUT as marksPut } from '../../src/app/api/v1/assessments/[id]/marks/route';
import { POST as publishRoute } from '../../src/app/api/v1/assessments/[id]/publish/route';
import { POST as rescoreRoute } from '../../src/app/api/v1/assessments/[id]/rescore/route';
import { GET as analysisRoute } from '../../src/app/api/v1/assessments/[id]/analysis/route';
import { GET as resultsRoute } from '../../src/app/api/v1/assessments/[id]/results/route';
import { GET as summaryRoute } from '../../src/app/api/internal/v1/students/[id]/summary/route';
import { createAssessment, createAssignment, createStudent, enrolManually, finaliseAssessment, updateSetting, upsertAttempts } from '../../src/server';
import { attemptsBody, createAssessmentBody, createAssignmentBody } from '../../src/server/schemas';
import { actor, staffFor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
const ids: string[] = [];
let quantTest: string;

interface Row {
  studentId: string;
  state: string;
  manualScore: string | null;
  version: number;
}
interface Sheet {
  bounds: { min: string; max: string; negativeAllowed: boolean } | null;
  canWithhold: boolean;
  rows: Row[];
}

const sheet = (user = u.teacher, id = quantTest) => callRoute<Sheet>(marksGet, authedRequest(user, `/academic/api/v1/assessments/${id}/marks`), { id });
const enter = (marks: unknown[], user = u.teacher, id = quantTest) =>
  callRoute<{ saved: number }>(marksPut, authedRequest(user, `/academic/api/v1/assessments/${id}/marks`, { method: 'PUT', json: { marks } }), { id });
const post = (route: typeof publishRoute, sub: string, user = u.coordinator, json?: unknown, id = quantTest) =>
  callRoute<Record<string, unknown>>(route, authedRequest(user, `/academic/api/v1/assessments/${id}/${sub}`, json === undefined ? { method: 'POST' } : { json }), { id });
const summary = (studentId: string) =>
  callRoute<AcademicStudentSummaryV1>(
    summaryRoute,
    buildRequest(`/academic/api/internal/v1/students/${studentId}/summary?from=2026-09-01&to=2026-09-30`, {
      headers: { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN!}`, 'x-elevate-caller': 'ops' },
    }),
    { id: studentId },
  );

async function assessment(rule: { marksPerWrong: string }, subjectId: string) {
  const coord = actor(u.coordinator);
  const a = await createAssessment(
    ctx.db,
    coord,
    createAssessmentBody.parse({ code: uniq('WT-'), title: 'Written test (fictional)', kind: 'chapter_test', batchId: w.batch.id, subjectId, scheduledDate: '2026-09-20', marksPerCorrect: '2', marksUnattempted: '0', ...rule, sections: [{ code: 'W', name: 'Written', questionCount: 5 }] }),
  );
  return a.id; // written test: manual totals only, no answer key
}

describe('marks entry (teacher, own batch and subject)', () => {
  it('lists every eligible student as pending; refuses other roles and subjects', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    for (const name of ['Anu', 'Bela', 'Charu', 'Dev', 'Esha']) {
      const s = await createStudent(ctx.db, coord, { fullName: `Sample ${name} (fictional)` });
      await enrolManually(ctx.db, coord, { studentId: s.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
      ids.push(s.id);
    }
    quantTest = await assessment({ marksPerWrong: '0' }, w.quant.id);
    const res = await sheet();
    expect(res.status).toBe(200);
    expect(res.data!.bounds).toEqual({ min: '0', max: '10', negativeAllowed: false });
    expect(res.data!.canWithhold).toBe(false);
    expect(res.data!.rows.map((r) => r.state)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    expect((await callRoute(marksGet, buildRequest(`/academic/api/v1/assessments/${quantTest}/marks`), { id: quantTest })).status).toBe(401);
    expect((await sheet(u.counsellor)).status).toBe(403);
    expect((await sheet(u.teacher2)).status).toBe(404); // teacher2 teaches Verbal in this batch, not Quant
    expect((await sheet(await createTestUser(ctx.db, { roles: ['teacher'] }))).status).toBe(404);
  });

  it('validates against the scheme: no negative totals without negative marking, max enforced, withheld coordinator-only', async () => {
    expect((await enter([{ studentId: ids[0], state: 'scored', manualScore: '-1', version: 0 }])).status).toBe(400);
    expect((await enter([{ studentId: ids[0], state: 'scored', manualScore: '10.5', version: 0 }])).status).toBe(400);
    expect((await enter([{ studentId: ids[0], state: 'scored', version: 0 }])).status).toBe(400);
    expect((await enter([{ studentId: ids[0], state: 'withheld', version: 0 }])).status).toBe(403);
    expect((await enter([{ studentId: crypto.randomUUID(), state: 'absent', version: 0 }])).status).toBe(400);
    const ok = await enter([
      { studentId: ids[0], state: 'scored', manualScore: '8', version: 0 },
      { studentId: ids[1], state: 'scored', manualScore: '6', version: 0 },
      { studentId: ids[2], state: 'absent', version: 0 },
      { studentId: ids[3], state: 'exempt', version: 0 },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.data!.saved).toBe(4);
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, quantTest), eq(auditEvents.action, 'marks.entered')));
    expect(audit).toHaveLength(1);
    const after = (await sheet()).data!.rows;
    expect(after.map((r) => r.state)).toEqual(['scored', 'scored', 'absent', 'exempt', 'pending']);
    expect(after[0]).toMatchObject({ manualScore: '8', version: 1 });
  });

  it('rejects a stale version ("changed since you opened it") and allows a negative total only with negative marking', async () => {
    const stale = await enter([{ studentId: ids[0], state: 'scored', manualScore: '9', version: 0 }]);
    expect(stale.status).toBe(409);
    expect(stale.error!.message).toContain('changed since you opened it');
    expect((await enter([{ studentId: ids[0], state: 'scored', manualScore: '9', version: 1 }])).status).toBe(200);
    expect((await enter([{ studentId: ids[0], state: 'scored', manualScore: '8', version: 2 }])).status).toBe(200);
    const negTest = await assessment({ marksPerWrong: '-0.5' }, w.quant.id);
    const neg = await enter([{ studentId: ids[0], state: 'scored', manualScore: '-1.5', version: 0 }], u.teacher, negTest);
    expect(neg.status).toBe(200);
    expect((await sheet(u.teacher, negTest)).data!.bounds).toMatchObject({ min: '-2.5', negativeAllowed: true });
  });

  it('refuses a total over recorded answers instead of silently deleting them', async () => {
    const t = await assessment({ marksPerWrong: '0' }, w.quant.id);
    await upsertAttempts(ctx.db, actor(u.coordinator), t, attemptsBody.parse({ attempts: [{ studentId: ids[0], status: 'submitted', keyVersion: 1, responses: { W: ['A', 'B', null, null, null] } }] }));
    for (const mark of [{ state: 'scored', manualScore: '4' }, { state: 'absent' }, { state: 'exempt' }]) {
      const res = await enter([{ studentId: ids[0], version: 1, ...mark }], u.teacher, t);
      expect(res.status).toBe(400);
      expect(res.error!.message).toContain('Clear the recorded answers first');
    }
    expect((await enter([{ studentId: ids[0], state: 'pending', version: 1 }], u.teacher, t)).status).toBe(200);
  });

  it('a teacher whose assignment has a planned future end date can still mark', async () => {
    const t3 = await createTestUser(ctx.db, { roles: ['teacher'] });
    const t3Staff = await staffFor(ctx.db, t3, 'Sample Teacher Three (fictional)');
    await createAssignment(ctx.db, actor(u.coordinator), createAssignmentBody.parse({ batchId: w.batch.id, subjectId: w.quant.id, staffMemberId: t3Staff, role: 'co_teacher', endDate: '2099-12-31' }));
    expect((await sheet(t3)).status).toBe(200);
  });
});

describe('finalise, publish, regrade (acceptance tests 16 and 17)', () => {
  it('pending blocks finalising; the coordinator may withhold; finalised scores follow the states (absence ≠ pending ≠ 0)', async () => {
    expect((await post(publishRoute, 'publish')).status).toBe(409); // not finalised yet
    await expect(finaliseAssessment(ctx.db, actor(u.coordinator), quantTest)).rejects.toThrow(/not ready/);
    expect((await enter([{ studentId: ids[4], state: 'withheld', version: 0 }], u.coordinator)).status).toBe(200);
    expect((await enter([{ studentId: ids[4], state: 'scored', manualScore: '5', version: 1 }])).status).toBe(403); // a teacher cannot undo a coordinator's withhold
    // Eligibility = placement covering the date (20 Sep): Dev sat as exempt and left on 22 Sep; Gita joined on 25 Sep.
    const [dev] = await ctx.db.select().from(academicEnrolments).where(eq(academicEnrolments.studentId, ids[3] as never));
    await ctx.db.update(academicBatchPlacements).set({ endDate: '2026-09-22', endedReason: 'Left (fictional)' }).where(eq(academicBatchPlacements.enrolmentId, dev!.id));
    await ctx.db.update(academicEnrolments).set({ status: 'withdrawn' }).where(eq(academicEnrolments.id, dev!.id));
    const gita = await createStudent(ctx.db, actor(u.coordinator), { fullName: 'Sample Gita (fictional)' });
    await enrolManually(ctx.db, actor(u.coordinator), { studentId: gita.id, batchId: w.batch.id, startDate: '2026-09-25', reason: 'Test (fictional)' });
    expect((await sheet()).data!.rows.map((r) => r.studentId)).not.toContain(gita.id);
    await finaliseAssessment(ctx.db, actor(u.coordinator), quantTest);
    const [run] = await ctx.db.select().from(academicResultRuns).where(eq(academicResultRuns.assessmentId, quantTest as never));
    expect(run!.answerKeyId).toBeNull(); // manual totals only: no made-up key
    const res = await callRoute<{ results: { studentId: string; state: string; totalScore: string | null; rank: number | null; percentile: string | null }[] }>(
      resultsRoute,
      authedRequest(u.teacher, `/academic/api/v1/assessments/${quantTest}/results`),
      { id: quantTest },
    );
    const by = Object.fromEntries(res.data!.results.map((r) => [r.studentId, r]));
    expect(by[ids[0]!]).toMatchObject({ state: 'scored', totalScore: '8.0000' });
    expect(by[ids[2]!]).toMatchObject({ state: 'absent', totalScore: null });
    expect(by[ids[3]!]).toMatchObject({ state: 'exempt', totalScore: null });
    expect(by[ids[4]!]).toMatchObject({ state: 'withheld', totalScore: null });
    // rank/percentile policy is proposed/off → never shown
    expect(res.data!.results.every((r) => r.rank === null && r.percentile === null)).toBe(true);
  });

  it('draft and unpublished marks never leave Academic; publication is coordinator-only and separate from finalise', async () => {
    expect((await summary(ids[0]!)).data!.results).toEqual([]);
    expect((await post(publishRoute, 'publish', u.teacher)).status).toBe(403);
    const pub = await post(publishRoute, 'publish');
    expect(pub.status).toBe(200);
    expect(pub.data!.publishedAt).toBeTruthy();
    expect((await post(publishRoute, 'publish')).status).toBe(409);
    const s = (await summary(ids[0]!)).data!;
    expect(s.results).toEqual([expect.objectContaining({ assessmentId: quantTest, state: 'scored', score: 8, maxScore: 10, rank: null, percentile: null, resultVersion: 1 })]);
    expect((await summary(ids[2]!)).data!.results[0]).toMatchObject({ state: 'absent', score: null });
    // exempt and withheld have no state in contract v1: they are not sent
    expect((await summary(ids[3]!)).data!.results).toEqual([]);
    expect((await summary(ids[4]!)).data!.results).toEqual([]);
  });

  it('a regrade after publication is a new result version with a reason; history is kept and the summary updates', async () => {
    const row = (await sheet()).data!.rows.find((r) => r.studentId === ids[1])!;
    expect((await enter([{ studentId: ids[1], state: 'scored', manualScore: '7', version: row.version }])).status).toBe(200);
    expect((await summary(ids[1]!)).data!.results[0]).toMatchObject({ score: 6, resultVersion: 1 }); // not live until regraded
    expect((await post(rescoreRoute, 'rescore', u.teacher, { reason: 'Re-marked Q3 (fictional)' })).status).toBe(403);
    expect((await post(rescoreRoute, 'rescore', u.coordinator, { reason: 'Re-marked Q3 (fictional)' })).status).toBe(201);
    const runs = await ctx.db.select().from(academicResultRuns).where(eq(academicResultRuns.assessmentId, quantTest as never));
    expect(runs.map((r) => `${r.version}:${r.status}:${r.reason ?? ''}`).sort()).toEqual(['1:superseded:', '2:final:Re-marked Q3 (fictional)']);
    expect((await summary(ids[1]!)).data!.results[0]).toMatchObject({ score: 7, resultVersion: 2 });
    const audits = await ctx.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, quantTest));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['marks.entered', 'assessment.finalised', 'assessment.published', 'assessment.rescored']));
  });

  it('rank and percentile appear only once the owner approves show=true', async () => {
    await expect(updateSetting(ctx.db, actor(u.coordinator), 'progress.show_rank_percentile', { value: { show: true }, status: 'approved' })).rejects.toThrow(/decision reference/);
    await updateSetting(ctx.db, actor(u.coordinator), 'progress.show_rank_percentile', { value: { show: true }, status: 'proposed' });
    expect((await summary(ids[0]!)).data!.results[0]!.rank).toBeNull();
    await updateSetting(ctx.db, actor(u.coordinator), 'progress.show_rank_percentile', { value: { show: true }, status: 'approved', decisionRef: 'D-900' });
    expect((await summary(ids[0]!)).data!.results[0]).toMatchObject({ rank: 1 });
    await updateSetting(ctx.db, actor(u.coordinator), 'progress.show_rank_percentile', { value: { show: false }, status: 'proposed' });
  });
});

describe('assessment analysis (acceptance test 18)', () => {
  it('averages the scored students only and states scored n of eligible m', async () => {
    const res = await callRoute<{ analysis: { eligible: number; scored: number; absent: number; exempt: number; withheld: number; pending: number; mean: string; meanPercent: number }; topics: { mapped: boolean }; comparison: { comparable: unknown[]; trend: { status: string } } }>(
      analysisRoute,
      authedRequest(u.teacher, `/academic/api/v1/assessments/${quantTest}/analysis`),
      { id: quantTest },
    );
    expect(res.status).toBe(200);
    expect(res.data!.analysis).toMatchObject({ eligible: 5, scored: 2, absent: 1, exempt: 1, withheld: 1, pending: 0, mean: '7.5', meanPercent: 75 });
    expect(res.data!.topics.mapped).toBe(false);
    expect(res.data!.comparison.trend.status).toBe('insufficient_data'); // one assessment never shows improvement
    expect((await callRoute(analysisRoute, authedRequest(u.counsellor, `/academic/api/v1/assessments/${quantTest}/analysis`), { id: quantTest })).status).toBe(403);
  });
});
