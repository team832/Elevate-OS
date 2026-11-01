/**
 * The owner's database holds samples seeded in October, named the old way. db:clear-samples finds
 * them by their flags, by the old .sample@ address with the old student name, and in tables with no
 * flag by the exact names the old seeds wrote. A real row that only looks similar stays.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  academicRooms,
  academicStudents,
  branches,
  marketingMetricImports,
  marketingSocialAccounts,
  opsAppointments,
  opsHolidays,
  opsLeads,
  opsStaffProfiles,
  opsWorkSchedules,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { retireSampleLogins } from '@elevate/database/seed';
import { createTestUser, setupTestDatabase } from '@elevate/testing';
import { clearSamples } from '../../seed';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const STARTS = new Date('2026-10-20T05:00:00Z');
const ENDS = new Date('2026-10-20T06:00:00Z');
let deleted: Record<string, number>;
let sampleLogin: { id: string };
let realLogin: { id: string };

beforeAll(async () => {
  sampleLogin = await createTestUser(db(), {
    email: 'hr-manager@example.test',
    displayName: 'Sample HR Manager',
    roles: ['hr_manager'],
  });
  realLogin = await createTestUser(db(), {
    email: 'real.hr@elevateeducation.in',
    displayName: 'Real Colleague',
    roles: ['hr_manager'],
  });
  const by = (u: { id: string }) => u.id as never;

  const [flaggedNoLogin, flaggedWithLogin, realStaff] = await db()
    .insert(staffMembers)
    .values([
      { fullName: 'Sample English Teacher' },
      { fullName: 'Sample HR Manager', userId: by(sampleLogin) },
      { fullName: 'Sample Looking Person' },
    ])
    .returning();
  await db()
    .insert(opsStaffProfiles)
    .values([
      { staffId: flaggedNoLogin!.id, isSample: true },
      { staffId: flaggedWithLogin!.id, isSample: true, displayName: 'Sample HR Manager' },
      { staffId: realStaff!.id },
    ]);

  const lead = (code: string, studentName: string, studentEmail: string, isSample = false) => ({
    code,
    studentName,
    studentEmail,
    isSample,
    firstReceivedAt: STARTS,
    createdBy: by(sampleLogin),
  });
  await db()
    .insert(opsLeads)
    .values([
      lead('LEAD-000101', 'Aarav Sample Student', 'aarav.sample@example.test', true),
      lead('LEAD-000102', 'Tanisha Demo Student', 'tanisha.sample@example.test'),
      lead('LEAD-000103', 'Riya Sample Student', 'riya.sample@example.test'),
      lead('LEAD-000901', 'Asha Sample', 'asha.sample@example.test'),
      lead('LEAD-000902', 'Riya Sample Student', 'riya.parent@example.test'),
    ]);
  await db()
    .insert(academicStudents)
    .values([
      {
        code: 'STU-DEMO0001',
        fullName: 'Yash Sample Student',
        email: 'yash.sample@example.test',
        isSample: true,
      },
      { code: 'STU-DEMO0002', fullName: 'Om Sample Student', email: 'om.sample@example.test' },
      { code: 'STU-REAL0001', fullName: 'Om Sample', email: 'om.sample@example.test' },
    ]);

  const schedule = (name: string, u: { id: string }) => ({
    name,
    weeklyPattern: {} as never,
    createdBy: by(u),
  });
  await db()
    .insert(opsWorkSchedules)
    .values([
      schedule('Sample schedule: teaching days (fictional)', sampleLogin),
      schedule('Sample schedule: office days (fictional)', sampleLogin),
      schedule('Sample schedule: weekend classes (fictional)', realLogin),
      schedule('Sample schedule: ours', sampleLogin),
    ]);

  const [oldBranch] = await db()
    .insert(branches)
    .values([
      { code: 'SAMPLE_BRANCH', name: 'Sample branch (fictional)' },
      { code: 'SAMPLE_BRANCH_2', name: 'Sample branch (fictional)' },
    ])
    .returning();
  await db()
    .insert(opsHolidays)
    .values([
      {
        name: 'Sample holiday: staff training day (fictional)',
        holidayOn: '2026-10-20',
        branchId: oldBranch!.id,
        createdBy: by(sampleLogin),
      },
      { name: 'Sample holiday: ours', holidayOn: '2026-10-21', createdBy: by(sampleLogin) },
      {
        name: 'Sample holiday: centre foundation day (fictional)',
        holidayOn: '2026-10-22',
        createdBy: by(realLogin),
      },
    ]);
  await db()
    .insert(academicRooms)
    .values([
      { code: 'SAMPLE-R1', name: 'Sample Room 1 (fictional)' },
      { code: 'SAMPLE-HALL', name: 'Sample seminar hall (fictional)' },
      { code: 'SAMPLE-OURS', name: 'Sample room we really have' },
      { code: 'R1', name: 'Sample Room 1 (fictional)' },
    ]);

  const event = (title: string, u: { id: string }) => ({
    type: 'webinar' as const,
    title,
    startsAt: STARTS,
    endsAt: ENDS,
    staffId: realStaff!.id,
    mode: 'online' as const,
    createdBy: by(u),
  });
  await db()
    .insert(opsAppointments)
    .values([
      event('Sample CLAT open house (fictional)', sampleLogin),
      event('Sample IPMAT parents’ webinar (fictional)', realLogin),
      event('Sample open day', sampleLogin),
    ] as never);

  const [account] = await db()
    .insert(marketingSocialAccounts)
    .values({ code: 'OLDT', platform: 'instagram', scope: 'company', status: 'live' } as never)
    .returning();
  const metrics = (fileSha256: string, u: { id: string }) => ({
    accountId: account!.id,
    fileName: 'Sample metrics export (fictional).csv',
    fileSha256,
    format: 'csv',
    dateFormat: 'YYYY-MM-DD',
    capturedAt: STARTS,
    rowsTotal: 0,
    rowsAccepted: 0,
    rowsRejected: 0,
    rejected: [],
    importedBy: by(u),
  });
  await db()
    .insert(marketingMetricImports)
    .values([metrics('a', sampleLogin), metrics('b', realLogin)] as never);

  deleted = await clearSamples(db());
});

describe('db:clear-samples on a database seeded the old way', () => {
  it.each([
    ['ops.leads', 3],
    ['academic.students', 2],
    ['core.staff_members', 1],
    ['ops.work_schedules', 2],
    ['ops.holidays', 1],
    ['academic.rooms', 2],
    ['core.branches', 1],
    ['ops.appointments', 1],
    ['marketing.metric_imports', 1],
  ])('removes the old rows of %s', (table, n) => expect(deleted[table]).toBe(n));

  it('keeps every real row that only looks similar', async () => {
    const names = async <T extends { n: string }>(rows: Promise<T[]>) =>
      (await rows).map((r) => r.n).sort();
    expect(await names(db().select({ n: opsLeads.code }).from(opsLeads))).toEqual([
      'LEAD-000901',
      'LEAD-000902',
    ]);
    expect(await names(db().select({ n: academicStudents.code }).from(academicStudents))).toEqual([
      'STU-REAL0001',
    ]);
    expect(await names(db().select({ n: opsWorkSchedules.name }).from(opsWorkSchedules))).toEqual([
      'Sample schedule: ours',
      'Sample schedule: weekend classes (fictional)',
    ]);
    expect(await names(db().select({ n: opsHolidays.name }).from(opsHolidays))).toEqual([
      'Sample holiday: centre foundation day (fictional)',
      'Sample holiday: ours',
    ]);
    expect(await names(db().select({ n: academicRooms.code }).from(academicRooms))).toEqual([
      'R1',
      'SAMPLE-OURS',
    ]);
    expect(await names(db().select({ n: branches.code }).from(branches))).toEqual([
      'SAMPLE_BRANCH_2',
    ]);
    expect(
      await names(db().select({ n: opsAppointments.title }).from(opsAppointments) as never),
    ).toEqual(['Sample IPMAT parents’ webinar (fictional)', 'Sample open day']);
    expect(await db().$count(marketingMetricImports)).toBe(1);
    expect(await clearSamples(db())).toEqual({});
  });

  it('old sample logins and staff that survive read as removed; a real one is untouched', async () => {
    await retireSampleLogins(db());
    const logins = await db()
      .select()
      .from(users)
      .where(inArray(users.id, [sampleLogin.id, realLogin.id] as never[]));
    expect(logins.find((u) => u.id === (sampleLogin.id as never))).toMatchObject({
      displayName: expect.stringMatching(/^Removed sample login /),
      status: 'disabled',
      passwordHash: null,
    });
    expect(logins.find((u) => u.id === (realLogin.id as never))).toMatchObject({
      displayName: 'Real Colleague',
      status: 'active',
    });
    const [kept] = await db()
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.userId, sampleLogin.id as never));
    expect(kept!.fullName).toMatch(/^Removed sample staff /);
    const [real] = await db()
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.fullName, 'Sample Looking Person'));
    expect(real!.status).toBe('active');
  });
});
