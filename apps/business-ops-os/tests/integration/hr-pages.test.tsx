/**
 * HR screens (brief 23 Oct 2026 §6): each page asks for its own permission (the frame shows
 * "No access" otherwise); private details never render without ops:staff_private:read; teaching
 * assignments say "Source unavailable" when Academic OS cannot be read; workload is by name.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { can, type Permission } from '@elevate/authorization';
import {
  departments,
  opsStaffPrivateDetails,
  opsStaffTasks,
  staffMembers,
  type Database,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import HrOverviewPage from '../../src/app/hr/page';
import AssignmentsPage from '../../src/app/hr/assignments/page';
import HrSettingsPage from '../../src/app/hr/settings/page';
import HrStaffPage from '../../src/app/hr/staff/page';
import HrStaffMemberPage from '../../src/app/hr/staff/[id]/page';
import { NAV } from '../../src/ui/frame';
import { staffWorkload } from '../../src/server/hr-overview';
import { setupReference, staffUser, type StaffUser } from './fixtures';

// Pages check access through Next's request context; here the gate answers from the user's roles.
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
const db = () => ctx.db as Database;
const html = async (as: TestUser, node: ReactNode) => {
  access.user = as;
  return new Response((await prerender(node)).prelude).text();
};
const sp = (v: Record<string, string> = {}) => ({ searchParams: Promise.resolve(v) });

let hr: StaffUser;
let manager: StaffUser;
let teacher: StaffUser;
let director: TestUser;

beforeAll(async () => {
  await setupReference(db());
  const [academics] = await db()
    .select()
    .from(departments)
    .where(eq(departments.code, 'ACADEMICS'));
  hr = await staffUser(db(), ['hr_manager'], { name: 'Sample HR Manager' });
  manager = await staffUser(db(), ['operations_manager'], { name: 'Sample Ops Manager' });
  teacher = await staffUser(db(), ['teacher'], { name: 'Sample Teacher Bina' });
  director = await createTestUser(db(), { roles: ['director'] });
  await db()
    .update(staffMembers)
    .set({ departmentId: academics!.id })
    .where(eq(staffMembers.id, teacher.staffId));
  await db()
    .insert(opsStaffPrivateDetails)
    .values({ staffId: teacher.staffId, address: 'Sample private address' });
  await db().insert(opsStaffTasks).values({
    staffId: teacher.staffId,
    title: 'Sample practice sheet',
    dueOn: '2026-10-30',
    originalDueOn: '2026-10-30',
    status: 'in_review',
    lastSubmittedAt: new Date(),
    firstSubmittedAt: new Date(),
    isSample: true,
    createdBy: hr.id,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('HR page gates', () => {
  it.each([
    ['HR overview', () => <HrOverviewPage {...sp()} />, 'HR overview'],
    ['Staff directory', () => <HrStaffPage {...sp()} />, 'Sample Teacher Bina'],
    ['HR settings', () => <HrSettingsPage {...sp()} />, 'Late arrival grace'],
  ])('%s: teachers get "No access"; HR managers get the page', async (_n, page, shown) => {
    expect(await html(teacher, page())).toContain('No access');
    const out = await html(hr, page());
    expect(out).not.toContain('No access');
    expect(out).toContain(shown);
  });

  it('HR settings are for holders of ops:hr_settings:manage only (not directors)', async () => {
    expect(await html(director, <HrSettingsPage {...sp()} />)).toContain('No access');
  });

  it('the HR nav group lists the ten areas; attendance needs all-scope read', () => {
    const hrRows = NAV.filter((n) => n.group === 'HR');
    expect(hrRows.map((n) => n.href)).toEqual(
      [
        '',
        '/staff',
        '/assignments',
        '/attendance',
        '/tasks',
        '/review',
        '/requests', // HR-REQ
        '/reports',
        '/feedback',
        '/settings',
      ].map((p) => `/ops/hr${p}`),
    );
    expect(hrRows.find((n) => n.key === 'hr-attendance')?.allScope).toBe(true);
    // Your own attendance is a personal row outside HR (own scope is enough).
    expect(NAV.find((n) => n.key === 'my-attendance')).toMatchObject({
      group: 'My work',
      href: '/ops/my-attendance',
      allScope: false,
    });
  });
});

describe('Staff record page', () => {
  const page = (as: TestUser, tab?: string) =>
    html(
      as,
      <HrStaffMemberPage
        params={Promise.resolve({ id: teacher.staffId })}
        searchParams={Promise.resolve(tab ? { tab } : {})}
      />,
    );

  it('private details render for HR managers only', async () => {
    expect(await page(hr)).toContain('Sample private address');
    for (const u of [manager, director]) {
      const out = await page(u);
      expect(out).toContain('Employee profile');
      expect(out).not.toContain('Private details');
      expect(out).not.toContain('Sample private address');
    }
  });

  it('Responsibilities says "Source unavailable" when Academic OS cannot be read', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    expect(await page(hr, 'responsibilities')).toContain('Source unavailable');
  });

  it('list tabs link to the HR lists narrowed to this person', async () => {
    expect(await page(hr, 'tasks')).toContain(`/ops/hr/tasks?staffId=${teacher.staffId}`);
  });
});

describe('Teaching assignments', () => {
  it('shows Academic’s assignments, pending ones as "Pending — no batch yet"', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return Response.json({
        data: {
          contract: 'academic.teaching_assignments',
          version: 1,
          generatedAt: new Date().toISOString(),
          total: 1,
          page: 1,
          pageSize: 25,
          items: [
            {
              assignmentId: crypto.randomUUID(),
              staffId: teacher.staffId,
              teacherName: 'Sample Teacher Bina',
              courseName: 'Sample Class 11',
              subjectName: 'Mathematics',
              classLevel: 'Class 11',
              batchCode: null,
              academicYear: '2026-27',
              branchName: 'Sikar centre',
              startDate: null,
              endDate: null,
              role: 'primary',
              status: 'pending',
            },
          ],
        },
      });
    });
    const out = await html(hr, <AssignmentsPage {...sp({ status: 'pending' })} />);
    expect(out).toContain('Pending — no batch yet');
    expect(out).toContain('No batch yet');
    expect(calls[0]).toContain('/academic/api/internal/v1/teaching-assignments?');
    expect(calls[0]).toContain('status=pending');
  });

  it('teachers cannot open the list', async () => {
    expect(await html(teacher, <AssignmentsPage {...sp()} />)).toContain('No access');
  });
});

describe('Staff workload', () => {
  it('open tasks per person in HR’s scope, by name; submitted counted separately', async () => {
    const w = await staffWorkload(db(), hr);
    const row = w!.rows.find((r) => r.id === teacher.staffId);
    expect(row).toMatchObject({ open: 1, submitted: 1 });
    expect(w!.rows.map((r) => r.name)).toEqual([...w!.rows.map((r) => r.name)].sort());
  });
});
