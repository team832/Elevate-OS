/**
 * "Download (spreadsheet)" (owner, 6 Nov 2026): every list export and the staff attendance
 * register — the page's permission and scope, a header row, formula-safe cells, unmarked days
 * blank, an audit row without personal data, a dated filename.
 */
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  callRoute,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { GET as taskReportsRoute } from '../../src/app/api/v1/task-reports/route';
import { GET as exportRoute } from '../../src/app/api/v1/exports/[list]/route';
import { POST as punchRoute } from '../../src/app/api/v1/attendance/punches/route';
import { POST as decisionRoute } from '../../src/app/api/v1/attendance/decisions/route';
import { addDays, istToday, type IsoDate } from '../../src/domain/dates';
import { RegisterDownload } from '../../src/app/hr/attendance/_components/register-download';
import { ExportLink } from '../../src/ui/export-link';
import { at, attendanceWorld, post } from './attendance-fixture';
import { phone, staffUser } from './fixtures';

const ctx = setupTestDatabase();
let w: Awaited<ReturnType<typeof attendanceWorld>>;
const month = addDays(`${istToday(new Date()).slice(0, 7)}-01` as IsoDate, -1).slice(0, 7); // last month: whole
const [P, A, U] = ['03', '04', '05'].map((d) => `${month}-${d}`) as [string, string, string];
const leadPhone = phone();

const download = (u: TestUser | null, list: string, query = '') => {
  const url = `${u?.roles.includes('teacher') ? '/academic' : '/ops'}/api/v1/exports/${list}${query}`;
  return exportRoute(u ? authedRequest(u, url) : buildRequest(url), {
    params: Promise.resolve({ list }),
  });
};
const lines = async (res: Response) => (await res.text()).replace(/^\uFEFF/, '').split('\r\n');
const audits = async () =>
  (await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'export.downloaded'))).map(
    (a) => a.metadata as { list: string; filters: string[]; rows: number },
  );

beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
  const other = await staffUser(ctx.db, ['admissions_counsellor'], {
    name: 'Sample Counsellor Two',
  });
  const lead = (u: TestUser, studentName: string, studentPhone = phone()) =>
    callRoute(
      createLead,
      authedRequest(u, '/ops/api/v1/leads', {
        method: 'POST',
        json: { studentName, studentPhone, programmeCode: 'CLAT', sourceCode: 'WALK_IN' },
      }),
    );
  expect((await lead(w.office, '=HYPERLINK("http://x")', leadPhone)).status).toBe(201);
  expect((await lead(other, 'Sample Other Lead')).status).toBe(201);
  for (const [time, direction] of [
    ['09:00', 'in'],
    ['17:30', 'out'],
  ] as const)
    expect(
      (
        await post(punchRoute, w.hr, '/punches', {
          staffId: w.teacher.staffId,
          at: at(P, time),
          direction,
        })
      ).status,
    ).toBe(201);
  const decided = await post(decisionRoute, w.hr, '/decisions', {
    staffId: w.teacher.staffId,
    workDate: A,
    status: 'absent',
    note: 'Confirmed with the employee (fictional)',
  });
  expect(decided.status).toBe(200);
});

describe('list downloads', () => {
  it.each([
    ['students', 'opsMgr', 'hr', 'Admission no.,Student,Programmes'],
    ['leads', 'opsMgr', 'hr', 'Lead,Student,Interest'],
    ['collections', 'finance', 'hr', 'Student,Payment date,Entry'],
    ['outstanding', 'finance', 'hr', 'Student,Instalment,Fee agreement'],
    ['staff', 'hr', 'office', 'Name,Employee ID,Job title'],
    ['tasks', 'hr', 'outsider', 'Task,Owner,Priority'],
    ['attendance', 'hr', 'outsider', 'Staff member,Staff code,Department'],
  ] as const)(
    '%s: 401 signed out, 403 for %s without the page permission, CSV with a header row and a dated filename; audited',
    async (list, ok, refused, header) => {
      expect((await download(null, list)).status).toBe(401);
      expect((await download(w[refused], list)).status).toBe(403);
      const res = await download(w[ok], list);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toMatch(
        list === 'attendance'
          ? /filename="staff-attendance-\d{4}-\d{2}\.csv"/
          : new RegExp(`filename="${list}-\\d{4}-\\d{2}-\\d{2}\\.csv"`),
      );
      expect((await lines(res))[0]!.startsWith(header)).toBe(true);
      expect((await audits()).some((a) => a.list === list)).toBe(true);
    },
  );

  it('leads: own scope, a formula-looking name neutralised, no contact fields; the audit names filters, not their values', async () => {
    const text = (await lines(await download(w.office, 'leads'))).join('\n');
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).not.toContain('Sample Other Lead');
    expect(text).not.toContain(leadPhone.slice(-8));
    expect(await (await download(w.office, 'leads', '?q=Sample%20Other')).text()).not.toContain(
      'Sample Other Lead',
    );
    const last = (await audits()).at(-1)!;
    expect(last).toEqual({ list: 'leads', filters: ['q'], rows: 0 });
  });

  it('the existing CSV route (task reports) still answers with the shared CSV headers', async () => {
    const res = await taskReportsRoute(
      authedRequest(w.hr, `/ops/api/v1/task-reports?from=${P}&to=${U}&format=csv`),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\w.-]+\.csv"$/);
  });

  it('a bad filter is 400, not a silent full list', async () => {
    expect((await download(w.opsMgr, 'students', '?cohort=NOPE')).status).toBe(400);
    expect((await download(w.hr, 'tasks', '?status=nope')).status).toBe(400);
  });
});

describe('staff attendance register', () => {
  const cellsOf = async (u: TestUser, query: string) => {
    const [head, ...rest] = await lines(await download(u, 'attendance', query));
    const cols = head!.split(',');
    const rows = rest.filter((l) => l.startsWith('Sample ')).map((l) => l.split(','));
    return { cols, rows, day: (row: string[], d: string) => row[cols.indexOf(d)] };
  };

  it('a column per day from deriveDays: P present, A confirmed absent, unmarked stays blank (never "absent")', async () => {
    const { cols, rows, day } = await cellsOf(w.hr, `?month=${month}`);
    expect(cols).toContain(`${month}-01`);
    const teacher = rows.find((r) => r[0] === 'Sample Teacher One')!;
    expect(teacher[1]).toBe('DEMO-T91');
    expect([day(teacher, P), day(teacher, A), day(teacher, U)]).toEqual(['P', 'A', '']);
    expect(teacher[cols.indexOf('Absent (confirmed by HR)')]).toBe('1');
    expect(teacher[cols.indexOf('Present')]).toBe('1');
  });

  it('own scope: a teacher gets only their own row whatever the filters; mine=1 narrows HR to themselves', async () => {
    expect((await cellsOf(w.teacher, `?month=${month}&who=other`)).rows.map((r) => r[0])).toEqual([
      'Sample Teacher One',
    ]);
    expect((await cellsOf(w.hr, `?month=${month}&mine=1`)).rows.map((r) => r[0])).toEqual([
      'Sample HR manager',
    ]);
  });

  it.each(['2026-13', '2999-01', 'last'])('month=%s → 400', async (m) => {
    expect((await download(w.hr, 'attendance', `?month=${m}`)).status).toBe(400);
  });
});

describe('download buttons', () => {
  const html = async (node: ReactElement | null) =>
    new Response((await prerender(node)).prelude).text();

  it("link to the export with the page's own filters, under the host workspace", async () => {
    const link = await html(
      ExportLink({ list: 'students', params: { view: 'active', q: 'Sample', limit: undefined } }),
    );
    expect(link).toContain('href="/ops/api/v1/exports/students?view=active&amp;q=Sample"');
    expect(link).toContain('download=""');
    expect(link).toContain('Download (spreadsheet)');
    expect(
      await html(ExportLink({ list: 'tasks', base: '/academic', params: { open: '1' } })),
    ).toContain('href="/academic/api/v1/exports/tasks?open=1"');
  });

  it('HR attendance: a month of the staff the Days filters cover (not the status filter)', async () => {
    const form = await html(
      RegisterDownload({ params: { who: 'teachers', status: 'present' }, today: '2026-11-06' }),
    );
    expect(form).toContain('action="/ops/api/v1/exports/attendance"');
    expect(form).toContain('name="who" value="teachers"');
    expect(form).not.toContain('name="status"');
    expect(form.match(/<option value="\d{4}-\d{2}"/g)).toHaveLength(12);
    expect(form).toContain('<option value="2025-12"');
  });
});
