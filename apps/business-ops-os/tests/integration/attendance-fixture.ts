/** Shared setup for the attendance tests: fictional staff, a default 9-to-5 schedule, route helpers. */
import { eq } from 'drizzle-orm';
import { departments, opsStaffProfiles, staffMembers, type Database } from '@elevate/database';
import { authedRequest, callRoute, createTestUser, type TestUser } from '@elevate/testing';
import { addDays, istToday } from '../../src/domain/dates';
import { GET as listRoute } from '../../src/app/api/v1/attendance/route';
import { POST as scheduleRoute } from '../../src/app/api/v1/attendance/schedules/route';
import { setupReference, staffUser } from './fixtures';

const today = istToday(new Date());
export const [D1, D2, D3] = [addDays(today, -3), addDays(today, -2), addDays(today, -1)];
export const at = (day: string, time: string) => `${day}T${time}:00+05:30`;
export const PATTERN = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    { start: '09:00', end: '17:00' },
  ]),
);

type Row = {
  date: string;
  status: string;
  basis: string;
  staff: { id: string };
  reasons: string[];
  lateMinutes: number | null;
};
type List = {
  items: Row[];
  total: number;
  byDate: { date: string; counts: Record<string, number> }[];
};

// Teachers reach the shared routes through Academic (a route under /ops needs Ops membership, D-072).
const base = (u: TestUser) => (u.roles.includes('teacher') ? '/academic' : '/ops');
export const get = (u: TestUser, query = '') =>
  callRoute<List>(listRoute, authedRequest(u, `${base(u)}/api/v1/attendance${query}`));
export const post = <T = { id: string }>(
  route: Parameters<typeof callRoute>[0],
  u: TestUser,
  path: string,
  json: unknown,
  params: Record<string, string> = {},
) =>
  callRoute<T>(
    route,
    authedRequest(u, `${base(u)}/api/v1/attendance${path}`, { method: 'POST', json }),
    params,
  );

export const profile = (db: Database, staffId: string, staffCode: string) =>
  db.insert(opsStaffProfiles).values({ staffId: staffId as never, staffCode });

export async function attendanceWorld(db: Database) {
  await setupReference(db);
  const w = {
    hr: await staffUser(db, ['hr_manager'], { name: 'Sample HR manager' }),
    hr2: await staffUser(db, ['hr_manager'], { name: 'Sample HR lead' }),
    teacher: await staffUser(db, ['teacher'], { name: 'Sample Teacher One' }), // DEMO-T91
    teacher2: await staffUser(db, ['teacher'], { name: 'Sample Teacher Two' }), // DEMO-T92
    outsider: await createTestUser(db, { roles: ['platform_admin'] }),
    // No department: inside HR scope.
    office: await staffUser(db, ['admissions_counsellor'], { name: 'Sample Office Staff' }),
    // FINANCE: outside HR's default scope (Academics, Marketing).
    finance: await staffUser(db, ['finance_officer'], { name: 'Sample Finance Staff' }),
    opsMgr: await staffUser(db, ['operations_manager'], { name: 'Sample Ops Manager' }),
  };
  const [fin] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, 'FINANCE'));
  await db
    .update(staffMembers)
    .set({ departmentId: fin!.id })
    .where(eq(staffMembers.id, w.finance.staffId));
  await profile(db, w.teacher.staffId, 'DEMO-T91');
  await profile(db, w.teacher2.staffId, 'DEMO-T92');
  const s = await post(scheduleRoute, w.hr, '/schedules', {
    name: 'Sample every day 9 to 5',
    weeklyPattern: PATTERN,
    isDefault: true,
  });
  if (s.status !== 201) throw new Error('schedule setup failed');
  const day = async (staffId: string, date: string) =>
    (await get(w.hr, `?staffId=${staffId}&from=${date}&to=${date}`)).data!.items[0]!;
  return { ...w, day };
}
