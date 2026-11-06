/** Monthly attendance register download (owner, 6 Nov 2026): one batch, one month, as CSV. */
import { eq } from 'drizzle-orm';
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '@elevate/database';
import { authedRequest, buildRequest, createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as registerRoute } from '../../src/app/api/v1/attendance-register/route';
import { GET as reportRoute } from '../../src/app/api/v1/reports/[kind]/route';
import { RegisterDownload } from '../../src/app/attendance/register-download';
import { createSessions, createStudent, enrolManually } from '../../src/server';
import { attend, markHeld } from './a4-helpers';
import { actor, users, world, type Users, type World } from './fixtures';

const ctx = setupTestDatabase();
let u: Users;
let w: World;
let asha: { id: string; code: string };

const download = (user: TestUser | null, query: string) => {
  const url = `/academic/api/v1/attendance-register?${query}`;
  return registerRoute(user ? authedRequest(user, url) : buildRequest(url), { params: Promise.resolve({}) });
};

beforeAll(async () => {
  u = await users(ctx.db);
  w = await world(ctx.db, u);
  const coord = actor(u.coordinator);
  asha = await createStudent(ctx.db, coord, { fullName: 'Sample Asha (fictional)' });
  const formula = await createStudent(ctx.db, coord, { fullName: '=Sample Formula (fictional)' });
  await enrolManually(ctx.db, coord, { studentId: asha.id, batchId: w.batch.id, startDate: '2026-09-03', reason: 'Test (fictional)' });
  await enrolManually(ctx.db, coord, { studentId: formula.id, batchId: w.batch.id, startDate: '2026-09-01', reason: 'Test (fictional)' });
  const at = (date: string) => ({ batchId: w.batch.id, subjectId: w.quant.id, teacherStaffId: w.teacherStaff, sessionType: 'teaching' as const, date, startTime: '09:00', durationMinutes: 75 });
  const { sessions } = await createSessions(ctx.db, coord, ['2026-09-02', '2026-09-04', '2026-09-07', '2026-09-08', '2026-10-01'].map(at));
  const [s0, s1, , , oct]: string[] = sessions.map((s) => s.id);
  // 7 Sep is delivered with nobody marked (blank); 8 Sep stays scheduled, so it is not listed.
  await markHeld(ctx.db, [...sessions.slice(0, 3).map((s) => s.id), oct!]);
  await attend(ctx.db, actor(u.teacher), s1!, [{ studentId: asha.id, status: 'absent' }, { studentId: formula.id, status: 'present' }]);
  await attend(ctx.db, actor(u.teacher), s0!, [{ studentId: formula.id, status: 'late' }]);
});

describe('attendance register (CSV)', () => {
  it('rows = students, a column per delivered class, codes; not recorded stays blank; totals, legend; audited without names', async () => {
    const res = await download(u.teacher, `batchId=${w.batch.id}&month=2026-09`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain(`attendance-${w.batch.code}-2026-09.csv`);
    const lines = (await res.text()).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('Student,Student code,2026-09-02 09:00,2026-09-04 09:00,2026-09-07 09:00,Delivered classes,Present,Late,Partial,Absent,Excused,Not recorded,Attendance %,Sample data');
    // The formula-looking name is neutralised; Asha joined on 3 Sep, so 2 Sep is "not placed".
    expect(lines.find((l) => l.includes('Formula'))).toMatch(/^'=Sample Formula \(fictional\),[^,]+,L,P,,3,1,1,0,0,0,1,100,$/);
    expect(lines).toContain(`Sample Asha (fictional),${asha.code},NP,A,,2,0,0,0,1,0,1,0,`);
    expect(lines.some((l) => l.startsWith('"Legend: P present, L late'))).toBe(true);
    const [audit] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'attendance.register_exported'));
    expect(audit!.metadata).toEqual({ month: '2026-09', students: 2, classes: 3 });
    expect(JSON.stringify(audit)).not.toContain('Asha');
  });

  it.each([
    ['signed out', null, 'month=2026-09', 401],
    ['no attendance permission', 'counsellor', 'month=2026-09', 403],
    ['bad month', 'coordinator', 'month=2026-13', 400],
    ['future month', 'coordinator', 'month=2099-01', 400],
    ['coordinator', 'coordinator', 'month=2026-10', 200],
  ] as const)('%s → %i', async (_, who, query, status) => {
    expect((await download(who ? u[who] : null, `batchId=${w.batch.id}&${query}`)).status).toBe(status);
  });

  it("a teacher of another batch gets 404 for this batch's register", async () => {
    const other = await createTestUser(ctx.db, { roles: ['teacher'] });
    await world(ctx.db, u, { teacher: other, teacher2: await createTestUser(ctx.db, { roles: ['teacher'] }) });
    expect((await download(other, `batchId=${w.batch.id}&month=2026-09`)).status).toBe(404);
  });

  it('the register and the existing report CSV share one CSV response (server-kit csvResponse)', async () => {
    const report = await reportRoute(authedRequest(u.coordinator, `/academic/api/v1/reports/attendance?batchId=${w.batch.id}&from=2026-09-01&to=2026-09-30&format=csv`), { params: Promise.resolve({ kind: 'attendance' }) });
    for (const res of [report, await download(u.coordinator, `batchId=${w.batch.id}&month=2026-09`)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.-]+\.csv"$/);
    }
    expect(report.headers.get('content-disposition')).toContain(`attendance-${w.batch.id.slice(0, 8)}-`);
  });

  it('the attendance screen offers the download: the batches the teacher may see and the last 12 months', async () => {
    const html = await new Response((await prerender(await RegisterDownload({ user: u.teacher }))).prelude).text();
    expect(html).toContain('action="/academic/api/v1/attendance-register"');
    expect(html).toContain(`value="${w.batch.id}"`);
    expect(html.match(/<option value="\d{4}-\d{2}"/g)).toHaveLength(12);
    expect(html).toContain('Download attendance (spreadsheet)</button>');
    expect(await RegisterDownload({ user: u.counsellor })).toBeNull();
  });
});
