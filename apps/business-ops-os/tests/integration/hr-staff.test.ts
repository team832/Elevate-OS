/**
 * HR staff records (brief 23 Oct 2026 §3, §5, §6): directory scope, filters and paging; the
 * record and its private details (HR managers only, also through the API); audited changes in
 * one transaction; ending employment disables the login and keeps history; HR settings.
 * Fictional people only.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import {
  auditEvents,
  departments,
  opsStaffDepartments,
  opsStaffManagerHistory,
  opsStaffProfiles,
  opsStaffTasks,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as list } from '../../src/app/api/v1/hr/staff/route';
import { GET as getOne, PATCH as patch } from '../../src/app/api/v1/hr/staff/[id]/route';
import { PUT as putPrivate } from '../../src/app/api/v1/hr/staff/[id]/private/route';
import { POST as act } from '../../src/app/api/v1/hr/staff/[id]/[action]/route';
import { PUT as putSetting } from '../../src/app/api/v1/hr/settings/[key]/route';
import { PUT as putMainSetting } from '../../src/app/api/v1/settings/[key]/route';
import { POST as createStaff } from '../../src/app/api/v1/staff/route';
import { PATCH as patchStaff } from '../../src/app/api/v1/staff/[id]/route';
import { listTeachingAssignments } from '../../src/server/hr-assignments';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
let hr: StaffUser;
let manager: StaffUser;
let teacher: StaffUser;
let counsellor: StaffUser;
let coordinator: StaffUser;
let director: TestUser;
let dept: Record<string, DepartmentId>;

type Directory = { total: number; staff: { id: string; fullName: string }[] };
type Record_ = { staff: { id: string }; private?: unknown; login: { email: string } | null };
const URL_ = '/ops/api/v1/hr/staff';
const send = (u: { token: string }, method: string, json?: unknown) =>
  authedRequest(u, URL_, { method, json });
const directory = (u: { token: string }, query = '') =>
  callRoute<Directory>(list, authedRequest(u, `${URL_}${query}`));
const record = (u: { token: string }, id: string) =>
  callRoute<Record_>(getOne, authedRequest(u, `${URL_}/${id}`), { id });
const action = (u: { token: string }, id: string, name: string, json: unknown) =>
  callRoute(act, send(u, 'POST', json), { id, action: name });

/** The open history rows always name the current department and manager. */
async function expectHistoryMatches(staffId: StaffMemberId) {
  const [s] = await db().select().from(staffMembers).where(eq(staffMembers.id, staffId));
  const depts = await db()
    .select()
    .from(opsStaffDepartments)
    .where(and(eq(opsStaffDepartments.staffId, staffId), isNull(opsStaffDepartments.toDate)));
  const mgr = await db()
    .select()
    .from(opsStaffManagerHistory)
    .where(and(eq(opsStaffManagerHistory.staffId, staffId), isNull(opsStaffManagerHistory.toDate)));
  expect(depts.find((d) => d.isPrimary)?.departmentId ?? null).toBe(s!.departmentId);
  expect(mgr[0]?.managerStaffId ?? null).toBe(s!.managerId);
}

const placeIn = (staffId: StaffMemberId, code: string) =>
  db().update(staffMembers).set({ departmentId: dept[code] }).where(eq(staffMembers.id, staffId));

beforeAll(async () => {
  await setupReference(db());
  dept = Object.fromEntries(
    (await db().select().from(departments)).map((d) => [d.code, d.id]),
  ) as Record<string, DepartmentId>;
  hr = await staffUser(db(), ['hr_manager'], { name: 'Sample HR Manager' });
  manager = await staffUser(db(), ['operations_manager'], { name: 'Sample Ops Manager' });
  teacher = await staffUser(db(), ['teacher'], {
    name: 'Sample Teacher Asha',
    managerId: manager.staffId,
  });
  counsellor = await staffUser(db(), ['admissions_counsellor'], { name: 'Sample Counsellor' });
  director = await createTestUser(db(), { roles: ['director'] });
  coordinator = await staffUser(db(), ['academic_coordinator'], { name: 'Sample Coordinator' });
  await placeIn(coordinator.staffId, 'ACADEMICS');
  await placeIn(hr.staffId, 'HUMAN_RESOURCES');
  await placeIn(manager.staffId, 'LEADERSHIP_OPERATIONS');
  await placeIn(teacher.staffId, 'ACADEMICS');
  await placeIn(counsellor.staffId, 'ADMISSIONS_COUNSELLING');
});

describe('GET /api/v1/hr/staff (HR directory)', () => {
  it('401 signed out; 403 for teachers and counsellors', async () => {
    expect((await callRoute(list, buildRequest(URL_))).status).toBe(401);
    for (const u of [teacher, counsellor]) expect((await directory(u)).status).toBe(403);
  });

  it('lists only HR’s departments (teaching and marketing) plus unplaced staff; filters narrow', async () => {
    const all = await directory(hr);
    const names = all.data!.staff.map((s) => s.fullName);
    expect(names).toContain('Sample Teacher Asha');
    expect(names).not.toContain('Sample Ops Manager'); // Leadership: outside HR's scope
    const byRole = await directory(hr, '?role=teacher');
    expect(byRole.data!.staff.map((s) => s.id)).toEqual([teacher.staffId]);
    const byDept = await directory(
      director,
      `?department=${dept.ACADEMICS}&manager=${manager.staffId}`,
    );
    expect(byDept.data!.staff.map((s) => s.id)).toEqual([teacher.staffId]);
    expect((await directory(hr, '?role=nobody')).status).toBe(400);
  });

  it('pages on the server, 25 at a time, with the total', async () => {
    await db()
      .insert(staffMembers)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          fullName: `Sample Paging Staff ${String(i).padStart(2, '0')}`,
          departmentId: dept.MARKETING_GROWTH,
        })),
      );
    const q = `?department=${dept.MARKETING_GROWTH}&q=paging`;
    const one = await directory(hr, q);
    const two = await directory(hr, `${q}&page=2`);
    expect(one.data!.total).toBe(30);
    expect(one.data!.staff).toHaveLength(25);
    expect(two.data!.staff).toHaveLength(5);
  });
});

describe('HR staff record and private details', () => {
  it('404 for a staff member outside HR’s scope or unknown; 403 without ops:hr:read', async () => {
    expect((await record(hr, manager.staffId)).status).toBe(404);
    expect((await record(hr, crypto.randomUUID())).status).toBe(404);
    expect((await record(teacher, teacher.staffId)).status).toBe(403);
  });

  it('scenario 14: private details — only HR managers edit and read them; others get no private field, even through the API', async () => {
    const values = { personalPhone: '0000000000', address: 'Sample address, Sikar' };
    expect(
      (await callRoute(putPrivate, send(manager, 'PUT', values), { id: teacher.staffId })).status,
    ).toBe(403);
    expect(
      (await callRoute(putPrivate, send(hr, 'PUT', values), { id: teacher.staffId })).status,
    ).toBe(200);
    const mine = await record(hr, teacher.staffId);
    expect(mine.data!.private).toMatchObject(values);
    for (const u of [manager, director]) {
      const res = await record(u, teacher.staffId);
      expect(res.status).toBe(200);
      expect(res.data).not.toHaveProperty('private');
      expect(JSON.stringify(res.data)).not.toContain('Sample address');
    }
    const [audit] = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'staff.private_details_updated'));
    expect(JSON.stringify(audit)).not.toContain('Sample address');
  });

  it('profile edits are audited; contradictory or duplicate values are refused', async () => {
    const edit = (u: { token: string }, json: unknown) =>
      callRoute(patch, send(u, 'PATCH', json), { id: teacher.staffId });
    expect((await edit(director, { staffCode: 'EMP-T1' })).status).toBe(403);
    expect((await edit(hr, { staffCode: 'EMP-T1', joinedOn: '2026-06-01' })).status).toBe(200);
    expect((await edit(hr, { leftOn: '2026-12-31' })).status).toBe(400); // notice not given
    await db().insert(opsStaffProfiles).values({ staffId: hr.staffId, staffCode: 'EMP-H1' });
    expect((await edit(hr, { staffCode: 'EMP-H1' })).status).toBe(400);
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'staff.profile_updated'));
    expect(rows).toHaveLength(1);
  });

  it('department and manager changes keep dated history; reporting loops are refused', async () => {
    const id = teacher.staffId;
    expect(
      (
        await action(hr, id, 'department', {
          departmentId: dept.MARKETING_GROWTH,
          kind: 'primary',
          fromDate: '2026-10-01',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await action(hr, id, 'department', {
          departmentId: dept.ACADEMICS,
          kind: 'additional',
          fromDate: '2026-10-02',
        })
      ).status,
    ).toBe(200);
    const history = await db()
      .select()
      .from(opsStaffDepartments)
      .where(eq(opsStaffDepartments.staffId, id));
    expect(history.map((h) => [h.departmentId, h.isPrimary, h.toDate]).sort()).toEqual(
      [
        [dept.ACADEMICS, true, '2026-10-01'],
        [dept.ACADEMICS, false, null],
        [dept.MARKETING_GROWTH, true, null],
      ].sort(),
    );
    const [s] = await db().select().from(staffMembers).where(eq(staffMembers.id, id));
    expect(s!.departmentId).toBe(dept.MARKETING_GROWTH);

    // The new manager must be inside HR's scope too (the ops manager is Leadership).
    expect(
      (await action(hr, coordinator.staffId, 'manager', { managerId: manager.staffId })).status,
    ).toBe(404);
    expect(
      (await action(hr, id, 'manager', { managerId: coordinator.staffId, reason: 'Moved team' }))
        .status,
    ).toBe(200);
    const managers = await db()
      .select()
      .from(opsStaffManagerHistory)
      .where(eq(opsStaffManagerHistory.staffId, id));
    expect(managers.map((m) => m.managerStaffId).sort()).toEqual(
      [coordinator.staffId, manager.staffId].sort(),
    );
    await expectHistoryMatches(id);
    // The coordinator reporting to their own report would loop.
    expect((await action(hr, coordinator.staffId, 'manager', { managerId: id })).status).toBe(409);
  });

  it('400 for an unknown action body; 403 for staff without ops:staff:manage', async () => {
    expect((await action(hr, teacher.staffId, 'department', { kind: 'sideways' })).status).toBe(
      400,
    );
    expect((await action(director, teacher.staffId, 'manager', { managerId: null })).status).toBe(
      403,
    );
  });
});

describe('End employment (one transaction)', () => {
  it('exits the profile, makes the record inactive, disables the login and ends its sessions; history stays', async () => {
    const leaver = await staffUser(db(), ['teacher'], { name: 'Sample Leaving Teacher' });
    await placeIn(leaver.staffId, 'ACADEMICS');
    await db().insert(opsStaffTasks).values({
      staffId: leaver.staffId,
      title: 'Sample worksheet',
      dueOn: '2026-10-30',
      originalDueOn: '2026-10-30',
      isSample: true,
      createdBy: hr.id,
    });
    expect((await directory(leaver)).status).toBe(403); // signed in (a teacher: no HR access)
    const res = await action(hr, leaver.staffId, 'end-employment', {
      leftOn: '2026-10-31',
      reason: 'Resigned',
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ userDisabled: true, sessionsRevoked: 1 });
    expect((await directory(leaver)).status).toBe(401); // session revoked
    const [u] = await db().select().from(users).where(eq(users.id, leaver.id));
    const [s] = await db().select().from(staffMembers).where(eq(staffMembers.id, leaver.staffId));
    const [p] = await db()
      .select()
      .from(opsStaffProfiles)
      .where(eq(opsStaffProfiles.staffId, leaver.staffId));
    expect([u!.status, s!.status, p!.employmentStatus, p!.leftOn]).toEqual([
      'disabled',
      'inactive',
      'exited',
      '2026-10-31',
    ]);
    expect(
      await db().select().from(opsStaffTasks).where(eq(opsStaffTasks.staffId, leaver.staffId)),
    ).toHaveLength(1);
    expect(
      (
        await action(hr, leaver.staffId, 'end-employment', {
          leftOn: '2026-11-01',
          reason: 'again',
        })
      ).status,
    ).toBe(409);
    // No re-activation through the old staff route, and the last day cannot be erased.
    const reopen = await callRoute(patchStaff, send(manager, 'PATCH', { status: 'active' }), {
      id: leaver.staffId,
    });
    expect(reopen.status).toBe(409);
    const erase = await callRoute(patch, send(hr, 'PATCH', { leftOn: null }), {
      id: leaver.staffId,
    });
    expect(erase.status).toBe(400);
    expect(erase.error?.message).toMatch(/last working day stays recorded/);
  });

  it('a later login-email change keeps the same staff link (the link is the user id, not the email)', async () => {
    await db()
      .update(users)
      .set({ email: 'asha-renamed@example.test' })
      .where(eq(users.id, teacher.id));
    const res = await record(hr, teacher.staffId);
    expect(res.data!.login?.email).toBe('asha-renamed@example.test');
    const linked = await db()
      .select()
      .from(staffMembers)
      .where(and(eq(staffMembers.userId, teacher.id)));
    expect(linked.map((r) => r.id)).toEqual([teacher.staffId]);
  });
});

describe('PUT /api/v1/hr/settings/[key]', () => {
  const put = (u: { token: string }, key: string, value: unknown) =>
    callRoute<{ decisionState: string }>(putSetting, send(u, 'PUT', { value }), { key });

  it.each([
    [
      'director (no ops:hr_settings:manage)',
      () => director,
      'hr.attendance.late_grace_minutes',
      { minutes: 15 },
      403,
    ],
    ['a key outside HR', () => hr, 'demo.fee', { amountInr: 1 }, 404],
    // HR must not widen its own scope; only ops:settings:manage changes who HR covers.
    ['the HR scope setting', () => hr, 'hr.staff_scope_departments', { departmentCodes: [] }, 404],
    ['an invalid value', () => hr, 'hr.attendance.late_grace_minutes', { minutes: -1 }, 400],
  ])('refuses %s', async (_n, who, key, value, status) => {
    expect((await put(who(), key, value)).status).toBe(status);
  });

  it('HR cannot change its scope through the main settings route either (403)', async () => {
    const res = await callRoute(
      putMainSetting,
      send(hr, 'PUT', { value: { departmentCodes: [] } }),
      {
        key: 'hr.staff_scope_departments',
      },
    );
    expect(res.status).toBe(403);
  });

  it('HR changes an HR setting; it stays proposed', async () => {
    const res = await put(hr, 'hr.attendance.late_grace_minutes', { minutes: 15 });
    expect(res.status).toBe(200);
    expect(res.data!.decisionState).toBe('proposed');
  });
});

describe('HR remit (fix round 1)', () => {
  const ACTIONS: [string, (id: string) => Promise<{ status: number }>][] = [
    [
      'end employment',
      (id) => action(hr, id, 'end-employment', { leftOn: '2026-10-31', reason: 'x' }),
    ],
    [
      'department',
      (id) => action(hr, id, 'department', { departmentId: dept.ACADEMICS, kind: 'additional' }),
    ],
    ['manager', (id) => action(hr, id, 'manager', { managerId: null })],
    ['profile', (id) => callRoute(patch, send(hr, 'PATCH', { title: 'X' }), { id })],
    ['private details', (id) => callRoute(putPrivate, send(hr, 'PUT', { address: 'X' }), { id })],
  ];

  it.each(['director', 'operations_manager', 'auditor', 'platform_admin', 'hr_manager'] as const)(
    'a %s (even with no department, so in scope) is outside HR remit: 403 for every change',
    async (role) => {
      const person = await staffUser(db(), [role], { name: `Sample ${role}` });
      expect((await record(hr, person.staffId)).status).toBe(200); // listed, not changeable
      for (const [, run] of ACTIONS) expect((await run(person.staffId)).status).toBe(403);
      const [u] = await db().select().from(users).where(eq(users.id, person.id));
      expect(u!.status).toBe('active');
    },
  );

  it('never your own record', async () => {
    await placeIn(hr.staffId, 'ACADEMICS');
    for (const [, run] of ACTIONS) expect((await run(hr.staffId)).status).toBe(403);
  });

  it('staff created with a department and manager start their history; the old route cannot move them', async () => {
    const res = await callRoute<{ id: StaffMemberId }>(
      createStaff,
      send(manager, 'POST', {
        fullName: 'Sample New Teacher',
        departmentId: dept.ACADEMICS,
        managerId: coordinator.staffId,
      }),
    );
    expect(res.status).toBe(201);
    await expectHistoryMatches(res.data!.id);
    await callRoute(patchStaff, send(manager, 'PATCH', { departmentId: dept.MARKETING_GROWTH }), {
      id: res.data!.id,
    });
    await expectHistoryMatches(res.data!.id);
    const [s] = await db().select().from(staffMembers).where(eq(staffMembers.id, res.data!.id));
    expect(s!.departmentId).toBe(dept.ACADEMICS);
  });

  it('profile audit stores the changed fields only, never internal notes', async () => {
    await db()
      .update(opsStaffProfiles)
      .set({ notes: 'Sample internal note' })
      .where(eq(opsStaffProfiles.staffId, teacher.staffId));
    await callRoute(patch, send(hr, 'PATCH', { title: 'Senior teacher' }), { id: teacher.staffId });
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'staff.profile_updated'),
          eq(auditEvents.entityId, teacher.staffId),
        ),
      );
    expect(JSON.stringify(rows.at(-1))).not.toContain('Sample internal note');
    expect(rows.at(-1)!.after).toEqual({ title: 'Senior teacher' });
  });

  it('directory options and assignments stay inside HR scope', async () => {
    const res = await callRoute<{ managers: { id: string }[]; departments: { code: string }[] }>(
      list,
      authedRequest(hr, URL_),
    );
    expect(res.data!.managers.map((m) => m.id)).not.toContain(manager.staffId);
    expect(res.data!.departments.map((d) => d.code).sort()).toEqual([
      'ACADEMICS',
      'MARKETING_GROWTH',
    ]);
    await expect(listTeachingAssignments(db(), hr, { staffId: manager.staffId })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('Operations managers in HR (fix round 2)', () => {
  it('see and change staff outside HR department scope (counsellors, HR managers, Leadership managers)', async () => {
    expect((await record(manager, counsellor.staffId)).status).toBe(200);
    expect(
      (
        await action(manager, counsellor.staffId, 'department', {
          departmentId: dept.ADMISSIONS_COUNSELLING,
          kind: 'remove',
        })
      ).status,
    ).toBe(400); // reached the rule (main department), not 403/404
    expect(
      (
        await action(manager, counsellor.staffId, 'department', {
          departmentId: dept.LEADERSHIP_OPERATIONS,
          kind: 'primary',
        })
      ).status,
    ).toBe(200);
    const leader = await staffUser(db(), [], { name: 'Sample Leadership Lead' });
    await placeIn(leader.staffId, 'LEADERSHIP_OPERATIONS');
    expect(
      (await action(manager, teacher.staffId, 'manager', { managerId: leader.staffId })).status,
    ).toBe(200);
    expect(
      (
        await action(manager, hr.staffId, 'department', {
          departmentId: dept.MARKETING_GROWTH,
          kind: 'primary',
        })
      ).status,
    ).toBe(200);
    // An HR-only manager still cannot reach the Leadership person.
    expect((await record(hr, leader.staffId)).status).toBe(404);
  });

  it.each([
    ['director', 403],
    ['platform_admin', 403],
    ['auditor', 200],
    ['hr_manager', 200],
  ] as const)('target holding %s: %i', async (role, status) => {
    const person = await staffUser(db(), [role], { name: `Sample target ${role}` });
    const res = await action(manager, person.staffId, 'department', {
      departmentId: dept.ACADEMICS,
      kind: 'additional',
    });
    expect(res.status).toBe(status);
  });

  it('never their own record', async () => {
    expect(
      (
        await action(manager, manager.staffId, 'department', {
          departmentId: dept.ACADEMICS,
          kind: 'additional',
        })
      ).status,
    ).toBe(403);
  });

  it('the old staff route refuses department and manager with a pointer to HR (400)', async () => {
    const res = await callRoute(patchStaff, send(manager, 'PATCH', { managerId: hr.staffId }), {
      id: teacher.staffId,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.error)).toMatch(/Change manager/);
  });
});

describe('Remit follows the right to change staff (fix round 3)', () => {
  it('an HR manager who is also auditor or director keeps the HR limits', async () => {
    const hrAuditor = await staffUser(db(), ['hr_manager', 'auditor'], {
      name: 'Sample HR Auditor',
    });
    const hrDirector = await staffUser(db(), ['hr_manager', 'director'], {
      name: 'Sample HR Director',
    });
    const otherHr = await staffUser(db(), ['hr_manager'], { name: 'Sample Other HR' });
    expect(
      (
        await action(hrAuditor, manager.staffId, 'department', {
          departmentId: dept.ACADEMICS,
          kind: 'additional',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callRoute(putPrivate, send(hrDirector, 'PUT', { address: 'X' }), {
          id: otherHr.staffId,
        })
      ).status,
    ).toBe(403);
  });

  it('the old status route runs the same check: not yourself, not a director', async () => {
    const boss = await staffUser(db(), ['director'], { name: 'Sample Director Staff' });
    for (const id of [manager.staffId, boss.staffId])
      expect(
        (await callRoute(patchStaff, send(manager, 'PATCH', { status: 'inactive' }), { id }))
          .status,
      ).toBe(403);
    expect(
      (
        await callRoute(patchStaff, send(manager, 'PATCH', { status: 'on_leave' }), {
          id: counsellor.staffId,
        })
      ).status,
    ).toBe(200);
  });
});
