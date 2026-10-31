import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { users } from '@elevate/database';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as directory } from '../../src/app/api/v1/organisation/route';
import { POST as createStaff } from '../../src/app/api/v1/staff/route';
import { PATCH as patchStaff } from '../../src/app/api/v1/staff/[id]/route';
import { linkableLogins } from '../../src/server/organisation';
import { POST as hrAction } from '../../src/app/api/v1/hr/staff/[id]/[action]/route';
import { GET as listSettings } from '../../src/app/api/v1/settings/route';
import { PUT as putSetting } from '../../src/app/api/v1/settings/[key]/route';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
let counsellor: StaffUser;
let auditor: TestUser;
const req = (user: { token: string }, json: unknown, method = 'POST') =>
  authedRequest(user, '/ops/api/v1/x', { method, json });

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  counsellor = await staffUser(ctx.db, ['admissions_counsellor'], { managerId: manager.staffId });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
});

describe('linking a login to a staff record (PPL-005, PPL-007)', () => {
  const addStaff = async (fullName: string) =>
    (await callRoute<{ id: string }>(createStaff, req(manager, { fullName }))).data!.id;

  it('the picker offers active logins with no staff record, and the one this record holds', async () => {
    const free = await createTestUser(ctx.db, { roles: ['teacher'] });
    const disabled = await createTestUser(ctx.db, { roles: ['teacher'] });
    await ctx.db.update(users).set({ status: 'disabled' }).where(eq(users.id, disabled.id));
    const staffId = await addStaff('Sample Link Teacher');
    const ids = async () => (await linkableLogins(ctx.db, manager, staffId)).map((o) => o.value);
    expect(await ids()).toContain(free.id);
    expect(await ids()).not.toContain(disabled.id);
    expect(await ids()).not.toContain(counsellor.id);
    const link = await callRoute(patchStaff, req(manager, { userId: free.id }, 'PATCH'), {
      id: staffId,
    });
    expect(link.status).toBe(200);
    expect(await ids()).toContain(free.id); // this record's own login stays on its list
    const other = await addStaff('Sample Other Teacher');
    expect((await linkableLogins(ctx.db, manager, other)).map((o) => o.value)).not.toContain(
      free.id,
    );
    const taken = await callRoute(patchStaff, req(manager, { userId: free.id }, 'PATCH'), {
      id: other,
    });
    expect(taken.status).toBe(409);
  });

  it('only holders of ops:organisation:manage may read the picker or link', async () => {
    const staffId = await addStaff('Sample Guarded Teacher');
    await expect(linkableLogins(ctx.db, counsellor, staffId)).rejects.toThrow();
    const res = await callRoute(patchStaff, req(counsellor, { userId: counsellor.id }, 'PATCH'), {
      id: staffId,
    });
    expect(res.status).toBe(403);
  });

  it('a rename reaches the login, which is what the header and account menu show', async () => {
    const person = await createTestUser(ctx.db, { roles: ['teacher'] });
    const staffId = await addStaff('Sample Old Name');
    await callRoute(patchStaff, req(manager, { userId: person.id }, 'PATCH'), { id: staffId });
    await callRoute(patchStaff, req(manager, { fullName: 'Sample New Name' }, 'PATCH'), {
      id: staffId,
    });
    const [row] = await ctx.db.select().from(users).where(eq(users.id, person.id));
    expect(row!.displayName).toBe('Sample New Name');
  });
});

describe('staff directory (steward of core tables)', () => {
  it('counsellor and auditor can read but not administer staff', async () => {
    expect((await callRoute(directory, authedRequest(counsellor, '/x'))).status).toBe(200);
    expect((await callRoute(createStaff, req(counsellor, { fullName: 'X' }))).status).toBe(403);
    expect((await callRoute(createStaff, req(auditor, { fullName: 'X' }))).status).toBe(403);
  });

  it('creates staff and rejects reporting-line loops', async () => {
    const a = await callRoute<{ id: string }>(
      createStaff,
      req(manager, {
        fullName: 'Lead A',
        employmentType: 'full_time',
        roleLabels: ['Operations Lead'],
      }),
    );
    const b = await callRoute<{ id: string }>(
      createStaff,
      req(manager, { fullName: 'Member B', managerId: a.data!.id }),
    );
    expect(b.status).toBe(201);
    // Manager changes go through HR (history kept); a loop is refused either way round.
    const setManager = (id: string, managerId: string) =>
      callRoute(hrAction, req(manager, { managerId }), { id, action: 'manager' });
    expect((await setManager(a.data!.id, b.data!.id)).status).toBe(409);
    expect((await setManager(a.data!.id, a.data!.id)).status).toBe(409);
  });
});

describe('settings (policy register)', () => {
  it('changes stay proposed; legacy-approved demo terms are read-only; auditor cannot change', async () => {
    const before = await callRoute<{ key: string; decisionState: string }[]>(
      listSettings,
      authedRequest(auditor, '/x'),
    );
    expect(before.data?.find((s) => s.key === 'demo.fee')?.decisionState).toBe('approved');
    const put = (user: { token: string }, key: string, value: unknown) =>
      callRoute<{ decisionState: string; value: unknown }>(
        putSetting,
        req(user, { value }, 'PUT'),
        { key },
      );
    expect((await put(auditor, 'demo.fee', { amountInr: 1 })).status).toBe(403);
    expect((await put(manager, 'demo.terms', { days: 3 })).status).toBe(400);
    const res = await put(manager, 'pipeline.demo_skip', { allowed: false });
    expect(res.data).toMatchObject({ decisionState: 'proposed', value: { allowed: false } });
  });
});
