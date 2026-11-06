/** Leave application screens render from real service data: My attendance, the HR tab, the record-leave wording. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { opsAttachments } from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import { CalendarTab } from '../../src/app/hr/attendance/_components/setup';
import { leaveFiles, LeaveTab } from '../../src/app/hr/attendance/_components/leave';
import { statusOptions } from '../../src/app/hr/attendance/_components/shared';
import { attendanceSetup } from '../../src/server/attendance-lists';
import {
  applyForLeave,
  canDecideLeave,
  decideLeave,
  listLeaveApplications,
  teachingStaff,
} from '../../src/server/leave-applications';
import { LEAVE_WHY_HIDDEN, RESEND_TO_ACADEMIC } from '../../src/domain/leave';
import { MyAttendanceBody } from '../../src/work';
import { setupReference, staffUser, type StaffUser } from './fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const ctx = setupTestDatabase();
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const day = (n: number) => addDays(istToday(new Date()), n);
const form = (n: number, reason: string, kind = 'Casual') => ({
  kind,
  fromDate: day(n),
  toDate: day(n),
  reason,
});
let hr: StaffUser;
let hr2: StaffUser;
let teacher: StaffUser;
let other: StaffUser;
let auditor: StaffUser;
let letter: string;

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('fetch failed');
    }),
  );
  await setupReference(ctx.db);
  hr = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR manager' });
  hr2 = await staffUser(ctx.db, ['hr_manager'], { name: 'Sample HR lead' });
  teacher = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Mira' });
  other = await staffUser(ctx.db, ['teacher'], { name: 'Sample Teacher Kabir' });
  auditor = await staffUser(ctx.db, ['auditor'], { name: 'Sample Auditor' });
  await applyForLeave(ctx.db, teacher, form(5, 'Sister wedding'));
  const yes = await applyForLeave(ctx.db, teacher, form(7, 'Exam duty', 'Earned'));
  await decideLeave(ctx.db, hr, yes.id, { decision: 'approved', version: 1 });
  const no = await applyForLeave(ctx.db, teacher, form(9, 'Long weekend'));
  await decideLeave(ctx.db, hr, no.id, { decision: 'rejected', note: 'Mock test that week', version: 1 });
  await applyForLeave(ctx.db, other, form(5, 'Someone else reason'));
  await applyForLeave(ctx.db, hr2, form(5, 'HR lead own reason'));
  const pending = await listLeaveApplications(ctx.db, teacher, { status: 'pending' });
  // Only the record of the file: rendering needs no stored bytes.
  const [file] = await ctx.db
    .insert(opsAttachments)
    .values({
      ownerKind: 'leave_application',
      ownerId: pending.items[0]!.id,
      purpose: 'evidence',
      originalName: 'sample-medical-certificate.pdf',
      mime: 'application/pdf',
      sizeBytes: 2048,
      sha256: 'b'.repeat(64),
      storageKey: crypto.randomUUID(),
      uploadedByUserId: teacher.id,
      isSample: true,
    })
    .returning();
  letter = file!.id;
});

const my = (user: StaffUser, params: Record<string, string> = {}, base = '/academic') =>
  html(<MyAttendanceBody user={user} base={base} searchParams={params} />);

describe('My attendance', () => {
  it('Apply for leave is one click from the top, in the workspace you are in', async () => {
    for (const base of ['/academic', '/marketing', '/ops'])
      expect(await my(teacher, {}, base)).toContain(`href="${base}/my-attendance?view=leave#apply"`);
  });

  it('the leave view: the form, every type, your own applications only, what HR said', async () => {
    const out = await my(teacher, { view: 'leave' });
    expect(out).toContain('id="apply"');
    expect(out).toContain('Type of leave');
    for (const t of ['Casual', 'Sick', 'Earned', 'Unpaid']) expect(out).toContain(`>${t}</option>`);
    expect(out).toContain('My leave applications');
    expect(out).toContain('Mock test that week');
    for (const label of ['Pending', 'Approved', 'Rejected']) expect(out).toContain(`>${label}<`);
    expect(out).not.toContain('Someone else reason');
    // F4-12: a balance per type, and words (never 0) where HR has set no allowance.
    expect(out).toContain('Leave balance, ');
    expect(out).toContain('No allowance set');
    expect(out).toContain('Does not use a balance');
    expect(out).toContain('Half day (optional)');
    expect(out).toContain('To cancel approved leave, ask HR');
    expect(out).toContain('Cancel application');
    expect(out).not.toContain('Your days in');
  });

  it('a pending application takes a leave letter or certificate; its files download in your workspace', async () => {
    const out = await my(teacher, { view: 'leave' });
    expect(out).toContain('Attach a letter or certificate');
    expect(out.match(/type="file"/g)).toHaveLength(1); // the pending row only
    expect(out).toContain(`href="/academic/api/v1/attachments/${letter}"`);
    expect(out).toContain('sample-medical-certificate.pdf');
  });

  it('nothing applied for: says so', async () => {
    const out = await my(auditor, { view: 'leave' });
    expect(out).toContain('You have not applied for leave');
    expect(out).not.toContain('id="apply"'); // an auditor reads only
    expect(out).toContain('cannot apply for leave here');
  });

  it('no staff record: a plain message, no form', async () => {
    const u = await createTestUser(ctx.db, { roles: ['teacher'], displayName: 'Sample No Record' });
    const out = await html(<MyAttendanceBody user={u} base="/academic" searchParams={{ view: 'leave' }} />);
    expect(out).toContain('cannot apply for leave');
    expect(out).not.toContain('Type of leave');
  });
});

describe('HR: Leave applications tab', () => {
  /** As the page loads it: files only for someone who decides leave. */
  const tab = async (user: StaffUser, params: Record<string, string | undefined>) => {
    const list = await listLeaveApplications(ctx.db, user, {
      status: params.status === 'all' ? undefined : ((params.status as never) ?? 'pending'),
      staffId: params.staffId,
    });
    const canDecide = await canDecideLeave(ctx.db, user);
    return html(
      <LeaveTab
        list={list}
        params={{ tab: 'leave', ...params }}
        canDecide={canDecide}
        ownStaffId={user.staffId}
        files={canDecide ? await leaveFiles(ctx.db, user, '/ops/api/v1', list.items) : undefined}
      />,
    );
  };

  it('tabs count the lists; Approve and Reject on the waiting rows, with a reason box', async () => {
    const out = await tab(hr, {});
    expect(out).toContain('Pending (3)');
    expect(out).toContain('Approved (1)');
    expect(out).toContain('Rejected (1)');
    expect(out).toContain('Cancelled (0)');
    expect(out).toContain('All (5)');
    expect(out).toContain('Sample Teacher Mira');
    expect(out).toContain('Approve');
    expect(out).toContain('Reject application');
    expect(out).toContain('Why (shown to the employee)');
    expect(out).toContain(`/ops/hr/attendance?tab=leave&amp;status=all&amp;staffId=${teacher.staffId}`);
  });

  it("HR, who decides leave, gets each application's files with download links; a reader who does not decide gets none", async () => {
    const out = await tab(hr, {});
    expect(out).toContain('>Files<');
    expect(out).toContain(`href="/ops/api/v1/attachments/${letter}"`);
    const read = await tab(auditor, {});
    expect(read).not.toContain('sample-medical-certificate.pdf');
    expect(read).not.toContain('>Files<');
  });

  it('HR cannot set a day to On leave: leave comes from a leave record', () => {
    expect(statusOptions.map((o) => o.value)).not.toContain('on_leave');
  });

  it('your own row offers no decision', async () => {
    const out = await tab(hr2, {});
    expect(out).toContain('Your own: another HR person decides this');
    expect((out.match(/value="Approve"|>Approve</g) ?? []).length).toBe(2);
  });

  it('an approved row offers Cancel leave with a reason', async () => {
    const out = await tab(hr, { status: 'approved' });
    expect(out).toContain('Cancel this leave');
    expect(out).not.toContain('Sister wedding');
  });

  it.each([
    ['the Leave applications tab', async (u: StaffUser) => tab(u, { status: 'all' })],
    [
      'the record-leave list',
      async (u: StaffUser) =>
        html(<CalendarTab setup={await attendanceSetup(ctx.db, u)} canManage={false} canDecideHolidays={false} />),
    ],
  ])('%s shows a reader who is not HR no reason and no buttons; HR reads it', async (_label, render) => {
    const out = await render(auditor);
    for (const text of ['Exam duty', 'Sister wedding', 'Mock test that week'])
      expect(out).not.toContain(text);
    expect(out).toContain(LEAVE_WHY_HIDDEN);
    expect(out).not.toContain('Not recorded');
    expect(out).not.toContain('Reject application');
    expect(await render(hr)).toContain('Exam duty');
  });

  it('one person: their whole history, and the way back to everyone', async () => {
    const out = await tab(hr, { status: 'all', staffId: teacher.staffId });
    for (const reason of ['Sister wedding', 'Exam duty', 'Long weekend']) expect(out).toContain(reason);
    expect(out).not.toContain('Someone else reason');
    expect(out).toContain('Show everyone');
  });

  it("a teacher's leave offers Send to Academic again to a leave approver (D-134)", async () => {
    const setup = await attendanceSetup(ctx.db, hr);
    const teachers = await teachingStaff(ctx.db, setup.leave.map((l) => l.staffId));
    expect(teachers.has(teacher.staffId)).toBe(true);
    expect(teachers.has(hr.staffId)).toBe(false);
    const tabFor = (resendFor?: ReadonlySet<string>) =>
      html(<CalendarTab setup={setup} canManage canDecideHolidays={false} resendFor={resendFor} />);
    expect(await tabFor(teachers)).toContain(RESEND_TO_ACADEMIC);
    expect(await tabFor()).not.toContain(RESEND_TO_ACADEMIC);
  });

  it('Record approved leave stays for HR entering leave, and points to the new tab', async () => {
    const out = await html(
      <CalendarTab setup={await attendanceSetup(ctx.db, hr)} canManage canDecideHolidays />,
    );
    expect(out).toContain('Record approved leave');
    expect(out).toContain('href="/ops/hr/attendance?tab=leave"');
    expect(out).not.toContain('Leave requests are not handled here');
  });
});
