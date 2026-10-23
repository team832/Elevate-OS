/**
 * Student feedback about teachers — privacy and integrity rules (review round 1): small-group
 * means, recounting on approval, corrections, self-interest, anonymity, overlapping summaries,
 * visibility settings, actions. Fictional people only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { setupTestDatabase } from '@elevate/testing';
import {
  notifications,
  opsStaffProfiles,
  opsStudentTeacherFeedback as feedback,
  staffMembers,
} from '@elevate/database';
import * as aboutTeachers from '../../src/app/api/v1/feedback/about-teachers/route';
import * as actionRoute from '../../src/app/api/v1/feedback/actions/[id]/route';
import * as actionsRoute from '../../src/app/api/v1/feedback/actions/route';
import { workRoutes } from '../../src/work';
import { listResponses, responseDetail } from '../../src/server/feedback-responses';
import { listActions, listSummaries, summaryDetail } from '../../src/server/feedback-summaries';
import { ABOUT_YOU } from '../../src/server/feedback-access';
import { importDetail } from '../../src/server/feedback-import';
import { listAttachments, uploadAttachment } from '../../src/server/attachments';
import { hrFeedbackCounts } from '../../src/server/feedback-hr';
import { updateSetting } from '../../src/server/settings';
import type { StaffUser } from './fixtures';
import { call, feedbackFixtures } from './feedback-fixtures';

const ctx = setupTestDatabase();
const { f, record, moderate, newSummary, patchSummary, upload, act } = feedbackFixtures(ctx);
const mine = (who: StaffUser) =>
  call<{ summaries: Record<string, unknown>[]; actions: unknown[] }>(
    workRoutes['feedback/mine'],
    'GET',
    who,
    '/academic/api/v1/feedback/mine',
  );
const setting = (key: string, value: unknown) =>
  updateSetting(ctx.db, f.u.operations_manager, { key, value });
/** `n` approved responses about the teacher in a month, each rating 4 overall. */
async function approvedResponses(
  month: string,
  n: number,
  categoryRatings: (i: number) => Record<string, number> | undefined = () => undefined,
) {
  for (let i = 0; i < n; i++) {
    const r = await record({
      periodStart: `${month}-01`,
      periodEnd: `${month}-28`,
      feedbackOn: `${month}-20`,
      rating: 4,
      categoryRatings: categoryRatings(i),
      comment: `Sample answer ${i}.`,
    });
    await moderate(r.data!.id, { action: 'approve' });
  }
}
const summaryFor = async (month: string) =>
  (await newSummary({ periodStart: `${month}-01`, periodEnd: `${month}-28` })).data!;

describe('summaries', () => {
  it('C1: no mean from fewer raters than the minimum reaches the teacher, whatever the codes', async () => {
    await setting('feedback.categories', {
      categories: [
        { code: 'pace', label: 'Pace' },
        { code: 'ab', label: 'Sample AB' },
        { code: 'ab__n', label: 'Sample AB N' },
      ],
    });
    // Five responses rate ab; one also rates pace 1 and ab__n 1 (one student's rating each).
    await approvedResponses('2026-05', 5, (i) => ({
      ab: 3,
      ...(i === 0 ? { pace: 1, ab__n: 1 } : {}),
    }));
    const s = await summaryFor('2026-05');
    expect((await patchSummary(s.id, { action: 'approve' })).status).toBe(200);
    const [shown] = (await mine(f.u.teacher)).data!.summaries;
    expect(shown).toEqual({
      id: s.id,
      periodStart: '2026-05-01',
      periodEnd: '2026-05-28',
      approvedAt: expect.any(String),
      ratingScaleMax: 5,
      enough: true,
      minGroupSize: 5,
      responseCount: 5,
      eligiblePopulation: null,
      categoryMeans: { overall: 4, categories: { ab: 3 } },
      strengths: null,
      areasToImprove: null,
      summaryText: null,
    });
  });

  it('I1: approving counts again (a row hidden after drafting is left out)', async () => {
    await approvedResponses('2026-06', 3);
    const s = await summaryFor('2026-06');
    expect(s.responseCount).toBe(3);
    const [row] = await ctx.db
      .select()
      .from(feedback)
      .where(eq(feedback.periodStart, '2026-06-01' as never))
      .limit(1);
    await moderate(row!.id, { action: 'hide' });
    expect((await patchSummary(s.id, { action: 'approve' })).data).toMatchObject({
      status: 'approved',
      responseCount: 2,
    });
  });

  it('M7: a summary overlapping a live one for the same teacher is refused; withdrawn frees it', async () => {
    const s = await summaryFor('2026-07');
    expect((await newSummary({ periodStart: '2026-07-15', periodEnd: '2026-08-15' })).status).toBe(
      409,
    );
    expect((await patchSummary(s.id, { action: 'withdraw' })).data?.status).toBe('withdrawn');
    expect((await newSummary({ periodStart: '2026-07-15', periodEnd: '2026-08-15' })).status).toBe(
      201,
    );
  });

  it('M1: an HR manager who is the teacher cannot approve a summary about themselves', async () => {
    const s = (
      await newSummary({
        teacherStaffId: f.hrSubject.staffId,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      })
    ).data!;
    expect((await patchSummary(s.id, { action: 'approve' }, f.hrSubject)).status).toBe(403);
    expect((await patchSummary(s.id, { action: 'approve' })).status).toBe(200);
    // Round 4: nobody prepares or lists a summary about themselves.
    expect(
      (
        await newSummary(
          {
            teacherStaffId: f.hrSubject.staffId,
            periodStart: '2026-02-01',
            periodEnd: '2026-02-28',
          },
          f.hrSubject,
        )
      ).status,
    ).toBe(403);
    const draft = (
      await newSummary({
        teacherStaffId: f.hrSubject.staffId,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      })
    ).data!;
    const edit = await patchSummary(
      draft.id,
      { action: 'edit', strengths: 'Sample.' },
      f.hrSubject,
    );
    expect([edit.status, edit.error?.message]).toEqual([
      403,
      'Another HR person must prepare this.',
    ]);
    const listed = await listSummaries(ctx.db, f.hrSubject, { page: 1 });
    expect(listed.rows.some((r) => r.teacherStaffId === f.hrSubject.staffId)).toBe(false);
    expect(
      (await listSummaries(ctx.db, f.u.hr_manager, { page: 1 })).rows.some(
        (r) => r.teacherStaffId === f.hrSubject.staffId,
      ),
    ).toBe(true);
    // M2: the originals behind a summary about you are not yours to read.
    await expect(summaryDetail(ctx.db, f.hrSubject, s.id)).rejects.toMatchObject({ status: 404 });
    expect((await summaryDetail(ctx.db, f.u.hr_manager, s.id)).id).toBe(s.id);
  });

  it('M4 + visibility: "nothing" shows and notifies nothing; "…and_comments" shows HR-edited text', async () => {
    await setting('feedback.teacher_visibility', { show: 'nothing' });
    await approvedResponses('2026-03', 1);
    const s = await summaryFor('2026-03');
    await patchSummary(s.id, { action: 'edit', summaryText: 'Sample edited text.' });
    await patchSummary(s.id, { action: 'approve' });
    expect((await mine(f.u.teacher)).data).toMatchObject({ summaries: [], actions: [] });
    const notes = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, f.u.teacher.id), eq(notifications.entityId, s.id)));
    expect(notes).toEqual([]);
    await setting('feedback.teacher_visibility', { show: 'approved_summaries_and_comments' });
    await setting('feedback.min_group_size', { size: 1 });
    const shown = (await mine(f.u.teacher)).data!.summaries.find((x) => x.id === s.id);
    expect(shown?.summaryText).toBe('Sample edited text.');
    await setting('feedback.teacher_visibility', { show: 'approved_summaries' });
    await setting('feedback.min_group_size', { size: 5 });
  });
});

describe('corrections and self-interest', () => {
  it('I3: a correction must be about the same teacher and hides the old row', async () => {
    const old = (await record({ comment: 'Sample typo.' })).data!;
    expect((await record({ correctsId: old.id, teacherStaffId: f.teacherB.staffId })).status).toBe(
      400,
    );
    const fixed = await record({ correctsId: old.id, comment: 'Sample corrected.' });
    expect(fixed.status).toBe(201);
    const [after] = await ctx.db
      .select()
      .from(feedback)
      .where(eq(feedback.id, old.id as never));
    expect(after!.moderationStatus).toBe('hidden');
    // A row already hidden (or rejected) can still be corrected; it just stays as it is.
    expect((await record({ correctsId: old.id, comment: 'Sample corrected again.' })).status).toBe(
      201,
    );
  });

  it('I3 + M2: nobody corrects or reads raw feedback about themselves', async () => {
    const own = (await record({ teacherStaffId: f.hrSubject.staffId })).data!;
    expect(
      (await record({ teacherStaffId: f.hrSubject.staffId, correctsId: own.id }, f.hrSubject))
        .status,
    ).toBe(403);
    // Evidence files on a row about you: 404 for you, readable and addable for other HR.
    const evidence = {
      ownerKind: 'feedback_evidence' as const,
      ownerId: own.id,
      purpose: 'evidence' as const,
      name: 'sample-evidence.txt',
      mime: 'text/plain',
      dataBase64: Buffer.from('Sample evidence').toString('base64'),
    };
    await expect(uploadAttachment(ctx.db, f.hrSubject, evidence)).rejects.toMatchObject({
      status: 404,
    });
    expect((await uploadAttachment(ctx.db, f.u.hr_manager, evidence)).id).toBeTruthy();
    await expect(
      listAttachments(ctx.db, f.hrSubject, 'feedback_evidence', own.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listAttachments(ctx.db, f.u.hr_manager, 'feedback_evidence', own.id)).toHaveLength(
      1,
    );
    await expect(
      listAttachments(ctx.db, f.u.teacher, 'feedback_evidence', own.id),
    ).rejects.toMatchObject({ status: 404 });
    const list = await listResponses(ctx.db, f.hrSubject, { page: 1 });
    expect(list.rows.some((r) => r.teacherStaffId === f.hrSubject.staffId)).toBe(false);
    await expect(responseDetail(ctx.db, f.hrSubject, own.id)).rejects.toMatchObject({
      status: 404,
    });
    const about = await call(
      aboutTeachers,
      'GET',
      f.hrSubject,
      `/ops/api/v1/feedback/about-teachers?teacherStaffId=${f.hrSubject.staffId}`,
    );
    expect(about.status).toBe(404);
  });
});

describe('imports', () => {
  const HEAD = 'Teacher,Batch,Period start,Period end,Rating,Comment';
  const imported = (importId: string) =>
    ctx.db
      .select()
      .from(feedback)
      .where(eq(feedback.importId, importId as never));

  it('I4 + I5: the importer a row is about cannot commit (no self-approval); anonymity only when declared', async () => {
    const csv = `${HEAD}\nDEMO-T01,SAMPLE-B1,2026-02-01,2026-02-28,4,Sample a.\nDEMO-T02,SAMPLE-B1,2026-02-01,2026-02-28,3,Sample b.`;
    expect((await upload(csv, 'approve.csv', f.hrSubject)).status).toBe(403);
    const p = (await upload(csv, 'approve.csv')).data!;
    expect((await act(p.id, 'commit', { approve: true }, f.hrSubject)).status).toBe(403);
    expect((await act(p.id, 'commit', { approve: true })).data?.status).toBe('committed');
    const rows = await imported(p.id);
    const status = (code: StaffUser) =>
      rows.find((r) => r.teacherStaffId === code.staffId)?.moderationStatus;
    expect([status(f.u.teacher), status(f.hrSubject)]).toEqual(['approved', 'approved']);
    expect(rows.every((r) => !r.isAnonymous && r.studentId === null)).toBe(true);
    // M2: the row about the HR teacher is redacted for them, and the source file refused.
    const detail = await importDetail(ctx.db, f.hrSubject, p.id);
    const aboutMe = detail.rows.find((r) => r.messages.includes(ABOUT_YOU));
    expect(aboutMe?.raw).toEqual({});
    expect(JSON.stringify(detail.rows)).not.toContain('Sample b.');
    expect(JSON.stringify((await importDetail(ctx.db, f.u.hr_manager, p.id)).rows)).toContain(
      'Sample b.',
    );
    await expect(
      listAttachments(ctx.db, f.hrSubject, 'feedback_import', p.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listAttachments(ctx.db, f.u.hr_manager, 'feedback_import', p.id)).toHaveLength(1);
    // Round 4: the stored resolution decides, never today's staff list.
    await ctx.db
      .update(opsStaffProfiles)
      .set({ staffCode: 'DEMO-T92' })
      .where(eq(opsStaffProfiles.staffId, f.hrSubject.staffId));
    expect(
      (await importDetail(ctx.db, f.hrSubject, p.id)).rows.some((r) =>
        r.messages.includes(ABOUT_YOU),
      ),
    ).toBe(true);
    await ctx.db
      .update(opsStaffProfiles)
      .set({ staffCode: 'DEMO-T02' })
      .where(eq(opsStaffProfiles.staffId, f.hrSubject.staffId));
  });

  it('round 4: an ambiguous name is about every candidate, as stored at preview', async () => {
    const p = (
      await upload(
        `${HEAD}
Sample Twin,SAMPLE-B1,2026-02-01,2026-02-28,2,Sample twin answer.`,
        'twin.csv',
      )
    ).data!;
    expect(p.rowsInvalid).toBe(1);
    const rows = async () => JSON.stringify((await importDetail(ctx.db, f.hrTwin, p.id)).rows);
    expect(await rows()).not.toContain('Sample twin answer.');
    await expect(listAttachments(ctx.db, f.hrTwin, 'feedback_import', p.id)).rejects.toMatchObject({
      status: 404,
    });
    // Renaming afterwards changes nothing: names are not matched again on read.
    await ctx.db
      .update(staffMembers)
      .set({ fullName: 'Sample Renamed' })
      .where(eq(staffMembers.id, f.hrTwin.staffId));
    expect(await rows()).not.toContain('Sample twin answer.');
    expect(JSON.stringify((await importDetail(ctx.db, f.u.hr_manager, p.id)).rows)).toContain(
      'Sample twin answer.',
    );

    const anon = (
      await upload(`${HEAD}\nDEMO-T01,SAMPLE-B1,2026-02-01,2026-02-28,5,Sample c.`, 'anon.csv')
    ).data!;
    await act(anon.id, 'commit', { anonymous: true });
    expect((await imported(anon.id))[0]?.isAnonymous).toBe(true);
  });

  it('discard frees the file for a new upload', async () => {
    const csv = `${HEAD}\nDEMO-T01,SAMPLE-B1,2026-02-01,2026-02-28,2,Sample d.`;
    const p = (await upload(csv, 'discard.csv')).data!;
    expect((await act(p.id, 'discard')).data?.status).toBe('discarded');
    expect((await upload(csv, 'discard.csv')).status).toBe(201);
  });
});

describe('development actions', () => {
  let id: string;
  beforeAll(async () => {
    const res = await call<{ id: string }>(
      actionsRoute,
      'POST',
      f.u.hr_manager,
      '/ops/api/v1/feedback/actions',
      {
        teacherStaffId: f.u.teacher.staffId,
        action: 'Sample: observe a colleague',
        dueOn: '2026-01-15',
      },
    );
    id = res.data!.id;
  });

  it('past due ones are listed and counted', async () => {
    const list = await listActions(ctx.db, f.u.hr_manager, { due: 'past', page: 1 });
    expect(list.rows.map((r) => r.id)).toContain(id);
    const counts = await hrFeedbackCounts(ctx.db, f.u.hr_manager);
    expect(counts.find((c) => c.key === 'actions_past_due')?.value).toBeGreaterThanOrEqual(1);
  });

  it('PATCH marks done and agreed; teachers cannot', async () => {
    const patch = (who: StaffUser, json: object) =>
      call<{ status: string; agreedAt: string | null }>(
        actionRoute,
        'PATCH',
        who,
        `/ops/api/v1/feedback/actions/${id}`,
        json,
        { id },
      );
    expect((await patch(f.u.teacher, { status: 'done' })).status).toBe(403);
    const done = await patch(f.u.hr_manager, { status: 'done', agreed: true });
    expect(done.data).toMatchObject({ status: 'done' });
    expect(done.data?.agreedAt).not.toBeNull();
    const list = await listActions(ctx.db, f.u.hr_manager, { due: 'past', page: 1 });
    expect(list.rows.map((r) => r.id)).not.toContain(id);
  });
});
