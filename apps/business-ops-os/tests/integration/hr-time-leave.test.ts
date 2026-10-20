import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { opsLeaveLedgerEntries } from '@elevate/database';
import { POST as createShift } from '../../src/app/api/v1/hr/shifts/route';
import { PATCH as patchShift } from '../../src/app/api/v1/hr/shifts/[id]/route';
import {
  POST as assignShift,
  GET as listAssignments,
} from '../../src/app/api/v1/hr/shift-assignments/route';
import { PATCH as patchAssignment } from '../../src/app/api/v1/hr/shift-assignments/[id]/route';
import { GET as listHolidays, POST as createHoliday } from '../../src/app/api/v1/hr/holidays/route';
import { PATCH as patchHoliday } from '../../src/app/api/v1/hr/holidays/[id]/route';
import { POST as createLeaveType } from '../../src/app/api/v1/hr/leave-types/route';
import {
  GET as listLeave,
  POST as requestLeave,
} from '../../src/app/api/v1/hr/leave-requests/route';
import { GET as getLeave } from '../../src/app/api/v1/hr/leave-requests/[id]/route';
import { POST as decideLeave } from '../../src/app/api/v1/hr/leave-requests/[id]/decision/route';
import { POST as cancelLeave } from '../../src/app/api/v1/hr/leave-requests/[id]/cancel/route';
import { GET as availability } from '../../src/app/api/v1/hr/leave-requests/availability/route';
import { GET as balances, POST as ledgerEntry } from '../../src/app/api/v1/hr/leave-balances/route';
import { POST as manualEntry } from '../../src/app/api/v1/hr/attendance/route';
import { GET as timesheets } from '../../src/app/api/v1/hr/timesheets/route';
import { GET as exportCsv } from '../../src/app/api/v1/hr/timesheets/export/route';
import { updateSetting } from '../../src/server/settings';
import { hrTimeMetrics } from '../../src/server/reports/hr-time-metrics';
import { auditFor, employee, get, post, statusOf, type Employee } from './hr-time-fixtures';

const ctx = setupTestDatabase();
let hr: Employee;
let opsManager: Employee;
let manager: Employee;
let otherManager: Employee;
let emp: Employee;
let emp2: Employee;
let outsider: Employee;
let dayId: string;
let eveningId: string;
let casualId: string;
let sickId: string;

type Leave = { id: string; code: string; status: string; workingDays: string | number };

beforeAll(async () => {
  hr = await employee(ctx.db, ['hr_manager']);
  opsManager = await employee(ctx.db, ['operations_manager']);
  manager = await employee(ctx.db, ['department_manager', 'employee']);
  otherManager = await employee(ctx.db, ['department_manager', 'employee']);
  emp = await employee(ctx.db, ['employee'], { managerId: manager.staffId, workLocation: 'Sikar' });
  emp2 = await employee(ctx.db, ['employee'], { managerId: manager.staffId });
  outsider = await employee(ctx.db, ['employee'], { managerId: otherManager.staffId });
  const day = await callRoute<{ id: string }>(
    createShift,
    post(hr, {
      code: 'DAY',
      name: 'Day (proposed)',
      startTime: '09:00',
      endTime: '17:30',
      unpaidBreakMinutes: 30,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
    }),
  );
  dayId = day.data!.id;
  const eve = await callRoute<{ id: string }>(
    createShift,
    post(hr, {
      code: 'EVE',
      name: 'Evening (proposed)',
      startTime: '18:00',
      endTime: '22:00',
      workingWeekdays: [1, 2, 3, 4, 5],
    }),
  );
  eveningId = eve.data!.id;
  const cl = await callRoute<{ id: string; status: string }>(
    createLeaveType,
    post(hr, { code: 'CASUAL', name: 'Casual leave (proposed)', paid: true, halfDayAllowed: true }),
  );
  expect(cl.data?.status).toBe('proposed');
  casualId = cl.data!.id;
  const sl = await callRoute<{ id: string }>(
    createLeaveType,
    post(hr, {
      code: 'SICK',
      name: 'Sick leave (proposed)',
      paid: true,
      halfDayAllowed: false,
      requiresDocument: true,
    }),
  );
  sickId = sl.data!.id;
});

describe('shift templates and assignments', () => {
  it('validation, permission and conflict detection', async () => {
    expect(await statusOf(createShift, buildRequest('/x', { json: {} }))).toBe(401);
    expect(await statusOf(createShift, post(emp, { code: 'X1' }))).toBe(403);
    const bad = await callRoute(
      createShift,
      post(hr, {
        code: 'BAD',
        name: 'x',
        startTime: '18:00',
        endTime: '09:00',
        workingWeekdays: [1],
      }),
    );
    expect(bad.status).toBe(400);
    expect(
      await statusOf(
        assignShift,
        post(hr, { staffId: emp.staffId, shiftTemplateId: dayId, fromDate: '2026-09-01' }),
      ),
    ).toBe(201);
    const clash = await callRoute(
      assignShift,
      post(hr, {
        staffId: emp.staffId,
        shiftTemplateId: eveningId,
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      }),
    );
    expect(clash.status).toBe(409);
    expect(
      await statusOf(
        assignShift,
        post(hr, {
          staffId: emp2.staffId,
          shiftTemplateId: dayId,
          fromDate: '2026-09-01',
          toDate: '2026-09-30',
        }),
      ),
    ).toBe(201);
    expect(
      await statusOf(
        assignShift,
        post(hr, { staffId: emp2.staffId, shiftTemplateId: dayId, fromDate: '2026-10-01' }),
      ),
    ).toBe(201);
  });

  it('split shifts are allowed only when the (proposed) policy says so and times do not overlap', async () => {
    await updateSetting(ctx.db, opsManager, {
      key: 'shifts.rules',
      value: { allowSplitShifts: true },
    });
    const ok = await callRoute<{ id: string }>(
      assignShift,
      post(hr, {
        staffId: emp2.staffId,
        shiftTemplateId: eveningId,
        fromDate: '2026-11-02',
        toDate: '2026-11-06',
      }),
    );
    expect(ok.status).toBe(201);
    expect(
      await statusOf(
        assignShift,
        post(hr, {
          staffId: emp2.staffId,
          shiftTemplateId: dayId,
          fromDate: '2026-11-02',
          toDate: '2026-11-03',
        }),
      ),
    ).toBe(409);
    expect(
      await statusOf(
        patchAssignment,
        post(hr, { action: 'cancel', reason: 'Trial ended' }, 'PATCH'),
        { id: ok.data!.id },
      ),
    ).toBe(200);
    await updateSetting(ctx.db, opsManager, {
      key: 'shifts.rules',
      value: { allowSplitShifts: false },
    });
  });

  it('scoped reads: employees see only their own assignments', async () => {
    const mine = await callRoute<{ rows: { staffId: string }[] }>(listAssignments, get(emp));
    expect(mine.data!.rows.every((r) => r.staffId === emp.staffId)).toBe(true);
    expect(await statusOf(listAssignments, get(emp, `/x?staffId=${emp2.staffId}`))).toBe(403);
  });

  it('approving a template; changing approved timings makes it proposed again', async () => {
    const a = await callRoute<{ status: string }>(
      patchShift,
      post(hr, { status: 'approved' }, 'PATCH'),
      { id: eveningId },
    );
    expect(a.data?.status).toBe('approved');
    const b = await callRoute<{ status: string }>(
      patchShift,
      post(hr, { endTime: '22:30' }, 'PATCH'),
      { id: eveningId },
    );
    expect(b.data?.status).toBe('proposed');
    expect(await auditFor(ctx.db, eveningId)).toEqual([
      'shift_template.created',
      'shift_template.approved',
      'shift_template.proposed',
    ]);
  });
});

describe('holidays', () => {
  it('per location, decision state, withdraw', async () => {
    const h = await callRoute<{ id: string; status: string }>(
      createHoliday,
      post(hr, { holidayDate: '2026-10-21', name: 'Site holiday (fictional)', location: 'Sikar' }),
    );
    expect(h.status).toBe(201);
    expect(h.data?.status).toBe('proposed');
    expect(
      await statusOf(
        createHoliday,
        post(hr, { holidayDate: '2026-10-21', name: 'dup', location: 'sikar' }),
      ),
    ).toBe(409);
    expect(await statusOf(createHoliday, post(emp, { holidayDate: '2026-10-22', name: 'x' }))).toBe(
      403,
    );
    const w = await callRoute<{ id: string }>(
      createHoliday,
      post(hr, { holidayDate: '2026-12-31', name: 'To withdraw (fictional)' }),
    );
    expect(
      await statusOf(patchHoliday, post(hr, { status: 'withdrawn' }, 'PATCH'), { id: w.data!.id }),
    ).toBe(200);
    const list = await callRoute<{ id: string }[]>(listHolidays, get(emp));
    expect(list.data!.map((x) => x.id)).toEqual([h.data!.id]);
  });
});

describe('leave requests', () => {
  let lv: Leave;
  it('counts working days (Sunday and the Sikar holiday excluded, half days) and assigns LVR codes', async () => {
    // Sat 17 Oct (second half) … Fri 23 Oct (first half): .5 + 0 (Sun) + 1 + 1 + 0 (holiday, Sikar) + 1 + .5
    const r = await callRoute<Leave & { perDate: unknown[]; countBasis: string }>(
      requestLeave,
      post(emp, {
        leaveTypeId: casualId,
        startDate: '2026-10-17',
        endDate: '2026-10-23',
        startPart: 'second_half',
        endPart: 'first_half',
        reason: 'Family function (fictional)',
      }),
    );
    expect(r.status).toBe(201);
    expect(r.data?.code).toMatch(/^LVR-\d{6}$/);
    expect(Number(r.data?.workingDays)).toBe(4);
    expect(r.data?.countBasis).toBe('shift');
    lv = r.data!;
    // emp2 (no Sikar location) is not on that holiday: same dates count 5
    const r2 = await callRoute<Leave>(
      requestLeave,
      post(emp2, {
        leaveTypeId: casualId,
        startDate: '2026-10-17',
        endDate: '2026-10-23',
        startPart: 'second_half',
        endPart: 'first_half',
      }),
    );
    expect(Number(r2.data?.workingDays)).toBe(5);
  });

  it('overlap with own pending leave → 409; half-day rules and document rules → 400', async () => {
    expect(
      await statusOf(
        requestLeave,
        post(emp, { leaveTypeId: casualId, startDate: '2026-10-22', endDate: '2026-10-22' }),
      ),
    ).toBe(409);
    // the other half of Friday 23rd is free
    expect(
      await statusOf(
        requestLeave,
        post(emp, {
          leaveTypeId: casualId,
          startDate: '2026-10-23',
          endDate: '2026-10-23',
          startPart: 'second_half',
        }),
      ),
    ).toBe(201);
    expect(
      await statusOf(
        requestLeave,
        post(emp, {
          leaveTypeId: sickId,
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          startPart: 'first_half',
        }),
      ),
    ).toBe(400);
    expect(
      await statusOf(
        requestLeave,
        post(emp, { leaveTypeId: sickId, startDate: '2026-11-02', endDate: '2026-11-02' }),
      ),
    ).toBe(400);
    expect(
      await statusOf(
        requestLeave,
        post(emp, { leaveTypeId: casualId, startDate: '2026-10-25', endDate: '2026-10-25' }),
      ),
    ).toBe(400); // Sunday only
    expect(
      await statusOf(
        requestLeave,
        post(emp, {
          staffId: emp2.staffId,
          leaveTypeId: casualId,
          startDate: '2026-11-09',
          endDate: '2026-11-09',
        }),
      ),
    ).toBe(403);
  });

  it('approval scope and self-approval refusal; approval writes a usage entry', async () => {
    expect(await statusOf(decideLeave, post(emp, { decision: 'approve' }), { id: lv.id })).toBe(
      403,
    );
    expect(
      (await callRoute(decideLeave, post(otherManager, { decision: 'approve' }), { id: lv.id }))
        .status,
    ).toBe(403);
    const own = await callRoute<Leave>(
      requestLeave,
      post(manager, { leaveTypeId: casualId, startDate: '2026-11-10', endDate: '2026-11-10' }),
    );
    expect(
      (await callRoute(decideLeave, post(manager, { decision: 'approve' }), { id: own.data!.id }))
        .status,
    ).toBe(403);
    const ok = await callRoute<Leave>(
      decideLeave,
      post(manager, { decision: 'approve', note: 'Covered by team' }),
      { id: lv.id },
    );
    expect(ok.status).toBe(200);
    expect(ok.data?.status).toBe('approved');
    const usage = await ctx.db
      .select()
      .from(opsLeaveLedgerEntries)
      .where(eq(opsLeaveLedgerEntries.leaveRequestId, lv.id as never));
    expect(usage.map((u) => [u.entryType, Number(u.days)])).toEqual([['usage', -4]]);
    expect(await auditFor(ctx.db, lv.id)).toEqual([
      'leave_request.created',
      'leave_request.approved',
    ]);
    const view = await callRoute<{ rows: { id: string }[] }>(
      listLeave,
      get(manager, '/x?view=to_decide'),
    );
    expect(view.data!.rows.map((r) => r.id)).not.toContain(own.data!.id);
  });

  it('balance: not configured until an allocation, then a ledger', async () => {
    const before = await callRoute<
      { staffId: string; balances: { code: string; balance: { status: string } }[] }[]
    >(balances, get(emp));
    const casual = before.data![0]!.balances.find((b) => b.code === 'CASUAL');
    expect(casual?.balance.status).toBe('not_configured');
    expect(
      await statusOf(
        ledgerEntry,
        post(hr, {
          staffId: hr.staffId,
          leaveTypeId: casualId,
          entryType: 'allocation',
          days: 12,
          effectiveDate: '2026-04-01',
          note: 'Self allocation',
        }),
      ),
    ).toBe(403);
    expect(
      await statusOf(
        ledgerEntry,
        post(emp, {
          staffId: emp.staffId,
          leaveTypeId: casualId,
          entryType: 'allocation',
          days: 12,
          effectiveDate: '2026-04-01',
          note: 'x',
        }),
      ),
    ).toBe(403);
    expect(
      await statusOf(
        ledgerEntry,
        post(hr, {
          staffId: emp.staffId,
          leaveTypeId: casualId,
          entryType: 'allocation',
          days: 1.25,
          effectiveDate: '2026-04-01',
          note: 'Recorded by HR (fictional)',
        }),
      ),
    ).toBe(400);
    expect(
      await statusOf(
        ledgerEntry,
        post(hr, {
          staffId: emp.staffId,
          leaveTypeId: casualId,
          entryType: 'allocation',
          days: 4,
          effectiveDate: '2026-04-01',
          note: 'Recorded by HR (fictional)',
        }),
      ),
    ).toBe(201);
    const after = await callRoute<
      { balances: { code: string; balance: { status: string; balance?: number } }[] }[]
    >(balances, get(emp));
    expect(after.data![0]!.balances.find((b) => b.code === 'CASUAL')?.balance).toMatchObject({
      status: 'configured',
      balance: 0,
    });
    expect(await statusOf(balances, get(emp, `/x?staffId=${emp2.staffId}`))).toBe(403);
  });

  it('cancellation: requester before start writes a reversal; after start only an approver with a reason', async () => {
    const r = await callRoute<Leave>(cancelLeave, post(emp, { reason: 'Plans changed' }), {
      id: lv.id,
    });
    // 17 Oct has passed (today ≥ 19 Oct 2026), so the employee cannot cancel it any more
    expect(r.status).toBe(403);
    expect(await statusOf(cancelLeave, post(manager, {}), { id: lv.id })).toBe(400);
    const ok = await callRoute<Leave>(
      cancelLeave,
      post(manager, { reason: 'Returned to work early' }),
      { id: lv.id },
    );
    expect(ok.data?.status).toBe('cancelled');
    const ledger = await ctx.db
      .select()
      .from(opsLeaveLedgerEntries)
      .where(eq(opsLeaveLedgerEntries.leaveRequestId, lv.id as never));
    expect(ledger.map((u) => [u.entryType, Number(u.days)]).sort()).toEqual([
      ['reversal', 4],
      ['usage', -4],
    ]);
    const after = await callRoute<
      { balances: { code: string; balance: { balance?: number } }[] }[]
    >(balances, get(emp));
    expect(after.data![0]!.balances.find((b) => b.code === 'CASUAL')?.balance.balance).toBe(4);
    // a future pending request: the requester may cancel
    const f = await callRoute<Leave>(
      requestLeave,
      post(emp, { leaveTypeId: casualId, startDate: '2026-12-07', endDate: '2026-12-08' }),
    );
    expect(await statusOf(cancelLeave, post(emp2, {}), { id: f.data!.id })).toBe(403);
    expect(
      (await callRoute<Leave>(cancelLeave, post(emp, {}), { id: f.data!.id })).data?.status,
    ).toBe('cancelled');
    expect(await statusOf(cancelLeave, post(emp, {}), { id: f.data!.id })).toBe(409);
  });

  it('reads are scoped: a colleague’s leave is 403; the chain manager can see it', async () => {
    expect(await statusOf(getLeave, get(emp2), { id: lv.id })).toBe(403);
    expect(await statusOf(getLeave, get(outsider), { id: lv.id })).toBe(403);
    const m = await callRoute<{ perDate: { excluded: string | null }[] }>(getLeave, get(manager), {
      id: lv.id,
    });
    expect(m.status).toBe(200);
    expect(m.data!.perDate.filter((d) => d.excluded).map((d) => d.excluded)).toEqual([
      'non_working_day',
      'holiday',
    ]);
  });

  it('team availability shows leave and scheduled days for the chain only', async () => {
    const r = await callRoute<{ rows: { staffId: string; cells: { state: string }[] }[] }>(
      availability,
      get(manager, '/x?from=2026-10-19&to=2026-10-25'),
    );
    expect(r.status).toBe(200);
    const ids = r.data!.rows.map((x) => x.staffId);
    expect(ids).toEqual(expect.arrayContaining([manager.staffId, emp.staffId, emp2.staffId]));
    expect(ids).not.toContain(outsider.staffId);
    const e2 = r.data!.rows.find((x) => x.staffId === emp2.staffId)!;
    expect(e2.cells[0]?.state).toBe('on_leave'); // emp2's pending request covers Mon 19 Oct
    expect(await statusOf(availability, get(manager, '/x?from=2026-10-01&to=2026-11-30'))).toBe(
      400,
    );
  });
});

describe('timesheets, export and metrics', () => {
  it('scheduled vs worked per employee, unapproved difference, missing stays missing', async () => {
    await callRoute(
      manualEntry,
      post(hr, {
        staffId: emp2.staffId,
        workDate: '2026-10-12',
        clockIn: '09:00',
        clockOut: '18:30',
        breakMinutes: 30,
        reason: 'Paper register (fictional)',
      }),
    );
    const r = await callRoute<{
      people: {
        staffId: string;
        summary: {
          scheduledMinutes: { status: string; value?: number };
          workedMinutes: { status: string; value?: number };
          unapprovedDifferenceMinutes: { status: string; value?: number };
        };
      }[];
    }>(timesheets, get(manager, '/x?from=2026-10-12&to=2026-10-12'));
    expect(r.status).toBe(200);
    const e2 = r.data!.people.find((p) => p.staffId === emp2.staffId)!;
    expect(e2.summary.scheduledMinutes).toEqual({ status: 'ok', value: 480 });
    expect(e2.summary.workedMinutes).toEqual({ status: 'ok', value: 540 });
    expect(e2.summary.unapprovedDifferenceMinutes).toEqual({ status: 'ok', value: 60 });
    const m = r.data!.people.find((p) => p.staffId === manager.staffId)!;
    expect(m.summary.scheduledMinutes.status).toBe('missing');
    expect(m.summary.workedMinutes.status).toBe('missing');
    expect(r.data!.people.map((p) => p.staffId)).not.toContain(outsider.staffId);
    expect(await statusOf(timesheets, get(emp, '/x?from=2026-10-12&to=2026-10-12'))).toBe(403);
  });

  it('employee-level CSV export needs ops:hr_reports:export and is audited', async () => {
    expect(await statusOf(exportCsv, get(manager, '/x?from=2026-10-12&to=2026-10-12'))).toBe(403);
    const finance = await createTestUser(ctx.db, { roles: ['finance_officer'] });
    expect(await statusOf(exportCsv, get(finance, '/x?from=2026-10-12&to=2026-10-12'))).toBe(403);
    const res = await exportCsv(get(hr, '/x?from=2026-10-12&to=2026-10-12'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text.split('\r\n')[0]).toMatch(
      /^employee_code,name,department,from,to,scheduled_hours,worked_hours/,
    );
    expect(text).toContain(`${emp2.employeeCode},`);
    expect(text).toContain('missing');
    expect(await auditFor(ctx.db, '2026-10-12_2026-10-12')).toEqual(['timesheet.exported']);
  });

  it('dashboard metrics are values or missing', async () => {
    const m = await hrTimeMetrics(ctx.db, hr, {
      from: '2026-10-12' as never,
      to: '2026-10-12' as never,
    });
    expect(m.leaveRequestsAwaitingApproval.status).toBe('ok');
    expect(m.recordedHours).toMatchObject({ status: 'ok', unit: 'hours' });
    const lone = await employee(ctx.db, ['department_manager']);
    const l = await hrTimeMetrics(ctx.db, lone, {
      from: '2026-10-12' as never,
      to: '2026-10-12' as never,
    });
    expect(l.recordedHours.status).toBe('missing');
    expect(l.scheduledHours.status).toBe('missing');
  });
});
