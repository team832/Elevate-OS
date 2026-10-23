/**
 * Attendance corrections (request, one pending per day, HR decides, never your own, managers
 * notified, times never overturn an HR decision), attachment access for a request, punch file
 * import guards, and the HR Overview figures.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { notifications, opsAttendancePunches, staffMembers } from '@elevate/database';
import { authedRequest, callRoute, setupTestDatabase, type TestUser } from '@elevate/testing';
import { POST as punchRoute } from '../../src/app/api/v1/attendance/punches/route';
import { POST as decisionRoute } from '../../src/app/api/v1/attendance/decisions/route';
import {
  GET as correctionsList,
  POST as correctionRoute,
} from '../../src/app/api/v1/attendance/corrections/route';
import { POST as decideRoute } from '../../src/app/api/v1/attendance/corrections/[id]/route';
import { POST as previewRoute } from '../../src/app/api/v1/attendance/imports/route';
import { POST as commitRoute } from '../../src/app/api/v1/attendance/imports/[id]/route';
import { hrAttendanceCounts } from '../../src/server/attendance-hr';
import { attendanceSetup } from '../../src/server/attendance-lists';
import { POST as leaveRoute } from '../../src/app/api/v1/attendance/leave/route';
import { correctionAccess } from '../../src/server/attendance-corrections';
import { at, attendanceWorld, D1, D2, D3, post, profile } from './attendance-fixture';
import { staffUser } from './fixtures';

const ctx = setupTestDatabase();

let w: Awaited<ReturnType<typeof attendanceWorld>>;
beforeAll(async () => {
  w = await attendanceWorld(ctx.db);
  // A punch the import file repeats, and an HR decision a correction must not overturn.
  await post(punchRoute, w.hr, '/punches', {
    staffId: w.teacher.staffId,
    at: at(D1, '09:25'),
    direction: 'in',
  });
  await post(decisionRoute, w.hr, '/decisions', {
    staffId: w.teacher2.staffId,
    workDate: D2,
    status: 'absent',
    note: 'Confirmed by phone with the employee',
  });
});

describe('corrections', () => {
  it('request → one pending per day → teacher cannot approve → HR approves and the day changes', async () => {
    const json = {
      workDate: D1,
      requestedIn: at(D1, '09:00'),
      requestedOut: at(D1, '17:00'),
      reason: 'Forgot to punch, was teaching all day',
    };
    const req = await post(correctionRoute, w.teacher2, '/corrections', json);
    expect(req.status).toBe(201);
    expect((await post(correctionRoute, w.teacher2, '/corrections', json)).status).toBe(409);
    expect(
      (
        await post(correctionRoute, w.teacher2, '/corrections', {
          workDate: D1,
          requestedStatus: 'present',
        })
      ).status,
    ).toBe(400); // reason required
    const id = req.data!.id;
    const decide = (u: TestUser, body: unknown) =>
      callRoute(
        decideRoute,
        authedRequest(u, `/ops/api/v1/attendance/corrections/${id}`, {
          method: 'POST',
          json: body,
        }),
        { id },
      );
    expect((await decide(w.teacher2, { decision: 'approved' })).status).toBe(403);
    expect((await decide(w.hr, { decision: 'rejected' })).status).toBe(400); // a rejection needs a note
    expect((await decide(w.hr, { decision: 'approved' })).status).toBe(200);
    expect((await decide(w.hr, { decision: 'approved' })).status).toBe(409);
    expect(await w.day(w.teacher2.staffId, D1)).toMatchObject({
      status: 'present',
      basis: 'computed',
    });
    const history = await callRoute<{ items: { status: string }[] }>(
      correctionsList,
      authedRequest(w.teacher2, '/academic/api/v1/attendance/corrections'),
    );
    expect(history.data!.items.map((c) => c.status)).toEqual(['approved']);
  });

  it('an operations manager decides a request HR-only managers cannot see', async () => {
    const req = await post(correctionRoute, w.finance, '/corrections', {
      workDate: D1,
      requestedStatus: 'present',
      reason: 'At the bank all day for the institute',
    });
    expect(req.status).toBe(201);
    const id = req.data!.id;
    const decide = (u: TestUser) =>
      callRoute(
        decideRoute,
        authedRequest(u, `/ops/api/v1/attendance/corrections/${id}`, {
          method: 'POST',
          json: { decision: 'approved' },
        }),
        { id },
      );
    expect((await decide(w.hr)).status).toBe(404); // outside the HR-only scope
    expect((await decide(w.opsMgr)).status).toBe(200);
    expect((await decide(w.hr)).status).toBe(404); // scope is checked before the status (no 409 leak)
  });

  it('HR-only managers cannot import, commit or list leave for staff outside their scope', async () => {
    await profile(ctx.db, w.finance.staffId, 'DEMO-F01');
    const content = `Staff code,Date-time,Direction
DEMO-F01,${D2} 09:00,in`;
    const hrView = await post<{ rows: { errors: string[] }[] }>(previewRoute, w.hr, '/imports', {
      filename: 'finance.csv',
      content,
    });
    expect(hrView.data!.rows[0]!.errors).toEqual(['No staff member has the code DEMO-F01']);
    // The same row previewed by an ops manager is valid; an HR-only manager still cannot commit it.
    const other = await post(previewRoute, w.opsMgr, '/imports', {
      filename: 'finance-ops.csv',
      content: `${content}
`,
    });
    const id = other.data!.id;
    const commit = await callRoute<{ added: number }>(
      commitRoute,
      authedRequest(w.hr, `/ops/api/v1/attendance/imports/${id}`, { method: 'POST', json: {} }),
      { id },
    );
    expect(commit.data).toMatchObject({ added: 0 });
    const stored = await ctx.db
      .select()
      .from(opsAttendancePunches)
      .where(eq(opsAttendancePunches.staffId, w.finance.staffId));
    expect(stored).toEqual([]);
    await post(leaveRoute, w.opsMgr, '/leave', {
      staffId: w.finance.staffId,
      fromDate: D1,
      toDate: D1,
      kind: 'Sample casual leave',
    });
    const hrSetup = await attendanceSetup(ctx.db, w.hr);
    expect(hrSetup.staffOptions.map((o) => o.value)).not.toContain(w.finance.staffId);
    expect(hrSetup.leave.map((l) => l.staffName)).not.toContain('Sample Finance Staff');
    expect((await attendanceSetup(ctx.db, w.opsMgr)).leave.map((l) => l.staffName)).toContain(
      'Sample Finance Staff',
    );
  });

  it('every attendance manager is notified; times alone never overturn an HR decision', async () => {
    const req = await post(correctionRoute, w.teacher2, '/corrections', {
      workDate: D2,
      requestedIn: at(D2, '09:00'),
      reason: 'I was here that morning',
    });
    expect(req.status).toBe(201);
    const told = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'attendance.correction_requested'));
    expect(told.map((n) => n.userId)).toEqual(
      expect.arrayContaining([w.opsMgr.id, w.hr.id, w.hr2.id]),
    );
    const id = req.data!.id;
    const ok = await callRoute<{ decisionKept: boolean }>(
      decideRoute,
      authedRequest(w.hr, `/ops/api/v1/attendance/corrections/${id}`, {
        method: 'POST',
        json: { decision: 'approved' },
      }),
      { id },
    );
    expect(ok.data).toMatchObject({ decisionKept: true });
    expect(await w.day(w.teacher2.staffId, D2)).toMatchObject({
      status: 'absent',
      basis: 'hr_decision',
    });
  });

  it('HR cannot decide a request about their own day', async () => {
    const req = await post(correctionRoute, w.hr2, '/corrections', {
      workDate: D3,
      requestedStatus: 'present',
      reason: 'Worked on the holiday',
    });
    expect(req.status).toBe(201);
    const own = await callRoute(
      decideRoute,
      authedRequest(w.hr2, `/ops/api/v1/attendance/corrections/${req.data!.id}`, {
        method: 'POST',
        json: { decision: 'approved' },
      }),
      { id: req.data!.id },
    );
    expect(own.status).toBe(403);
    // Attachment access (ATTACH): requester writes while pending, HR writes, others see nothing.
    const id = req.data!.id;
    expect(await correctionAccess(ctx.db, w.hr2, id)).toEqual({ canRead: true, canWrite: true });
    expect(await correctionAccess(ctx.db, w.teacher, id)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(await correctionAccess(ctx.db, w.outsider, id)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(await correctionAccess(ctx.db, w.hr, 'not-a-uuid')).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it('a decided request is read-only for its requester', async () => {
    const [mine] = (
      await callRoute<{ items: { id: string }[] }>(
        correctionsList,
        authedRequest(w.teacher2, '/academic/api/v1/attendance/corrections'),
      )
    ).data!.items;
    expect(await correctionAccess(ctx.db, w.teacher2, mine!.id)).toEqual({
      canRead: true,
      canWrite: false,
    });
  });
});

describe('CSV import', () => {
  type Preview = {
    id: string;
    rowsValid: number;
    rowsInvalid: number;
    rowsDuplicate: number;
    sourceLabel: string;
  };
  const csv = [
    'Staff code,Date-time,Direction',
    `DEMO-T91,${D2} 09:00,in`,
    `DEMO-T91,${D2} 17:10,out`,
    `DEMO-T91,${D1} 09:25,in`, // already entered by hand
    `DEMO-T91,${D2} 17:10,out`, // repeated in the file
    `DEMO-NOPE,${D2} 09:00,in`,
  ].join('\n');

  it('previews row by row, commits once, skips stored punches and refuses the same file again', async () => {
    const preview = await post<Preview>(previewRoute, w.hr, '/imports', {
      filename: 'sample-punches.csv',
      content: csv,
    });
    expect(preview.status).toBe(201);
    expect(preview.data).toMatchObject({
      rowsValid: 2,
      rowsInvalid: 1,
      rowsDuplicate: 2,
      sourceLabel: 'Imported from sample-punches.csv',
    });
    const id = preview.data!.id;
    const commit = await callRoute<{ added: number; skipped: number }>(
      commitRoute,
      authedRequest(w.hr, `/ops/api/v1/attendance/imports/${id}`, { method: 'POST', json: {} }),
      { id },
    );
    expect(commit.data).toMatchObject({ added: 2, skipped: 0 });
    const stored = await ctx.db
      .select()
      .from(opsAttendancePunches)
      .where(
        and(
          eq(opsAttendancePunches.staffId, w.teacher.staffId),
          eq(opsAttendancePunches.source, 'import'),
        ),
      );
    expect(stored).toHaveLength(2);
    expect(await w.day(w.teacher.staffId, D2)).toMatchObject({ status: 'present' });
    const again = await post(previewRoute, w.hr, '/imports', {
      filename: 'renamed.csv',
      content: csv,
    });
    expect(again.status).toBe(409);
  });

  it('nobody imports their own punches: a row error on preview, skipped on commit', async () => {
    await profile(ctx.db, w.hr2.staffId, 'DEMO-H02');
    const own = await post<{ rows: { errors: string[] }[]; rowsValid: number }>(
      previewRoute,
      w.hr2,
      '/imports',
      { filename: 'own.csv', content: `Staff code,Date-time,Direction\nDEMO-H02,${D3} 09:00,in` },
    );
    expect(own.data).toMatchObject({ rowsValid: 0 });
    expect(own.data!.rows[0]!.errors).toEqual(['Another HR person must record this.']);
    // Previewed by someone else, committed by the person the row is about: still not stored.
    const theirs = await post(previewRoute, w.hr, '/imports', {
      filename: 'hr2.csv',
      content: `Staff code,Date-time,Direction\nDEMO-H02,${D3} 09:30,in`,
    });
    const id = theirs.data!.id;
    const commit = await callRoute<{ added: number }>(
      commitRoute,
      authedRequest(w.hr2, `/ops/api/v1/attendance/imports/${id}`, { method: 'POST', json: {} }),
      { id },
    );
    expect(commit.data).toMatchObject({ added: 0 });
    const stored = await ctx.db
      .select()
      .from(opsAttendancePunches)
      .where(eq(opsAttendancePunches.staffId, w.hr2.staffId));
    expect(stored).toEqual([]);
  });

  it('a row for someone who has left is refused', async () => {
    const gone = await staffUser(ctx.db, ['teacher'], { name: 'Sample Former Teacher' });
    await profile(ctx.db, gone.staffId, 'DEMO-T93');
    await ctx.db
      .update(staffMembers)
      .set({ status: 'inactive' })
      .where(eq(staffMembers.id, gone.staffId));
    const preview = await post<{ rows: { errors: string[] }[] }>(previewRoute, w.hr, '/imports', {
      filename: 'leaver.csv',
      content: `Staff code,Date-time,Direction
DEMO-T93,${D1} 09:00,in`,
    });
    expect(preview.data!.rows[0]!.errors).toEqual([
      'Sample Former Teacher (DEMO-T93) no longer works here',
    ]);
  });

  it('a header-less file is refused with the column names', async () => {
    const bad = await post(previewRoute, w.hr, '/imports', {
      filename: 'x.csv',
      content: 'a,b\n1,2',
    });
    expect(bad.status).toBe(400);
  });
});

describe('HR Overview figures', () => {
  it('counts link to filtered lists; staff get none', async () => {
    const counts = await hrAttendanceCounts(ctx.db, w.hr);
    expect(counts.map((c) => c.key)).toEqual([
      'attendance_review',
      'attendance_missing_checkout',
      'attendance_corrections',
      'attendance_unmarked_yesterday',
    ]);
    expect(counts.find((c) => c.key === 'attendance_corrections')?.value).toBe(1);
    for (const c of counts) expect(c.href).toMatch(/^\/ops\/hr\/attendance\?/);
    expect(await hrAttendanceCounts(ctx.db, w.teacher)).toEqual([]);
  });
});
