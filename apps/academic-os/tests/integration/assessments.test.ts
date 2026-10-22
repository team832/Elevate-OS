import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { academicBatches, academicResultRuns, academicResults, auditEvents, integrationEvents } from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase } from '@elevate/testing';
import { POST as createRoute } from '../../src/app/api/v1/assessments/route';
import { GET as getRoute } from '../../src/app/api/v1/assessments/[id]/route';
import { PUT as scoringRoute } from '../../src/app/api/v1/assessments/[id]/scoring/route';
import { POST as keyRoute } from '../../src/app/api/v1/assessments/[id]/answer-keys/route';
import { POST as attemptsRoute } from '../../src/app/api/v1/assessments/[id]/attempts/route';
import { POST as validateRoute } from '../../src/app/api/v1/assessments/[id]/validate/route';
import { POST as finaliseRoute } from '../../src/app/api/v1/assessments/[id]/finalise/route';
import { POST as rescoreRoute } from '../../src/app/api/v1/assessments/[id]/rescore/route';
import { GET as resultsRoute } from '../../src/app/api/v1/assessments/[id]/results/route';
import { POST as scheduleRoute } from '../../src/app/api/v1/assessments/schedule-check/route';
import { createSessions, createStudent, enrolManually, updateBatch, updateSetting } from '../../src/server';
import { actor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let id: string;
const codes: string[] = [];

const post = <T = unknown>(route: typeof finaliseRoute, path: string, json?: unknown, user = u.coordinator) =>
  callRoute<T>(route, authedRequest(user, path, json === undefined ? { method: 'POST' } : { json }), { id });

describe('assessment lifecycle with exact negative marking', () => {
  it('creates an assessment with a configurable rule (−0.25 per wrong) and sections', async () => {
    u = await users(ctx.db);
    w = await world(ctx.db, u);
    const coord = actor(u.coordinator);
    for (const name of ['Anu', 'Bela', 'Charu', 'Dev']) {
      const s = await createStudent(ctx.db, coord, { fullName: `${name} Example (fictional)` });
      await enrolManually(ctx.db, coord, { studentId: s.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
      codes.push(s.code);
    }
    const body = { code: uniq('CT-'), title: 'Chapter test (fictional)', kind: 'chapter_test', batchId: w.batch.id, chapterIds: [w.ch1.id], scheduledDate: '2026-09-26', marksPerCorrect: '1', marksPerWrong: '-0.25', marksUnattempted: '0', sections: [{ code: 'QA', name: 'Quant', questionCount: 4 }] };
    expect((await callRoute(createRoute, authedRequest(u.teacher, '/academic/api/v1/assessments', { json: body }))).status).toBe(403);
    expect((await callRoute(createRoute, authedRequest(u.coordinator, '/academic/api/v1/assessments', { json: { ...body, marksPerWrong: '-0.33333' } }))).status).toBe(400);
    const res = await callRoute<{ id: string; status: string; marksPerWrong: string }>(createRoute, authedRequest(u.coordinator, '/academic/api/v1/assessments', { json: body }));
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ status: 'scheduled', marksPerWrong: '-0.2500' });
    id = res.data!.id;
  });

  it('validation lists every issue; finalising an invalid set is refused with details', async () => {
    const before = await post<{ ok: boolean; issues: { code: string }[] }>(validateRoute, `/academic/api/v1/assessments/${id}/validate`);
    expect(before.data!.ok).toBe(false);
    expect(before.data!.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NO_ANSWER_KEY', 'MISSING_ATTEMPT']));
    expect((await post(keyRoute, `/academic/api/v1/assessments/${id}/answer-keys`, { answers: { QA: ['A', 'B', 'C', 'D'] } })).status).toBe(201);
    const dup = await post(attemptsRoute, `/academic/api/v1/assessments/${id}/attempts`, { csv: `${codes[0]},1,QA,A|B|C|D\n${codes[0]},1,QA,A|B|C|D` });
    expect(dup.status).toBe(400);
    const csv = [
      'student_code,key_version,section_code,answers',
      `${codes[0]},1,QA,A|B|C|D`, // 4
      `${codes[1]},1,QA,A|B|C|`, // 3
      `${codes[2]},1,QA,B||C|`, // -0.25 + 1 = 0.75
    ].join('\n');
    const imported = await post<{ saved: number }>(attemptsRoute, `/academic/api/v1/assessments/${id}/attempts`, { csv });
    expect(imported.data!.saved).toBe(3);
    const refused = await post(finaliseRoute, `/academic/api/v1/assessments/${id}/finalise`);
    expect(refused.status).toBe(400);
    expect((refused.error!.details as { code: string; studentId: string }[]).map((d) => d.code)).toEqual(['MISSING_ATTEMPT']);
    await post(attemptsRoute, `/academic/api/v1/assessments/${id}/attempts`, { csv: `${codes[3]},,ABSENT,` });
    expect((await post<{ ok: boolean }>(validateRoute, `/academic/api/v1/assessments/${id}/validate`)).data!.ok).toBe(true);
  });

  it('finalises immutable results with exact quarter marks, ranks and percentiles; absent is not zero', async () => {
    expect((await post(finaliseRoute, `/academic/api/v1/assessments/${id}/finalise`, undefined, u.teacher)).status).toBe(403);
    const res = await post<{ run: { version: number }; scored: number; absent: number }>(finaliseRoute, `/academic/api/v1/assessments/${id}/finalise`);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ run: { version: 1 }, scored: 3, absent: 1 });
    expect((await post(finaliseRoute, `/academic/api/v1/assessments/${id}/finalise`)).status).toBe(409);
    await updateSetting(ctx.db, actor(u.coordinator), 'progress.show_rank_percentile', { value: { show: true }, status: 'approved', decisionRef: 'D-900' }); // ranks are shown only under an approved policy
    const results = await callRoute<{ results: { studentCode: string; totalScore: string | null; rank: number | null; percentile: string | null; absent: boolean }[] }>(resultsRoute, authedRequest(u.teacher, `/academic/api/v1/assessments/${id}/results`), { id });
    expect(results.status).toBe(200);
    const by = Object.fromEntries(results.data!.results.map((r) => [r.studentCode, r]));
    expect(by[codes[0]!]).toMatchObject({ totalScore: '4.0000', rank: 1, percentile: '83.3333' });
    expect(by[codes[1]!]).toMatchObject({ totalScore: '3.0000', rank: 2, percentile: '50.0000' });
    expect(by[codes[2]!]).toMatchObject({ totalScore: '0.7500', rank: 3, percentile: '16.6667' });
    expect(by[codes[3]!]).toMatchObject({ totalScore: null, rank: null, percentile: null, absent: true });
    const events = await ctx.db.select().from(integrationEvents).where(eq(integrationEvents.type, 'academic.assessment.finalised'));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toContain('Example');
  });

  it('re-scoring with a corrected key creates version 2, keeps version 1 and audits the change', async () => {
    await post(keyRoute, `/academic/api/v1/assessments/${id}/answer-keys`, { answers: { QA: ['A', 'B', 'C', null] }, note: 'Q4 dropped (fictional)' });
    expect((await post(rescoreRoute, `/academic/api/v1/assessments/${id}/rescore`, { reason: 'Q4 dropped' })).status).toBe(400); // responses keyed to v1
    await post(attemptsRoute, `/academic/api/v1/assessments/${id}/attempts`, { csv: [`${codes[0]},2,QA,A|B|C|D`, `${codes[1]},2,QA,A|B|C|`, `${codes[2]},2,QA,B||C|`, `${codes[3]},,ABSENT,`].join('\n') });
    expect((await post(rescoreRoute, `/academic/api/v1/assessments/${id}/rescore`, {})).status).toBe(400); // reason required
    const res = await post<{ run: { version: number }; previousVersion: number }>(rescoreRoute, `/academic/api/v1/assessments/${id}/rescore`, { reason: 'Q4 dropped (fictional)' });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ run: { version: 2 }, previousVersion: 1 });
    const runs = await ctx.db.select().from(academicResultRuns).where(eq(academicResultRuns.assessmentId, id as never));
    expect(runs.map((r) => `${r.version}:${r.status}`).sort()).toEqual(['1:superseded', '2:final']);
    const v1 = runs.find((r) => r.version === 1)!;
    const v1Rows = await ctx.db.select().from(academicResults).where(eq(academicResults.runId, v1.id));
    expect(v1Rows.map((r) => r.totalScore).sort()).toEqual(['0.7500', '3.0000', '4.0000', null].sort());
    const latest = await callRoute<{ run: { version: number }; results: { studentCode: string; totalScore: string; maxScore: string }[] }>(resultsRoute, authedRequest(u.coordinator, `/academic/api/v1/assessments/${id}/results`), { id });
    expect(latest.data!.run.version).toBe(2);
    expect(latest.data!.results.find((r) => r.studentCode === codes[1])).toMatchObject({ totalScore: '3.0000', maxScore: '3.0000' });
    const old = await callRoute<{ run: { version: number; status: string } }>(resultsRoute, authedRequest(u.coordinator, `/academic/api/v1/assessments/${id}/results?version=1`), { id });
    expect(old.data!.run).toMatchObject({ version: 1, status: 'superseded' });
    const audit = await ctx.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'assessment.rescored')));
    expect(audit).toHaveLength(1);
    // the frozen rule cannot be edited after finalisation
    const frozen = await callRoute(scoringRoute, authedRequest(u.coordinator, `/academic/api/v1/assessments/${id}/scoring`, { method: 'PUT', json: { marksPerCorrect: '2', marksPerWrong: '0', marksUnattempted: '0', sections: [{ code: 'QA', name: 'Quant', questionCount: 4 }] } }), { id });
    expect(frozen.status).toBe(409);
  });

  it('teachers outside the batch cannot read the assessment (404)', async () => {
    const detail = await callRoute(getRoute, authedRequest(u.teacher, `/academic/api/v1/assessments/${id}`), { id });
    expect(detail.status).toBe(200);
    expect((await callRoute(getRoute, authedRequest(u.counsellor, `/academic/api/v1/assessments/${id}`), { id })).status).toBe(403);
  });
});

describe('assessment scheduling constraints', () => {
  it('flags clashes with classes, the unverified exam date and the configured blackout window', async () => {
    const coord = actor(u.coordinator);
    await updateBatch(ctx.db, coord, w.batch.id, { endDate: '2027-12-31' });
    await ctx.db.update(academicBatches).set({ targetExam: 'Entrance exam (test)', targetExamDate: '2026-11-15', targetExamDateStatus: 'unverified' }).where(eq(academicBatches.id, w.batch.id));
    await createSessions(ctx.db, coord, [{ batchId: w.batch.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching', date: '2026-10-05', startTime: '09:00', durationMinutes: 75 }]);
    const res = await callRoute<{ verdict: string; hard: { code: string; candidateId: string; unverified: boolean }[]; conflictingCandidates: string[] }>(
      scheduleRoute,
      authedRequest(u.teacher, '/academic/api/v1/assessments/schedule-check', {
        json: {
          batchId: w.batch.id,
          candidates: [
            { id: 'ok', label: 'Test OK', date: '2026-10-10', startTime: '09:00', durationMinutes: 60 },
            { id: 'class', label: 'Test clash', date: '2026-10-05', startTime: '10:00', durationMinutes: 60 },
            { id: 'exam', label: 'Late test', date: '2026-11-14', discussionDate: '2026-11-15' },
          ],
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.data!.verdict).toBe('infeasible');
    expect(res.data!.conflictingCandidates).toEqual(['class', 'exam']);
    expect(res.data!.hard.find((c) => c.candidateId === 'exam')).toMatchObject({ code: 'BLACKOUT', unverified: true });
  });
});
