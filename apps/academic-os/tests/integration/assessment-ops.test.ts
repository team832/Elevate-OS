/**
 * Academic internal assessment API for Business Ops (owner answer 1: ONE test record; brief §17–21).
 * Roster snapshot, one-writer scores, finalise mirror, publication versions and ranking.
 */
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  academicResultRuns,
  academicResults,
  academicStudents,
  auditEvents,
  students as coreStudents,
  users as coreUsers,
} from '@elevate/database';
import {
  academicAssessmentDetailV1Schema,
  academicAssessmentListV1Schema,
  type AcademicAssessmentDetailV1,
} from '@elevate/shared-contracts';
import {
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  GET as listRoute,
  POST as createRoute,
} from '../../src/app/api/internal/v1/assessments/route';
import {
  GET as detailRoute,
  PATCH as patchRoute,
} from '../../src/app/api/internal/v1/assessments/[id]/route';
import { POST as snapshotRoute } from '../../src/app/api/internal/v1/assessments/[id]/roster/route';
import { POST as correctionRoute } from '../../src/app/api/internal/v1/assessments/[id]/roster/corrections/route';
import { POST as scoresRoute } from '../../src/app/api/internal/v1/assessments/[id]/scores/route';
import { POST as finaliseRoute } from '../../src/app/api/internal/v1/assessments/[id]/finalise/route';
import { POST as publishRoute } from '../../src/app/api/internal/v1/assessments/[id]/publications/route';
import { POST as withdrawRoute } from '../../src/app/api/internal/v1/assessments/[id]/publications/[version]/withdraw/route';
import {
  buildReport,
  checkAssessmentScheduleFor,
  configureScoring,
  createAssignment,
  createBatch,
  createStudent,
  enrolManually,
  enterMarks,
  getAssessment,
  getAssessmentAnalysis,
  getMarksSheet,
  getResults,
  getStudentProgress,
  listAssessments,
  updateSetting,
  upsertAttempts,
  validateAssessment,
} from '../../src/server';
import { attemptsBody, scoringBody } from '../../src/server/schemas';
import { recordScores } from '../../src/server/services/assessment-ops';
import { actor, staffFor, uniq, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let ops: TestUser;
let b2: string;
let b3: string;
let mockId: string;
const s: Record<string, string> = {};

type Handler = Parameters<typeof callRoute>[0];
const headers = (
  caller = 'ops',
  acting: string | null = ops.id,
  token = process.env.INTERNAL_SERVICE_TOKEN!,
) => ({
  authorization: `Bearer ${token}`,
  'x-elevate-caller': caller,
  ...(acting ? { 'x-elevate-acting-user': acting } : {}),
});
const call = (
  route: Handler,
  path: string,
  json?: unknown,
  params: Record<string, string> = {},
  h = headers(),
  method?: string,
) =>
  callRoute<AcademicAssessmentDetailV1>(
    route,
    buildRequest(`/academic/api/internal/v1/assessments${path}`, { json, headers: h, method }),
    params,
  );
const at = (route: Handler, sub: string, json: unknown, extra: Record<string, string> = {}) =>
  call(route, `/${mockId}/${sub}`, json, { id: mockId, ...extra });
const detail = async () =>
  academicAssessmentDetailV1Schema.parse(
    (await call(detailRoute, `/${mockId}`, undefined, { id: mockId })).data,
  );
const rowOf = (d: AcademicAssessmentDetailV1, key: string) =>
  d.roster.find((r) => r.studentId === s[key])!;
/** Rows for record-scores at the versions currently stored. */
async function rows(
  spec: Record<string, { attendance?: string; marksState: string; score: string | null }>,
) {
  const d = await detail();
  return Object.entries(spec).map(([k, v]) => ({
    studentId: s[k],
    version: rowOf(d, k).version,
    ...v,
  }));
}
const scores = async (spec: Parameters<typeof rows>[0], extra: object = {}) =>
  at(scoresRoute, 'scores', { source: 'csv', rows: await rows(spec), ...extra });
const verified = (score: string) => ({ attendance: 'present', marksState: 'verified', score });
const auditCount = async (action: string) =>
  (
    await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, mockId), eq(auditEvents.action, action)))
  ).length;

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  ops = await createTestUser(ctx.db, { roles: ['operations_manager'] });
  const coord = actor(u.coordinator);
  const batch = async () =>
    (
      await createBatch(ctx.db, coord, {
        code: uniq('B-'),
        name: 'Mock batch (fictional)',
        courseId: w.course.id,
        startDate: '2026-09-01',
        status: 'active',
      })
    ).id;
  b2 = await batch();
  b3 = await batch();
  const place = { b1: ['a', 'b', 'c', 'd', 'e', 'f'], b2: ['g', 'h'], b3: ['x'] } as const;
  for (const [batchKey, keys] of Object.entries(place)) {
    for (const k of keys) {
      const st = await createStudent(ctx.db, coord, {
        fullName: `Sample ${k.toUpperCase()} (fictional)`,
      });
      await enrolManually(ctx.db, coord, {
        studentId: st.id,
        batchId: { b1: w.batch.id, b2, b3 }[batchKey as 'b1']!,
        startDate: '2026-09-01',
        reason: 'Test (fictional)',
      });
      s[k] = st.id;
    }
  }
  const [core] = await ctx.db
    .insert(coreStudents)
    .values({ fullName: 'Sample A (fictional)', isSample: true })
    .returning();
  await ctx.db
    .update(academicStudents)
    .set({ coreStudentId: core!.id })
    .where(eq(academicStudents.id, s.a as never));
  s.coreA = core!.id;
});

describe('internal routes: callers and acting user', () => {
  const body = () => ({
    code: uniq('M-'),
    kind: 'full_mock',
    title: 'Mock (fictional)',
    academicYear: '2026-27',
    batchIds: [w.batch.id],
  });
  it.each([
    ['another module', () => headers('marketing'), 403],
    ['academic itself', () => headers('academic'), 403],
    ['no acting user', () => headers('ops', null), 400],
    ['an unknown acting user', () => headers('ops', crypto.randomUUID()), 400],
    ['a wrong token', () => headers('ops', ops.id, 'x'.repeat(40)), 401],
  ])('refuses a write from %s', async (_n, h, status) => {
    expect((await call(createRoute, '', body(), {}, h())).status).toBe(status);
  });
  it('refuses a read from a non-ops caller', async () => {
    expect((await call(listRoute, '', undefined, {}, headers('marketing'))).status).toBe(403);
  });
});

describe('IPMAT-style mock: selected batches, snapshot, scores, ranking, publication', () => {
  it('creates a scheduled mock for the selected batches and snapshots only their active enrolments', async () => {
    const res = await call(createRoute, '', {
      code: uniq('IPM-'),
      kind: 'full_mock',
      title: 'IPMAT mock 1 (fictional)',
      academicYear: '2026-27',
      batchIds: [w.batch.id, b2],
      scheduledDate: '2026-09-20',
      sections: [
        {
          code: 'QA',
          name: 'Quant',
          questionCount: 10,
          marksPerCorrect: '4',
          marksPerWrong: '-1',
          marksUnattempted: '0',
        },
      ],
      responsibleTeacherStaffId: w.teacherStaff,
    });
    expect(res.status).toBe(200);
    mockId = res.data!.assessment.id;
    expect(res.data!.assessment).toMatchObject({
      type: 'mock_test',
      status: 'scheduled',
      maxMarks: '40',
      rosterCounts: null,
      responsibleTeacher: { name: 'Tina Teacher (fictional)' },
    });
    const snap = await at(snapshotRoute, 'roster', {
      admissionNumbers: [{ coreStudentId: s.coreA, admissionNumber: 'ADM-0001' }],
    });
    expect(snap.status).toBe(200);
    const d = academicAssessmentDetailV1Schema.parse(snap.data);
    expect(d.roster.map((r) => r.studentId).sort()).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => s[k]).sort(),
    );
    expect(rowOf(d, 'a')).toMatchObject({
      admissionNumber: 'ADM-0001',
      attendance: 'unmarked',
      marksState: 'not_entered',
      score: null,
      version: 1,
    });
    expect(rowOf(d, 'b').admissionNumber).toBeNull();
    expect(rowOf(d, 'g').batchId).toBe(b2);
    expect(d.roster.every((r) => r.studentCode)).toBe(true);
    expect(d.assessment.sections).toEqual([
      {
        code: 'QA',
        name: 'Quant',
        questionCount: 10,
        maxMarks: '40',
        perCorrect: '4',
        perWrong: '-1',
        perUnattempted: '0',
        capMarks: null,
      },
    ]);
    expect((await at(snapshotRoute, 'roster', {})).status).toBe(409);
  });

  it('does not rewrite the snapshot when the batches change later', async () => {
    const late = await createStudent(ctx.db, actor(u.coordinator), {
      fullName: 'Sample Late (fictional)',
    });
    await enrolManually(ctx.db, actor(u.coordinator), {
      studentId: late.id,
      batchId: w.batch.id,
      startDate: '2026-09-01',
      reason: 'Test (fictional)',
    });
    s.late = late.id;
    expect((await detail()).roster).toHaveLength(8);
    expect(
      (
        await call(
          patchRoute,
          `/${mockId}`,
          { batchIds: [w.batch.id, b3] },
          { id: mockId },
          headers(),
          'PATCH',
        )
      ).status,
    ).toBe(409);
  });

  it.each([
    ['the negative floor', '-10', 200],
    ['below the negative floor', '-10.25', 400],
    ['the maximum', '40', 200],
    ['above the maximum', '40.5', 400],
    ['five decimals', '1.00001', 400],
  ])('negative marking bounds: %s (%s) → %i', async (_n, score, status) => {
    expect(
      (await scores({ a: { attendance: 'present', marksState: 'imported', score } })).status,
    ).toBe(status);
  });

  it('records attendance and marks; present 0 is kept apart from absent; omitted attendance stays as stored', async () => {
    const res = await scores({
      a: verified('40'),
      b: verified('30'),
      c: verified('30'),
      g: verified('0'),
      d: { attendance: 'absent', marksState: 'not_entered', score: null },
      e: { attendance: 'excused', marksState: 'not_entered', score: null },
      f: { attendance: 'present', marksState: 'imported', score: '35' },
    });
    expect(res.status).toBe(200);
    expect((await scores({ h: { marksState: 'verified', score: '10' } })).status).toBe(400); // h is unmarked: verified needs present
    const d = await detail();
    expect(rowOf(d, 'g')).toMatchObject({
      attendance: 'present',
      marksState: 'verified',
      score: '0',
    });
    expect(rowOf(d, 'd')).toMatchObject({ attendance: 'absent', score: null });
    expect(d.assessment.rosterCounts).toMatchObject({
      active: 8,
      present: 5,
      absent: 1,
      excused: 1,
      unmarked: 1,
      verified: 4,
      imported: 1,
      notEntered: 3,
    });
  });

  it('a repeated record-scores with the same values changes nothing and writes no duplicate', async () => {
    const before = await detail();
    const audits = await auditCount('roster.scores_recorded');
    const again = await at(scoresRoute, 'scores', {
      source: 'csv',
      rows: ['a', 'b', 'g'].map((k) => ({
        studentId: s[k],
        version: 1,
        attendance: 'present',
        marksState: 'verified',
        score: rowOf(before, k).score,
      })),
    });
    expect(again.status).toBe(200);
    expect((await detail()).roster).toEqual(before.roster);
    expect(await auditCount('roster.scores_recorded')).toBe(audits);
  });

  it('refuses a stale version (409) and a verified overwrite without the flag; the flagged overwrite is audited old → new', async () => {
    const stale = await at(scoresRoute, 'scores', {
      source: 'manual',
      rows: [
        { studentId: s.f, version: 1, attendance: 'present', marksState: 'imported', score: '36' },
      ],
    });
    expect(stale.status).toBe(409);
    expect(stale.error!.details).toEqual({ stale: [s.f] });
    const refused = await scores({ b: verified('31') });
    expect(refused.status).toBe(409);
    expect(refused.error!.details).toEqual({ overwriteRequired: [s.b] });
    expect(
      (
        await scores(
          { b: verified('31') },
          { overwriteVerified: true, reason: 'Re-checked the answer sheet' },
        )
      ).status,
    ).toBe(200);
    const [row] = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, mockId), eq(auditEvents.action, 'roster.scores_recorded')),
      )
      .orderBy(desc(auditEvents.at))
      .limit(1);
    expect(row!.actorUserId).toBe(ops.id);
    expect(row!.before).toEqual([expect.objectContaining({ studentId: s.b, score: '30.0000' })]);
    expect(row!.after).toEqual([expect.objectContaining({ studentId: s.b, score: '31.0000' })]);
    expect(row!.metadata).toMatchObject({
      overwritten: [s.b],
      reason: 'Re-checked the answer sheet',
    });
    await scores(
      { b: verified('30') },
      { overwriteVerified: true, reason: 'Back to the original mark' },
    );
  });

  it('finalises (roster mirrored: missing never 0) and blocks the final publication while incomplete', async () => {
    expect((await at(finaliseRoute, 'finalise', {})).status).toBe(200);
    const results = await ctx.db
      .select({
        studentId: academicResults.studentId,
        state: academicResults.state,
        total: academicResults.totalScore,
      })
      .from(academicResults)
      .innerJoin(academicResultRuns, eq(academicResultRuns.id, academicResults.runId))
      .where(
        and(
          eq(academicResults.assessmentId, mockId as never),
          eq(academicResultRuns.status, 'final'),
        ),
      );
    const by = (k: string) => results.find((r) => r.studentId === s[k]);
    expect([by('g'), by('d'), by('e'), by('f'), by('h')].map((r) => [r!.state, r!.total])).toEqual([
      ['scored', '0.0000'],
      ['absent', null],
      ['exempt', null],
      ['withheld', null],
      ['withheld', null],
    ]);
    const blocked = await at(publishRoute, 'publications', { version: 1, provisional: false });
    expect(blocked.status).toBe(409);
    expect(
      (blocked.error!.details as { issues: { code: string; count: number }[] }).issues,
    ).toEqual([
      expect.objectContaining({ code: 'UNMARKED', count: 1 }),
      expect.objectContaining({ code: 'UNVERIFIED', count: 1 }),
    ]);
    expect((await at(publishRoute, 'publications', { version: 1, provisional: true })).status).toBe(
      409,
    ); // setting not approved
  });

  it('publishes provisionally once allowed: ties 1,2,2,4 over present + verified only; ranks hidden until rank display is approved', async () => {
    await updateSetting(ctx.db, actor(u.director), 'assessments.provisional_publication', {
      value: { allowed: true },
      status: 'approved',
      decisionRef: 'D-TEST',
    });
    const pub = await at(publishRoute, 'publications', { version: 1, provisional: true });
    expect(pub.status).toBe(200);
    expect(pub.data!.publication).toMatchObject({ state: 'provisional', rankVisible: false });
    expect(pub.data!.roster.every((r) => r.rank === null)).toBe(true);
    await updateSetting(ctx.db, actor(u.director), 'progress.show_rank_percentile', {
      value: { show: true },
      status: 'approved',
      decisionRef: 'D-TEST',
    });
    const d = await detail();
    expect(
      Object.fromEntries(
        ['a', 'b', 'c', 'g', 'd', 'e', 'f', 'h'].map((k) => [k, rowOf(d, k).rank]),
      ),
    ).toEqual({ a: 1, b: 2, c: 2, g: 4, d: null, e: null, f: null, h: null });
    expect((await at(publishRoute, 'publications', { version: 1, provisional: true })).status).toBe(
      409,
    ); // a retried call never publishes twice
  });

  it('a correction to final results needs a reason, re-scores and publishes version 2; version 1 is kept', async () => {
    expect((await scores({ f: verified('35') })).status).toBe(400);
    expect(
      (
        await scores(
          {
            f: verified('35'),
            h: { attendance: 'absent', marksState: 'not_entered', score: null },
          },
          { reason: 'Verified the imported sheet' },
        )
      ).status,
    ).toBe(200);
    const d = await detail();
    expect(d.results!.resultVersion).toBe(2);
    expect(
      d.publication.history.map((p) => [p.version, p.status, p.provisional, p.resultVersion]),
    ).toEqual([
      [2, 'current', false, 2],
      [1, 'superseded', true, 1],
    ]);
    expect(d.publication.state).toBe('published');
    expect(Object.fromEntries(['a', 'f', 'b', 'c', 'g'].map((k) => [k, rowOf(d, k).rank]))).toEqual(
      { a: 1, f: 2, b: 3, c: 3, g: 5 },
    );
  });

  it('a correction that leaves the roster incomplete withdraws the final publication (never silently provisional) and succeeds', async () => {
    const res = await scores(
      { b: { attendance: 'present', marksState: 'imported', score: '30' } },
      { overwriteVerified: true, reason: 'Sheet under review' },
    );
    expect(res.status).toBe(200);
    const d = await detail();
    expect(d.publication.state).toBe('withdrawn');
    expect(d.publication.history.map((p) => [p.version, p.status, p.withdrawnReason])).toEqual([
      [2, 'withdrawn', 'correction made results incomplete'],
      [1, 'superseded', null],
    ]);
    expect(d.roster.every((r) => r.rank === null)).toBe(true);
    expect((await scores({ b: verified('30') }, { reason: 'Review done' })).status).toBe(200);
    expect((await detail()).publication.state).toBe('withdrawn'); // Ops republishes when complete
  });

  it('ranks a chosen cohort only, then withdraws with a reason', async () => {
    const cohort = await at(publishRoute, 'publications', {
      version: 3,
      provisional: false,
      rankingScope: 'cohort',
      cohortBatchIds: [b2],
    });
    expect(cohort.status).toBe(200);
    expect(
      cohort.data!.roster.filter((r) => r.rank !== null).map((r) => [r.studentId, r.rank]),
    ).toEqual([[s.g, 1]]);
    expect(
      (
        await at(publishRoute, 'publications', {
          version: 4,
          provisional: false,
          rankingScope: 'cohort',
          cohortBatchIds: [b3],
        })
      ).status,
    ).toBe(400);
    const out = await at(
      withdrawRoute,
      'publications/3/withdraw',
      { reason: 'Wrong cohort chosen' },
      { version: '3' },
    );
    expect(out.status).toBe(200);
    expect(out.data!.publication.state).toBe('withdrawn');
    expect(out.data!.roster.every((r) => r.rank === null)).toBe(true);
    expect(out.data!.publication.history.map((p) => p.status)).toEqual([
      'withdrawn',
      'withdrawn',
      'superseded',
    ]);
  });

  it('roster corrections need a reason; on final results they re-score', async () => {
    expect(
      (
        await at(correctionRoute, 'roster/corrections', {
          action: 'remove',
          studentId: s.e,
          reason: '',
        })
      ).status,
    ).toBe(400);
    const res = await at(correctionRoute, 'roster/corrections', {
      action: 'remove',
      studentId: s.e,
      reason: 'Left before the test (fictional)',
    });
    expect(res.status).toBe(200);
    expect(rowOf(res.data!, 'e')).toMatchObject({
      removedReason: 'Left before the test (fictional)',
    });
    expect(res.data!.results!.resultVersion).toBe(5);
    expect(res.data!.assessment.rosterCounts).toMatchObject({ active: 7, removed: 1 });
  });

  it.each([
    [
      'a student not placed in that batch on the test date',
      () => ({ studentId: s.x, batchId: w.batch.id }),
      400,
    ],
    [
      'an admission number already on the roster',
      () => ({ studentId: s.late, batchId: w.batch.id, admissionNumber: 'ADM-0001' }),
      409,
    ],
    [
      'a placed student with a new admission number',
      () => ({ studentId: s.late, batchId: w.batch.id, admissionNumber: 'ADM-0002' }),
      200,
    ],
  ])('roster add refuses %s', async (_n, body, status) => {
    expect(
      (
        await at(correctionRoute, 'roster/corrections', {
          action: 'add',
          reason: 'Sat the test late (fictional)',
          ...body(),
        })
      ).status,
    ).toBe(status);
  });
});

describe('list views and teacher visibility', () => {
  it('counts stored records per view under the same filters', async () => {
    const list = async (q: string) =>
      academicAssessmentListV1Schema.parse(
        (
          await callRoute(
            listRoute,
            buildRequest(`/academic/api/internal/v1/assessments?${q}`, { headers: headers() }),
          )
        ).data,
      );
    const all = await list(`view=previous&batchId=${b2}`);
    expect(all.items.map((i) => i.id)).toEqual([mockId]);
    expect(all.viewCounts).toMatchObject({ previous: 1, awaiting_publication: 1, upcoming: 0 });
    expect(all.items[0]).toMatchObject({
      publicationState: 'withdrawn',
      batches: [
        { batchId: w.batch.id, primary: true },
        { batchId: b2, primary: false },
      ],
    });
    const none = await list(`view=previous&batchId=${b3}`);
    expect(none.total).toBe(0);
    expect(none.filterOptions.courses).toEqual([
      { id: w.course.id, label: 'Test course (fictional)' },
    ]); // whole view, not the page or the batch filter
    expect(none.filterOptions.batches.map((b) => b.id).sort()).toEqual([w.batch.id, b2].sort());
    expect((await list(`view=previous&teacherStaffId=${w.teacher2Staff}`)).total).toBe(0);
  });

  it('a teacher sees an assessment only for a subject they teach in one of its batches', async () => {
    const make = async (subjectId: string | undefined, batchIds: string[]) =>
      (
        await call(createRoute, '', {
          code: uniq('T-'),
          kind: 'chapter_test',
          title: 'Test (fictional)',
          academicYear: '2026-27',
          batchIds,
          subjectId,
          scheduledDate: '2026-09-25',
          maxMarks: '20',
        })
      ).data!.assessment.id;
    const verbal = await make(w.verbal.id, [w.batch.id]);
    const viaEligible = await make(undefined, [b2, w.batch.id]);
    const seen = async (user: TestUser) =>
      (await listAssessments(ctx.db, actor(user))).map((a) => a.id);
    expect(await seen(u.teacher)).toEqual(expect.arrayContaining([mockId, viaEligible]));
    expect(await seen(u.teacher)).not.toContain(verbal);
    expect(await seen(u.teacher2)).toContain(verbal);
  });

  it('analysis compares a teacher only with assessments they may see (no other subject codes or averages)', async () => {
    const finalised = async (subjectId: string) => {
      const created = await call(createRoute, '', {
        code: uniq('AN-'),
        kind: 'chapter_test',
        title: 'Analysis test (fictional)',
        academicYear: '2026-27',
        batchIds: [w.batch.id],
        subjectId,
        scheduledDate: '2026-09-26',
        maxMarks: '20',
      });
      const id = created.data!.assessment.id;
      const roster = (await call(snapshotRoute, `/${id}/roster`, {}, { id })).data!.roster;
      await call(
        scoresRoute,
        `/${id}/scores`,
        {
          source: 'manual',
          rows: roster.map((r) => ({
            studentId: r.studentId,
            version: r.version,
            attendance: 'present',
            marksState: 'verified',
            score: '12',
          })),
        },
        { id },
      );
      expect((await call(finaliseRoute, `/${id}/finalise`, {}, { id })).status).toBe(200);
      return { id, code: created.data!.assessment.code };
    };
    const quant = await finalised(w.quant.id);
    const verbal = await finalised(w.verbal.id);
    const codes = async (user: TestUser) => {
      const c = (await getAssessmentAnalysis(ctx.db, actor(user), quant.id)).comparison!;
      return [...c.comparable, ...c.notComparable].map((x) => x.code);
    };
    expect(await codes(u.director)).toContain(verbal.code);
    expect(await codes(u.teacher)).not.toContain(verbal.code);
  });

  it('teacher marking on a roster-managed test writes the roster: a score is a verified present mark; a verified overwrite is refused', async () => {
    const id = (
      await call(createRoute, '', {
        code: uniq('T-'),
        kind: 'chapter_test',
        title: 'Total-only test (fictional)',
        academicYear: '2026-27',
        batchIds: [w.batch.id],
        scheduledDate: '2026-09-25',
        maxMarks: '20',
      })
    ).data!.assessment.id;
    await call(snapshotRoute, `/${id}/roster`, {}, { id });
    const sheet = await getMarksSheet(ctx.db, actor(u.teacher), id);
    expect(sheet.assessment.rosterManaged).toBe(true);
    expect(sheet.bounds).toEqual({ min: '0', max: '20', negativeAllowed: false });
    const row = sheet.rows.find((r) => r.studentId === s.a)!;
    await enterMarks(ctx.db, actor(u.teacher), id, {
      marks: [{ studentId: s.a!, state: 'scored', manualScore: '17', version: row.version }],
    });
    const d = academicAssessmentDetailV1Schema.parse(
      (await call(detailRoute, `/${id}`, undefined, { id })).data,
    );
    expect(d.roster.find((r) => r.studentId === s.a)).toMatchObject({
      attendance: 'present',
      marksState: 'verified',
      score: '17',
      version: 2,
    });
    await expect(
      enterMarks(ctx.db, actor(u.teacher), id, {
        marks: [{ studentId: s.a!, state: 'scored', manualScore: '18', version: 2 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('fix round 1: teacher scope on multi-batch rosters, attempts after final, scoring rule, duplicates, acting user', () => {
  let t3: TestUser;
  let multi: string;
  beforeAll(async () => {
    t3 = await createTestUser(ctx.db, { roles: ['teacher'] });
    const t3Staff = await staffFor(ctx.db, t3, 'Tara Teacher (fictional)');
    await createAssignment(ctx.db, actor(u.coordinator), {
      batchId: b2,
      subjectId: w.quant.id,
      staffMemberId: t3Staff,
    });
    await createAssignment(ctx.db, actor(u.coordinator), {
      batchId: w.batch.id,
      subjectId: w.verbal.id,
      staffMemberId: t3Staff,
    }); // VERBAL b1 + QUANT b2
    const created = await call(createRoute, '', {
      code: uniq('MB-'),
      kind: 'sectional',
      title: 'Two-batch quant (fictional)',
      academicYear: '2026-27',
      batchIds: [w.batch.id, b2],
      subjectId: w.quant.id,
      scheduledDate: '2026-09-27',
      maxMarks: '20',
    });
    multi = created.data!.assessment.id;
    await call(snapshotRoute, `/${multi}/roster`, {}, { id: multi });
  });
  const sheetIds = async (user: TestUser) =>
    (await getMarksSheet(ctx.db, actor(user), multi)).rows.map((r) => r.studentId).sort();

  it('C1: a teacher sees and marks only the roster rows of their own (batch, subject); the coordinator sees all', async () => {
    expect(await sheetIds(t3)).toEqual([s.g, s.h].sort());
    expect(await sheetIds(u.teacher)).not.toContain(s.g);
    expect(await sheetIds(u.coordinator)).toEqual(expect.arrayContaining([s.a, s.g]));
    await expect(
      enterMarks(ctx.db, actor(t3), multi, {
        marks: [{ studentId: s.a!, state: 'scored', manualScore: '5', version: 1 }],
      }),
    ).rejects.toMatchObject({ status: 404 });
    await enterMarks(ctx.db, actor(t3), multi, {
      marks: [{ studentId: s.g!, state: 'scored', manualScore: '5', version: 1 }],
    });
  });

  it('validate: a teacher’s issue list names only students whose marks they may see; the coordinator sees every id', async () => {
    const issueIds = async (user: TestUser) =>
      (await validateAssessment(ctx.db, actor(user), multi)).issues.flatMap((i) =>
        i.studentId ? [i.studentId] : [],
      );
    expect(await issueIds(u.coordinator)).toEqual(expect.arrayContaining([s.a, s.h]));
    const mine = await issueIds(t3);
    expect(mine).toContain(s.h);
    expect(mine.filter((id) => id !== s.g && id !== s.h)).toEqual([]);
  });

  it('I1: a teacher of a secondary batch gets a schedule check for their batch, not a 404', async () => {
    const a = await getAssessment(ctx.db, actor(t3), multi);
    expect(a.scheduleBatchId).toBe(b2);
    await expect(
      checkAssessmentScheduleFor(ctx.db, actor(t3), { batchId: a.scheduleBatchId }),
    ).resolves.toMatchObject({ batch: { id: b2 } });
  });

  it('I2: the Academic scoring form refuses rule changes once roster marks exist', async () => {
    await expect(
      configureScoring(
        ctx.db,
        actor(u.coordinator),
        multi,
        scoringBody.parse({
          marksPerCorrect: '1',
          marksPerWrong: '0',
          marksUnattempted: '0',
          sections: [{ code: 'Q', name: 'Q', questionCount: 20 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('M1: duplicate students in one write are refused on every path', async () => {
    const row = {
      studentId: s.h as never,
      version: 1,
      attendance: 'absent' as const,
      marksState: 'not_entered' as const,
      score: null,
    };
    await expect(
      recordScores(ctx.db, actor(ops), multi, {
        source: 'manual',
        rows: [row, row],
        overwriteVerified: false,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('C2: responses cannot change a roster-managed test once results are final', async () => {
    const d = academicAssessmentDetailV1Schema.parse(
      (await call(detailRoute, `/${multi}`, undefined, { id: multi })).data,
    );
    await call(
      scoresRoute,
      `/${multi}/scores`,
      {
        source: 'manual',
        rows: d.roster.map((r) => ({
          studentId: r.studentId,
          version: r.version,
          ...(r.studentId === s.h
            ? { attendance: 'absent', marksState: 'not_entered', score: null }
            : { attendance: 'present', marksState: 'verified', score: '5' }),
        })),
      },
      { id: multi },
    );
    expect((await call(finaliseRoute, `/${multi}/finalise`, {}, { id: multi })).status).toBe(200);
    await expect(
      upsertAttempts(
        ctx.db,
        actor(u.coordinator),
        multi,
        attemptsBody.parse({
          attempts: [{ studentId: s.h, status: 'submitted', keyVersion: 1, responses: {} }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const after = academicAssessmentDetailV1Schema.parse(
      (await call(detailRoute, `/${multi}`, undefined, { id: multi })).data,
    );
    expect(after.roster.find((r) => r.studentId === s.h)).toMatchObject({
      attendance: 'absent',
      score: null,
    });
  });

  // Root cause (fix round 2): every teacher-facing path with per-student marks or ranks uses one helper.
  const ids = (list: readonly { studentId: string }[]) => list.map((r) => r.studentId).sort();
  const codeToId = async () =>
    new Map(
      (
        await ctx.db
          .select({ id: academicStudents.id, code: academicStudents.code })
          .from(academicStudents)
      ).map((r) => [r.code, r.id as string]),
    );
  const sees: [string, (user: TestUser) => Promise<unknown>][] = [
    ['marks sheet', async (user) => ids((await getMarksSheet(ctx.db, actor(user), multi)).rows)],
    ['results', async (user) => ids((await getResults(ctx.db, actor(user), multi)).results)],
    [
      'assessment report (print and CSV)',
      async (user) => {
        const m = await codeToId();
        return (await buildReport(ctx.db, actor(user), 'assessment', { assessmentId: multi })).rows
          .map((r) => m.get(r[0] as string)!)
          .sort();
      },
    ],
    [
      'analysis counts',
      async (user) => {
        const x = (await getAssessmentAnalysis(ctx.db, actor(user), multi)).analysis!;
        return { eligible: x.eligible, scored: x.scored };
      },
    ],
    [
      'student progress',
      async (user) => {
        const shown: string[] = [];
        for (const k of ['a', 'b', 'g', 'h']) {
          const progress = await getStudentProgress(ctx.db, actor(user), s[k]!).catch(() => null);
          if (progress?.batches.some((b) => b.results.some((r) => r.assessmentId === multi)))
            shown.push(s[k]!);
        }
        return shown.sort();
      },
    ],
  ];
  it.each(sees)(
    'root cause: a VERBAL-b1 + QUANT-b2 teacher sees only the b2 rows of a QUANT b1+b2 mock on %s; the coordinator sees all',
    async (name, read) => {
      const roster = academicAssessmentDetailV1Schema.parse(
        (await call(detailRoute, `/${multi}`, undefined, { id: multi })).data,
      ).roster;
      const all = ids(roster);
      const mine = [s.g!, s.h!].sort();
      const expected = (who: string[]) =>
        name === 'analysis counts'
          ? { eligible: who.length, scored: who.filter((id) => id !== s.h).length }
          : name === 'student progress'
            ? who.filter((id) => [s.a, s.b, s.g, s.h].includes(id)).sort()
            : who;
      expect(await read(t3)).toEqual(expected(mine));
      expect(await read(u.coordinator)).toEqual(expected(all));
    },
  );

  it('M5: a disabled acting user is refused', async () => {
    const gone = await createTestUser(ctx.db, { roles: ['operations_manager'] });
    await ctx.db.update(coreUsers).set({ status: 'disabled' }).where(eq(coreUsers.id, gone.id));
    expect(
      (
        await call(
          patchRoute,
          `/${multi}`,
          { title: 'Renamed (fictional)' },
          { id: multi },
          headers('ops', gone.id),
          'PATCH',
        )
      ).status,
    ).toBe(403);
  });
});
