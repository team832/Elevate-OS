/**
 * Attendance screens render from real service data: HR tabs, the staff page parts and My
 * attendance (own days only, whatever the URL says).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { opsAttendancePunches, opsStaffProfiles, opsWorkSchedules } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { addDays, istInstant, istToday } from '../../src/domain/dates';
import { listAttendance } from '../../src/server/attendance';
import { requestCorrection } from '../../src/server/attendance-corrections';
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

  it('staff without everyone-access cannot load the HR tabs', async () => {
    await expect(attendanceSetup(ctx.db, teacher)).rejects.toThrow(/every staff member/);
  });
});

describe('My attendance', () => {
  it("shows only the signed-in person's days and requests; a staffId in the URL is ignored", async () => {
    const out = await html(
      <MyAttendanceBody
        user={teacher}
        base="/academic"
        searchParams={{ staffId: other.staffId }}
      />,
    );
    expect(out).toContain('My attendance');
    expect(out).toContain('Missing check-out');
    expect(out).toContain('Left without punching out');
    expect(out).toContain('Send request to HR');
    expect(out).not.toContain('Sample Teacher Kabir');
  });
});
