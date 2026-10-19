import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  authedRequest,
  callRoute,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { opsCompensationRecords } from '@elevate/database';
import { GET as listComp, POST as draftComp } from '../../src/app/api/v1/hr/compensation/route';
import { PATCH as patchComp } from '../../src/app/api/v1/hr/compensation/[id]/route';
import { POST as approveComp } from '../../src/app/api/v1/hr/compensation/[id]/approve/route';
import { POST as cancelComp } from '../../src/app/api/v1/hr/compensation/[id]/cancel/route';
import { GET as exportComp } from '../../src/app/api/v1/hr/compensation/export/route';
import { GET as listAssets, POST as createAsset } from '../../src/app/api/v1/hr/assets/route';
import { GET as getAsset, PATCH as patchAsset } from '../../src/app/api/v1/hr/assets/[id]/route';
import { POST as assignAsset } from '../../src/app/api/v1/hr/assets/[id]/assign/route';
import { POST as returnAsset } from '../../src/app/api/v1/hr/assets/[id]/return/route';
import { GET as employeeAssets } from '../../src/app/api/v1/hr/employees/[id]/assets/route';
import { PATCH as patchEmployee } from '../../src/app/api/v1/hr/employees/[id]/route';
import { setupReference } from './fixtures';
import { employeeUser, lastAudit, type EmployeeUser } from './hr-records-fixtures';

const ctx = setupTestDatabase();
const NO_ID = '00000000-0000-4000-8000-000000000000';
let hrManager: EmployeeUser;
let finance: EmployeeUser;
let finance2: EmployeeUser;
let deptManager: EmployeeUser;
let report: EmployeeUser;
let colleague: EmployeeUser;
let opsManager: EmployeeUser;
let hrContributor: EmployeeUser;
let others: TestUser[];

const req = (
  u: { token: string },
  json?: unknown,
  method = json === undefined ? 'GET' : 'POST',
  path = '/ops/api/v1/hr/x',
) => authedRequest(u, path, { method, json });

beforeAll(async () => {
  await setupReference(ctx.db);
  hrManager = await employeeUser(ctx.db, ['hr_manager', 'employee']);
  finance = await employeeUser(ctx.db, ['finance_officer']);
  finance2 = await employeeUser(ctx.db, ['finance_officer']);
  deptManager = await employeeUser(ctx.db, ['department_manager', 'employee']);
  report = await employeeUser(ctx.db, ['employee'], { managerId: deptManager.staffId });
  colleague = await employeeUser(ctx.db, ['employee']);
  opsManager = await employeeUser(ctx.db, ['operations_manager']);
  hrContributor = await employeeUser(ctx.db, ['hr_contributor']);
  others = await Promise.all(
    (
      [
        'teacher',
        'admissions_counsellor',
        'auditor',
        'director',
        'academic_coordinator',
        'recruiter',
      ] as const
    ).map((r) => createTestUser(ctx.db, { roles: [r] })),
  );
});

describe('compensation records (OPS-036) — records only, not payroll', () => {
  it('is never visible to managers, employees, auditor, director, teacher, counsellor or ops manager', async () => {
    for (const u of [deptManager, report, colleague, opsManager, hrContributor, ...others]) {
      expect((await callRoute(listComp, req(u))).status).toBe(403);
      expect((await callRoute(exportComp, req(u))).status).toBe(403);
      const approve = req(u, { confirm: true });
      expect((await callRoute(approveComp, approve, { id: NO_ID })).status).toBe(403);
    }
    expect((await callRoute(listComp, req(hrManager))).status).toBe(200);
    expect((await callRoute(listComp, req(finance))).status).toBe(200);
  });

  it('refuses deductions/statutory components, mismatched totals and one’s own compensation', async () => {
    const base = { staffId: report.staffId, basis: 'monthly', effectiveFrom: '2026-04-01' };
    const tax = await callRoute(
      draftComp,
      req(finance, {
        ...base,
        amountPaise: 100,
        components: [{ kind: 'earning', label: 'TDS', amountPaise: 100 }],
      }),
    );
    expect(tax.status).toBe(400);
    const deduction = await callRoute(
      draftComp,
      req(finance, {
        ...base,
        amountPaise: 100,
        components: [{ kind: 'deduction', label: 'X', amountPaise: 100 }],
      }),
    );
    expect(deduction.status).toBe(400);
    const mismatch = await callRoute(
      draftComp,
      req(finance, {
        ...base,
        amountPaise: 5000000,
        components: [{ kind: 'earning', label: 'Basic', amountPaise: 4000000 }],
      }),
    );
    expect(mismatch.status).toBe(400);
    const fractional = await callRoute(draftComp, req(finance, { ...base, amountPaise: 10.5 }));
    expect(fractional.status).toBe(400);
    const self = await callRoute(
      draftComp,
      req(finance, { ...base, staffId: finance.staffId, amountPaise: 100 }),
    );
    expect(self.status).toBe(403);
  });

  it('approval by a different person; one approved record; later approval supersedes; audit has no amounts', async () => {
    const d1 = await callRoute<{ id: string }>(
      draftComp,
      req(finance, {
        staffId: report.staffId,
        basis: 'monthly',
        amountPaise: 4500000,
        components: [
          { kind: 'earning', label: 'Basic', amountPaise: 4000000 },
          { kind: 'allowance', label: 'Travel allowance', amountPaise: 500000 },
        ],
        effectiveFrom: '2026-04-01',
      }),
    );
    expect(d1.status).toBe(201);
    expect(
      (await callRoute(approveComp, req(finance, { confirm: true }), { id: d1.data!.id })).status,
    ).toBe(403);
    expect((await callRoute(approveComp, req(finance2, {}), { id: d1.data!.id })).status).toBe(400);
    const ok = await callRoute(approveComp, req(finance2, { confirm: true }), { id: d1.data!.id });
    expect(ok.status).toBe(200);
    expect(
      (await callRoute(patchComp, req(finance, { amountPaise: 1 }, 'PATCH'), { id: d1.data!.id }))
        .status,
    ).toBe(409);
    const audit = await lastAudit(ctx.db, d1.data!.id, 'compensation.approved');
    expect(JSON.stringify(audit)).not.toMatch(/4500000|4000000|Basic/);

    const earlier = await callRoute<{ id: string }>(
      draftComp,
      req(finance, {
        staffId: report.staffId,
        basis: 'monthly',
        amountPaise: 4000000,
        effectiveFrom: '2026-03-01',
      }),
    );
    expect(
      (await callRoute(approveComp, req(finance2, { confirm: true }), { id: earlier.data!.id }))
        .status,
    ).toBe(409);
    expect(
      (
        await callRoute(cancelComp, req(finance, { reason: 'Wrong date' }), {
          id: earlier.data!.id,
        })
      ).status,
    ).toBe(200);

    const d2 = await callRoute<{ id: string }>(
      draftComp,
      req(hrManager, {
        staffId: report.staffId,
        basis: 'monthly',
        amountInr: '50000.00',
        effectiveFrom: '2026-10-01',
      }),
    );
    expect(d2.status).toBe(201);
    expect(
      (
        await callRoute(
          draftComp,
          req(hrManager, {
            staffId: report.staffId,
            basis: 'monthly',
            amountInr: '1.234',
            effectiveFrom: '2026-10-01',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await callRoute(
          draftComp,
          req(hrManager, {
            staffId: report.staffId,
            basis: 'monthly',
            effectiveFrom: '2026-10-01',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await callRoute(approveComp, req(finance, { confirm: true }), { id: d2.data!.id })).status,
    ).toBe(200);
    const approved = await ctx.db
      .select()
      .from(opsCompensationRecords)
      .where(
        and(
          eq(opsCompensationRecords.staffId, report.staffId),
          eq(opsCompensationRecords.status, 'approved'),
        ),
      );
    expect(approved).toHaveLength(1);
    const [first] = await ctx.db
      .select()
      .from(opsCompensationRecords)
      .where(eq(opsCompensationRecords.id, d1.data!.id as never));
    expect(first).toMatchObject({ status: 'superseded', effectiveTo: '2026-09-30' });
  });

  it('the employee themself cannot approve their own pay even with permission', async () => {
    const d = await callRoute<{ id: string }>(
      draftComp,
      req(finance, {
        staffId: hrManager.staffId,
        basis: 'annual',
        amountPaise: 90000000,
        effectiveFrom: '2026-04-01',
      }),
    );
    expect(
      (await callRoute(approveComp, req(hrManager, { confirm: true }), { id: d.data!.id })).status,
    ).toBe(403);
  });

  it('export: finance officer only (HR manager lacks export); CSV of the terms effective on the date; audited reference', async () => {
    expect((await callRoute(exportComp, req(hrManager))).status).toBe(403);
    const res = await exportComp(
      req(finance, undefined, 'GET', '/ops/api/v1/hr/compensation/export?asOf=2026-05-15'),
      {
        params: Promise.resolve({}),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const ref = res.headers.get('x-export-reference')!;
    expect(ref).toMatch(/^CMPX-20260515-[0-9A-F]{6}$/);
    const csv = await res.text();
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('employee_code');
    const row = lines.find((l) => l.includes(report.employeeCode))!;
    expect(row).toContain('4500000');
    expect(row).toContain('45000.00');
    const later = await exportComp(
      req(finance, undefined, 'GET', '/ops/api/v1/hr/compensation/export?asOf=2026-11-01'),
      { params: Promise.resolve({}) },
    );
    expect(
      (await later.text()).split('\r\n').find((l) => l.includes(report.employeeCode)),
    ).toContain('5000000');
    const bad = await callRoute(
      exportComp,
      req(finance, undefined, 'GET', '/ops/api/v1/hr/compensation/export?asOf=2026-13-01'),
    );
    expect(bad.status).toBe(400);
  });
});

describe('assets (OPS-038)', () => {
  let assetId: string;

  it('registers, assigns once, refuses a second open assignment and separated employees', async () => {
    expect(
      (await callRoute(createAsset, req(report, { name: 'Laptop', category: 'Laptop' }))).status,
    ).toBe(403);
    const a = await callRoute<{ id: string; code: string }>(
      createAsset,
      req(hrContributor, {
        name: 'Laptop (test)',
        category: 'Laptop',
        serialNumber: `SN-${Date.now()}`,
      }),
    );
    expect(a.status).toBe(201);
    expect(a.data!.code).toMatch(/^AST-\d{5}$/);
    assetId = a.data!.id;
    expect(
      (
        await callRoute(
          assignAsset,
          req(hrContributor, {
            staffId: report.staffId,
            assignedOn: '2026-10-01',
            expectedReturnOn: '2026-09-01',
          }),
          { id: assetId },
        )
      ).status,
    ).toBe(409);
    const ok = await callRoute(
      assignAsset,
      req(hrContributor, { staffId: report.staffId, assignedOn: '2026-10-01' }),
      { id: assetId },
    );
    expect(ok.status).toBe(201);
    expect(
      (
        await callRoute(assignAsset, req(hrContributor, { staffId: colleague.staffId }), {
          id: assetId,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await callRoute(patchAsset, req(hrContributor, { status: 'retired' }, 'PATCH'), {
          id: assetId,
        })
      ).status,
    ).toBe(409);

    const b = await callRoute<{ id: string }>(
      createAsset,
      req(hrContributor, { name: 'Phone (test)', category: 'Phone' }),
    );
    await callRoute(
      patchEmployee,
      req(
        hrManager,
        {
          employmentStatus: 'separated',
          reason: 'Contract ended',
          employmentEndDate: '2026-10-15',
        },
        'PATCH',
      ),
      {
        id: colleague.staffId,
      },
    );
    expect(
      (
        await callRoute(assignAsset, req(hrContributor, { staffId: colleague.staffId }), {
          id: b.data!.id,
        })
      ).status,
    ).toBe(409);
  });

  it('records the return with its condition and keeps history per asset and per employee', async () => {
    const r = await callRoute(
      returnAsset,
      req(hrContributor, { condition: 'damaged', notes: 'Cracked hinge' }),
      { id: assetId },
    );
    expect(r.status).toBe(200);
    expect(
      (await callRoute(returnAsset, req(hrContributor, { condition: 'good' }), { id: assetId }))
        .status,
    ).toBe(409);
    const detail = await callRoute<{
      asset: { status: string };
      history: { conditionOnReturn: string }[];
    }>(getAsset, req(hrManager), { id: assetId });
    expect(detail.data!.asset.status).toBe('in_repair');
    expect(detail.data!.history[0]!.conditionOnReturn).toBe('damaged');
    const mine = await callRoute<{ assetId: string }[]>(employeeAssets, req(report), {
      id: report.staffId,
    });
    expect(mine.data!.map((m) => m.assetId)).toContain(assetId);
    expect((await callRoute(employeeAssets, req(colleague), { id: report.staffId })).status).toBe(
      403,
    );
    expect((await callRoute(employeeAssets, req(deptManager), { id: report.staffId })).status).toBe(
      200,
    );
    const theirs = await callRoute<{ items: { id: string }[] }>(listAssets, req(colleague));
    expect(theirs.data!.items.map((i) => i.id)).not.toContain(assetId);
    expect((await callRoute(getAsset, req(colleague), { id: assetId })).status).toBe(403);
  });
});
