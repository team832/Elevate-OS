import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  authedRequest,
  buildRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import {
  departments,
  integrationEvents,
  opsEmploymentHistory,
  staffMembers,
} from '@elevate/database';
import type { DepartmentId, StaffMemberId } from '@elevate/shared-types';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/hr/employees/route';
import { GET as getRoute, PATCH as patchRoute } from '../../src/app/api/v1/hr/employees/[id]/route';
import { GET as historyRoute } from '../../src/app/api/v1/hr/employees/[id]/history/route';
import { PATCH as patchStaff } from '../../src/app/api/v1/staff/[id]/route';
import {
  POST as assignHead,
  PATCH as endHead,
} from '../../src/app/api/v1/departments/[id]/heads/route';
import { GET as chartRoute } from '../../src/app/api/v1/organisation/chart/route';
import { createEmployee } from '../../src/server/hr/employees';
import { registerDeactivationHandler } from '../../src/server/hr/employee-core';
import { setupReference } from './fixtures';
import { employeeUser, lastAudit, uniqueWorkEmail, type EmployeeUser } from './hr-records-fixtures';

const ctx = setupTestDatabase();
let hrManager: EmployeeUser;
let hrContributor: EmployeeUser;
let deptManager: EmployeeUser;
let report: EmployeeUser;
let colleague: EmployeeUser;
let financeOfficer: EmployeeUser;
let opsManager: EmployeeUser;
let director: TestUser;
let auditor: TestUser;
let teacher: TestUser;
let deptId: DepartmentId;

const post = (u: { token: string }, json: unknown, method = 'POST') =>
  authedRequest(u, '/ops/api/v1/hr/employees', { method, json });
const get = (u: { token: string }, path = '/ops/api/v1/hr/employees') => authedRequest(u, path);

type View = { staffId: string; employeeCode: string; record: unknown; legalName?: string | null };

beforeAll(async () => {
  await setupReference(ctx.db);
  hrManager = await employeeUser(ctx.db, ['hr_manager', 'employee']);
  hrContributor = await employeeUser(ctx.db, ['hr_contributor', 'employee']);
  deptManager = await employeeUser(ctx.db, ['department_manager', 'employee']);
  report = await employeeUser(ctx.db, ['employee'], { managerId: deptManager.staffId });
  colleague = await employeeUser(ctx.db, ['employee']);
  financeOfficer = await employeeUser(ctx.db, ['finance_officer']);
  opsManager = await employeeUser(ctx.db, ['operations_manager']);
  director = await createTestUser(ctx.db, { roles: ['director'] });
  auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
  teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
  const [d] = await ctx.db.select({ id: departments.id }).from(departments).limit(1);
  deptId = d!.id;
});

describe('employee creation (OPS-030)', () => {
  it('401 signed out, 403 without permission, 400 invalid, 201 created with an EMP code', async () => {
    expect((await callRoute(createRoute, buildRequest('/x', { json: {} }))).status).toBe(401);
    expect(
      (await callRoute(createRoute, post(teacher, { fullName: 'X (fictional)' }))).status,
    ).toBe(403);
    expect(
      (await callRoute(createRoute, post(auditor, { fullName: 'X (fictional)' }))).status,
    ).toBe(403);
    expect(
      (await callRoute(createRoute, post(colleague, { fullName: 'X (fictional)' }))).status,
    ).toBe(403);
    const invalid = await callRoute(
      createRoute,
      post(hrManager, { fullName: 'X', workEmail: 'not-an-email' }),
    );
    expect(invalid.status).toBe(400);
    const missingName = await callRoute(createRoute, post(hrManager, {}));
    expect(missingName.status).toBe(400);
    const res = await callRoute<{ staffId: string; employeeCode: string }>(
      createRoute,
      post(hrManager, {
        fullName: 'Kavya Rao (fictional)',
        workEmail: uniqueWorkEmail('kavya'),
        departmentId: deptId,
        title: 'Front office coordinator',
        employmentType: 'full_time',
        employmentStartDate: '2026-11-02',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.data!.employeeCode).toMatch(/^EMP-\d{4}$/);
    const audit = await lastAudit(ctx.db, res.data!.staffId, 'employee.created');
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit!.after)).not.toMatch(/legalName|workEmail/);
  });

  it('gives unique, increasing EMP codes, also for concurrent creation in separate transactions', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        createEmployee(ctx.db, hrManager, { fullName: `Concurrent ${i} (fictional)` }),
      ),
    );
    const codes = results.map((r) => r.employeeCode);
    expect(new Set(codes).size).toBe(4);
    for (const c of codes) expect(c).toMatch(/^EMP-\d{4}$/);
  });

  it('normalises the work email and refuses a duplicate (409)', async () => {
    const email = uniqueWorkEmail('Nisha');
    const raw = `  ${email.toUpperCase()} `;
    const a = await callRoute<{ staffId: string }>(
      createRoute,
      post(hrManager, { fullName: 'Nisha (fictional)', workEmail: raw }),
    );
    expect(a.status).toBe(201);
    const view = await callRoute<{ employee: { workEmail: string } }>(getRoute, get(hrManager), {
      id: a.data!.staffId,
    });
    expect(view.data!.employee.workEmail).toBe(email.toLowerCase());
    const dup = await callRoute(
      createRoute,
      post(hrManager, { fullName: 'Other (fictional)', workEmail: email }),
    );
    expect(dup.status).toBe(409);
  });

  it('refuses an archived department and an inactive manager', async () => {
    const [arch] = await ctx.db
      .insert(departments)
      .values({ code: 'HR_ARCHIVED_TEST', name: 'Archived (test)', status: 'archived' })
      .returning();
    const res = await callRoute(
      createRoute,
      post(hrManager, { fullName: 'A (fictional)', departmentId: arch!.id }),
    );
    expect(res.status).toBe(400);
    const [inactive] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'Former (fictional)', status: 'inactive' })
      .returning();
    const res2 = await callRoute(
      createRoute,
      post(hrManager, { fullName: 'B (fictional)', managerId: inactive!.id }),
    );
    expect(res2.status).toBe(400);
  });
});

describe('reporting lines and employment history (OPS-032, OPS-033)', () => {
  it('refuses self-management and circular hierarchies', async () => {
    const top = await createEmployee(ctx.db, hrManager, { fullName: 'Top (fictional)' });
    const mid = await createEmployee(ctx.db, hrManager, {
      fullName: 'Mid (fictional)',
      managerId: top.staffId,
    });
    const self = await callRoute(patchRoute, post(hrManager, { managerId: top.staffId }, 'PATCH'), {
      id: top.staffId,
    });
    expect(self.status).toBe(409);
    const loop = await callRoute(patchRoute, post(hrManager, { managerId: mid.staffId }, 'PATCH'), {
      id: top.staffId,
    });
    expect(loop.status).toBe(409);
  });

  it('writes a history row for every tracked change, including creation and the staff screen', async () => {
    const e = await createEmployee(ctx.db, hrManager, {
      fullName: 'History (fictional)',
      departmentId: deptId,
      title: 'Counsellor',
    });
    const initial = await ctx.db
      .select()
      .from(opsEmploymentHistory)
      .where(eq(opsEmploymentHistory.staffId, e.staffId as StaffMemberId));
    expect(initial.map((r) => r.field).sort()).toEqual(
      ['department', 'employment_status', 'employment_type', 'title'].sort(),
    );
    const res = await callRoute(
      patchRoute,
      post(
        hrManager,
        {
          title: 'Senior counsellor',
          managerId: deptManager.staffId,
          employmentType: 'contract',
          employmentStatus: 'active',
          effectiveOn: '2026-10-20',
          reason: 'Probation completed',
        },
        'PATCH',
      ),
      { id: e.staffId },
    );
    expect(res.status).toBe(200);
    await callRoute(
      patchStaff,
      authedRequest(opsManager, '/x', { method: 'PATCH', json: { departmentId: null } }),
      {
        id: e.staffId,
      },
    );
    const hist = await callRoute<
      { field: string; from: string | null; to: string | null; effectiveOn: string }[]
    >(historyRoute, get(hrManager), { id: e.staffId });
    expect(hist.status).toBe(200);
    const fields = hist.data!.map((h) => h.field);
    for (const f of ['title', 'manager', 'employment_type', 'employment_status', 'department'])
      expect(fields.filter((x) => x === f).length).toBeGreaterThanOrEqual(f === 'manager' ? 1 : 2);
    expect(hist.data!.find((h) => h.field === 'manager')!.to).toBe(deptManager.displayName);
    expect(
      hist.data!.find((h) => h.field === 'title' && h.to === 'Senior counsellor')!.effectiveOn,
    ).toBe('2026-10-20');
  });

  it('validates employment-status transitions (reason required, separated is final)', async () => {
    const e = await createEmployee(ctx.db, hrManager, {
      fullName: 'Status (fictional)',
      employmentStatus: 'active',
    });
    const noReason = await callRoute(
      patchRoute,
      post(hrManager, { employmentStatus: 'on_notice' }, 'PATCH'),
      { id: e.staffId },
    );
    expect(noReason.status).toBe(400);
    const noEnd = await callRoute(
      patchRoute,
      post(hrManager, { employmentStatus: 'separated', reason: 'Resigned' }, 'PATCH'),
      {
        id: e.staffId,
      },
    );
    expect(noEnd.status).toBe(400);
    let handled = 0;
    const off = registerDeactivationHandler(async () => {
      handled += 1;
    });
    const sep = await callRoute(
      patchRoute,
      post(
        hrManager,
        { employmentStatus: 'separated', reason: 'Resigned', employmentEndDate: '2026-12-31' },
        'PATCH',
      ),
      { id: e.staffId },
    );
    off();
    expect(sep.status).toBe(200);
    expect(handled).toBe(1);
    expect((await lastAudit(ctx.db, e.staffId, 'employee.deactivated'))?.metadata).toMatchObject({
      source: 'employment_separated',
      accessRevocation: 'handled',
    });
    const back = await callRoute(
      patchRoute,
      post(hrManager, { employmentStatus: 'active', reason: 'Rehire' }, 'PATCH'),
      {
        id: e.staffId,
      },
    );
    expect(back.status).toBe(409);
  });

  it('deactivating a staff row publishes ops.employee.separated once and audits "handled"; no employee record → "not_wired"', async () => {
    const separations = (staffId: string) =>
      ctx.db
        .select()
        .from(integrationEvents)
        .where(
          and(
            eq(integrationEvents.type, 'ops.employee.separated'),
            sql`${integrationEvents.payload}->>'staffId' = ${staffId}`,
          ),
        );
    const e = await createEmployee(ctx.db, hrManager, { fullName: 'Deactivated (fictional)' });
    const [plain] = await ctx.db
      .insert(staffMembers)
      .values({ fullName: 'No HR record (fictional)' })
      .returning();
    for (const [staffId, accessRevocation, events] of [
      [e.staffId, 'handled', 1],
      [plain!.id, 'not_wired', 0],
    ] as const) {
      const res = await callRoute(
        patchStaff,
        authedRequest(opsManager, '/x', { method: 'PATCH', json: { status: 'inactive' } }),
        { id: staffId },
      );
      expect(res.status).toBe(200);
      expect((await lastAudit(ctx.db, staffId, 'employee.deactivated'))?.metadata).toMatchObject({
        source: 'staff_inactive',
        accessRevocation,
      });
      expect(await separations(staffId)).toHaveLength(events);
    }
  });

  it('keeps department-head history; one current head', async () => {
    const a = await callRoute(
      assignHead,
      authedRequest(hrManager, '/x', {
        json: { staffId: hrManager.staffId, startsOn: '2026-01-01' },
      }),
      {
        id: deptId,
      },
    );
    expect(a.status).toBe(201);
    const same = await callRoute(
      assignHead,
      authedRequest(hrManager, '/x', {
        json: { staffId: hrManager.staffId, startsOn: '2026-02-01' },
      }),
      {
        id: deptId,
      },
    );
    expect(same.status).toBe(409);
    const b = await callRoute(
      assignHead,
      authedRequest(hrManager, '/x', {
        json: { staffId: deptManager.staffId, startsOn: '2026-06-01' },
      }),
      {
        id: deptId,
      },
    );
    expect(b.status).toBe(201);
    const end = await callRoute(
      endHead,
      authedRequest(hrManager, '/x', {
        method: 'PATCH',
        json: { reason: 'Restructure', endsOn: '2026-05-01' },
      }),
      {
        id: deptId,
      },
    );
    expect(end.status).toBe(400);
    expect(
      (
        await callRoute(
          assignHead,
          authedRequest(colleague, '/x', { json: { staffId: colleague.staffId } }),
          { id: deptId },
        )
      ).status,
    ).toBe(403);
  });

  it('org chart lists reports under their manager', async () => {
    const res = await callRoute<{ id: string; depth: number }[]>(chartRoute, get(colleague));
    expect(res.status).toBe(200);
    const mgr = res.data!.find((r) => r.id === deptManager.staffId)!;
    const rep = res.data!.find((r) => r.id === report.staffId)!;
    expect(rep.depth).toBe(mgr.depth + 1);
  });
});

describe('field-level protection on employee records (OPS-037)', () => {
  const view = async (u: { token: string }, id: string) =>
    callRoute<{ employee: View; roles: string[] | null }>(getRoute, get(u), { id });

  it('HR manager sees record fields and the legal name; HR contributor sees record fields only', async () => {
    const m = await view(hrManager, report.staffId);
    expect(m.status).toBe(200);
    expect(m.data!.employee.record).not.toBeNull();
    expect('legalName' in m.data!.employee).toBe(true);
    expect(m.data!.roles).toEqual(['employee']);
    const c = await view(hrContributor, report.staffId);
    expect(c.data!.employee.record).not.toBeNull();
    expect('legalName' in c.data!.employee).toBe(false);
  });

  it('department manager sees their chain (record tier, no legal name) and nobody else', async () => {
    const inChain = await view(deptManager, report.staffId);
    expect(inChain.status).toBe(200);
    expect(inChain.data!.employee.record).not.toBeNull();
    expect('legalName' in inChain.data!.employee).toBe(false);
    // Holding `employee` too, they see colleagues at directory tier only.
    const outside = await view(deptManager, colleague.staffId);
    expect(outside.status).toBe(200);
    expect(outside.data!.employee.record).toBeNull();
    // A department manager WITHOUT the employee role sees only their chain.
    const onlyMgr = await employeeUser(ctx.db, ['department_manager']);
    const onlyReport = await employeeUser(ctx.db, ['employee'], { managerId: onlyMgr.staffId });
    expect((await view(onlyMgr, colleague.staffId)).status).toBe(403);
    expect((await view(onlyMgr, onlyReport.staffId)).data!.employee.record).not.toBeNull();
    const list = await callRoute<{ items: View[]; recordTier: boolean }>(listRoute, get(onlyMgr));
    const ids = list.data!.items.map((i) => i.staffId).sort();
    expect(ids).toEqual([onlyMgr.staffId, onlyReport.staffId].sort());
    expect(list.data!.recordTier).toBe(true);
  });

  it('an employee sees their own record and legal name, but only directory fields of colleagues', async () => {
    const self = await view(report, report.staffId);
    expect(self.data!.employee.record).not.toBeNull();
    expect('legalName' in self.data!.employee).toBe(true);
    const other = await view(report, colleague.staffId);
    expect(other.status).toBe(200);
    expect(other.data!.employee.record).toBeNull();
    expect('legalName' in other.data!.employee).toBe(false);
    expect(other.data!.roles).toBeNull();
    const list = await callRoute<{ items: View[]; recordTier: boolean }>(listRoute, get(report));
    expect(list.data!.recordTier).toBe(false);
    const colleagueRow = list.data!.items.find((i) => i.staffId === colleague.staffId)!;
    expect(colleagueRow.record).toBeNull();
    for (const row of list.data!.items.filter((i) => i.staffId !== report.staffId))
      expect('legalName' in row).toBe(false);
    const filtered = await callRoute(
      listRoute,
      get(report, '/ops/api/v1/hr/employees?status=on_notice'),
    );
    expect(filtered.status).toBe(403);
    const sorted = await callRoute(
      listRoute,
      get(report, '/ops/api/v1/hr/employees?sort=start_date'),
    );
    expect(sorted.status).toBe(403);
  });

  it('director, auditor and operations manager: record tier, never the legal name; finance: directory only', async () => {
    for (const u of [director, auditor, opsManager]) {
      const r = await view(u, report.staffId);
      expect(r.status).toBe(200);
      expect(r.data!.employee.record).not.toBeNull();
      expect('legalName' in r.data!.employee).toBe(false);
    }
    const f = await view(financeOfficer, report.staffId);
    expect(f.data!.employee.record).toBeNull();
    expect('legalName' in f.data!.employee).toBe(false);
    expect(
      (await callRoute(historyRoute, get(financeOfficer), { id: report.staffId })).status,
    ).toBe(403);
    expect((await callRoute(historyRoute, get(colleague), { id: report.staffId })).status).toBe(
      403,
    );
    expect((await callRoute(listRoute, get(teacher))).status).toBe(403);
  });

  it('directory search, filter, sort and pagination run on the server', async () => {
    await createEmployee(ctx.db, hrManager, {
      fullName: 'Zubin Searchable (fictional)',
      workLocation: 'Jaipur annexe',
    });
    const q = await callRoute<{ items: View[]; total: number }>(
      listRoute,
      get(hrManager, '/ops/api/v1/hr/employees?q=searchable'),
    );
    expect(q.data!.total).toBe(1);
    const loc = await callRoute<{ items: View[] }>(
      listRoute,
      get(hrManager, '/ops/api/v1/hr/employees?location=jaipur'),
    );
    expect(loc.data!.items).toHaveLength(1);
    const page = await callRoute<{ items: View[]; total: number; pageSize: number }>(
      listRoute,
      get(hrManager, '/ops/api/v1/hr/employees?pageSize=2&page=2&sort=code&dir=desc'),
    );
    expect(page.data!.items).toHaveLength(2);
    expect(page.data!.total).toBeGreaterThan(4);
    const bad = await callRoute(listRoute, get(hrManager, '/ops/api/v1/hr/employees?pageSize=500'));
    expect(bad.status).toBe(400);
  });
});
