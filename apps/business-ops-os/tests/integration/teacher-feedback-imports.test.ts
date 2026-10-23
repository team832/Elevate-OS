/**
 * Feedback imports and the conflict-of-interest rule M2 (review round 5): the staff a row may be
 * about only ever grows (preview, remap, commit), and nobody an import may be about remaps,
 * commits or discards it, the importer included. Fictional people only.
 */
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase } from '@elevate/testing';
import {
  opsStaffProfiles,
  opsTeacherFeedbackImportRows as importRows,
  staffMembers,
} from '@elevate/database';
import { deleteAttachment, listAttachments, uploadAttachment } from '../../src/server/attachments';
import { ABOUT_YOU } from '../../src/server/feedback-access';
import { importDetail } from '../../src/server/feedback-import';
import type { StaffUser } from './fixtures';
import { feedbackFixtures } from './feedback-fixtures';

const ctx = setupTestDatabase();
const { f, upload, remap, act } = feedbackFixtures(ctx);
const HEAD = 'Teacher,Batch,Period start,Period end,Rating,Comment';
const MAPPING = {
  Teacher: 'teacher',
  Batch: 'batch',
  'Period start': 'period_start',
  'Period end': 'period_end',
  Rating: 'rating',
  Comment: 'comment',
};
let n = 0;
/** A new file with one row about `teacher` (staff code or name). */
async function importAbout(teacher: string, by: StaffUser = f.u.hr_manager) {
  const answer = `Sample round five answer ${++n}.`;
  const csv = `${HEAD}\n${teacher},SAMPLE-B1,2026-03-01,2026-03-28,3,${answer}`;
  const res = await upload(csv, `round5-${n}.csv`, by);
  expect(res.status).toBe(201);
  return { id: res.data!.id, answer };
}
/** Whether `who` reads the row's text and the source file (file count, or the refusal status). */
async function sees(who: StaffUser, { id, answer }: { id: string; answer: string }) {
  const rows = JSON.stringify((await importDetail(ctx.db, who, id)).rows);
  const files = await listAttachments(ctx.db, who, 'feedback_import', id).then(
    (l) => l.length,
    (e: { status: number }) => e.status,
  );
  return { text: rows.includes(answer), hidden: rows.includes(ABOUT_YOU), files };
}
const HIDDEN = { text: false, hidden: true, files: 404 };
const SHOWN = { text: true, hidden: false, files: 1 };
const setCode = (who: StaffUser, staffCode: string) =>
  ctx.db
    .insert(opsStaffProfiles)
    .values({ staffId: who.staffId, staffCode })
    .onConflictDoUpdate({ target: opsStaffProfiles.staffId, set: { staffCode } });

describe('who may handle an import (M2)', () => {
  const ACTIONS = {
    'remap (preview again)': (id: string, who: StaffUser) => remap(id, MAPPING, who),
    commit: (id: string, who: StaffUser) => act(id, 'commit', {}, who),
    discard: (id: string, who: StaffUser) => act(id, 'discard', {}, who),
  };
  const WHO = {
    'the HR person it is about': {
      about: 'DEMO-T02',
      by: () => f.u.hr_manager,
      actor: () => f.hrSubject,
    },
    'an HR person it may be about': {
      about: 'Sample Twin',
      by: () => f.u.hr_manager,
      actor: () => f.hrTwin,
    },
    'another HR person': { about: 'DEMO-T02', by: () => f.hrTwin, actor: () => f.u.hr_manager },
  };
  const CASES = Object.keys(ACTIONS).flatMap((a) =>
    Object.keys(WHO).map((w) => [a as keyof typeof ACTIONS, w as keyof typeof WHO] as const),
  );

  it.each(CASES)('%s by %s', async (action, who) => {
    const w = WHO[who];
    const imp = await importAbout(w.about, w.by());
    const res = await ACTIONS[action](imp.id, w.actor());
    if (who === 'another HR person') {
      expect(res.status).toBe(200);
      return;
    }
    expect(res.status).toBe(403);
    expect(res.error?.message).toBe('Another HR person must handle this import.');
    expect((await importDetail(ctx.db, f.u.hr_manager, imp.id)).status).toBe('preview');
  });
});

describe('the staff a row may be about only grows', () => {
  it('P3: remapping the Teacher column away does not un-hide the row or the source file', async () => {
    const imp = await importAbout('DEMO-T02');
    expect((await remap(imp.id, { ...MAPPING, Teacher: '' })).status).toBe(400);
    const away = { ...MAPPING, Teacher: 'comment', Comment: 'teacher' };
    expect((await remap(imp.id, away, f.hrSubject)).status).toBe(403);
    expect((await remap(imp.id, away)).status).toBe(200);
    expect(await sees(f.hrSubject, imp)).toEqual(HIDDEN);
    expect(await sees(f.u.hr_manager, imp)).toEqual(SHOWN);
  });

  it.each([
    ['their full name', 'Sample HR Subject explained it well', true],
    ['their staff code', 'Ask DEMO-T02 instead', true],
    ['a longer word', 'Sample HR Subjects were fine', false],
    ['a longer code', 'Ask DEMO-T021 instead', false],
  ])(
    'L1/L2: a row naming the reader in any cell (%s) is about them',
    async (_, comment, hidden) => {
      const csv = `${HEAD}
DEMO-T01,SAMPLE-B1,2026-03-01,2026-03-28,3,${comment} ${++n}.`;
      const res = await upload(csv, `mention-${n}.csv`);
      expect((await sees(f.hrSubject, { id: res.data!.id, answer: comment })).hidden).toBe(hidden);
    },
  );

  it('P4: renaming one of two people who share a name, then remapping, keeps the row hidden', async () => {
    const imp = await importAbout('Sample Twin');
    await ctx.db
      .update(staffMembers)
      .set({ fullName: 'Sample Twin Renamed' })
      .where(eq(staffMembers.id, f.hrTwin.staffId));
    try {
      expect((await remap(imp.id, MAPPING)).status).toBe(200);
      expect(await sees(f.hrTwin, imp)).toEqual(HIDDEN);
      expect((await act(imp.id, 'commit')).data?.status).toBe('committed');
      expect(await sees(f.hrTwin, imp)).toEqual(HIDDEN);
    } finally {
      await ctx.db
        .update(staffMembers)
        .set({ fullName: 'Sample Twin' })
        .where(eq(staffMembers.id, f.hrTwin.staffId));
    }
  });

  it('P6: a staff code moved between preview and commit keeps the row hidden from both people', async () => {
    const imp = await importAbout('DEMO-T02');
    await setCode(f.hrSubject, 'DEMO-T92');
    await setCode(f.hrTwin, 'DEMO-T02');
    try {
      expect((await act(imp.id, 'commit', {}, f.hrTwin)).status).toBe(403);
      expect((await act(imp.id, 'commit')).data?.status).toBe('committed');
      expect(await sees(f.hrSubject, imp)).toEqual(HIDDEN);
      expect(await sees(f.hrTwin, imp)).toEqual(HIDDEN);
      expect(await sees(f.u.hr_manager, imp)).toEqual(SHOWN);
    } finally {
      await setCode(f.hrTwin, 'DEMO-T93');
      await setCode(f.hrSubject, 'DEMO-T02');
    }
  });

  it('access is checked afresh on every call (no cached answer)', async () => {
    const imp = await importAbout('DEMO-T01');
    expect(await sees(f.hrSubject, imp)).toEqual(SHOWN);
    await ctx.db
      .update(importRows)
      .set({
        raw: {
          Teacher: 'DEMO-T01',
          Comment: imp.answer,
          $about: [f.u.teacher.staffId, f.hrSubject.staffId],
        },
      })
      .where(eq(importRows.importId, imp.id as never));
    expect(await sees(f.hrSubject, imp)).toEqual(HIDDEN);
  });
});

describe('round 6: nobody an import may be about adds or removes its files', () => {
  const addFile = (who: StaffUser, ownerId: string) =>
    uploadAttachment(ctx.db, who, {
      ownerKind: 'feedback_import',
      ownerId,
      purpose: 'evidence',
      name: 'sample-note.csv',
      mime: 'text/csv',
      dataBase64: Buffer.from(`Sample note ${ownerId}`).toString('base64'),
    });

  it('the subject cannot upload or delete; other HR still can', async () => {
    const imp = await importAbout('DEMO-T02');
    const [source] = await listAttachments(ctx.db, f.u.hr_manager, 'feedback_import', imp.id);
    await expect(addFile(f.hrSubject, imp.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteAttachment(ctx.db, f.hrSubject, source!.id)).rejects.toMatchObject({
      status: 404,
    });
    const added = await addFile(f.u.hr_manager, imp.id);
    expect((await deleteAttachment(ctx.db, f.u.hr_manager, added.id)).id).toBe(added.id);
  });

  it('previewing a file about yourself is refused outright', async () => {
    const csv = `${HEAD}
DEMO-T01,SAMPLE-B1,2026-04-01,2026-04-28,3,Sample HR Subject was there.`;
    const res = await upload(csv, 'round7.csv', f.hrSubject);
    expect([res.status, res.error?.message]).toEqual([
      403,
      'Another HR person must handle this import.',
    ]);
    expect((await upload(csv, 'round7.csv')).status).toBe(201);
  });
});
