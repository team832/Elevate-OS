/**
 * Student feedback about teachers (brief 23 Oct 2026 §15, §20 scenarios 12–13): HR-only raw rows,
 * file imports with row-level outcomes, summaries, and the teacher's view in Academic OS.
 * Fictional people only (Sample …). Further rules: teacher-feedback-rules.test.ts.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { setupTestDatabase } from '@elevate/testing';
import { opsStudentTeacherFeedback } from '@elevate/database';
import * as aboutTeachers from '../../src/app/api/v1/feedback/about-teachers/route';
import * as importsRoute from '../../src/app/api/v1/feedback/imports/route';
import * as summariesRoute from '../../src/app/api/v1/feedback/summaries/route';
import * as actionsRoute from '../../src/app/api/v1/feedback/actions/route';
import { FeedbackDevelopmentBody, workRoutes } from '../../src/work';
import { ActionsTab } from '../../src/app/hr/feedback/_components/actions-tab';
import { ImportsTab } from '../../src/app/hr/feedback/_components/imports-tab';
import { ResponsesTab } from '../../src/app/hr/feedback/_components/responses-tab';
import { SummariesTab } from '../../src/app/hr/feedback/_components/summaries-tab';
import { listAttachments } from '../../src/server/attachments';
import { hrFeedbackCounts } from '../../src/server/feedback-hr';
import { updateSetting } from '../../src/server/settings';
import type { StaffUser } from './fixtures';
import { ADMISSION_NUMBER, call, feedbackFixtures, ROLES, type Role } from './feedback-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
}));
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();

const ctx = setupTestDatabase();
const { f, record, moderate, newSummary, patchSummary, upload, act } = feedbackFixtures(ctx);
/** Workspace each role calls through (D-072). */
const base = (r: Role) => (r === 'teacher' ? '/academic' : '/ops');

const ROW = 'DEMO-T01,SAMPLE-B1,2026-09-01,2026-09-30';
const CSV = [
  'Teacher,Batch,Period start,Period end,Admission number,Rating,Pace,Comment',
  `${ROW},,4,3,"Clear, a little fast."`,
  'Nobody Known,SAMPLE-B1,2026-09-01,2026-09-30,,4,3,Fine.',
  'DEMO-T01,OTHER-B9,2026-09-01,2026-09-30,,4,3,Fine.',
  `${ROW},,9,3,Out of scale.`,
  'DEMO-T01,SAMPLE-B1,,2026-09-30,,4,3,No start.',
  `${ROW},,4,3,"Clear, a little fast."`,
  `${ROW},${ADMISSION_NUMBER},5,4,Named answer.`,
  `${ROW},${ADMISSION_NUMBER},2,2,Same student again.`,
].join('\n');
const importedRows = async () =>
  (
    await ctx.db
      .select()
      .from(opsStudentTeacherFeedback)
      .where(eq(opsStudentTeacherFeedback.collectionMethod, 'import'))
  ).length;

describe('scenario 12: feedback imports validate refs, flag duplicates, commit only valid rows', () => {
  let first: string;

  it('preview: teacher and batch checked, row-level errors, a repeated student flagged', async () => {
    const res = await upload(CSV);
    expect(res.status).toBe(201);
    first = res.data!.id;
    // Anonymous exact repeats are kept (two students may answer alike); the same student twice is not.
    expect(res.data).toMatchObject({
      status: 'preview',
      rowsTotal: 8,
      rowsValid: 3,
      rowsInvalid: 4,
      rowsDuplicate: 1,
    });
    expect(res.data!.sourceFile?.stored).toBe(true);
    expect(await listAttachments(ctx.db, f.u.hr_manager, 'feedback_import', first)).toHaveLength(1);
    expect(await importedRows()).toBe(0);
  });

  it('the same file is refused while its preview is live, also when sent twice at once', async () => {
    expect((await upload(CSV)).status).toBe(409);
    const other = `${CSV}\n${ROW},,3,3,Concurrent.`;
    const statuses = (await Promise.all([upload(other), upload(other)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
  });

  it('commit writes only the valid rows; committing again changes nothing', async () => {
    expect((await act(first, 'commit')).data).toMatchObject({ status: 'committed', rowsValid: 3 });
    expect(await importedRows()).toBe(3);
    expect((await act(first, 'commit')).data?.status).toBe('committed');
    expect(await importedRows()).toBe(3);
    expect((await act(first, 'discard')).status).toBe(409);
  });

  it('a later file: the stored student is a duplicate, an identical anonymous answer is kept', async () => {
    const next = await upload(
      `${CSV.split('\n')[0]}\n${ROW},,4,3,"Clear, a little fast."\n${ROW},${ADMISSION_NUMBER},5,4,Again.`,
      'later.csv',
    );
    expect(next.data).toMatchObject({ rowsTotal: 2, rowsValid: 1, rowsDuplicate: 1 });
    expect((await act(next.data!.id, 'discard')).data?.status).toBe('discarded');
    expect(
      (
        await upload(
          `${CSV.split('\n')[0]}\n${ROW},,4,3,"Clear, a little fast."\n${ROW},${ADMISSION_NUMBER},5,4,Again.`,
          'again.csv',
        )
      ).status,
    ).toBe(201);
  });
});

describe('scenario 13: teacher-facing feedback never carries student identities or raw comments', () => {
  let summaryId: string;
  const mine = (who: StaffUser) =>
    call<Record<string, unknown>>(
      workRoutes['feedback/mine'],
      'GET',
      who,
      '/academic/api/v1/feedback/mine',
    );
  const mineOne = (who: StaffUser, id: string) =>
    call(
      workRoutes['feedback/mine/[id]'],
      'GET',
      who,
      `/academic/api/v1/feedback/mine/${id}`,
      undefined,
      { id },
    );

  beforeAll(async () => {
    const ids = [
      (
        await record({
          studentId: f.studentId,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          feedbackOn: '2026-10-20',
        })
      ).data!.id,
      (
        await record({
          isAnonymous: true,
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          feedbackOn: '2026-10-20',
        })
      ).data!.id,
    ];
    for (const id of ids) expect((await moderate(id, { action: 'approve' })).status).toBe(200);
    const s = await newSummary({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    summaryId = s.data!.id;
    expect(s.data?.responseCount).toBe(2);
    await patchSummary(summaryId, {
      action: 'edit',
      strengths: 'Sample strength.',
      summaryText: 'Sample edited comments.',
    });
    expect((await patchSummary(summaryId, { action: 'approve' })).status).toBe(200);
    await call(actionsRoute, 'POST', f.u.hr_manager, '/ops/api/v1/feedback/actions', {
      teacherStaffId: f.u.teacher.staffId,
      summaryId,
      action: 'Sample: slow down for worked examples',
      agreed: true,
    });
  });

  const leaks = (body: unknown) => {
    const text = JSON.stringify(body);
    return ['Asha', f.studentId, 'Sample raw comment'].filter((s) => text.includes(s));
  };

  it('below the minimum group size: no figures, strengths or comments, only that there were too few', async () => {
    const res = await mine(f.u.teacher);
    expect(res.status).toBe(200);
    expect(leaks(res.data)).toEqual([]);
    const [s] = res.data!.summaries as Record<string, unknown>[];
    expect(s).toMatchObject({
      enough: false,
      responseCount: null,
      categoryMeans: null,
      strengths: null,
      summaryText: null,
    });
    expect(res.data!.actions).toHaveLength(1);
  });

  it('at or above it: aggregates and HR-edited text, still no student identity or raw comment', async () => {
    await updateSetting(ctx.db, f.u.operations_manager, {
      key: 'feedback.min_group_size',
      value: { size: 2 },
    });
    const res = await mine(f.u.teacher);
    expect(leaks(res.data)).toEqual([]);
    expect((res.data!.summaries as Record<string, unknown>[])[0]).toMatchObject({
      enough: true,
      responseCount: 2,
      strengths: 'Sample strength.',
      categoryMeans: { overall: 3 },
    });
    await updateSetting(ctx.db, f.u.operations_manager, {
      key: 'feedback.min_group_size',
      value: { size: 5 },
    });
  });

  it("teacher B cannot read teacher A's summary by id (404); teacher A can", async () => {
    expect((await mineOne(f.u.teacher, summaryId)).status).toBe(200);
    expect((await mineOne(f.teacherB, summaryId)).status).toBe(404);
    expect((await mine(f.teacherB)).data!.summaries).toEqual([]);
  });

  it('the Academic page body shows the held-back summary and nothing about respondents', async () => {
    const out = await html(
      <FeedbackDevelopmentBody user={f.u.teacher} base="/academic" searchParams={{}} />,
    );
    expect(out).toContain('Not enough responses to show');
    expect(out).toContain('Sample: slow down for worked examples');
    expect(leaks(out)).toEqual([]);
  });

  it('HR screens render every tab and record pop-up without an error state', async () => {
    const [row] = await ctx.db.select().from(opsStudentTeacherFeedback).limit(1);
    const hr = f.u.hr_manager;
    const views = [
      <ResponsesTab key="r" user={hr} params={{ tab: 'responses', open: row!.id }} />,
      <ResponsesTab
        key="e"
        user={hr}
        params={{ tab: 'responses', record: 'new', recordFor: f.u.teacher.staffId }}
      />,
      <ImportsTab key="i" user={hr} params={{ tab: 'imports' }} />,
      <SummariesTab key="s" user={hr} params={{ tab: 'summaries', open: summaryId }} />,
      <ActionsTab key="a" user={hr} params={{ tab: 'actions' }} />,
    ];
    for (const view of views)
      expect(await html(view)).not.toMatch(/Something went wrong|Cannot show this|Not found/);
    const summary = await html(views[3]!);
    expect(summary).toContain('Sample raw comment naming Asha.'); // HR sees originals beside the write-up
    expect(summary).toContain('Not enough responses to show'); // and the teacher's held-back preview
  });

  it('HR counts link to the filtered lists', async () => {
    const counts = await hrFeedbackCounts(ctx.db, f.u.hr_manager);
    expect(counts.map((c) => c.key)).toEqual([
      'feedback_pending',
      'summaries_draft',
      'actions_past_due',
    ]);
    expect(await hrFeedbackCounts(ctx.db, f.u.teacher)).toEqual([]);
  });
});

describe('permissions: raw feedback is HR and operations manager only', () => {
  const T = () => f.u.teacher.staffId;
  const month = (r: Role) => `2025-${String(ROLES.indexOf(r) + 1).padStart(2, '0')}`;
  it.each<[string, Role[], (r: Role) => Promise<{ status: number }>]>([
    [
      'GET about-teachers',
      ['hr_manager', 'operations_manager'],
      (r) =>
        call(
          aboutTeachers,
          'GET',
          f.u[r],
          `${base(r)}/api/v1/feedback/about-teachers?teacherStaffId=${T()}`,
        ),
    ],
    [
      'POST about-teachers',
      ['hr_manager', 'operations_manager'],
      (r) =>
        call(aboutTeachers, 'POST', f.u[r], `${base(r)}/api/v1/feedback/about-teachers`, {
          teacherStaffId: T(),
          submittedByKind: 'student',
          feedbackOn: '2026-09-21',
          comment: 'Sample.',
        }),
    ],
    [
      'POST imports',
      ['hr_manager', 'operations_manager'],
      (r) =>
        call(importsRoute, 'POST', f.u[r], `${base(r)}/api/v1/feedback/imports`, {
          name: `${r}.csv`,
          content: `Teacher,Batch\nDEMO-T01,${r}`,
        }),
    ],
    [
      'POST summaries',
      ['hr_manager', 'operations_manager'],
      (r) =>
        call(summariesRoute, 'POST', f.u[r], `${base(r)}/api/v1/feedback/summaries`, {
          teacherStaffId: T(),
          periodStart: `${month(r)}-01`,
          periodEnd: `${month(r)}-10`,
        }),
    ],
    [
      'GET mine',
      ['hr_manager', 'operations_manager', 'director', 'auditor', 'teacher'],
      (r) => call(workRoutes['feedback/mine'], 'GET', f.u[r], `${base(r)}/api/v1/feedback/mine`),
    ],
  ])('%s: allowed only for %j', async (_name, allowed, run) => {
    for (const r of ROLES) {
      const { status } = await run(r);
      expect([r, status < 300]).toEqual([r, allowed.includes(r)]);
    }
  });
});
