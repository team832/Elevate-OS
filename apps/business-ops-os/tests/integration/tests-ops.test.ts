/**
 * Tests and Mock Tests in Business Ops (owner brief 23 Oct 2026 §17–§21, owner answers 1, 2, 6):
 * permissions, views and counts, create + roster snapshot, papers and keys (type, size, versions,
 * release), score imports (CSV happy path, ambiguous rows, repeats, verified overwrites, AI rows,
 * AI not set up, Excel), publishing, and Academic's ranks passing through. Academic OS and the AI provider
 * are simulated at their contract boundaries (tests-ops-fixtures.ts). Fictional people only.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEvents, opsAdmissions, opsLeads, students } from '@elevate/database';
import { authedRequest, setupTestDatabase } from '@elevate/testing';
import * as listRoute from '../../src/app/api/v1/assessments/route';
import * as detailRoute from '../../src/app/api/v1/assessments/[id]/route';
import * as uploadRoute from '../../src/app/api/v1/attachments/route';
import * as releaseRoute from '../../src/app/api/v1/assessments/[id]/files/[fileId]/release/route';
import * as publishRoute from '../../src/app/api/v1/assessments/[id]/publications/route';
import * as correctionsRoute from '../../src/app/api/v1/assessments/[id]/roster/corrections/route';
import * as importsRoute from '../../src/app/api/v1/assessments/[id]/score-imports/route';
import * as actionRoute from '../../src/app/api/v1/score-imports/[id]/[action]/route';
import * as downloadRoute from '../../src/app/api/v1/attachments/[id]/route';
import { call } from './feedback-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import {
  aiAnswer,
  BATCH_A,
  csvFile,
  fakeAcademic,
  pdfFile,
  student,
  TEST_ID,
  testDetail,
} from './tests-ops-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let coordinator: StaffUser;
let teacher: StaffUser;
let fake: ReturnType<typeof fakeAcademic>;

beforeAll(async () => {
  vi.stubEnv('ATTACHMENTS_DIR', mkdtempSync(path.join(tmpdir(), 'tests-ops-')));
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  coordinator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher' });
});
beforeEach(() => {
  fake = fakeAcademic();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('ATTACHMENTS_DIR', mkdtempSync(path.join(tmpdir(), 'tests-ops-')));
});

const T = `/ops/api/v1/assessments/${TEST_ID}`;
const params = { id: TEST_ID };
type Started = { id: string; counts: Record<string, number> };
const startCsv = (text: string, extra: object = {}) =>
  call<Started>(
    importsRoute,
    'POST',
    manager,
    `${T}/score-imports`,
    {
      source: 'csv',
      ...csvFile(text),
      ...extra,
    },
    params,
  );
const act = (importId: string, action: 'confirm' | 'cancel', body: object = {}, who = manager) =>
  call<{ written: number; unchanged: number; overwritten: number }>(
    actionRoute,
    'POST',
    who,
    `/ops/api/v1/score-imports/${importId}/${action}`,
    body,
    { id: importId, action },
  );
const scoreCalls = () => fake.state.calls.filter((c) => c.path.endsWith('/scores'));

describe('permissions (server-side, per key)', () => {
  it.each([
    ['teacher lists tests', () => call(listRoute, 'GET', teacher, '/ops/api/v1/assessments')],
    [
      'coordinator creates a test',
      () => call(listRoute, 'POST', coordinator, '/ops/api/v1/assessments', {}),
    ],
    [
      'coordinator uploads a paper',
      () =>
        call(uploadRoute, 'POST', coordinator, '/ops/api/v1/attachments', {
          ownerKind: 'assessment_paper',
          ownerId: TEST_ID,
          purpose: 'reference',
          ...pdfFile(),
        }),
    ],
    [
      'coordinator imports scores',
      () =>
        call(
          importsRoute,
          'POST',
          coordinator,
          `${T}/score-imports`,
          { source: 'csv', ...csvFile('a') },
          params,
        ),
    ],
    [
      'coordinator publishes',
      () => call(publishRoute, 'POST', coordinator, `${T}/publications`, {}, params),
    ],
    [
      'coordinator corrects the roster',
      () => call(correctionsRoute, 'POST', coordinator, `${T}/roster/corrections`, {}, params),
    ],
    ['teacher confirms an import', () => act(TEST_ID, 'confirm', {}, teacher)],
  ])('403: %s', async (_, run) => {
    expect((await run()).status).toBe(403);
    expect(scoreCalls()).toEqual([]);
  });

  it('a reader (coordinator) can read the list and the record', async () => {
    expect((await call(listRoute, 'GET', coordinator, '/ops/api/v1/assessments')).status).toBe(200);
    expect((await call(detailRoute, 'GET', coordinator, T, undefined, params)).status).toBe(200);
  });
});

describe('views and counts', () => {
  it('counts come from the stored records under the same filters; filters reach Academic', async () => {
    const r = await call<{
      list: { status: string; data: { viewCounts: Record<string, number>; items: unknown[] } };
      imports: unknown[];
      counts: { imports: number };
    }>(
      listRoute,
      'GET',
      manager,
      `/ops/api/v1/assessments?view=previous&batchId=${BATCH_A}&from=2026-09-01`,
    );
    expect(r.status).toBe(200);
    expect(r.data!.list.data.viewCounts).toEqual({
      upcoming: 1,
      in_progress: 0,
      previous: 2,
      awaiting_publication: 1,
    });
    expect(r.data!.counts.imports).toBe(r.data!.imports.length);
    const q = new URLSearchParams(fake.state.calls[0]!.path.split('?')[1]);
    expect(Object.fromEntries(q)).toMatchObject({
      view: 'previous',
      batchId: BATCH_A,
      from: '2026-09-01',
    });
  });
});

describe('create and roster snapshot', () => {
  it('creates with the ticked batches, then sends Ops admission numbers for the roster', async () => {
    const [core] = await ctx.db
      .insert(students)
      .values({ fullName: 'Sample Rostered Student', isSample: true })
      .returning();
    const [lead] = await ctx.db
      .insert(opsLeads)
      .values({
        code: 'LEAD-990001',
        studentEmail: 'sample-rostered@example.test',
        studentName: 'Sample Rostered Student',
        firstReceivedAt: new Date(),
        createdBy: manager.id,
      })
      .returning();
    await ctx.db.insert(opsAdmissions).values({
      code: 'ADM-990001',
      leadId: lead!.id,
      studentId: core!.id,
      admissionNumber: 'SAMPLE-ADM-77',
      enrolledBatchId: BATCH_A as never,
      createdBy: manager.id,
    });
    const r = await call<{ id: string; rosterTaken: boolean }>(
      listRoute,
      'POST',
      manager,
      '/ops/api/v1/assessments',
      {
        code: 'SAMPLE-MOCK-2',
        kind: 'full_mock',
        title: 'Sample mock 2',
        academicYear: '2026-27',
        batches: { [BATCH_A]: true, '0b0e8a43-1c55-4c42-9a1d-0000000000b2': false },
        scheduledDate: '2026-11-02',
        marksPerCorrect: '1',
        marksPerWrong: '-0.25',
        sections: 'QA, Quant, 10, 10\nVA, Verbal, 10',
      },
    );
    expect(r.status).toBe(201);
    expect(r.data!.rosterTaken).toBe(true);
    const [create, roster] = fake.state.calls;
    expect(create!.body).toMatchObject({
      batchIds: [BATCH_A],
      marksPerWrong: '-0.25',
      sections: [
        { code: 'QA', name: 'Quant', questionCount: 10, capMarks: '10' },
        { code: 'VA', name: 'Verbal', questionCount: 10 },
      ],
    });
    expect(roster!.path).toBe(`/${TEST_ID}/roster`);
    expect((roster!.body as { admissionNumbers: unknown[] }).admissionNumbers).toContainEqual({
      coreStudentId: core!.id,
      admissionNumber: 'SAMPLE-ADM-77',
    });
  });

  it.each([
    [{ batches: {} }, 'Choose at least one eligible batch.'],
    [{ batches: { [BATCH_A]: true }, sections: 'QA, Quant, ten' }, 'Line 1'],
  ])('400 before Academic is called: %o', async (over, message) => {
    const r = await call(listRoute, 'POST', manager, '/ops/api/v1/assessments', {
      code: 'SAMPLE-MOCK-3',
      kind: 'chapter_test',
      title: 'x',
      academicYear: '2026-27',
      ...over,
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.error)).toContain(message);
    expect(fake.state.calls).toEqual([]);
  });

  it('a roster correction needs a reason (the contract body)', async () => {
    const body = { action: 'remove', studentId: student(1).studentId };
    expect(
      (await call(correctionsRoute, 'POST', manager, `${T}/roster/corrections`, body, params))
        .status,
    ).toBe(400);
    const ok = await call(
      correctionsRoute,
      'POST',
      manager,
      `${T}/roster/corrections`,
      { ...body, reason: 'Left the batch' },
      params,
    );
    expect(ok.status).toBe(200);
  });
});

describe('question papers and answer keys', () => {
  const upload = (kind: string, file: object) =>
    call<{ id: string; duplicate: boolean }>(
      uploadRoute,
      'POST',
      manager,
      '/ops/api/v1/attachments',
      {
        ownerKind: kind,
        ownerId: TEST_ID,
        purpose: 'reference',
        ...file,
      },
    );
  const download = async (who: StaffUser, id: string) => ({
    status: (
      await downloadRoute.GET(authedRequest(who, `/ops/api/v1/attachments/${id}`), {
        params: Promise.resolve({ id }),
      })
    ).status,
  });

  it.each([
    [
      'a PNG',
      {
        name: 'paper.png',
        mime: 'image/png',
        dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
          'base64',
        ),
      },
      'PDF',
    ],
    [
      'a renamed program',
      {
        name: 'paper.pdf',
        mime: 'application/pdf',
        dataBase64: Buffer.from('MZ not a pdf').toString('base64'),
      },
      'not a real .pdf',
    ],
    [
      'over 8 MB',
      {
        name: 'paper.pdf',
        mime: 'application/pdf',
        dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1, 0x25).toString('base64'),
      },
      '8 MB',
    ],
  ])('refuses %s', async (_, file, message) => {
    const r = await upload('assessment_paper', file);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.error)).toContain(message);
  });

  it('keeps versions; an unreleased key opens only for managers until released', async () => {
    const v1 = await upload('assessment_key', pdfFile('key.pdf', 'v1'));
    const v2 = await upload('assessment_key', pdfFile('key.pdf', 'v2'));
    expect([v1.status, v2.status]).toEqual([201, 201]);
    const { opsAttachments } = await import('@elevate/database');
    const rows = await ctx.db
      .select()
      .from(opsAttachments)
      .where(eq(opsAttachments.ownerId, TEST_ID));
    const second = rows.find((r) => r.id === v2.data!.id)!;
    expect(second).toMatchObject({
      version: 2,
      supersedesAttachmentId: v1.data!.id,
      releasedAt: null,
    });

    expect((await download(coordinator, v2.data!.id)).status).toBe(404);
    expect((await download(manager, v2.data!.id)).status).toBe(200);
    const listed = await call<{ files: { key: { id: string }[] } }>(
      detailRoute,
      'GET',
      coordinator,
      T,
      undefined,
      params,
    );
    expect(listed.data!.files.key).toEqual([]);

    const release = (fileId: string) =>
      call(
        releaseRoute,
        'POST',
        manager,
        `${T}/files/${fileId}/release`,
        {},
        { id: TEST_ID, fileId },
      );
    fake.state.detail = testDetail({ scheduledDate: '2099-01-01' as never });
    expect((await release(v2.data!.id)).status).toBe(409); // before the test date (setting test_day)
    fake.state.detail = testDetail();
    expect((await release(v2.data!.id)).status).toBe(200);
    expect((await download(coordinator, v2.data!.id)).status).toBe(200);
    expect((await download(coordinator, v1.data!.id)).status).toBe(404); // v1 never released
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'attachment.released'), eq(auditEvents.entityId, v2.data!.id)),
      );
    expect(audit).toHaveLength(1);
  });
});

describe('score import (CSV)', () => {
  const HEAD = 'Admission number,Name,Attendance,QA';

  it('happy path: staged, reviewed, one Academic call, audited; repeating the file is refused', async () => {
    const text = `${HEAD}\nSAMPLE-ADM-1,Sample Student 1,present,7.75\nSAMPLE-ADM-2,Sample Student 2,absent,\nSAMPLE-ADM-3,Sample Student 3,present,-0.5\n`;
    const s = await startCsv(text);
    expect(s.status).toBe(201);
    expect(s.data!.counts).toMatchObject({ matched: 3, withErrors: 0 });
    const c = await act(s.data!.id, 'confirm');
    expect(c.status).toBe(200);
    expect(c.data!.written).toBe(3);
    expect(scoreCalls()).toHaveLength(1);
    expect(scoreCalls()[0]!.body).toMatchObject({
      source: 'csv',
      importRef: s.data!.id,
      overwriteVerified: false,
      rows: [
        {
          studentId: student(1).studentId,
          version: 1,
          attendance: 'present',
          marksState: 'verified',
          score: '7.75',
        },
        {
          studentId: student(2).studentId,
          version: 1,
          attendance: 'absent',
          marksState: 'not_entered',
          score: null,
        },
        {
          studentId: student(3).studentId,
          version: 1,
          attendance: 'present',
          marksState: 'verified',
          score: '-0.5',
        },
      ],
    });
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'score_import.confirmed'), eq(auditEvents.entityId, s.data!.id)),
      );
    expect(audit).toHaveLength(1);

    const again = await startCsv(text);
    expect(again.status).toBe(409);
    expect(again.error!.message).toContain('already imported');

    // The same marks in another file (columns reordered): nothing changes, nothing is sent.
    const same = await startCsv(
      'Name,Admission number,Attendance,QA\nSample Student 1,SAMPLE-ADM-1,present,7.75\nSample Student 2,SAMPLE-ADM-2,absent,\nSample Student 3,SAMPLE-ADM-3,present,-0.5\n',
    );
    expect(same.data!.counts).toMatchObject({ no_change: 2 });
    const sameConfirm = await act(same.data!.id, 'confirm');
    expect(sameConfirm.data).toMatchObject({ written: 0, unchanged: 3 });
    expect(scoreCalls()).toHaveLength(1);
  });

  it('a mark below the negative-marking floor (10 × −0.25) is an error; a scored row is not made present on its own', async () => {
    const s = await startCsv('Admission number,QA\nSAMPLE-ADM-1,-3\nSAMPLE-ADM-2,4\n');
    expect(s.data!.counts).toMatchObject({ withErrors: 1 });
    const blocked = await act(s.data!.id, 'confirm');
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.error)).toContain('outside -2.5 to 10');
    const ok = await act(s.data!.id, 'confirm', { resolutions: { 'row-1': 'skip' } });
    expect(ok.status).toBe(200);
    expect(scoreCalls().at(-1)!.body).toMatchObject({
      rows: [{ studentId: student(2).studentId, marksState: 'imported', score: '4' }],
    });
    expect((scoreCalls().at(-1)!.body as { rows: object[] }).rows[0]).not.toHaveProperty(
      'attendance',
    );
  });

  it('“Mark scored students present” records them present and verified', async () => {
    const s = await startCsv('Admission number,QA\nSAMPLE-ADM-4,6\n');
    await act(s.data!.id, 'confirm', { markScoredPresent: true });
    expect(scoreCalls().at(-1)!.body).toMatchObject({
      rows: [
        {
          studentId: student(4).studentId,
          attendance: 'present',
          marksState: 'verified',
          score: '6',
        },
      ],
    });
  });

  it('ambiguous rows block the confirmation until a person chooses', async () => {
    fake.state.detail = testDetail({}, [
      student(1, { displayName: 'Sample Twin' }),
      student(2, { displayName: 'Sample Twin' }),
    ]);
    const s = await startCsv('Name,QA\nSample Twin,5\n');
    expect(s.data!.counts).toMatchObject({ ambiguous: 1 });
    const blocked = await act(s.data!.id, 'confirm');
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.error)).toContain('more than one student fits');
    expect(scoreCalls()).toEqual([]);
    const chosen = await act(s.data!.id, 'confirm', {
      resolutions: { 'row-1': student(2).studentId },
    });
    expect(chosen.status).toBe(200);
    expect(scoreCalls()[0]!.body).toMatchObject({ rows: [{ studentId: student(2).studentId }] });
  });

  it('changing a verified mark needs the per-row overwrite confirmation and a reason', async () => {
    fake.state.detail = testDetail({}, [
      student(1, { attendance: 'present', marksState: 'verified', score: '7', version: 3 }),
    ]);
    const s = await startCsv('Admission number,QA\nSAMPLE-ADM-1,8\n');
    expect(s.data!.counts).toMatchObject({ overwrite: 1 });
    const noTick = await act(s.data!.id, 'confirm');
    expect(JSON.stringify(noTick.error)).toContain('confirm the overwrite');
    const noReason = await act(s.data!.id, 'confirm', { overwriteConfirmed: { 'row-1': true } });
    expect(noReason.status).toBe(400);
    expect(scoreCalls()).toEqual([]);
    const ok = await act(s.data!.id, 'confirm', {
      overwriteConfirmed: { 'row-1': true },
      reason: 'Re-marked paper',
    });
    expect(ok.data).toMatchObject({ written: 1, overwritten: 1 });
    expect(scoreCalls()[0]!.body).toMatchObject({
      overwriteVerified: true,
      reason: 'Re-marked paper',
      rows: [{ version: 3, score: '8' }],
    });
  });

  it.each([
    [
      'an Excel file',
      {
        source: 'csv',
        name: 'scores.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dataBase64: Buffer.from('PK\x03\x04').toString('base64'),
      },
      'Save the sheet as CSV (File → Save as → CSV)',
    ],
    [
      'a PDF without the AI confirmation',
      { source: 'pdf_ai', ...pdfFile('sheet.pdf') },
      'I confirm sending this score sheet to an AI service',
    ],
  ])('refuses %s', async (_, body, message) => {
    const r = await call(importsRoute, 'POST', manager, `${T}/score-imports`, body, params);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.error)).toContain(message);
  });

  it('a test without a roster snapshot cannot take scores', async () => {
    fake.state.detail = testDetail({ rosterSnapshotAt: null }, []);
    const r = await startCsv('Admission number,QA\nSAMPLE-ADM-1,5\n');
    expect(r.status).toBe(409);
  });
});

describe('score import (PDF read by AI, owner answer 6)', () => {
  const startPdf = (extra = '') =>
    call<Started>(
      importsRoute,
      'POST',
      manager,
      `${T}/score-imports`,
      {
        source: 'pdf_ai',
        confirmSend: true,
        ...pdfFile('sheet.pdf', extra),
      },
      params,
    );

  it('AI not set up: a plain message, no AI provider called, CSV still works', async () => {
    vi.stubEnv('GEMINI_MODEL', '');
    const r = await startPdf('not-set-up');
    expect(r.status).toBe(409);
    expect(r.error!.message).toContain('Save the sheet as CSV');
    expect(fake.ai.calls).toEqual([]);
  });

  it('sends only the sheet; AI rows need a per-row human check before saving', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-only-gemini-key-tests');
    vi.stubEnv('GEMINI_MODEL', 'test-model');
    vi.stubEnv('GEMINI_BASE_URL', 'https://ai.test/v1beta');
    fake.ai.reply = aiAnswer({
      rows: [
        {
          admissionNumber: 'SAMPLE-ADM-2',
          studentCode: null,
          name: 'Sample Student 2',
          total: null,
          attendance: 'present',
          sections: [{ code: 'QA', marks: '9' }],
        },
      ],
    });
    const s = await startPdf('ai');
    expect(s.status).toBe(201);
    const sent = JSON.stringify(fake.ai.calls[0]);
    expect(sent).toContain('"mime_type":"application/pdf"');
    expect(sent).toContain('"maxOutputTokens":16000');
    expect(sent).not.toMatch(/Sample Student|SAMPLE-ADM|@example\.test/); // no roster or contact data
    const blocked = await act(s.data!.id, 'confirm');
    expect(JSON.stringify(blocked.error)).toContain('read by AI');
    expect(scoreCalls()).toEqual([]);
    const ok = await act(s.data!.id, 'confirm', { aiConfirmed: { 'row-1': true } });
    expect(ok.status).toBe(200);
    expect(scoreCalls()[0]!.body).toMatchObject({
      source: 'pdf_ai',
      rows: [{ score: '9', marksState: 'verified' }],
    });
  });
});

describe('publication and ranks from Academic', () => {
  it('final publication is refused while marks are missing; provisional publishes v1', async () => {
    const final = await call(
      publishRoute,
      'POST',
      manager,
      `${T}/publications`,
      { provisional: false },
      params,
    );
    expect(final.status).toBe(409);
    expect(final.error!.message).toContain('Attendance not marked: 4.');
    expect(fake.state.calls.map((c) => c.path)).toEqual([
      `/${TEST_ID}`,
      `/${TEST_ID}/finalise`,
      `/${TEST_ID}/publications`,
    ]);
    fake.state.calls.length = 0;
    const prov = await call(
      publishRoute,
      'POST',
      manager,
      `${T}/publications`,
      { provisional: true, cohort: { [BATCH_A]: true } },
      params,
    );
    expect(prov.status).toBe(200);
    // The refused attempt already finalised result version 1; publishing reads and publishes.
    expect(fake.state.calls.map((c) => c.path)).toEqual([
      `/${TEST_ID}`,
      `/${TEST_ID}/publications`,
    ]);
    expect(fake.state.calls.at(-1)!.body).toEqual({
      version: 1,
      rankingScope: 'cohort',
      cohortBatchIds: [BATCH_A],
      provisional: true,
    });
  });

  it('competition ties and negative scores come through unchanged', async () => {
    fake.state.detail = testDetail({}, [
      student(1, { attendance: 'present', marksState: 'verified', score: '9', rank: 1 }),
      student(2, { attendance: 'present', marksState: 'verified', score: '7', rank: 2 }),
      student(3, { attendance: 'present', marksState: 'verified', score: '7', rank: 2 }),
      student(4, { attendance: 'present', marksState: 'verified', score: '-0.5', rank: 4 }),
    ]);
    const r = await call<{ test: { roster: { rank: number; score: string }[] } }>(
      detailRoute,
      'GET',
      manager,
      T,
      undefined,
      params,
    );
    expect(r.data!.test.roster.map((x) => [x.rank, x.score])).toEqual([
      [1, '9'],
      [2, '7'],
      [2, '7'],
      [4, '-0.5'],
    ]);
  });
});
