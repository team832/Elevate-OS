/** F4-08: the Ops calendar shows each viewer exactly what the source pages show them, and prints as a month. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import { can, type Permission } from '@elevate/authorization';
import {
  opsAppointments,
  opsHolidays,
  opsLeaveRecords,
  opsStaffTasks,
  type Database,
} from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import CalendarPage from '../../src/app/calendar/page';
import { opsCalendar } from '../../src/server/calendar';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { testDetail } from './tests-ops-fixtures';

const access = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../src/ui/frame', async (orig) => ({
  ...(await orig<object>()),
  gate: async (permission: Permission) => ({
    status: can(access.user as never, permission) ? 'allowed' : 'forbidden',
    user: access.user,
    modules: ['ops'],
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => '/',
}));

const ctx = setupTestDatabase();
const page = async (as: StaffUser, sp: Record<string, string> = { date: '2099-03-01' }) => {
  access.user = as;
  return new Response(
    (await prerender(await CalendarPage({ searchParams: Promise.resolve(sp) }))).prelude,
  ).text();
};
let a: StaffUser;
let b: StaffUser;
let manager: StaffUser;
let hr: StaffUser;
let teacher: StaffUser;

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  );
  const db = ctx.db as Database;
  await setupReference(db);
  a = await staffUser(db, ['admissions_counsellor'], { name: 'Sample Counsellor Asha' });
  b = await staffUser(db, ['admissions_counsellor'], { name: 'Sample Counsellor Bina' });
  manager = await staffUser(db, ['operations_manager'], { name: 'Sample Ops Manager' });
  hr = await staffUser(db, ['hr_manager'], { name: 'Sample HR Manager' });
  teacher = await staffUser(db, ['teacher'], { name: 'Sample Teacher' });
  for (const [who, day, n] of [
    [a, 2, 'Asha'],
    [b, 4, 'Bina'],
  ] as const) {
    const on = `2099-03-0${day}`;
    await db.insert(opsLeaveRecords).values({
      staffId: who.staffId,
      fromDate: on,
      toDate: on,
      kind: 'Casual',
      approvedBy: hr.id,
      isSample: true,
    });
    await db.insert(opsStaffTasks).values({
      staffId: who.staffId,
      title: `Call list ${n}`,
      dueOn: on,
      originalDueOn: on,
      createdBy: who.id,
      isSample: true,
    });
    await db.insert(opsAppointments).values({
      type: 'webinar',
      title: `Webinar ${n}`,
      staffId: who.staffId,
      organiserStaffId: who.staffId,
      startsAt: new Date(`${on}T04:30:00Z`),
      endsAt: new Date(`${on}T05:30:00Z`),
      mode: 'online',
      createdBy: who.id,
    });
  }
  await db.insert(opsHolidays).values({
    holidayOn: '2099-03-10',
    name: 'Sample centre holiday',
    decisionState: 'approved',
    createdBy: hr.id,
  });
});

describe('Ops calendar', () => {
  it('a counsellor sees their own meetings, tasks and leave, and the holidays; never another counsellor’s', async () => {
    const html = await page(a);
    for (const own of [
      'Webinar Asha',
      'Call list Asha',
      'Sample Counsellor Asha: Casual',
      'Sample centre holiday',
    ])
      expect(html).toContain(own);
    expect(html).not.toContain('Bina');
    expect(html).toContain('href="/ops/my-attendance?view=leave"');
    expect(html).not.toContain('Tests are not shown'); // no test permission: Academic is not asked
  });

  it('the operations manager sees everyone, links leave to HR attendance, and says when tests could not be read', async () => {
    const html = await page(manager);
    for (const item of [
      'Webinar Asha',
      'Webinar Bina',
      'Call list Bina',
      'Sample Counsellor Bina: Casual',
    ])
      expect(html).toContain(item);
    expect(html).toContain(`href="/ops/hr/attendance/${b.staffId}"`);
    expect(html).toContain('Tests are not shown');
    expect(html).toMatch(
      /<a class="el-cal-item" data-kind="meeting" href="\/ops\/meetings\?open=[0-9a-f-]{36}">/,
    );
  });

  it('HR sees the team’s leave in its reach, and no meetings (not an HR page)', async () => {
    const html = await page(hr);
    expect(html).toContain('Sample Counsellor Asha: Casual');
    expect(html).toContain('Sample Counsellor Bina: Casual');
    expect(html).not.toContain('Webinar');
  });

  it('a teacher (no Business Operations access) is refused', async () => {
    expect(await page(teacher)).toContain('No access');
  });

  it('prints: the print line, the Print button and the month grid; navigation is by query string', async () => {
    const html = await page(manager);
    expect(html).toContain('class="el-print-header"');
    expect(html).toContain('>Print</button>');
    expect(html).toContain('<h2 id="el-cal-title">March 2099</h2>');
    expect(html).toContain('href="/ops/calendar?date=2099-02-01&amp;view=month"');
    expect(await page(manager, { view: 'week', date: '2099-03-02' })).toContain(
      'Week of 2 Mar 2099',
    );
  });
});

describe('Ops calendar: tests from Academic are never dropped silently', () => {
  const base = testDetail().assessment;
  /** Academic's assessment list contract with `totals[view]` tests in March 2099, served page by page. */
  const serve = (totals: Record<string, number>) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const q = new URL(String(input)).searchParams;
        const [view, page, size] = [
          q.get('view')!,
          Number(q.get('page') ?? 1),
          Number(q.get('pageSize')),
        ];
        const total = totals[view] ?? 0;
        const items = Array.from(
          { length: Math.max(0, Math.min(size, total - (page - 1) * size)) },
          () => ({
            ...base,
            id: crypto.randomUUID(),
            scheduledDate: '2099-03-10',
            status: 'scheduled',
          }),
        );
        const counts = { upcoming: 0, in_progress: 0, previous: 0, awaiting_publication: 0 };
        return Response.json({
          data: {
            contract: 'academic.assessments',
            version: 1,
            generatedAt: '2026-10-01T05:00:00.000Z',
            view,
            total,
            page,
            pageSize: size,
            viewCounts: counts,
            filterOptions: { courses: [], batches: [] },
            items,
          },
        });
      }),
    );
  const march = { from: '2099-03-01', to: '2099-03-31' } as never;
  const tests = (r: Awaited<ReturnType<typeof opsCalendar>>) =>
    r.items.filter((i) => i.kind === 'test');

  it('reads every page of a month with more than 100 tests', async () => {
    serve({ upcoming: 230, previous: 120 });
    const r = await opsCalendar(ctx.db as Database, manager, march);
    expect(tests(r)).toHaveLength(350);
    expect(r.cut).toEqual([]);
  });

  it('stops at 1,000 per view and says “first 1,000 of 1,500”', async () => {
    serve({ upcoming: 1500 });
    const r = await opsCalendar(ctx.db as Database, manager, march);
    expect(tests(r)).toHaveLength(1000);
    expect(r.cut).toEqual([{ what: 'tests', shown: 1000, total: 1500 }]);
    expect(await page(manager)).toContain('Showing the first 1,000 of 1,500 tests in this month.');
  });
});
