/**
 * Past students and returning students (brief §11; acceptance 14, 15, 16): directory status per
 * student, exit records with their snapshot, readmission as a new application. Cases are written
 * straight to the database (fictional data) so these tests do not depend on the conversion flow.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { opsAdmissions, opsApplications, opsExitRecords } from '@elevate/database';
import { buildRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as listRoute } from '../../src/app/api/v1/students/route';
import { POST as lifecycle } from '../../src/app/api/v1/admissions/[id]/lifecycle/route';
import { get, post } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf as caseIn, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;

type Row = { id: string; studentId: string; status: string; statusLabel: string };

const list = async (qs: string) => {
  const r = await callRoute<Row[]>(listRoute, get(manager, `/ops/api/v1/students?limit=200&${qs}`));
  expect(r.status).toBe(200);
  return r.data!;
};
const act = (user: { token: string }, admissionId: string, body: unknown) =>
  callRoute<Record<string, unknown>>(lifecycle, post(user, body), { id: admissionId });
const today = new Date().toISOString().slice(0, 10);

const student = (name: string) => identity(ctx.db, name);
const caseOf = caseIn;

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
});

describe('directory status is per student (A-STU-2, acceptance 14 and 15)', () => {
  it('multi-programme student stays active; past lists only students with no active case, once each', async () => {
    const multi = await student('Sample Multi');
    await caseOf(ctx.db, manager.id, multi, 'enrolled');
    await caseOf(ctx.db, manager.id, multi, 'completed', { programme: 'CLASS_12' });
    const early = await student('Sample Early');
    await caseOf(ctx.db, manager.id, early, 'withdrawn');
    const both = await student('Sample Both Exits');
    await caseOf(ctx.db, manager.id, both, 'completed');
    await caseOf(ctx.db, manager.id, both, 'withdrawn', { programme: 'CLASS_12' });
    const held = await student('Sample Held');
    await caseOf(ctx.db, manager.id, held, 'on_hold', { heldFromStatus: 'enrolled' });

    const [active, past, onHold, withdrawn, completed] = await Promise.all([
      list('view=active'),
      list('view=former'),
      list('view=on_hold'),
      list('view=former&outcome=withdrawn_early'),
      list('view=former&outcome=completed'),
    ]);
    const ids = (rows: Row[]) => rows.map((r) => r.studentId);
    expect(ids(active)).toContain(multi);
    expect(ids(past)).not.toContain(multi);
    expect(ids(past).filter((i) => i === both)).toHaveLength(1);
    expect(ids(past)).toEqual(expect.arrayContaining([early, both]));
    expect(ids(past).filter((i) => ids(active).includes(i))).toEqual([]);
    // On hold is not past, and is reached from Active's filter.
    expect(ids(past)).not.toContain(held);
    expect(ids(active)).not.toContain(held);
    expect(ids(onHold)).toContain(held);
    expect(ids(withdrawn)).toEqual(expect.arrayContaining([early, both]));
    expect(ids(withdrawn)).not.toContain(multi);
    expect(ids(completed)).toContain(both);
    expect(ids(completed)).not.toContain(early);
    expect(withdrawn.find((r) => r.studentId === early)?.statusLabel).toBe('Withdrawn early');
    expect(completed.find((r) => r.studentId === both)?.statusLabel).toBe('Completed');
  });
});

describe('case filters and scope apply to the cases before one row per student is chosen (I-1)', () => {
  it('a multi-programme student matches a programme filter on any case; a counsellor sees students with any case of theirs', async () => {
    const counsellor = await staffUser(ctx.db, ['admissions_counsellor']);
    const s = await student('Sample Filter Twice');
    const ipmat = await caseOf(ctx.db, manager.id, s, 'enrolled', {
      programme: 'IPMAT',
      counsellorStaffId: counsellor.staffId,
    });
    await caseOf(ctx.db, manager.id, s, 'enrolled'); // CLAT, updated later, another counsellor
    const ids = (rows: Row[]) => rows.map((r) => r.studentId);
    expect(ids(await list('view=active&programme=IPMAT'))).toContain(s);
    expect(ids(await list('view=active&programme=CLAT'))).toContain(s);
    const own = await callRoute<Row[]>(
      listRoute,
      get(counsellor, '/ops/api/v1/students?view=active&limit=200'),
    );
    expect(own.data!.map((r) => [r.studentId, r.id])).toEqual([[s, ipmat.id]]);
  });
});

describe('exit records (acceptance 14 and 15)', () => {
  it('records the snapshot; the student stays active while another programme runs; 401/403/400', async () => {
    const s = await student('Sample Two Programmes');
    const clat = await caseOf(ctx.db, manager.id, s, 'enrolled');
    await caseOf(ctx.db, manager.id, s, 'enrolled', { programme: 'CLASS_12' });
    const exit = {
      action: 'exit',
      exitStatus: 'completed',
      exitDate: today,
      reason: 'Programme finished (test)',
      reasonCode: 'not_interested',
      materialStatus: 'returned',
      closingNotes: 'All books returned (test)',
    };
    expect(
      (await callRoute(lifecycle, buildRequest('/x', { json: exit }), { id: clat.id })).status,
    ).toBe(401);
    const auditor = await createTestUser(ctx.db, { roles: ['auditor'] });
    expect((await act(auditor, clat.id, exit)).status).toBe(403);
    expect((await act(manager, clat.id, { ...exit, reasonCode: 'made_up_code' })).status).toBe(400);
    expect(
      (await act(manager, clat.id, { ...exit, materialStatus: 'lost_somewhere' })).status,
    ).toBe(400);

    const r = await act(manager, clat.id, exit);
    expect(r.data?.status).toBe('completed');
    const [record] = await ctx.db
      .select()
      .from(opsExitRecords)
      .where(eq(opsExitRecords.admissionId, clat.id));
    expect(record).toMatchObject({
      exitStatus: 'completed',
      reasonCode: 'not_interested',
      materialStatus: 'returned',
      closingNotes: 'All books returned (test)',
      priorBatchId: clat.enrolledBatchId,
      balancePaise: null, // no fee records: not recorded, never 0
      recordedBy: manager.id,
    });
    expect((await list('view=active')).map((x) => x.studentId)).toContain(s);
    expect((await list('view=former')).map((x) => x.studentId)).not.toContain(s);
  });
});

describe('reactivation (kept beside readmission)', () => {
  it('needs ops:students:reactivate and another approver; the exit record keeps who reactivated', async () => {
    const manager2 = await staffUser(ctx.db, ['operations_manager']);
    const a = await caseOf(ctx.db, manager.id, await student('Sample Reactivated'), 'enrolled');
    const exit = {
      action: 'exit',
      exitStatus: 'withdrawn',
      exitDate: today,
      reason: 'Moved (test)',
    };
    expect((await act(manager, a.id, { ...exit, reactivationAllowed: true })).status).toBe(200);
    const reactivate = { action: 'reactivate', reason: 'Family returned (test)' };
    expect((await act(manager, a.id, reactivate)).status).toBe(403);
    expect((await act(manager2, a.id, reactivate)).data?.status).toBe('admitted');
    const [record] = await ctx.db
      .select()
      .from(opsExitRecords)
      .where(eq(opsExitRecords.admissionId, a.id));
    expect(record).toMatchObject({ exitStatus: 'withdrawn', reactivatedBy: manager2.id });
  });

  it('refuses a reactivation once a readmission is open, and a readmission once reactivated (I-2)', async () => {
    const manager2 = await staffUser(ctx.db, ['operations_manager']);
    const exit = {
      action: 'exit',
      exitStatus: 'withdrawn',
      exitDate: today,
      reason: 'Moved (test)',
    };
    const reactivate = { action: 'reactivate', reason: 'Family returned (test)' };
    const readmit = { action: 'readmit', reason: 'Family returned (test)' };
    const a = await caseOf(
      ctx.db,
      manager.id,
      await student('Sample Readmitted First'),
      'enrolled',
    );
    await act(manager, a.id, { ...exit, reactivationAllowed: true });
    expect((await act(manager, a.id, readmit)).status).toBe(200);
    const refused = await act(manager2, a.id, reactivate);
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toMatch(/readmission is already open/);
    const b = await caseOf(
      ctx.db,
      manager.id,
      await student('Sample Reactivated First'),
      'enrolled',
    );
    await act(manager, b.id, { ...exit, reactivationAllowed: true });
    expect((await act(manager2, b.id, reactivate)).status).toBe(200);
    expect((await act(manager, b.id, readmit)).status).toBe(409);
  });
});

describe('readmission (acceptance 16)', () => {
  it('opens a new application and case for the same identity and lead; the old case and number stay', async () => {
    const s = await student('Sample Returning');
    const old = await caseOf(ctx.db, manager.id, s, 'withdrawn');
    const body = {
      action: 'readmit',
      reason: 'Family returned next year (test)',
      academicYear: '2027-28',
    };
    expect((await act(manager, old.id, { ...body, academicYear: '2027' })).status).toBe(400);

    const r = await act(manager, old.id, body);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      origin: 'readmission',
      previousAdmissionId: old.id,
      studentId: s,
    });
    const [app] = await ctx.db
      .select()
      .from(opsApplications)
      .where(eq(opsApplications.id, r.data!.id as never));
    const [fresh] = await ctx.db
      .select()
      .from(opsAdmissions)
      .where(eq(opsAdmissions.id, app!.admissionId));
    expect(fresh).toMatchObject({
      studentId: s,
      leadId: old.leadId, // KYC stays on the same lead (not forked)
      status: 'admission_pending',
      admissionNumber: null, // its own number only at final confirmation
    });
    const [after] = await ctx.db.select().from(opsAdmissions).where(eq(opsAdmissions.id, old.id));
    expect(after).toMatchObject({ status: 'withdrawn', admissionNumber: old.admissionNumber });

    expect((await act(manager, old.id, body)).status).toBe(409);
    const active = await caseOf(ctx.db, manager.id, await student('Sample Still Here'), 'enrolled');
    expect((await act(manager, active.id, body)).status).toBe(409);
  });
});
