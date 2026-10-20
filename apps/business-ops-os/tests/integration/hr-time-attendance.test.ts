import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { notifications, opsAttendanceImports, opsAttendanceSessions } from '@elevate/database';
import {
  GET as listAttendance,
  POST as manualEntry,
} from '../../src/app/api/v1/hr/attendance/route';
import { GET as getSession } from '../../src/app/api/v1/hr/attendance/[id]/route';
import { POST as clockInRoute } from '../../src/app/api/v1/hr/attendance/clock-in/route';
import { POST as clockOutRoute } from '../../src/app/api/v1/hr/attendance/clock-out/route';
import { POST as breakRoute } from '../../src/app/api/v1/hr/attendance/breaks/route';
import { GET as summaryRoute } from '../../src/app/api/v1/hr/attendance/summary/route';
import { GET as providerRoute } from '../../src/app/api/v1/hr/attendance/provider/route';
import {
  GET as listCorrections,
  POST as createCorrection,
} from '../../src/app/api/v1/hr/attendance-corrections/route';
import { POST as decideCorrection } from '../../src/app/api/v1/hr/attendance-corrections/[id]/decision/route';
import { POST as withdrawCorrection } from '../../src/app/api/v1/hr/attendance-corrections/[id]/withdraw/route';
import {
  GET as listImports,
  POST as importRoute,
} from '../../src/app/api/v1/hr/attendance-imports/route';
import { POST as createShift } from '../../src/app/api/v1/hr/shifts/route';
import { POST as assignShift } from '../../src/app/api/v1/hr/shift-assignments/route';
import { runMissingClockOutCheck } from '../../src/server/hr/attendance';
import { auditFor, employee, get, post, statusOf, type Employee } from './hr-time-fixtures';

const ctx = setupTestDatabase();
let hr: Employee; // hr_manager
let deptManager: Employee; // department_manager of `emp` and `emp2`
let otherManager: Employee; // department_manager of another chain
let emp: Employee;
let emp2: Employee;
let outsider: Employee;
let dayShiftId: string;

type Session = {
  id: string;
  status: string;
  workDate: string;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  workedMinutes: number | null;
  source: string;
};

beforeAll(async () => {
  hr = await employee(ctx.db, ['hr_manager']);
  deptManager = await employee(ctx.db, ['department_manager', 'employee']);
  otherManager = await employee(ctx.db, ['department_manager', 'employee']);
  emp = await employee(ctx.db, ['employee'], { managerId: deptManager.staffId });
  emp2 = await employee(ctx.db, ['employee'], { managerId: deptManager.staffId });
  outsider = await employee(ctx.db, ['employee'], { managerId: otherManager.staffId });
  const shift = await callRoute<{ id: string; status: string }>(
    createShift,
    post(hr, {
      code: 'GEN-DAY',
      name: 'General day shift (proposed)',
      startTime: '09:00',
      endTime: '17:30',
      unpaidBreakMinutes: 30,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
    }),
  );
  expect(shift.status).toBe(201);
  expect(shift.data?.status).toBe('proposed');
  dayShiftId = shift.data!.id;
  for (const e of [emp, emp2])
    expect(
      await statusOf(
        assignShift,
        post(hr, { staffId: e.staffId, shiftTemplateId: dayShiftId, fromDate: '2026-09-01' }),
      ),
    ).toBe(201);
});

const manual = (as: Employee, over: Record<string, unknown> = {}) =>
  callRoute<Session>(
    manualEntry,
    post(as, {
      staffId: emp.staffId,
      workDate: '2026-10-12',
      clockIn: '09:25',
      clockOut: '17:00',
      breakMinutes: 30,
      reason: 'Forgot the phone at home (fictional)',
      ...over,
    }),
  );

describe('attendance routes: authentication, permissions, validation', () => {
  it('401 without a session, 403 without the permission, 400 on bad input', async () => {
    expect(await statusOf(listAttendance, buildRequest('/x'))).toBe(401);
    const teacher = await createTestUser(ctx.db, { roles: ['teacher'] });
    expect(await statusOf(listAttendance, get(teacher))).toBe(403);
    expect(await statusOf(manualEntry, post(emp, { staffId: emp.staffId }))).toBe(403);
    const bad = await callRoute(
      manualEntry,
      post(hr, { staffId: emp.staffId, workDate: '2026-10-12', clockIn: '9am' }),
    );
    expect(bad.status).toBe(400);
  });

  it('manual entries need a reason, are audited, and late/early is measured against the shift', async () => {
    const noReason = await manual(hr, { reason: '' });
    expect(noReason.status).toBe(400);
    const r = await manual(hr);
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({
      source: 'manual',
      status: 'closed',
      lateMinutes: 25,
      earlyDepartureMinutes: 30,
      workedMinutes: 425,
    });
    expect(await auditFor(ctx.db, r.data!.id)).toContain('attendance.manual_entry');
    // one session per day (proposed policy) → 409
    expect(
      (await manual(hr, { clockIn: '18:00', clockOut: '19:00', breakMinutes: 0 })).status,
    ).toBe(409);
    // future → 400
    expect((await manual(hr, { workDate: '2027-01-04' })).status).toBe(400);
  });

  it('a day without a shift is not measured (null), not on time', async () => {
    const r = await manual(hr, {
      staffId: hr.staffId,
      workDate: '2026-10-13',
      clockIn: '10:00',
      clockOut: '12:00',
      breakMinutes: 0,
    });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ lateMinutes: null, earlyDepartureMinutes: null });
  });
});

describe('self service and own scope', () => {
  it('clock in, break, clock out; second clock-in on the same day is refused', async () => {
    const inRes = await callRoute<Session>(clockInRoute, post(emp2));
    expect(inRes.status).toBe(201);
    expect(inRes.data?.status).toBe('open');
    expect(await statusOf(clockInRoute, post(emp2))).toBe(409);
    expect(await statusOf(breakRoute, post(emp2, { action: 'start' }))).toBe(200);
    expect(await statusOf(breakRoute, post(emp2, { action: 'start' }))).toBe(409);
    const out = await callRoute<Session>(clockOutRoute, post(emp2));
    expect(out.status).toBe(200);
    expect(out.data?.status).toBe('closed');
    expect(await statusOf(clockOutRoute, post(emp2))).toBe(409);
    expect(await auditFor(ctx.db, inRes.data!.id)).toEqual(
      expect.arrayContaining([
        'attendance.clocked_in',
        'attendance.break_started',
        'attendance.clocked_out',
      ]),
    );
  });

  it('an employee sees only their own attendance; a colleague’s record is 403', async () => {
    const mine = await callRoute<{ rows: { staffId: string }[] }>(listAttendance, get(emp, '/x'));
    expect(mine.status).toBe(200);
    expect(new Set(mine.data!.rows.map((r) => r.staffId))).toEqual(new Set([emp.staffId]));
    const colleague = await callRoute(listAttendance, get(emp, `/x?staffId=${emp2.staffId}`));
    expect(colleague.status).toBe(403);
    const [s] = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.staffId, emp2.staffId));
    expect(await statusOf(getSession, get(emp), { id: s!.id })).toBe(403);
    expect(await statusOf(getSession, get(emp2), { id: s!.id })).toBe(200);
    // the department manager sees the chain, the other manager does not
    expect(await statusOf(getSession, get(deptManager), { id: s!.id })).toBe(200);
    expect(await statusOf(getSession, get(otherManager), { id: s!.id })).toBe(403);
  });

  it('monthly summary: worked vs scheduled for self; colleague summary forbidden', async () => {
    const r = await callRoute<{
      summary: {
        workedMinutes: { status: string; value?: number };
        lateCount: number;
        scheduledMinutes: { status: string };
      };
    }>(summaryRoute, get(emp, '/x?month=2026-10'));
    expect(r.status).toBe(200);
    expect(r.data!.summary.workedMinutes).toEqual({ status: 'ok', value: 425 });
    expect(r.data!.summary.lateCount).toBe(1);
    expect(r.data!.summary.scheduledMinutes.status).toBe('ok');
    expect(await statusOf(summaryRoute, get(emp, `/x?staffId=${emp2.staffId}`))).toBe(403);
    const none = await callRoute<{ summary: { scheduledMinutes: { status: string } } }>(
      summaryRoute,
      get(outsider, '/x?month=2026-10'),
    );
    expect(none.data!.summary.scheduledMinutes.status).toBe('missing');
  });

  it('provider adapter reports not_configured', async () => {
    const r = await callRoute<{ connection: string; detail: string }>(providerRoute, get(emp));
    expect(r.data?.connection).toBe('not_configured');
    expect(r.data?.detail).toMatch(
      /No attendance device or provider is connected; manual and CSV only/,
    );
  });
});

describe('missing clock-out job', () => {
  it('flags an open session past shift end + grace once, and notifies the employee', async () => {
    const opened = await callRoute<Session>(clockInRoute, post(emp));
    expect(opened.status).toBe(201);
    const early = await runMissingClockOutCheck(ctx.db, new Date(Date.now() + 60_000));
    expect(early.flagged).toBe(0);
    const later = new Date(Date.now() + 2 * 86_400_000);
    const r = await runMissingClockOutCheck(ctx.db, later);
    expect(r.flagged).toBe(1);
    expect(r.notified).toBe(1);
    const again = await runMissingClockOutCheck(ctx.db, later);
    expect(again.flagged).toBe(0);
    const notes = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, emp.id),
          eq(notifications.kind, 'attendance.missing_clock_out'),
        ),
      );
    expect(notes).toHaveLength(1);
    const list = await callRoute<{ rows: { id: string }[] }>(
      listAttendance,
      get(hr, `/x?status=missing_clock_out`),
    );
    expect(list.data!.rows.map((x) => x.id)).toContain(opened.data!.id);
  });
});

describe('corrections never overwrite', () => {
  let original: Session;
  it('request → no self-approval → other chain 403 → manager approves → original kept as superseded', async () => {
    const [s] = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(
        and(
          eq(opsAttendanceSessions.staffId, emp.staffId),
          eq(opsAttendanceSessions.workDate, '2026-10-12'),
        ),
      );
    original = s as unknown as Session;
    const req = await callRoute<{ id: string; code: string; status: string }>(
      createCorrection,
      post(emp, {
        sessionId: s!.id,
        workDate: '2026-10-12',
        clockIn: '09:00',
        clockOut: '17:30',
        breakMinutes: 30,
        reason: 'Gate register shows 09:00 (fictional)',
      }),
    );
    expect(req.status).toBe(201);
    expect(req.data?.code).toMatch(/^ATC-\d{6}$/);
    // a second pending correction on the same session → 409
    expect(
      await statusOf(
        createCorrection,
        post(emp, {
          sessionId: s!.id,
          workDate: '2026-10-12',
          clockIn: '09:00',
          clockOut: '17:30',
          reason: 'again please',
        }),
      ),
    ).toBe(409);
    // colleague cannot request for someone else
    expect(
      await statusOf(
        createCorrection,
        post(emp2, {
          sessionId: s!.id,
          workDate: '2026-10-12',
          clockIn: '09:00',
          clockOut: '17:30',
          reason: 'not mine',
        }),
      ),
    ).toBe(403);
    // employees cannot decide at all; manager of another chain is out of scope
    expect(
      (await callRoute(decideCorrection, post(emp, { decision: 'approve' }), { id: req.data!.id }))
        .status,
    ).toBe(403);
    expect(
      await statusOf(decideCorrection, post(otherManager, { decision: 'approve' }), {
        id: req.data!.id,
      }),
    ).toBe(403);
    // rejection without a note → 400
    expect(
      await statusOf(decideCorrection, post(deptManager, { decision: 'reject' }), {
        id: req.data!.id,
      }),
    ).toBe(400);
    const ok = await callRoute<{ status: string; resultingSessionId: string }>(
      decideCorrection,
      post(deptManager, { decision: 'approve', note: 'Matches register' }),
      { id: req.data!.id },
    );
    expect(ok.status).toBe(200);
    expect(ok.data?.status).toBe('approved');
    const [orig] = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.id, s!.id as never));
    expect(orig).toMatchObject({
      status: 'superseded',
      supersededById: ok.data!.resultingSessionId,
      lateMinutes: 25,
    });
    expect(orig!.clockInAt.toISOString()).toBe(s!.clockInAt.toISOString());
    const [fresh] = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.id, ok.data!.resultingSessionId as never));
    expect(fresh).toMatchObject({
      source: 'correction',
      status: 'closed',
      correctionId: req.data!.id,
      lateMinutes: 0,
      earlyDepartureMinutes: 0,
    });
    expect(await auditFor(ctx.db, req.data!.id)).toEqual([
      'attendance_correction.requested',
      'attendance_correction.approved',
    ]);
    // deciding again → invalid state transition
    expect(
      await statusOf(decideCorrection, post(deptManager, { decision: 'reject', note: 'x' }), {
        id: req.data!.id,
      }),
    ).toBe(409);
  });

  it('a manager cannot approve a correction about their own attendance', async () => {
    const m = await manual(hr, {
      staffId: deptManager.staffId,
      workDate: '2026-10-14',
      clockIn: '10:00',
      clockOut: '12:00',
      breakMinutes: 0,
    });
    const req = await callRoute<{ id: string }>(
      createCorrection,
      post(deptManager, {
        sessionId: m.data!.id,
        workDate: '2026-10-14',
        clockIn: '09:30',
        clockOut: '12:00',
        reason: 'Arrived earlier (fictional)',
      }),
    );
    expect(req.status).toBe(201);
    const self = await callRoute(decideCorrection, post(deptManager, { decision: 'approve' }), {
      id: req.data!.id,
    });
    expect(self.status).toBe(403);
    // HR rejects; the original stays the live record
    const rej = await callRoute<{ status: string }>(
      decideCorrection,
      post(hr, { decision: 'reject', note: 'No evidence' }),
      { id: req.data!.id },
    );
    expect(rej.data?.status).toBe('rejected');
    const [s] = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.id, m.data!.id as never));
    expect(s?.status).toBe('closed');
  });

  it('only the requester withdraws; lists are scoped', async () => {
    const req = await callRoute<{ id: string }>(
      createCorrection,
      post(emp2, {
        workDate: '2026-10-10',
        clockIn: '09:00',
        clockOut: '13:00',
        reason: 'Clocked nothing that day (fictional)',
      }),
    );
    expect(req.status).toBe(201);
    expect(await statusOf(withdrawCorrection, post(deptManager), { id: req.data!.id })).toBe(403);
    expect(await statusOf(withdrawCorrection, post(emp2), { id: req.data!.id })).toBe(200);
    const list = await callRoute<{ rows: { staffId: string }[] }>(listCorrections, get(emp2));
    expect(list.data!.rows.every((r) => r.staffId === emp2.staffId)).toBe(true);
    void original;
  });
});

describe('CSV import', () => {
  const csv = () =>
    [
      '﻿employee_code,date,clock_in,clock_out,break_minutes,timezone,note',
      `${emp2.employeeCode},2026-10-05,09:00,17:30,30,,"Imported, with comma"`,
      `${emp2.employeeCode},2026-10-06,22:00,2026-10-07 06:00,60,Asia/Kolkata,night`,
      `EMP-9999,2026-10-05,09:00,17:00,,,`,
      `${emp2.employeeCode},2026-10-08,17:00,09:00,,,`,
      '',
    ].join('\r\n');

  it('preview reports per-row errors and creates nothing; 403 for employees', async () => {
    expect(await statusOf(importRoute, post(emp, { csv: csv() }))).toBe(403);
    const before = (await ctx.db.select().from(opsAttendanceSessions)).length;
    const p = await callRoute<{
      mode: string;
      validRows: number;
      invalidRows: number;
      rows: { ok: boolean; errors: string[] }[];
    }>(importRoute, post(hr, { csv: csv(), fileName: 'october.csv' }));
    expect(p.status).toBe(200);
    expect(p.data).toMatchObject({ mode: 'preview', validRows: 2, invalidRows: 2 });
    expect(p.data!.rows[2]?.errors[0]).toMatch(/Unknown employee code/);
    expect((await ctx.db.select().from(opsAttendanceSessions)).length).toBe(before);
    expect(await statusOf(importRoute, post(hr, { csv: 'colour\nred' }))).toBe(400);
  });

  it('commit imports only valid rows in one batch; re-importing the same file creates nothing', async () => {
    const c = await callRoute<{
      batch: { id: string; createdSessions: number };
      alreadyImported: boolean;
    }>(importRoute, post(hr, { csv: csv(), fileName: 'october.csv', commit: true }));
    expect(c.status).toBe(200);
    expect(c.data).toMatchObject({ alreadyImported: false, batch: { createdSessions: 2 } });
    const imported = await ctx.db
      .select()
      .from(opsAttendanceSessions)
      .where(eq(opsAttendanceSessions.importId, c.data!.batch.id as never));
    expect(imported).toHaveLength(2);
    expect(imported.every((s) => s.source === 'csv_import')).toBe(true);
    expect(await auditFor(ctx.db, c.data!.batch.id)).toEqual(['attendance.csv_imported']);
    const again = await callRoute<{ alreadyImported: boolean; batch: { id: string } }>(
      importRoute,
      post(hr, { csv: csv(), commit: true }),
    );
    expect(again.data).toMatchObject({ alreadyImported: true, batch: { id: c.data!.batch.id } });
    expect(await ctx.db.select().from(opsAttendanceImports)).toHaveLength(1);
    // a different file with the same rows: duplicates against existing sessions are row errors
    const dup = await callRoute<{ validRows: number }>(
      importRoute,
      post(hr, { csv: csv() + `\r\n` }),
    );
    expect(dup.data?.validRows).toBe(0);
    const batches = await callRoute<{ total: number }>(listImports, get(hr));
    expect(batches.data?.total).toBe(1);
  });

  it('department managers cannot import (no ops:attendance:manage)', async () => {
    const [mgr] = [deptManager];
    expect(await statusOf(importRoute, post(mgr, { csv: csv() }))).toBe(403);
  });
});
