/**
 * Tests and Mock Tests, review round 1: per-section marking rules, raw cells never stored or
 * shown, roster admission numbers only for the selected batches, compare-and-set confirmation,
 * the file name sent to the AI provider, superseded papers, the import/test pairing, and the working
 * actions (edit and cancel a test, withdraw a publication, add a student). Fictional people only.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEvents, opsAdmissions, opsLeads, students } from '@elevate/database';
import { authedRequest, setupTestDatabase } from '@elevate/testing';
import * as detailRoute from '../../src/app/api/v1/assessments/[id]/route';
import * as uploadRoute from '../../src/app/api/v1/attachments/route';
import * as downloadRoute from '../../src/app/api/v1/attachments/[id]/route';
import * as releaseRoute from '../../src/app/api/v1/assessments/[id]/files/[fileId]/release/route';
import * as withdrawRoute from '../../src/app/api/v1/assessments/[id]/publications/[version]/withdraw/route';
import * as correctionsRoute from '../../src/app/api/v1/assessments/[id]/roster/corrections/route';
import * as rosterRoute from '../../src/app/api/v1/assessments/[id]/roster/route';
import * as importsRoute from '../../src/app/api/v1/assessments/[id]/score-imports/route';
import * as reviewRoute from '../../src/app/api/v1/score-imports/[id]/route';
import * as actionRoute from '../../src/app/api/v1/score-imports/[id]/[action]/route';
import { importReview } from '../../src/server/score-import';
import { call } from './feedback-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import {
  aiAnswer,
  BATCH_A,
  BATCH_B,
  csvFile,
  fakeAcademic,
  pdfFile,
  section,
  student,
  TEST_ID,
  testDetail,
} from './tests-ops-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let coordinator: StaffUser;
let director: StaffUser;
let fake: ReturnType<typeof fakeAcademic>;

beforeAll(async () => {
  vi.stubEnv('ATTACHMENTS_DIR', mkdtempSync(path.join(tmpdir(), 'tests-ops-r1-')));
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager'], { name: 'Sample Ops Manager' });
  coordinator = await staffUser(ctx.db, ['academic_coordinator'], { name: 'Sample Coordinator' });
  director = await staffUser(ctx.db, ['director'], { name: 'Sample Director' });
});
beforeEach(() => {
  fake = fakeAcademic();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('ATTACHMENTS_DIR', mkdtempSync(path.join(tmpdir(), 'tests-ops-r1-')));
});

const T = `/ops/api/v1/assessments/${TEST_ID}`;
const params = { id: TEST_ID };
type Started = { id: string };
const startCsv = (text: string) =>
  call<Started>(
    importsRoute,
    'POST',
    manager,
    `${T}/score-imports`,
    { source: 'csv', ...csvFile(text) },
    params,
  );
const review = (id: string, who = manager) =>
  call<{ rows: { rowNo: number; errors: unknown[] }[] }>(
    reviewRoute,
    'GET',
    who,
    `/ops/api/v1/score-imports/${id}`,
    undefined,
    { id },
  );

let n = 0;
/** An admitted Ops student with an Academic id, placed in `batchId`. */
async function admitted(batchId: string) {
  n += 1;
  const [core] = await ctx.db
    .insert(students)
    .values({ fullName: `Sample Admitted ${n}`, isSample: true })
    .returning();
  const [lead] = await ctx.db
    .insert(opsLeads)
    .values({
      code: `LEAD-98${String(n).padStart(4, '0')}`,
      studentName: `Sample Admitted ${n}`,
      studentEmail: `sample-r1-${n}@example.test`,
      firstReceivedAt: new Date(),
      createdBy: manager.id,
    })
    .returning();
  const academicStudentId = crypto.randomUUID();
  await ctx.db.insert(opsAdmissions).values({
    code: `ADM-98${String(n).padStart(4, '0')}`,
    leadId: lead!.id,
    studentId: core!.id,
    admissionNumber: `SAMPLE-R1-${n}`,
    academicStudentId: academicStudentId as never,
    enrolledBatchId: batchId as never,
    createdBy: manager.id,
  });
  return { coreStudentId: core!.id, academicStudentId, admissionNumber: `SAMPLE-R1-${n}` };
}

describe('I1: each section keeps its own marking rule', () => {
  it('an MCQ section at −1 per wrong accepts −3; a short-answer section at 0 per wrong refuses −5', async () => {
    fake.state.detail = testDetail({
      sections: [section('MCQ', 'MCQ', 10, '1', '-1'), section('SA', 'Short answers', 5, '2', '0')],
    });
    const s = await startCsv('Admission number,MCQ,SA\nSAMPLE-ADM-1,-3,4\nSAMPLE-ADM-2,5,-5\n');
    expect(s.status).toBe(201);
    const r = await review(s.data!.id);
    expect(r.data!.rows.map((x) => x.errors.length)).toEqual([0, 1]);
    expect(JSON.stringify(r.data!.rows[1]!.errors)).toContain(
      'Short answers -5 is outside 0 to 10',
    );
  });
});

describe('I2: raw cells are never stored or shown', () => {
  it('a parent_phone column and stray cells do not reach a reader', async () => {
    const s = await startCsv(
      'Admission number,parent_phone,QA\nSAMPLE-ADM-1,+919800000001,5,stray note 98290\n',
    );
    for (const who of [manager, director]) {
      const r = await review(s.data!.id, who);
      expect(r.status).toBe(200);
      const body = JSON.stringify(r.data);
      expect(body).not.toContain('9800000001');
      expect(body).not.toContain('stray note');
      expect(body).toContain('parent_phone'); // heading names only
    }
  });
});

describe('M1: admission numbers only for the selected batches', () => {
  it('sends the eligible batches’ students, nobody else', async () => {
    const inA = await admitted(BATCH_A);
    const elsewhere = await admitted(crypto.randomUUID());
    fake.state.detail = testDetail({ status: 'scheduled', rosterSnapshotAt: null }, []);
    const r = await call(rosterRoute, 'POST', manager, `${T}/roster`, {}, params);
    expect(r.status).toBe(200);
    const sent = (
      fake.state.calls.at(-1)!.body as { admissionNumbers: { admissionNumber: string }[] }
    ).admissionNumbers.map((a) => a.admissionNumber);
    expect(sent).toContain(inA.admissionNumber);
    expect(sent).not.toContain(elsewhere.admissionNumber);
  });
});

describe('M2: confirmation is compare-and-set', () => {
  it('two confirmations at once: one wins, the other gets 409, one audit row', async () => {
    fake.state.detail = testDetail({}, [
      student(1, { attendance: 'present', marksState: 'verified', score: '5' }),
    ]);
    const s = await startCsv('Admission number,Attendance,QA\nSAMPLE-ADM-1,present,5\n');
    const confirm = () =>
      call(
        actionRoute,
        'POST',
        manager,
        `/ops/api/v1/score-imports/${s.data!.id}/confirm`,
        {},
        { id: s.data!.id, action: 'confirm' },
      );
    const statuses = (await Promise.all([confirm(), confirm()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const audit = await ctx.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'score_import.confirmed'), eq(auditEvents.entityId, s.data!.id)),
      );
    expect(audit).toHaveLength(1);
  });
});

describe('M3: the AI provider gets a fixed file name', () => {
  it('never the uploaded name', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only-openrouter-key-r1');
    vi.stubEnv('OPENROUTER_MODEL', 'test-model');
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://ai.test/v1');
    fake.ai.reply = aiAnswer({ rows: [] }, 'chat');
    await call(
      importsRoute,
      'POST',
      manager,
      `${T}/score-imports`,
      { source: 'pdf_ai', confirmSend: true, ...pdfFile('Sample Student 9 marks.pdf', 'm3') },
      params,
    );
    const sent = JSON.stringify(fake.ai.calls[0]);
    expect(sent).toContain('"filename":"score-sheet.pdf"');
    expect(sent).not.toContain('Sample Student 9');
  });
});

describe('M4: superseded papers', () => {
  it('are hidden from readers once a new version exists', async () => {
    const up = (extra: string) =>
      call<{ id: string }>(uploadRoute, 'POST', manager, '/ops/api/v1/attachments', {
        ownerKind: 'assessment_key',
        ownerId: TEST_ID,
        purpose: 'reference',
        ...pdfFile('key.pdf', extra),
      });
    const v1 = (await up('m4-v1')).data!.id;
    await call(
      releaseRoute,
      'POST',
      manager,
      `${T}/files/${v1}/release`,
      {},
      { id: TEST_ID, fileId: v1 },
    );
    const before = await call<{ files: { key: { id: string }[] } }>(
      detailRoute,
      'GET',
      coordinator,
      T,
      undefined,
      params,
    );
    expect(before.data!.files.key.map((f) => f.id)).toContain(v1);
    await up('m4-v2');
    const after = await call<{ files: { key: { id: string }[] } }>(
      detailRoute,
      'GET',
      coordinator,
      T,
      undefined,
      params,
    );
    expect(after.data!.files.key).toEqual([]);
    const res = await downloadRoute.GET(
      authedRequest(coordinator, `/ops/api/v1/attachments/${v1}`),
      { params: Promise.resolve({ id: v1 }) },
    );
    expect(res.status).toBe(404);
    const managerView = await call<{ files: { key: { supersededByVersion: number | null }[] } }>(
      detailRoute,
      'GET',
      manager,
      T,
      undefined,
      params,
    );
    expect(managerView.data!.files.key.map((f) => f.supersededByVersion)).toEqual([null, 2]);
  });
});

describe('M6, M8', () => {
  it('two identical imports at once: one 201, the other 409', async () => {
    const text = 'Admission number,QA\nSAMPLE-ADM-3,2\n';
    const statuses = (await Promise.all([startCsv(text), startCsv(text)]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('an import opened under another test is not found', async () => {
    const s = await startCsv('Admission number,QA\nSAMPLE-ADM-4,3\n');
    await expect(
      importReview(ctx.db, manager, s.data!.id, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('working actions', () => {
  it('edit a test and cancel it with a reason (Academic PATCH); readers cannot', async () => {
    const edit = (who: StaffUser, json: object) => call(detailRoute, 'PATCH', who, T, json, params);
    expect((await edit(coordinator, { title: 'Sample renamed' })).status).toBe(403);
    expect((await edit(manager, { title: 'Sample renamed' })).status).toBe(200);
    expect(fake.state.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: `/${TEST_ID}`,
      body: { title: 'Sample renamed' },
    });
    expect((await edit(manager, { status: 'cancelled' })).status).toBe(400);
    expect((await edit(manager, { status: 'cancelled', reason: 'Centre closed' })).status).toBe(
      200,
    );
  });

  it('withdraw a publication with a reason', async () => {
    const w = (who: StaffUser, json: object) =>
      call(withdrawRoute, 'POST', who, `${T}/publications/1/withdraw`, json, {
        id: TEST_ID,
        version: '1',
      });
    expect((await w(coordinator, { reason: 'Wrong key used' })).status).toBe(403);
    expect((await w(manager, {})).status).toBe(400);
    expect((await w(manager, { reason: 'Wrong key used' })).status).toBe(200);
    expect(fake.state.calls.at(-1)).toMatchObject({
      path: `/${TEST_ID}/publications/1/withdraw`,
      body: { reason: 'Wrong key used' },
    });
  });

  it('add a student: the batch and admission number come only from Ops, never the client', async () => {
    const real = await admitted(BATCH_A);
    const elsewhere = await admitted(crypto.randomUUID());
    const add = (json: object) =>
      call(
        correctionsRoute,
        'POST',
        manager,
        `${T}/roster/corrections`,
        { action: 'add', reason: 'Joined late', ...json },
        params,
      );
    // A made-up student carrying a real student's admission number.
    const forged = await add({
      studentId: crypto.randomUUID(),
      batchId: BATCH_A,
      admissionNumber: real.admissionNumber,
    });
    expect(forged.status).toBe(400);
    for (const studentId of [crypto.randomUUID(), elsewhere.academicStudentId]) {
      const r = await add({ studentId });
      expect(r.status).toBe(400);
      expect(r.error!.message).toContain('This student is not placed in this test’s batches');
    }
    expect(fake.state.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('add a student: Ops fills the batch and admission number', async () => {
    const s = await admitted(BATCH_B);
    const r = await call(
      correctionsRoute,
      'POST',
      manager,
      `${T}/roster/corrections`,
      { action: 'add', studentId: s.academicStudentId, reason: 'Joined late' },
      params,
    );
    expect(r.status).toBe(200);
    expect(fake.state.calls.at(-1)!.body).toEqual({
      action: 'add',
      studentId: s.academicStudentId,
      batchId: BATCH_B,
      admissionNumber: s.admissionNumber,
      reason: 'Joined late',
    });
  });
});
