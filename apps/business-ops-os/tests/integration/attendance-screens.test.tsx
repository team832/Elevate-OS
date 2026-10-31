/**
 * Attendance screens render from real service data: HR tabs, the staff page parts and My
 * attendance (own days only, whatever the URL says).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import {
  notifications,
  opsAttendanceCorrections,
  opsAttendancePunches,
  opsHolidays,
  opsStaffProfiles,
  opsStaffSubjectCapabilities,
  opsWorkSchedules,
} from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { isNoScheduleDay } from '../../src/domain/attendance';
import { addDays, istInstant, istToday } from '../../src/domain/dates';
import { listAttendance } from '../../src/server/attendance';
import { decideCorrection, requestCorrection } from '../../src/server/attendance-corrections';
import { openNotification } from '../../src/server/notification-open';
import { listPunchImports, previewPunchImport } from '../../src/server/attendance-import';
import { attendanceSetup } from '../../src/server/attendance-lists';
import { DaysTab } from '../../src/app/hr/attendance/_components/days';
import { ImportTab } from '../../src/app/hr/attendance/_components/import';
import { CalendarTab, SchedulesTab } from '../../src/app/hr/attendance/_components/setup';
import { MyAttendanceBody } from '../../src/work';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const D = addDays(istToday(new Date()), -1);
let hr: StaffUser;
let teacher: StaffUser;
let other: StaffUser;

beforeAll(async () => {
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR manager' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Mira' });
  other = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Kabir' });
  await ctx.db.insert(opsStaffProfiles).values({ staffId: teacher.staffId, staffCode: 'DEMO-T81' });
  const day = { start: '09:00', end: '17:00' };
  await ctx.db.insert(opsWorkSchedules).values({
    name: 'Sample all week',
    weeklyPattern: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    isDefault: true,
    createdBy: hr.id,
  });
  await ctx.db.insert(opsAttendancePunches).values({
    staffId: teacher.staffId,
    punchedAt: istInstant(D, '09:40'),
    direction: 'in',
    source: 'manual',
    enteredBy: hr.id,
  });
  await requestCorrection(ctx.db, teacher, {
    workDate: D,
    requestedOut: istInstant(D, '17:05'),
    reason: 'Left without punching out',
  });
});

describe('HR attendance tabs', () => {
  it('days, review, schedules, holidays and import render real figures', async () => {
    const setup = await attendanceSetup(ctx.db, hr);
    const list = await listAttendance(ctx.db, hr, { from: D, to: D });
    const days = await html(
      <DaysTab list={list} setup={setup} params={{}} review={false} canManage />,
    );
    expect(days).toContain('Attendance by date');
    expect(days).toContain('Sample Teacher Mira (DEMO-T81)');
    expect(days).toContain('40 min late');
    expect(days).toContain('Missing check-out');
    expect(days).toContain('Enter a check-in or check-out');
    const review = await listAttendance(ctx.db, hr, { from: D, to: D, review: '1' });
    expect(review.items.map((r) => r.staff.name).sort()).toEqual([
      'Sample HR manager',
      'Sample Teacher Kabir',
      'Sample Teacher Mira',
    ]);
    expect(await html(<SchedulesTab setup={setup} canManage />)).toContain('Sample all week');
    expect(
      await html(<CalendarTab setup={setup} canManage={false} canDecideHolidays={false} />),
    ).not.toContain('Record leave');
    const preview = await previewPunchImport(ctx.db, hr, {
      filename: 'sample.csv',
      content: `Staff code,Date-time,Direction\nDEMO-T81,${D} 17:05,out\nNOPE,${D} 09:00,in`,
    });
    const imp = await html(
      <ImportTab imports={await listPunchImports(ctx.db, hr)} preview={preview} />,
    );
    expect(imp).toContain('Imported from sample.csv');
    expect(imp).toContain('No staff member has the code NOPE');
    expect(imp).toContain('No device is connected to Elevate OS'); // R12: never claims a device
    expect(imp).not.toMatch(/synced|connected device/i);
  });

  it('who: teachers are the people in the Teachers directory; totals and the chart agree', async () => {
    await ctx.db
      .insert(opsStaffSubjectCapabilities)
      .values({ staffId: teacher.staffId, subject: 'Sample Physics' });
    const names = async (who?: 'teachers' | 'other') => {
      const l = await listAttendance(ctx.db, hr, { from: D, to: D, who });
      const charted = l.byDate.flatMap((d) => Object.values(d.counts)).reduce((a, b) => a + b, 0);
      expect(charted).toBe(l.total);
      expect(l.staffCount).toBe(l.total);
      return l.items.map((r) => r.staff.name).sort();
    };
    expect(await names('teachers')).toEqual(['Sample Teacher Mira']);
    expect(await names('other')).toEqual(['Sample HR manager', 'Sample Teacher Kabir']);
    expect(await names()).toHaveLength(3);
    // Own scope: always your own days, whatever the filter says.
    const own = await listAttendance(ctx.db, other, { from: D, to: D, who: 'teachers' });
    expect(own.items.map((r) => r.staff.name)).toEqual(['Sample Teacher Kabir']);
  });

  it('staff without everyone-access cannot load the HR tabs', async () => {
    await expect(attendanceSetup(ctx.db, teacher)).rejects.toThrow(/every staff member/);
  });
});

describe('the status filter', () => {
  it('matches the words on the rows: Unmarked and No schedule are apart, and so are the chart counts (RL2-016)', async () => {
    const day = (status: 'unmarked' | 'no_schedule') =>
      listAttendance(ctx.db, hr, { from: D, to: D, status });
    await ctx.db.update(opsWorkSchedules).set({ isDefault: false });
    try {
      const none = await day('no_schedule');
      expect(none.total).toBeGreaterThan(0);
      expect(none.items.every(isNoScheduleDay)).toBe(true);
      expect(none.byDate[0]!.counts.no_schedule).toBe(none.total);
      expect((await day('unmarked')).items.filter(isNoScheduleDay)).toEqual([]);
    } finally {
      await ctx.db.update(opsWorkSchedules).set({ isDefault: true });
    }
    const scheduled = await day('unmarked');
    expect(scheduled.total).toBeGreaterThan(0);
    expect((await day('no_schedule')).total).toBe(0);
  });
});

describe('My attendance', () => {
  it('no work schedule: says so first, names who fixes it, and no day reads as a fault', async () => {
    await ctx.db.update(opsWorkSchedules).set({ isDefault: false });
    try {
      const out = await html(<MyAttendanceBody user={other} base="/academic" searchParams={{}} />);
      const notice = out.indexOf('No work schedule is set for you');
      expect(notice).toBeGreaterThan(-1);
      expect(notice).toBeLessThan(out.indexOf('cannot tell without a work schedule'));
      expect(out).toContain('Ask HR');
      // Every day of this person is "No schedule": no Unmarked badge in the table, no count of 0.
      const table = out.slice(out.indexOf('<table'));
      expect(table).toContain('No schedule');
      expect(table).not.toContain('>Unmarked<');
      expect(out).not.toContain('Unmarked scheduled day');
      const rows = (table.match(/>No schedule</g) ?? []).length;
      expect(out).toContain(`${rows} ${rows === 1 ? 'day' : 'days'} with no schedule`);
      expect(out).not.toMatch(/\d unmarked/);
    } finally {
      await ctx.db.update(opsWorkSchedules).set({ isDefault: true });
    }
  });

  it('an HR decision on a correction opens the requests tab, in the person\'s own workspace', async () => {
    const c = await requestCorrection(ctx.db, other, {
      workDate: addDays(D, -2),
      requestedStatus: 'present',
      reason: 'Sample missed punch',
    });
    await decideCorrection(ctx.db, hr, c.id, { decision: 'rejected', note: 'Sample reason' });
    const [n] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'attendance.correction_rejected'));
    expect(n!.userId).toBe(other.id);
    expect(n!.link).toBe('/academic/my-attendance?view=requests');
    expect(await openNotification(ctx.db, other, n!.id)).toEqual({ href: n!.link });
  });

  it('the requests tab counts them all and pages them, like the leave tab', async () => {
    await ctx.db.insert(opsAttendanceCorrections).values(
      Array.from({ length: 26 }, (_, i) => ({
        staffId: other.staffId,
        workDate: addDays(D, -(i + 40)),
        requestedStatus: 'present' as const,
        reason: 'Sample older request',
        requestedByUserId: other.id,
      })),
    );
    const body = (page?: string) =>
      html(
        <MyAttendanceBody
          user={other}
          base="/academic"
          searchParams={{ view: 'requests', page }}
        />,
      );
    const first = await body();
    const total = Number(/Correction requests.*?el-tab-count">(\d+)</.exec(first)?.[1]);
    expect(total).toBeGreaterThan(25);
    expect(first.replaceAll('<!-- -->', '')).toContain(`Showing 1–25 of ${total}`);
    expect(first).toMatch(/href="[^"]*view=requests[^"]*page=2"/);
    expect((await body('2')).replaceAll('<!-- -->', '')).toContain(`Showing 26–${total} of ${total}`);
  });

  it('with a schedule there is no such notice, and the unmarked total equals the unmarked rows', async () => {
    const out = await html(<MyAttendanceBody user={other} base="/academic" searchParams={{}} />);
    expect(out).not.toContain('No work schedule is set for you');
    const rows = (out.slice(out.indexOf('<table')).match(/>Unmarked</g) ?? []).length;
    expect(rows).toBeGreaterThan(0);
    expect(out).toContain(`${rows} unmarked`);
    expect(out).toContain('How these totals are worked out');
  });

  it('today and the way to ask HR come first; history and requests are apart; the page scrolls, not the table', async () => {
    const out = await html(<MyAttendanceBody user={teacher} base="/academic" searchParams={{}} />);
    const today = out.indexOf('Today, ');
    expect(today).toBeGreaterThan(-1);
    // "1 working day so far" on the 1st of a month.
    expect(today).toBeLessThan(out.indexOf(' so far:'));
    expect(out.indexOf(' so far:')).toBeLessThan(out.indexOf('<table'));
    expect(out).toMatch(/href="\/academic\/my-attendance\?view=requests#correct"/);
    expect(out).toContain('no machine is connected');
    expect(out).not.toContain('el-table-well');
    expect(out).not.toContain('Send request to HR');
    expect(out).not.toContain('ops-kpis');
    const requests = await html(
      <MyAttendanceBody user={teacher} base="/academic" searchParams={{ view: 'requests' }} />,
    );
    expect(requests).toContain('id="correct"');
    expect(requests).toContain('Send request to HR');
    expect(requests).not.toContain('Your days in');
  });

  it('upcoming holidays: this branch and everyone, nearest first; a proposed one says so; none is said plainly', async () => {
    const soon = addDays(istToday(new Date()), 3);
    const later = addDays(istToday(new Date()), 9);
    const page = () =>
      html(<MyAttendanceBody user={teacher} base="/academic" searchParams={{}} />);
    expect(await page()).toContain('No upcoming holidays are recorded');
    await ctx.db.insert(opsHolidays).values([
      { holidayOn: later, name: 'Sample Founders Day', decisionState: 'proposed', createdBy: hr.id },
      { holidayOn: soon, name: 'Sample Festival', decisionState: 'approved', createdBy: hr.id },
      { holidayOn: addDays(soon, -10), name: 'Sample Past Day', decisionState: 'approved', createdBy: hr.id },
    ]);
    const out = await page();
    expect(out.indexOf('Sample Festival')).toBeLessThan(out.indexOf('Sample Founders Day'));
    expect(out).toContain('proposed, not confirmed');
    expect(out).not.toContain('Sample Past Day');
    expect(out).not.toMatch(/leave balance/i);
  });

  it("shows only the signed-in person's days and requests; a staffId in the URL is ignored", async () => {
    const body = (view?: string) =>
      html(
        <MyAttendanceBody
          user={teacher}
          base="/academic"
          searchParams={{ staffId: other.staffId, view, month: D.slice(0, 7) }}
        />,
      );
    const out = await body();
    expect(out).toContain('My attendance');
    expect(out).toContain('Missing check-out');
    expect(out).not.toContain('Sample Teacher Kabir');
    const requests = await body('requests');
    expect(requests).toContain('Left without punching out');
    expect(requests).toContain('Send request to HR');
    expect(requests).not.toContain('Sample Teacher Kabir');
  });
});
