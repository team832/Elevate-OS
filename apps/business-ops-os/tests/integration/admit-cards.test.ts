/**
 * Admit cards in Business Ops (F4-03): Academic simulated at its `academic.admit_cards` v1
 * boundary; roll numbers asked of Academic as the acting person; the PDF (two per A4) for the
 * test or one batch, refused before roll numbers; setting `tests.admit_card_block_defaulters`
 * off = every student, on = students with overdue tuition left out and named. Fictional people.
 */
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { opsAdmissions, opsFeeInstalments, opsSettings } from '@elevate/database';
import { academicAdmitCardsV1Schema, type AcademicAdmitCardsV1 } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  GET as pdfRoute,
  POST as writeRoute,
} from '../../src/app/api/v1/assessments/[id]/admit-cards/route';
import { admitCardPlan } from '../../src/server/admit-cards';
import { post } from './admissions-fixtures';
import { activePlan } from './application-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const TEST = '0b0e8a43-1c55-4c42-9a1d-0000000000a1';
const BATCH_A = '0b0e8a43-1c55-4c42-9a1d-0000000000b1';
const BATCH_B = '0b0e8a43-1c55-4c42-9a1d-0000000000b2';
let manager: StaffUser;
let coordinator: TestUser;
let defaulter: string;
let paid: string;
let state: {
  data: AcademicAdmitCardsV1;
  calls: { body: unknown; acting: string | null }[];
  down: boolean;
};

const row = (n: number, coreStudentId: string | null, batchId = BATCH_A) => ({
  rosterId: `0b0e8a43-1c55-4c42-9a1d-0000000001${n}0`,
  coreStudentId,
  admissionNumber: `SAMPLE-ADM-${n}`,
  displayName: `Sample Student ${n}`,
  batchId,
  batchCode: batchId === BATCH_A ? 'SAMPLE-A' : 'SAMPLE-B',
  rollNumber: null as number | null,
});
const record = (): AcademicAdmitCardsV1 =>
  academicAdmitCardsV1Schema.parse({
    contract: 'academic.admit_cards',
    version: 1,
    generatedAt: '2026-11-06T05:00:00.000Z',
    assessment: {
      id: TEST,
      code: 'SAMPLE-MOCK-1',
      title: 'Sample CLAT mock 1',
      status: 'scheduled',
      courseName: 'Sample CLAT',
      scheduledDate: '2026-11-20',
      startTime: '10:00',
      durationMinutes: 120,
      rosterSnapshotAt: '2026-11-06T05:00:00.000Z',
      venue: { online: true, roomId: null, roomName: null },
      instructions: null,
      isSample: true,
    },
    rooms: [],
    rows: [row(1, defaulter), row(2, paid), row(3, null, BATCH_B)],
  });

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  coordinator = await createTestUser(ctx.db, { roles: ['academic_coordinator'] });
  const director = await createTestUser(ctx.db, { roles: ['director'] });
  const finance = await staffUser(ctx.db, ['finance_officer']);
  [defaulter, paid] = await Promise.all([
    identity(ctx.db, 'Sample Overdue Student'),
    identity(ctx.db, 'Sample Paid Student'),
  ]);
  const admission = await caseOf(ctx.db, manager.id, defaulter, 'enrolled');
  await ctx.db
    .update(opsAdmissions)
    .set({ admissionNumber: 'EE-T-0009' })
    .where(eq(opsAdmissions.id, admission.id as never));
  const plan = await activePlan(ctx.db, director, admission.id, defaulter, finance.id);
  await ctx.db
    .update(opsFeeInstalments)
    .set({ dueDate: '2026-10-01' })
    .where(eq(opsFeeInstalments.planId, plan.id as never));
}, 120_000);

beforeEach(() => {
  state = { data: record(), calls: [], down: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (state.down || !String(input).endsWith(`/assessments/${TEST}/admit-cards`))
        throw new TypeError('fetch failed');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        state.calls.push({ body, acting: new Headers(init.headers).get('x-elevate-acting-user') });
        if (body.action === 'roll_numbers')
          state.data.rows.forEach((r, i) => (r.rollNumber = i + 1));
      }
      return Response.json({ data: state.data });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const download = (who: { token: string } | null, query = '') =>
  pdfRoute(
    who
      ? authedRequest(who, `/ops/api/v1/assessments/${TEST}/admit-cards${query}`)
      : buildRequest('/x'),
    { params: Promise.resolve({ id: TEST }) },
  );
const sheets = async (res: Response) =>
  (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount();
const number = () => callRoute(writeRoute, post(manager, { action: 'roll_numbers' }), { id: TEST });

describe('admit cards from Ops', () => {
  it.each([
    ['nobody signed in', () => null, 401],
    ['the coordinator (tests read only)', () => coordinator, 403],
  ])('the PDF refuses %s', async (_n, who, status) => {
    expect((await download(who())).status).toBe(status);
  });

  it('refuses the PDF before roll numbers, then numbers them in Academic as the manager', async () => {
    const before = await download(manager);
    expect(before.status).toBe(409);
    expect((await before.json()).error.message).toMatch(/roll numbers first/);
    expect((await number()).status).toBe(200);
    expect(state.calls).toEqual([{ body: { action: 'roll_numbers' }, acting: manager.id }]);
  });

  it.each([
    ['', 2],
    [`?batchId=${BATCH_A}`, 1],
    [`?batchId=${BATCH_B}`, 1],
  ])('setting off: every student gets a card (%s → %i A4 sheets)', async (query, pages) => {
    state.data.rows.forEach((r, i) => (r.rollNumber = i + 1));
    const res = await download(manager, query);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await sheets(res)).toBe(pages);
  });

  it('setting on: the student with overdue tuition gets no card and is named', async () => {
    state.data.rows.forEach((r, i) => (r.rollNumber = i + 1));
    expect((await admitCardPlan(ctx.db, manager, state.data)).leftOut).toEqual([]);
    await ctx.db.insert(opsSettings).values({
      key: 'tests.admit_card_block_defaulters',
      value: { leaveOut: true },
      decisionState: 'approved',
      source: 'test-only',
    });
    const plan = await admitCardPlan(ctx.db, manager, state.data);
    // The number Ops holds now, not the roster's old copy (SAMPLE-ADM-1); none held = the copy.
    expect(plan.leftOut.map((r) => [r.displayName, r.admissionNumber])).toEqual([
      ['Sample Student 1', 'EE-T-0009'],
    ]);
    expect(plan.cards.map((r) => r.admissionNumber)).toEqual(['SAMPLE-ADM-2', 'SAMPLE-ADM-3']);
    expect(plan.cards.map((r) => r.displayName)).toEqual(['Sample Student 2', 'Sample Student 3']);
    expect(await sheets(await download(manager))).toBe(1);
    const onlyDefaulter = await download(manager, `?batchId=${BATCH_A}`);
    expect(onlyDefaulter.status).toBe(200); // Student 2 is in batch A too
    await ctx.db
      .delete(opsSettings)
      .where(eq(opsSettings.key, 'tests.admit_card_block_defaulters'));
  });

  it.each([
    ['a made-up venue', { action: 'venue', venue: 'hall' }],
    ['an unknown action', { action: 'reprint' }],
  ])('refuses %s before calling Academic', async (_n, body) => {
    expect((await callRoute(writeRoute, post(manager, body), { id: TEST })).status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it('refuses a cancelled test', async () => {
    state.data.rows.forEach((r, i) => (r.rollNumber = i + 1));
    state.data.assessment.status = 'cancelled';
    const res = await download(manager);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/cancelled/);
  });

  it('says plainly when Academic cannot be reached', async () => {
    state.down = true;
    const res = await download(manager);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/Academic OS could not be read/);
  });
});
