/**
 * The new-request form: who a request can be for (told apart by role and department, only people who
 * can really receive one, searchable when long) and the owner's categories, with old rows still valid.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import { eq } from 'drizzle-orm';
import { departments, opsStaffProfiles, staffMembers, users } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import HrRequestsPage from '../../src/app/hr-requests/page';
import { can, type Permission } from '@elevate/authorization';
import { createHrRequest } from '../../src/server/hr-requests';
import { listMyRequests, requestFormOptions } from '../../src/server/hr-requests-read';
import { hrRequestBody } from '../../src/server/hr-requests-schemas';
import { setupReference, staffUser, type StaffUser } from './fixtures';

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
const html = async (node: ReactNode) => new Response((await prerender(node)).prelude).text();
const sp = (v: Record<string, string> = {}) => ({ searchParams: Promise.resolve(v) });

let sender: StaffUser;
let twinA: StaffUser;
let twinB: StaffUser;
let sameJob: StaffUser;
let gone: StaffUser;
let locked: StaffUser;
let auditor: StaffUser;

const inDept = async (s: StaffUser, code: string) => {
  const [d] = await ctx.db.select().from(departments).where(eq(departments.code, code));
  await ctx.db
    .update(staffMembers)
    .set({ departmentId: d!.id })
    .where(eq(staffMembers.id, s.staffId));
};

beforeAll(async () => {
  await setupReference(ctx.db);
  sender = await staffUser(ctx.db, ['teacher'], { name: 'Sample Sender' });
  twinA = await staffUser(ctx.db, ['teacher'], { name: 'Sample Twin' });
  twinB = await staffUser(ctx.db, ['marketing_contributor'], { name: 'Sample Twin' });
  sameJob = await staffUser(ctx.db, ['teacher'], { name: 'Sample Twin' });
  gone = await staffUser(ctx.db, ['teacher'], { name: 'Sample Left Already' });
  locked = await staffUser(ctx.db, ['teacher'], { name: 'Sample Login Off' });
  auditor = await staffUser(ctx.db, ['auditor'], { name: 'Sample Auditor Only' });
  await inDept(twinA, 'ACADEMICS');
  await inDept(sameJob, 'ACADEMICS');
  await inDept(twinB, 'MARKETING_GROWTH');
  await ctx.db.insert(opsStaffProfiles).values({ staffId: sameJob.staffId, staffCode: 'DEMO-T90' });
  await ctx.db
    .update(staffMembers)
    .set({ status: 'inactive' })
    .where(eq(staffMembers.id, gone.staffId));
  await ctx.db.update(users).set({ status: 'disabled' }).where(eq(users.id, locked.id));
  access.user = sender;
});

describe('who a request can be for', () => {
  const people = async (find?: string) =>
    (await requestFormOptions(ctx.db, sender, find)).recipients.filter((r) =>
      r.value.startsWith('staff:'),
    );
  const labelOf = async (s: StaffUser) =>
    (await people()).find((p) => p.value === `staff:${s.staffId}`)?.label;

  it('each person shows role and department; same name, role and department adds what still differs', async () => {
    expect(await labelOf(twinB)).toBe('Sample Twin (Marketing employee, Marketing & Growth)');
    expect(await labelOf(twinA)).toMatch(/^Sample Twin \(Teacher, Academics\) · [0-9a-f]{8}$/);
    expect(await labelOf(sameJob)).toBe('Sample Twin (Teacher, Academics) · DEMO-T90');
    expect(new Set((await people()).map((p) => p.label)).size).toBe((await people()).length);
    expect(await labelOf(locked)).toBeUndefined();
  });

  it.each([
    ['employment ended', () => gone],
    ['login switched off', () => locked],
    ['a role that cannot reply', () => auditor],
    ['the sender themselves', () => sender],
  ])('%s: not offered', async (_, who) => {
    expect((await people()).map((p) => p.value)).not.toContain(`staff:${who().staffId}`);
  });

  it('search narrows people by name, role or department; HR and named recipients stay', async () => {
    const { recipients } = await requestFormOptions(ctx.db, sender, 'marketing');
    expect(recipients.map((r) => r.value)).toEqual(['hr', 'key:schar', `staff:${twinB.staffId}`]);
    expect(await people('teacher')).toHaveLength(2);
    expect(await people('nobody like this')).toEqual([]);
  });

  it('the form offers the search only when the list is long, or once it is in use, keeping the form open', async () => {
    const short = await html(<HrRequestsPage {...sp({ new: '1' })} />);
    expect(short).not.toContain('Find a person');
    const searching = await html(
      <HrRequestsPage {...sp({ new: '1', find: 'nobody like this' })} />,
    );
    expect(searching).toContain('Find a person');
    expect(searching).toContain('name="new" value="1"');
    expect(searching).toContain('Nobody matches');
  });
});

describe('request categories', () => {
  it("the owner's list, in this order", async () => {
    const { categories } = await requestFormOptions(ctx.db, sender);
    expect(categories.map((c) => c.label)).toEqual([
      'Tasks and deadlines',
      'Attendance',
      'Leave',
      'Timetable changes',
      'Classes and batches',
      'Students',
      'Resources',
      'Development support',
      'Something else',
    ]);
  });

  it.each([
    ['tasks', 'Tasks and deadlines'],
    ['classes', 'Classes and batches'],
    ['students', 'Students'],
    ['other', 'Something else'],
    ['leave', 'Leave'],
    ['development', 'Development support'],
  ])('a request in %s saves and reads back with its label', async (category, label) => {
    const { id } = await createHrRequest(
      ctx.db,
      sender,
      hrRequestBody.parse({ category, subject: 'Sample subject', message: 'Sample words' }),
    );
    const { rows } = await listMyRequests(ctx.db, sender, 1);
    expect(rows.find((r) => r.id === id)?.categoryLabel).toBe(label);
  });

  it('the form points leave to the leave form, in one line, and keeps the category', async () => {
    const out = await html(<HrRequestsPage {...sp({ new: '1' })} />);
    expect(out.match(/my-attendance\?view=leave/g)).toHaveLength(1);
    expect(out).toContain('>Leave</option>');
  });

  it('Find keeps the list behind the form, so closing the form returns to it', async () => {
    const out = await html(
      <HrRequestsPage {...sp({ new: '1', find: 'nobody', tab: 'forwarded', page: '2' })} />,
    );
    const search = /<form[^>]*role="search".*?<\/form>/s.exec(out)![0];
    for (const kept of [
      'name="new" value="1"',
      'name="tab" value="forwarded"',
      'name="page" value="2"',
    ])
      expect(search).toContain(kept);
    expect(search.match(/name="find"/g)).toHaveLength(1);
  });
});
