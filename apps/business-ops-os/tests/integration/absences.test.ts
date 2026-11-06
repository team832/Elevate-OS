/**
 * Absent students (F4-06): Academic's absences (simulated, AcademicAbsencesV1) joined to Ops
 * students in the caller's scope, follow-up calls logged and audited, and Academic down shown as
 * "unavailable", never as an empty list. Fictional data only.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditEvents, opsAbsenceCalls } from '@elevate/database';
import type { AcademicAbsencesV1 } from '@elevate/shared-contracts';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as download, POST as logCall } from '../../src/app/api/v1/students/absences/route';
import { absentStudents, type AbsencesQuery } from '../../src/server/absences';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db;
let manager: StaffUser;
let counsellor: StaffUser;
let other: StaffUser;
let director: TestUser;
let finance: StaffUser;
const sid: Record<'mine' | 'theirs' | 'noCase', string> = { mine: '', theirs: '', noCase: '' };
const WINDOW = { from: '2026-09-01', to: '2026-09-30' } as AbsencesQuery;
const API = '/ops/api/v1/students/absences';

const absence = (coreStudentId: string, date: string) => ({
  coreStudentId,
  batchId: crypto.randomUUID() as never,
  batchCode: 'B-SAMPLE',
  batchName: 'Sample batch',
  sessionId: crypto.randomUUID(),
  date: date as never,
  startTime: '09:00',
  subjectName: 'Quant',
});
let payload: AcademicAbsencesV1;

/** Academic simulated: the absences route answers `payload`, or nothing at all ('down'). */
function academic(state: 'up' | 'down') {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    if (state === 'down' || !String(input).includes('/internal/v1/absences?'))
      throw new TypeError('fetch failed');
    return Response.json({ data: payload });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await setupReference(db());
  manager = await staffUser(db(), ['operations_manager']);
  counsellor = await staffUser(db(), ['admissions_counsellor']);
  other = await staffUser(db(), ['admissions_counsellor']);
  finance = await staffUser(db(), ['finance_officer']);
  director = await createTestUser(db(), { roles: ['director'] });
  sid.mine = await identity(db(), 'Sample Absent Student');
  sid.theirs = await identity(db(), 'Sample Other Student');
  sid.noCase = await identity(db(), 'Sample Unlinked Student');
  await caseOf(db(), manager.id, sid.mine, 'enrolled', { counsellorStaffId: counsellor.staffId });
  await caseOf(db(), manager.id, sid.theirs, 'enrolled', { counsellorStaffId: other.staffId });
  payload = {
    contract: 'academic.absences',
    version: 1,
    generatedAt: new Date().toISOString() as never,
    ...(WINDOW as { from: never; to: never }),
    absences: [
      absence(sid.mine, '2026-09-07'),
      absence(sid.theirs, '2026-09-08'),
      absence(sid.mine, '2026-09-14'),
      absence(sid.noCase, '2026-09-15'),
      absence(crypto.randomUUID(), '2026-09-16'), // not an Ops student
    ],
  };
}, 120_000);

describe('who sees which absent students (F4-06)', () => {
  it.each<[string, () => TestUser, (() => string[]) | 403]>([
    ['the operations manager: everyone', () => manager, () => [sid.mine, sid.noCase, sid.theirs]],
    ['a counsellor: students of their own cases', () => counsellor, () => [sid.mine]],
    ['another counsellor: theirs', () => other, () => [sid.theirs]],
    ['the director: no contact access', () => director, 403],
    ['finance: no contact access', () => finance, 403],
  ])('%s', async (_, who, expected) => {
    const calls = academic('up');
    const run = absentStudents(db(), who(), WINDOW);
    if (expected === 403) return expect(run).rejects.toMatchObject({ status: 403 });
    const r = await run;
    expect(r.available).toBe(true);
    expect(r.rows.map((s) => s.id).sort()).toEqual(expected().sort());
    expect(String(calls.mock.calls[0]![0])).toContain('from=2026-09-01&to=2026-09-30');
  });

  it('a student’s absences are newest first and counted; the default window is the last 7 days', async () => {
    academic('up');
    const [row] = (await absentStudents(db(), counsellor, WINDOW)).rows;
    expect(row).toMatchObject({
      absences: [{ date: '2026-09-14' }, { date: '2026-09-07' }],
      lastCall: null,
    });
    const calls = academic('up');
    await absentStudents(db(), counsellor, {}, new Date('2026-10-10T06:00:00Z'));
    expect(String(calls.mock.calls[0]![0])).toContain('from=2026-10-04&to=2026-10-10');
  });

  it.each<[string, AbsencesQuery]>([
    ['from after to', { from: '2026-09-30', to: '2026-09-01' } as AbsencesQuery],
    ['more than 92 days', { from: '2026-06-01', to: '2026-09-30' } as AbsencesQuery],
  ])('refuses %s before asking Academic', async (_, window) => {
    const calls = academic('up');
    await expect(absentStudents(db(), manager, window)).rejects.toMatchObject({ status: 400 });
    expect(calls).not.toHaveBeenCalled();
  });
});

describe('Academic unreachable (F4-06)', () => {
  it('is a warning, not an empty list; the download refuses instead of sending an empty file', async () => {
    academic('down');
    expect(await absentStudents(db(), manager, WINDOW)).toMatchObject({
      available: false,
      rows: [],
    });
    const res = await callRoute(
      download,
      authedRequest(manager, `${API}?from=2026-09-01&to=2026-09-30`),
    );
    expect(res.status).toBe(409);
  });
});

describe('logging a call (F4-06)', () => {
  const log = (user: TestUser, json: Record<string, unknown>) =>
    callRoute<{ id: string }>(logCall, authedRequest(user, API, { json }));

  it('401 / 403 / 400 / 404 outside the counsellor’s students', async () => {
    expect((await callRoute(logCall, buildRequest(API, { json: {} }))).status).toBe(401);
    expect((await log(director, { studentId: sid.mine, outcome: 'reached' })).status).toBe(403);
    expect((await log(counsellor, { studentId: sid.mine, outcome: 'maybe' })).status).toBe(400);
    expect((await log(counsellor, { studentId: sid.theirs, outcome: 'reached' })).status).toBe(404);
  });

  it('is stored, audited and shown as the last call', async () => {
    const first = await log(counsellor, { studentId: sid.mine, outcome: 'no_answer' });
    expect(first.status).toBe(201);
    const second = await log(counsellor, {
      studentId: sid.mine,
      outcome: 'will_attend',
      note: 'Parent says back on Monday (fictional)',
    });
    const [audit] = await db()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, second.data!.id),
          eq(auditEvents.action, 'absence_call.logged'),
        ),
      );
    expect(audit).toMatchObject({
      module: 'ops',
      entityType: 'absence_call',
      actorUserId: counsellor.id,
    });
    expect(audit!.after).toMatchObject({ studentId: sid.mine, outcome: 'will_attend', note: true });
    expect(
      (
        await db()
          .select()
          .from(opsAbsenceCalls)
          .where(eq(opsAbsenceCalls.studentId, sid.mine as never))
      ).length,
    ).toBe(2);
    academic('up');
    const [row] = (await absentStudents(db(), counsellor, WINDOW)).rows;
    expect(row!.lastCall).toMatchObject({
      outcome: 'will_attend',
      calledBy: counsellor.displayName,
    });
    expect(row!.calls.map((c) => c.outcome)).toEqual(['will_attend', 'no_answer']);
  });

  it('the download is one row per absence in the caller’s scope, audited', async () => {
    academic('up');
    const res = await download(authedRequest(counsellor, `${API}?from=2026-09-01&to=2026-09-30`), {
      params: Promise.resolve({}),
    });
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines).toHaveLength(3); // header + two absences of their one student
    expect(lines[1]).toContain('Will attend');
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'absences.exported'));
    expect(rows.at(-1)!.metadata).toMatchObject({ rows: 2, from: '2026-09-01', to: '2026-09-30' });
  });
});
