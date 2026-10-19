import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildRequest, setupTestDatabase } from '@elevate/testing';
import {
  auditEvents,
  integrationEvents,
  notifications,
  opsAssetAssignments,
  opsEmployeeRecords,
  opsEmploymentHistory,
  opsLifecycleItems,
  opsTasks,
  staffMembers,
} from '@elevate/database';
import { addDays, istToday } from '../../src/domain/dates';
import {
  GET as listCases,
  POST as createCase,
} from '../../src/app/api/v1/hr/lifecycle-cases/route';
import { GET as getCase } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/route';
import { PATCH as updateItem } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/items/[itemId]/route';
import { POST as transfer } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/items/[itemId]/transfer/route';
import { POST as approve } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/approve/route';
import { POST as cancel } from '../../src/app/api/v1/hr/lifecycle-cases/[id]/cancel/route';
import { POST as runJob } from '../../src/app/api/v1/hr/lifecycle-cases/jobs/route';
import { runLifecycleReminders } from '../../src/server/hr/onboarding';
import { publishSeparation, runSeparations } from '../../src/server/hr/offboarding';
import { withTransaction } from '@elevate/server-kit';
import {
  assignAsset,
  call,
  employeeWithLogin,
  get,
  json,
  setupCast,
  type Cast,
} from './hr-lifecycle-fixtures';
import { staffUser } from './fixtures';

const ctx = setupTestDatabase();
let cast: Cast;

beforeAll(async () => {
  cast = await setupCast(ctx.db);
});

type Item = { id: string; kind: string; status: string; required: boolean; itemKey: string };
type Detail = {
  case: { id: string; status: string; separationReason: string | null; reasonHidden: boolean };
  items: Item[];
  gaps: string[];
  canApprove: boolean;
};

const detail = async (who: { token: string }, id: string) =>
  call<Detail>(getCase, get(who), { id });

async function resolveAll(id: string, skipKinds: string[] = []) {
  const d = (await detail(cast.hrManager, id)).data!;
  for (const i of d.items) {
    if (skipKinds.includes(i.kind) || i.status === 'done') continue;
    const body =
      i.kind === 'final_settlement'
        ? { status: 'done', evidence: 'FS-REF-0001 (fictional)' }
        : { status: 'not_applicable', notes: 'Not needed in this test (fictional)' };
    const r = await call(updateItem, json(cast.hrManager, body, 'PATCH'), { id, itemId: i.id });
    expect(r.status, `${i.kind}: ${JSON.stringify(r.error)}`).toBe(200);
  }
}

describe('onboarding cases', () => {
  it('gates completion on required items and needs an approver who is not the employee', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'onboarding', roles: ['hr_manager'] });
    expect(
      (
        await call(
          createCase,
          buildRequest('/ops/api/v1/hr/lifecycle-cases', {
            json: { kind: 'onboarding', staffId: emp.staffId },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await call(createCase, json(cast.deptManager, { kind: 'onboarding', staffId: emp.staffId })))
        .status,
    ).toBe(403);
    expect((await call(createCase, json(cast.hrManager, { kind: 'onboarding' }))).status).toBe(400);
    const c = await call<{ id: string; code: string }>(
      createCase,
      json(cast.hrManager, { kind: 'onboarding', staffId: emp.staffId }),
    );
    expect(c.status).toBe(201);
    expect(c.data!.code).toMatch(/^HRC-\d{5}$/);
    expect(
      (await call(createCase, json(cast.hrManager, { kind: 'onboarding', staffId: emp.staffId })))
        .status,
    ).toBe(409);
    const id = c.data!.id;
    const blocked = await call(approve, json(cast.hrManager, { confirm: true }), { id });
    expect(blocked.status).toBe(409);
    // A required item cannot be skipped silently.
    const first = (await detail(cast.hrManager, id)).data!.items.find((i) => i.required)!;
    expect(
      (
        await call(updateItem, json(cast.hrManager, { status: 'not_applicable' }, 'PATCH'), {
          id,
          itemId: first.id,
        })
      ).status,
    ).toBe(400);
    await resolveAll(id);
    expect((await detail(cast.hrManager, id)).data!.gaps).toEqual([]);
    // The employee (who is an HR manager here) cannot approve their own onboarding.
    expect((await call(approve, json(emp, { confirm: true }), { id })).status).toBe(403);
    expect((await call(approve, json(cast.hrContributor, { confirm: true }), { id })).status).toBe(
      403,
    );
    expect((await call(approve, json(cast.hrManager, {}), { id })).status).toBe(400);
    const ok = await call<{ status: string }>(
      approve,
      json(cast.hrManager, { confirm: true, comment: 'All set' }),
      { id },
    );
    expect(ok.status).toBe(200);
    expect(ok.data!.status).toBe('completed');
    const [rec] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, emp.staffId));
    expect(rec!.employmentStatus).toBe('active');
    const history = await ctx.db
      .select()
      .from(opsEmploymentHistory)
      .where(eq(opsEmploymentHistory.staffId, emp.staffId));
    expect(history.some((h) => h.field === 'employment_status' && h.toValue === 'active')).toBe(
      true,
    );
  });

  it('department managers read cases in their reporting chain only', async () => {
    const report = await employeeWithLogin(ctx.db, {
      status: 'onboarding',
      managerId: cast.deptManager.staffId,
    });
    const stranger = await employeeWithLogin(ctx.db, { status: 'onboarding' });
    const a = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, { kind: 'onboarding', staffId: report.staffId }),
    );
    const b = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, { kind: 'onboarding', staffId: stranger.staffId }),
    );
    expect((await detail(cast.deptManager, a.data!.id)).status).toBe(200);
    expect((await detail(cast.deptManager, b.data!.id)).status).toBe(403);
    const list = await call<{ rows: { id: string }[] }>(
      listCases,
      get(cast.deptManager, '/ops/api/v1/hr/lifecycle-cases'),
    );
    const ids = list.data!.rows.map((r) => r.id);
    expect(ids).toContain(a.data!.id);
    expect(ids).not.toContain(b.data!.id);
    expect((await detail(cast.recruiter, a.data!.id)).status).toBe(403);
  });

  it('overdue items get one reminder per IST day', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'onboarding' });
    const c = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, { kind: 'onboarding', staffId: emp.staffId }),
    );
    const item = (await detail(cast.hrManager, c.data!.id)).data!.items[0]!;
    await call(
      updateItem,
      json(
        cast.hrManager,
        { dueDate: addDays(istToday(new Date()), -3), assigneeStaffId: emp.staffId },
        'PATCH',
      ),
      { id: c.data!.id, itemId: item.id },
    );
    const mine = () =>
      ctx.db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.userId, emp.id), eq(notifications.kind, 'lifecycle.item_overdue')),
        );
    const first = await runLifecycleReminders(ctx.db);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    // The fixture start date is in the past, so every item assigned to the employee is overdue.
    const afterFirst = (await mine()).length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    const again = await runLifecycleReminders(ctx.db);
    expect(again.overdueItems).toBe(0);
    expect(await mine()).toHaveLength(afterFirst);
    // Next IST day: reminded again.
    const tomorrow = await runLifecycleReminders(ctx.db, new Date(Date.now() + 86_400_000));
    expect(tomorrow.overdueItems).toBeGreaterThanOrEqual(1);
  });
});

describe('offboarding and separation', () => {
  it('generates asset returns and ownership transfers; assets complete from the register', async () => {
    const emp = await employeeWithLogin(ctx.db, {
      status: 'active',
      managerId: cast.deptManager.staffId,
    });
    const { assignment } = await assignAsset(ctx.db, emp.staffId, cast.hrManager.id);
    const [task] = await ctx.db
      .insert(opsTasks)
      .values({
        code: `TSK-${String(90000 + Math.floor(Math.random() * 9999)).padStart(5, '0')}`,
        title: 'Weekly timetable (fictional)',
        ownerStaffId: emp.staffId,
        createdBy: cast.hrManager.id,
      })
      .returning();
    const lwd = addDays(istToday(new Date()), 5);
    expect(
      (
        await call(
          createCase,
          json(cast.hrManager, {
            kind: 'offboarding',
            staffId: emp.staffId,
            separationType: 'resignation',
            noticeDate: addDays(lwd, 1),
            lastWorkingDay: lwd,
          }),
        )
      ).status,
    ).toBe(400);
    const c = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, {
        kind: 'offboarding',
        staffId: emp.staffId,
        separationType: 'resignation',
        noticeDate: istToday(new Date()),
        lastWorkingDay: lwd,
        reason: 'Moving cities (fictional)',
      }),
    );
    expect(c.status).toBe(201);
    const id = c.data!.id;
    const d = (await detail(cast.hrManager, id)).data!;
    expect(d.items.filter((i) => i.kind === 'asset_return')).toHaveLength(1);
    expect(d.items.find((i) => i.kind === 'ownership_transfer')?.itemKey).toBe(
      `transfer:task:${task!.id}`,
    );
    expect(d.items.some((i) => i.kind === 'access_revocation')).toBe(true);
    // Reason restricted: HR sees it, the department manager and the auditor do not.
    expect(d.case.separationReason).toBe('Moving cities (fictional)');
    const dm = (await detail(cast.deptManager, id)).data!;
    expect(dm.case.separationReason).toBeNull();
    expect(dm.case.reasonHidden).toBe(true);
    expect((await detail(cast.auditor, id)).data!.case.separationReason).toBeNull();
    const list = await call<{ rows: Record<string, unknown>[] }>(
      listCases,
      get(cast.hrManager, '/ops/api/v1/hr/lifecycle-cases?kind=offboarding'),
    );
    expect(JSON.stringify(list.data)).not.toContain('Moving cities');
    const [audit] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, 'lifecycle_case.opened')));
    expect(JSON.stringify(audit)).not.toContain('Moving cities');

    const asset = d.items.find((i) => i.kind === 'asset_return')!;
    expect(
      (
        await call(updateItem, json(cast.hrManager, { status: 'done' }, 'PATCH'), {
          id,
          itemId: asset.id,
        })
      ).status,
    ).toBe(409);
    await ctx.db
      .update(opsAssetAssignments)
      .set({ returnedAt: new Date(), returnedBy: cast.hrManager.id })
      .where(eq(opsAssetAssignments.id, assignment.id));
    expect(
      (await detail(cast.hrManager, id)).data!.items.find((i) => i.id === asset.id)!.status,
    ).toBe('done');

    const transferItem = d.items.find((i) => i.kind === 'ownership_transfer')!;
    expect(
      (
        await call(transfer, json(cast.hrManager, { targetStaffId: emp.staffId }), {
          id,
          itemId: transferItem.id,
        })
      ).status,
    ).toBe(400);
    const t = await call(
      transfer,
      json(cast.hrManager, { targetStaffId: cast.deptManager.staffId }),
      { id, itemId: transferItem.id },
    );
    expect(t.status).toBe(200);
    const [moved] = await ctx.db.select().from(opsTasks).where(eq(opsTasks.id, task!.id));
    expect(moved!.ownerStaffId).toBe(cast.deptManager.staffId);
  });

  it('approval puts the employee on notice; separation publishes one event and history survives', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'active', roles: ['hr_manager'] });
    const lwd = addDays(istToday(new Date()), 3);
    const c = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, {
        kind: 'offboarding',
        staffId: emp.staffId,
        separationType: 'contract_end',
        lastWorkingDay: lwd,
      }),
    );
    const id = c.data!.id;
    await resolveAll(id, ['access_revocation']);
    expect((await call(approve, json(emp, { confirm: true }), { id })).status).toBe(403);
    expect((await call(approve, json(cast.deptManager, { confirm: true }), { id })).status).toBe(
      403,
    );
    const ok = await call<{ status: string }>(approve, json(cast.director, { confirm: true }), {
      id,
    });
    expect(ok.status).toBe(200);
    expect(ok.data!.status).toBe('approved');
    const [onNotice] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, emp.staffId));
    expect(onNotice!.employmentStatus).toBe('on_notice');

    // Not due yet: nothing applied.
    expect((await runSeparations(ctx.db, lwd)).applied).toBe(0);
    const day = addDays(lwd, 1);
    expect((await runSeparations(ctx.db, day)).applied).toBe(1);
    expect((await runSeparations(ctx.db, day)).applied).toBe(0);
    const events = await ctx.db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.idempotencyKey, `separation:${id}`));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('ops.employee.separated');
    expect((events[0]!.payload as { userId: string }).userId).toBe(emp.id);
    expect(JSON.stringify(events[0]!.payload)).not.toContain('contract_end');
    // Re-publishing (e.g. from another path) stores nothing new.
    const again = await withTransaction(ctx.db, (tx) =>
      publishSeparation(tx, {
        staffId: emp.staffId,
        lastWorkingDay: lwd,
        separatedAt: new Date(),
        caseId: id,
      }),
    );
    expect(again.created).toBe(false);
    const [sep] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, emp.staffId));
    expect(sep!.employmentStatus).toBe('separated');
    expect(sep!.employmentEndDate).toBe(lwd);
    const [staff] = await ctx.db
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.id, emp.staffId));
    expect(staff!.status).toBe('inactive');
    // History is kept: employment history rows, the case and its audit trail all remain.
    const history = await ctx.db
      .select()
      .from(opsEmploymentHistory)
      .where(eq(opsEmploymentHistory.staffId, emp.staffId));
    expect(history.map((h) => h.toValue)).toEqual(
      expect.arrayContaining(['on_notice', 'separated']),
    );
    expect((await detail(cast.hrManager, id)).data!.case.status).toBe('completed');
    const trail = await ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(trail.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'lifecycle_case.opened',
        'lifecycle_case.approved',
        'lifecycle_case.separation_applied',
      ]),
    );
    const access = (await detail(cast.hrManager, id)).data!.items.find(
      (i) => i.kind === 'access_revocation',
    )!;
    expect(access.status).toBe('pending');
  });

  it('an employee without a login completes access revocation at separation; jobs route is guarded', async () => {
    const plain = await staffUser(ctx.db, [], { name: 'No-login employee (fictional)' });
    await ctx.db
      .update(staffMembers)
      .set({ userId: null })
      .where(eq(staffMembers.id, plain.staffId));
    await ctx.db
      .insert(opsEmployeeRecords)
      .values({ staffId: plain.staffId, employeeCode: 'EMP-8801', employmentStatus: 'active' });
    const past = addDays(istToday(new Date()), -1);
    const c = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, {
        kind: 'offboarding',
        staffId: plain.staffId,
        separationType: 'retirement',
        lastWorkingDay: past,
      }),
    );
    await resolveAll(c.data!.id, ['access_revocation']);
    const ok = await call<{ status: string }>(approve, json(cast.hrManager, { confirm: true }), {
      id: c.data!.id,
    });
    expect(ok.data!.status).toBe('completed');
    const items = await ctx.db
      .select()
      .from(opsLifecycleItems)
      .where(
        and(
          eq(opsLifecycleItems.caseId, c.data!.id as never),
          eq(opsLifecycleItems.kind, 'access_revocation'),
        ),
      );
    expect(items[0]!.status).toBe('done');
    expect((await call(runJob, json(cast.hrContributor, { job: 'separations' }))).status).toBe(403);
    expect((await call(runJob, json(cast.hrManager, { job: 'nope' }))).status).toBe(400);
    expect((await call(runJob, json(cast.hrManager, { job: 'separations' }))).status).toBe(200);
  });

  it('an approved separation can be retracted before it applies', async () => {
    const emp = await employeeWithLogin(ctx.db, { status: 'active' });
    const c = await call<{ id: string }>(
      createCase,
      json(cast.hrManager, {
        kind: 'offboarding',
        staffId: emp.staffId,
        separationType: 'resignation',
        lastWorkingDay: addDays(istToday(new Date()), 10),
      }),
    );
    await resolveAll(c.data!.id, ['access_revocation']);
    await call(approve, json(cast.hrManager, { confirm: true }), { id: c.data!.id });
    expect(
      (
        await call(cancel, json(cast.hrContributor, { reason: 'Resignation withdrawn' }), {
          id: c.data!.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(cancel, json(cast.hrManager, { reason: 'Resignation withdrawn' }), {
          id: c.data!.id,
        })
      ).status,
    ).toBe(200);
    const [rec] = await ctx.db
      .select()
      .from(opsEmployeeRecords)
      .where(eq(opsEmployeeRecords.staffId, emp.staffId));
    expect(rec!.employmentStatus).toBe('active');
  });
});
