import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  approvals,
  opsAdmissions,
  opsFeeInstalments,
  opsFeePlans,
  opsFeeRecords,
  students,
  type Database,
} from '@elevate/database';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import { addDays, istToday } from '../../src/domain';
import { feeYearTotals } from '../../src/domain/fee-year';
import { feeYear, owingStudents } from '../../src/server/fee-year';
import { pendingCase } from './admissions-fixtures';
import { setupReference, staffUser, type StaffUser } from './fixtures';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const today = istToday(new Date());
const YEAR = '2026-27';
const TUITION = 100_000_00;
let finance: StaffUser;
let counsellor: StaffUser;
let colleague: StaffUser;
let teacher: TestUser;
let marketing: TestUser;
let fresh: StaffUser;
let code = 0;

/** A case of `who` with a linked student and an agreement inserted as the ledger would hold it. */
async function agreement(
  who: StaffUser,
  o: {
    programmeCode?: string;
    year?: string;
    status?: 'active' | 'closed' | 'draft';
    paid?: number;
    sample?: boolean;
    /** Continue this student's chain: a new version replacing `supersedes`. */
    student?: string;
    total?: number;
    supersedes?: { id: string; version: number };
  },
) {
  const { admissionId, leadId } = await pendingCase(who, { programmeCode: o.programmeCode });
  const [s] = o.student
    ? [{ id: o.student as never }]
    : await db()
        .insert(students)
        .values({ fullName: `Sample Fee Year ${++code}`, isSample: o.sample ?? true })
        .returning();
  await db()
    .update(opsAdmissions)
    .set({ studentId: s!.id })
    .where(eq(opsAdmissions.id, admissionId as never));
  const id = crypto.randomUUID();
  const decided = { decidedBy: finance.id, decidedAt: new Date() };
  const [approval] =
    o.status === 'draft'
      ? []
      : await db()
          .insert(approvals)
          .values({
            subjectModule: 'ops',
            subjectType: 'fee_plan',
            subjectId: id,
            policy: 'ops.fee_agreement.version',
            status: 'approved',
            requestedBy: who.id,
            ...decided,
          })
          .returning();
  const [plan] = await db()
    .insert(opsFeePlans)
    .values({
      id: id as never,
      admissionId: admissionId as never,
      studentId: s!.id,
      label: 'Annual tuition (test)',
      totalPaise: o.total ?? TUITION,
      academicYear: o.year ?? YEAR,
      status: o.status ?? 'active',
      ...(o.supersedes
        ? {
            version: o.supersedes.version + 1,
            supersedesPlanId: o.supersedes.id as never,
            adjustmentReason: 'Changed terms (test)',
          }
        : {}),
      ...(approval
        ? { approvalId: approval.id, approvedBy: finance.id, approvedAt: decided.decidedAt }
        : {}),
      ...(o.status === 'closed'
        ? { closedBy: finance.id, closeReason: 'Student left (test)' }
        : {}),
      createdBy: finance.id,
    })
    .returning();
  await db()
    .insert(opsFeeInstalments)
    .values(
      [
        [addDays(today, -30), 50_000_00],
        [today, 25_000_00],
        [addDays(today, 90), 25_000_00],
      ].map(([dueDate, amountPaise], i) => ({
        planId: plan!.id,
        sequence: i + 1,
        dueDate: dueDate as string,
        amountPaise: amountPaise as number,
      })),
    );
  const fee = (extra: Record<string, unknown>) => ({
    code: `FEE-9${String(++code).padStart(5, '0')}`,
    admissionId: admissionId as never,
    leadId: leadId as never,
    paymentDate: today,
    recordedBy: finance.id,
    ...extra,
  });
  await db()
    .insert(opsFeeRecords)
    .values([
      ...(o.paid ? [fee({ kind: 'received', amountPaise: o.paid, planId: plan!.id })] : []),
      // Registration is a separate charge: never on the agreement, never in annual tuition.
      fee({ kind: 'received', chargeCategory: 'registration', amountPaise: 5_000_00 }),
    ] as never);
  return { studentId: s!.id as string, planId: id };
}

beforeAll(async () => {
  await setupReference(db());
  finance = await staffUser(db(), ['finance_officer']);
  counsellor = await staffUser(db(), ['admissions_counsellor'], { name: 'Sample Counsellor' });
  colleague = await staffUser(db(), ['admissions_counsellor'], { name: 'Sample Colleague' });
  teacher = await createTestUser(db(), { roles: ['teacher'] });
  marketing = await createTestUser(db(), { roles: ['marketing_contributor'] });
  await agreement(counsellor, { programmeCode: 'CLAT', paid: 60_000_00 });
  await agreement(counsellor, { paid: 100_000_00 });
  await agreement(colleague, { status: 'closed', paid: 10_000_00 });
  await agreement(colleague, { status: 'draft' });
  await agreement(colleague, { year: '2025-26' });
  // I1: a change waiting for approval (2024-25) — the last approved version keeps counting.
  const v1 = await agreement(colleague, { year: '2024-25', status: 'closed', paid: 50_000_00 });
  await agreement(colleague, {
    year: '2024-25',
    status: 'draft',
    total: 120_000_00,
    student: v1.studentId,
    supersedes: { id: v1.planId, version: 1 },
  });
  // (c) a chain continued on another counsellor's admission (2022-23): only the newest counts.
  const c1 = await agreement(counsellor, { year: '2022-23', status: 'closed' });
  await agreement(colleague, {
    year: '2022-23',
    student: c1.studentId,
    supersedes: { id: c1.planId, version: 1 },
  });
  fresh = await staffUser(db(), ['admissions_counsellor'], { name: 'Sample New Counsellor' });
  await agreement(fresh, { year: '2023-24', status: 'draft' });
}, 120_000);

describe('A-FEE-9 annual tuition: chart totals = drill-down', () => {
  it.each([
    ['every course', {}, 3, 300_000_00, 130_000_00],
    ['one course', { course: 'CLAT' }, 1, 100_000_00, 40_000_00],
  ])('%s: totals equal the sum of the drill-down rows', async (_, filter, n, billed, owed) => {
    const d = await feeYear(db(), finance, { year: YEAR, ...filter });
    const drill = feeYearTotals(owingStudents(d.rows));
    expect(d.totals).toMatchObject({ students: n, billedPaise: billed, outstandingPaise: owed });
    expect(drill.outstandingPaise).toBe(d.totals.outstandingPaise);
    expect(drill.overduePaise + drill.dueNowPaise + drill.futurePaise).toBe(owed);
  });

  it('counts the closed agreement, not the draft or another year; registration stays out', async () => {
    const d = await feeYear(db(), finance, {});
    expect(d).toMatchObject({ year: YEAR, draftsNotCounted: 1 });
    expect(d.years).toEqual([YEAR, '2025-26', '2024-25', '2022-23']);
    expect(d.rows.filter((r) => r.closed)).toHaveLength(1);
    expect(d.totals.paidPaise).toBe(170_000_00);
    expect(d.courses.map((c) => c.value).sort()).toEqual(['CLAT', 'IPMAT']);
  });

  it('a counsellor sees only the cases they counsel', async () => {
    const own = await feeYear(db(), counsellor, { year: YEAR });
    expect(own.totals).toMatchObject({ students: 2, outstandingPaise: 40_000_00 });
    expect(own.draftsNotCounted).toBe(0);
  });

  it('a change waiting for approval: the last approved version counts and is reported', async () => {
    const d = await feeYear(db(), finance, { year: '2024-25' });
    expect(d.totals).toMatchObject({ students: 1, billedPaise: TUITION, paidPaise: 50_000_00 });
    expect(d).toMatchObject({ changesPending: 1, draftsNotCounted: 0 });
  });

  it('a chain continued on another admission counts once, for whoever sees its newest version', async () => {
    expect((await feeYear(db(), counsellor, { year: '2022-23' })).rows).toHaveLength(0);
    expect((await feeYear(db(), colleague, { year: '2022-23' })).rows).toHaveLength(1);
    expect((await feeYear(db(), finance, { year: '2022-23' })).totals.students).toBe(1);
  });

  it('with only drafts, the empty view still reports them', async () => {
    expect(await feeYear(db(), fresh, {})).toMatchObject({
      years: [],
      year: '2023-24',
      rows: [],
      draftsNotCounted: 1,
    });
  });

  it('drafts follow the course filter', async () => {
    expect((await feeYear(db(), finance, { year: YEAR, course: 'CLAT' })).draftsNotCounted).toBe(0);
    expect((await feeYear(db(), finance, { year: YEAR, course: 'IPMAT' })).draftsNotCounted).toBe(
      1,
    );
  });

  it.each([
    ['teacher', () => teacher],
    ['marketing contributor', () => marketing],
  ])('%s gets 403', async (_, who) => {
    await expect(feeYear(db(), who(), { year: YEAR })).rejects.toMatchObject({ status: 403 });
  });
});
