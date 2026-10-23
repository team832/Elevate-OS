/**
 * Round 7: HR staff who teach (teacher role, or any subject capability) get no access to raw
 * student feedback about teachers at all; non-teaching HR never handle work about themselves.
 * Fictional people only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { opsStudentTeacherFeedback as feedback } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import * as aboutTeachers from '../../src/app/api/v1/feedback/about-teachers/route';
import * as actionRoute from '../../src/app/api/v1/feedback/actions/[id]/route';
import * as actionsRoute from '../../src/app/api/v1/feedback/actions/route';
import * as aiRoute from '../../src/app/api/v1/ai/feedback-summary/route';
import { listAttachments } from '../../src/server/attachments';
import { CONFLICTED } from '../../src/server/feedback-access';
import { hrFeedbackCounts } from '../../src/server/feedback-hr';
import { importDetail, listImports } from '../../src/server/feedback-import';
import {
  listFeedbackAboutTeacher,
  listResponses,
  responseDetail,
} from '../../src/server/feedback-responses';
import { collectFacts } from '../../src/server/eod-facts';
import { listActions, listSummaries, summaryDetail } from '../../src/server/feedback-summaries';
import type { StaffUser } from './fixtures';
import { call, feedbackFixtures } from './feedback-fixtures';

const ctx = setupTestDatabase();
const { f, record, moderate, newSummary, patchSummary, upload, remap, act } = feedbackFixtures(ctx);
const ids = { feedback: '', import: '', summary: '', action: '' };
const action = (json: object, who: StaffUser) =>
  call<{ id: string }>(actionsRoute, 'POST', who, '/ops/api/v1/feedback/actions', json);
const patchAction = (id: string, json: object, who: StaffUser) =>
  call(actionRoute, 'PATCH', who, `/ops/api/v1/feedback/actions/${id}`, json, { id });

beforeAll(async () => {
  ids.feedback = (await record()).data!.id;
  ids.import = (
    await upload(
      'Teacher,Batch,Period start,Period end,Rating,Comment\nDEMO-T01,SAMPLE-B1,2026-05-01,2026-05-28,4,Sample conflict answer.',
      'conflict.csv',
    )
  ).data!.id;
  ids.summary = (await newSummary({ periodStart: '2026-06-01', periodEnd: '2026-06-28' })).data!.id;
  ids.action = (
    await action(
      { teacherStaffId: f.u.teacher.staffId, action: 'Sample: plan a recap' },
      f.u.hr_manager,
    )
  ).data!.id;
});

/** [status, message] of a refusal, or 'allowed'. */
async function outcome(run: () => Promise<unknown>) {
  try {
    const r = (await run()) as { ok?: boolean; status?: number; error?: { message: string } };
    return r?.ok === false ? [r.status, r.error!.message] : 'allowed';
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
}

const ENTRY_POINTS: [string, (who: StaffUser) => Promise<unknown>][] = [
  ['record a response', (who) => record({}, who)],
  ['moderate a response', (who) => moderate(ids.feedback, { action: 'approve' }, who)],
  ['list responses', (who) => listResponses(ctx.db, who, { page: 1 })],
  ['response detail', (who) => responseDetail(ctx.db, who, ids.feedback)],
  [
    'feedback about one teacher',
    (who) =>
      call(
        aboutTeachers,
        'GET',
        who,
        `/ops/api/v1/feedback/about-teachers?teacherStaffId=${f.u.teacher.staffId}`,
      ),
  ],
  ['upload an import', (who) => upload('Teacher,Rating\nDEMO-T01,3', `c-${who.id}.csv`, who)],
  ['remap an import', (who) => remap(ids.import, { Teacher: 'teacher' }, who)],
  ['commit an import', (who) => act(ids.import, 'commit', {}, who)],
  ['discard an import', (who) => act(ids.import, 'discard', {}, who)],
  ['import list', (who) => listImports(ctx.db, who)],
  ['import detail', (who) => importDetail(ctx.db, who, ids.import)],
  [
    'create a summary',
    (who) => newSummary({ periodStart: '2026-07-01', periodEnd: '2026-07-28' }, who),
  ],
  ['edit a summary', (who) => patchSummary(ids.summary, { action: 'approve' }, who)],
  ['list summaries', (who) => listSummaries(ctx.db, who, { page: 1 })],
  ['summary detail', (who) => summaryDetail(ctx.db, who, ids.summary)],
  [
    'AI summary draft',
    (who) =>
      call(aiRoute, 'POST', who, '/ops/api/v1/ai/feedback-summary', { summaryId: ids.summary }),
  ],
  [
    'create an action',
    (who) => action({ teacherStaffId: f.u.teacher.staffId, action: 'Sample: x' }, who),
  ],
  ['update an action', (who) => patchAction(ids.action, { status: 'done' }, who)],
  ['list actions', (who) => listActions(ctx.db, who, { page: 1 })],
  ['HR overview counts', (who) => hrFeedbackCounts(ctx.db, who)],
];
const WHO = ['hrWhoTeaches', 'hrWithSubject'] as const;

describe('HR staff who teach have no access (round 7)', () => {
  it.each(ENTRY_POINTS.flatMap(([name, run]) => WHO.map((w) => [name, w, run] as const)))(
    '%s by %s → 403',
    async (_name, who, run) => {
      expect(await outcome(() => run(f[who]))).toEqual([403, CONFLICTED]);
    },
  );

  it.each(WHO)('%s cannot open import source files or evidence', async (who) => {
    for (const [kind, id] of [
      ['feedback_import', ids.import],
      ['feedback_evidence', ids.feedback],
    ] as const)
      await expect(listAttachments(ctx.db, f[who], kind, id)).rejects.toMatchObject({
        status: 404,
      });
  });

  it('non-teaching HR still can', async () => {
    expect(await outcome(() => listResponses(ctx.db, f.u.hr_manager, { page: 1 }))).toBe('allowed');
    expect(await outcome(() => importDetail(ctx.db, f.u.hr_manager, ids.import))).toBe('allowed');
    expect(await outcome(() => hrFeedbackCounts(ctx.db, f.u.hr_manager))).toBe('allowed');
  });
});

describe('non-teaching HR never handle work about themselves', () => {
  it('I1: recording a response about yourself is refused', async () => {
    const res = await record({ teacherStaffId: f.hrSubject.staffId }, f.hrSubject);
    expect(res.status).toBe(403);
  });

  it('I2: actions about yourself cannot be created, changed or listed', async () => {
    const mine = { teacherStaffId: f.hrSubject.staffId, action: 'Sample: about me' };
    expect((await action(mine, f.hrSubject)).status).toBe(403);
    const id = (await action(mine, f.u.hr_manager)).data!.id;
    expect((await patchAction(id, { status: 'done' }, f.hrSubject)).status).toBe(403);
    const listed = await listActions(ctx.db, f.hrSubject, { page: 1 });
    expect(listed.rows.some((r) => r.teacherStaffId === f.hrSubject.staffId)).toBe(false);
  });

  it('I3: overview counts leave out feedback and summaries about the viewer', async () => {
    await record({ teacherStaffId: f.hrSubject.staffId });
    await newSummary({
      teacherStaffId: f.hrSubject.staffId,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-28',
    });
    const counts = async (who: StaffUser) =>
      Object.fromEntries((await hrFeedbackCounts(ctx.db, who)).map((c) => [c.key, c.value]));
    const [all, mine] = [await counts(f.u.hr_manager), await counts(f.hrSubject)];
    expect(mine.feedback_pending).toBe(all.feedback_pending! - 1);
    expect(mine.summaries_draft).toBe(all.summaries_draft! - 1);
  });
});

describe('round 8: raw reads leave out imported rows that may be about the reader', () => {
  let feedbackId = '';
  beforeAll(async () => {
    const csv =
      'Teacher,Batch,Period start,Period end,Rating,Comment\nDEMO-T01,SAMPLE-B1,2026-09-01,2026-09-28,4,Sample HR Subject ran zebra drills.';
    const p = (await upload(csv, 'round8.csv')).data!;
    await act(p.id, 'commit', { approve: true });
    const [row] = await ctx.db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.importId, p.id as never));
    feedbackId = row!.id;
  });
  /** Whether [the reader it may be about, another HR person] see the comment. */
  const shows = (read: (who: StaffUser) => Promise<unknown>) =>
    Promise.all(
      [f.hrSubject, f.u.hr_manager].map(async (who) =>
        JSON.stringify(await read(who)).includes('zebra'),
      ),
    );

  it.each([
    ['responses list', (who: StaffUser) => listResponses(ctx.db, who, { page: 1 })],
    [
      'feedback about one teacher',
      (who: StaffUser) => listFeedbackAboutTeacher(ctx.db, who, f.u.teacher.staffId),
    ],
  ])('%s', async (_, read) => {
    expect(await shows(read)).toEqual([false, true]);
  });

  it('response detail is 404 for the reader it may be about', async () => {
    await expect(responseDetail(ctx.db, f.hrSubject, feedbackId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await responseDetail(ctx.db, f.u.hr_manager, feedbackId)).id).toBe(feedbackId);
  });

  it('summary originals', async () => {
    const s = (await newSummary({ periodStart: '2026-09-01', periodEnd: '2026-09-30' })).data!;
    expect(await shows((who) => summaryDetail(ctx.db, who, s.id))).toEqual([false, true]);
  });
});

it('round 8: the monthly report lists only actions with an approved summary or none', async () => {
  await action(
    {
      teacherStaffId: f.u.teacher.staffId,
      summaryId: ids.summary,
      action: 'Sample: tied to a draft',
    },
    f.u.hr_manager,
  );
  const facts = JSON.stringify(
    await collectFacts(ctx.db, f.u.teacher.staffId, {
      kind: 'month',
      start: '2026-10-01',
      end: '2026-10-31',
    } as never),
  );
  expect(facts).toContain('Sample: plan a recap');
  expect(facts).not.toContain('Sample: tied to a draft');
});
