/**
 * Workspace overview data (apps/platform/src/server/overview-adapter.ts): every widget
 * is loaded through the modules' services with the signed-in user's permissions and
 * record scope, and missing is never shown as zero. Ops rows are inserted directly
 * (the Ops workflows have their own tests); everyone is fictional.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  opsAdmissions,
  opsFollowUps,
  opsLeads,
  programmes,
  staffMembers,
  type OpsAdmissionStatus,
} from '@elevate/database';
import { SEED_PROGRAMMES } from '@elevate/database/seed';
import type { LeadId, RoleKey, StaffMemberId } from '@elevate/shared-types';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  FOLLOW_UP_ROWS,
  filterFollowUps,
  istDate,
  loadAttention,
  loadFollowUps,
  loadInbox,
  loadMetrics,
  loadPipeline,
  loadTodayClasses,
  mapPipeline,
  type OverviewDeps,
  type Widget,
} from '../../src/server/overview-adapter';

const ctx = setupTestDatabase();
// Tuesday 20 Oct 2026, 10:00 IST
const now = new Date('2026-10-20T04:30:00Z');
const day = (offset: number) => istDate(now, offset);

type Staff = TestUser & { staffId: StaffMemberId };

async function staff(roles: RoleKey[], name: string): Promise<Staff> {
  const user = await createTestUser(ctx.db, { roles, displayName: `${name} (fictional)` });
  const [row] = await ctx.db
    .insert(staffMembers)
    .values({ userId: user.id, fullName: user.displayName })
    .returning({ id: staffMembers.id });
  return { ...user, staffId: row!.id };
}

const as = (user: TestUser): OverviewDeps => ({ db: ctx.db, user, now });
const deps = async (roles: RoleKey[]) => as(await createTestUser(ctx.db, { roles }));

const byKey = <T extends { key: string }>(items: T[], key: string) => {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
};
const metricOf = async (d: OverviewDeps, key: string) =>
  byKey(await loadMetrics(d, loadInbox(d)), key).metric;
function ok<T>(w: Widget<T>): T {
  if (w.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(w)}`);
  return w.data;
}

let n = 0;
async function lead(
  owner: Staff,
  status: OpsAdmissionStatus,
  options: { programme?: string; mergedInto?: LeadId } = {},
): Promise<LeadId> {
  n += 1;
  const [p] = await ctx.db
    .select({ id: programmes.id })
    .from(programmes)
    .where(eq(programmes.code, options.programme ?? 'IPMAT'));
  const [row] = await ctx.db
    .insert(opsLeads)
    .values({
      code: `LEAD-${String(800000 + n)}`,
      studentName: `Overview Student ${n} (fictional)`,
      studentEmail: `overview-${n}@example.test`,
      studentPhone: `+9198700${String(10000 + n)}`,
      firstReceivedAt: now,
      programmeId: p!.id,
      ownerStaffId: owner.staffId,
      mergedIntoLeadId: options.mergedInto ?? null,
      mergedAt: options.mergedInto ? now : null,
      createdBy: owner.id,
    })
    .returning({ id: opsLeads.id });
  await ctx.db.insert(opsAdmissions).values({
    code: `ADM-${String(800000 + n)}`,
    leadId: row!.id,
    programmeId: p!.id,
    counsellorStaffId: owner.staffId,
    status,
    heldFromStatus: status === 'on_hold' ? 'contacted' : null,
    ...(status === 'enrolled'
      ? { enrolmentId: randomUUID() as never, academicStudentId: randomUUID() as never }
      : {}),
    createdBy: owner.id,
  });
  return row!.id;
}

const followUp = (owner: Staff, leadId: LeadId, title: string, due: string, status = 'open') =>
  ctx.db.insert(opsFollowUps).values({
    leadId,
    kind: 'first_contact',
    title,
    dueDate: due,
    ownerStaffId: owner.staffId,
    status: status as 'open',
    completedAt: status === 'done' ? now : null,
    outcome: status === 'done' ? 'Sample outcome' : null,
  } as never);

let manager: OverviewDeps;
let asha: Staff;
let ravi: Staff;

beforeAll(async () => {
  for (const [code, name, description, status] of SEED_PROGRAMMES)
    await ctx.db
      .insert(programmes)
      .values({ code, name, description, status })
      .onConflictDoNothing();
  manager = await deps(['operations_manager']);
  asha = await staff(['admissions_counsellor'], 'Asha Counsellor');
  ravi = await staff(['admissions_counsellor'], 'Ravi Counsellor');
});

describe('overview — permissions are respected', () => {
  it('a teacher sees no Business Ops figures: Not available with a reason, never 0', async () => {
    const d = await deps(['teacher']);
    const inbox = loadInbox(d);
    expect(await inbox).toMatchObject({ status: 'unavailable' });

    const metrics = await loadMetrics(d, inbox);
    for (const key of ['activeEnquiries', 'pendingApprovals']) {
      const m = byKey(metrics, key).metric;
      expect(m.status).toBe('missing');
      expect(m.value).toBeNull();
      expect(m.status === 'missing' && m.reason).toMatch(/role/i);
    }
    for (const w of [await loadPipeline(d), await loadFollowUps(d, undefined)])
      expect(w).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/role/) });

    const attention = await loadAttention(d, inbox);
    expect(attention.map((a) => a.key)).toEqual(['admissionDecisions', 'contentApprovals']);
    for (const a of attention) {
      expect(a.count).toBeNull();
      expect(a.reason).toBeTruthy();
    }
  });

  it('a marketing contributor (no Academic timetable) gets "unavailable" for today’s classes, not an empty list', async () => {
    const d = await deps(['marketing_contributor']);
    expect(await loadTodayClasses(d)).toMatchObject({ status: 'unavailable' });
  });

  it('an operations manager gets the live approvals inbox count', async () => {
    const pending = byKey(await loadMetrics(manager, loadInbox(manager)), 'pendingApprovals');
    // a measured, empty inbox is a real 0 (sources exist and loaded)
    expect(pending.metric).toMatchObject({ status: 'ok', value: 0 });
  });

  it('a marketing manager sees the live count of content in review', async () => {
    const d = await deps(['marketing_manager']);
    const content = byKey(await loadAttention(d, loadInbox(d)), 'contentApprovals');
    expect(content.count).toBe(0);
    expect(content.reason).toBeUndefined();
  });

  it('an academic coordinator gets live students and classes (measured 0 shows as 0)', async () => {
    const d = await deps(['academic_coordinator']);
    expect(await metricOf(d, 'studentsEnrolled')).toMatchObject({ status: 'ok', value: 0 });
    expect(await loadTodayClasses(d)).toMatchObject({ status: 'ok', data: [] });
  });
});

describe('overview — empty data is an explicit empty state, missing is never zero', () => {
  it('no leads, cases or follow-ups yet: measured zeros and empty lists, no rows invented', async () => {
    expect(await metricOf(manager, 'activeEnquiries')).toMatchObject({ status: 'ok', value: 0 });
    expect(ok(await loadPipeline(manager)).every((s) => s.count === 0)).toBe(true);
    expect(ok(await loadFollowUps(manager, undefined))).toEqual({
      rows: [],
      matched: 0,
      total: 0,
      capped: false,
    });
  });

  it('a failed inbox becomes "Not available", never 0', async () => {
    const failed: Promise<Widget<never>> = Promise.resolve({ status: 'error', message: 'x' });
    const pending = byKey(await loadMetrics(manager, failed), 'pendingApprovals');
    expect(pending.metric).toMatchObject({ status: 'missing', value: null });
    for (const a of (await loadAttention(manager, failed)).slice(0, 1)) expect(a.count).toBeNull();
  });
});

describe('overview — live Business Ops data, scoped to the signed-in user', () => {
  beforeAll(async () => {
    const a1 = await lead(asha, 'new', { programme: 'CLAT' });
    const a2 = await lead(asha, 'counselled');
    await lead(asha, 'enrolled');
    await lead(asha, 'lost');
    await lead(asha, 'on_hold');
    await lead(asha, 'new', { mergedInto: a1 });
    const r1 = await lead(ravi, 'contacted');
    await lead(ravi, 'admission_pending');

    await followUp(asha, a1, 'Call back about the weekend batch', day(-1));
    await followUp(asha, a2, 'Send the fee structure', day(0));
    await followUp(asha, a2, 'Already done', day(0), 'done');
    await followUp(ravi, r1, 'Confirm the counselling slot', day(1));
  });

  it('active enquiries: open, non-merged leads (on hold counts; enrolled, lost, merged do not)', async () => {
    expect(await metricOf(manager, 'activeEnquiries')).toMatchObject({ status: 'ok', value: 5 });
    expect(await metricOf(as(asha), 'activeEnquiries')).toMatchObject({ status: 'ok', value: 3 });
    expect(await metricOf(as(ravi), 'activeEnquiries')).toMatchObject({ status: 'ok', value: 2 });
  });

  it('pipeline: cases per stage, a counsellor sees only their own', async () => {
    const counts = (w: Widget<{ label: string; count: number }[]>) =>
      ok(w).map((s) => [s.label, s.count]);
    expect(counts(await loadPipeline(manager))).toEqual([
      ['New', 1],
      ['Contacted', 1],
      ['Counselling', 1],
      ['Application', 1],
      ['Enrolled', 1],
    ]);
    expect(counts(await loadPipeline(as(asha)))).toEqual([
      ['New', 1],
      ['Contacted', 0],
      ['Counselling', 1],
      ['Application', 0],
      ['Enrolled', 1],
    ]);
  });

  it('follow-ups: open ones, earliest due first, own scope, no contact details', async () => {
    const all = ok(await loadFollowUps(manager, undefined));
    expect(all.rows.map((r) => r.nextStep)).toEqual([
      'Call back about the weekend batch',
      'Send the fee structure',
      'Confirm the counselling slot',
    ]);
    expect(all.rows.map((r) => r.due)).toEqual([day(-1), day(0), day(1)]);
    expect(all.rows[0]).toMatchObject({
      programme: 'CLAT UG preparation',
      owner: 'Asha Counsellor (fictional)',
    });
    for (const r of all.rows) {
      expect(Object.keys(r).sort()).toEqual(
        ['due', 'id', 'leadId', 'nextStep', 'owner', 'programme', 'student'].sort(),
      );
      expect(JSON.stringify(r)).not.toMatch(/@example\.test|\+91/);
    }
    const mine = ok(await loadFollowUps(as(ravi), undefined));
    expect(mine.rows.map((r) => r.nextStep)).toEqual(['Confirm the counselling slot']);
  });

  it('follow-up filter (?fq=) matches student, programme, owner or next step', async () => {
    const clat = ok(await loadFollowUps(manager, 'clat'));
    expect(clat.rows.map((r) => r.programme)).toEqual(['CLAT UG preparation']);
    expect(clat).toMatchObject({ matched: 1, total: 3 });
    expect(ok(await loadFollowUps(manager, 'ravi')).rows).toHaveLength(1);
    expect(ok(await loadFollowUps(manager, 'FEE STRUCTURE')).rows).toHaveLength(1);
    const none = ok(await loadFollowUps(manager, 'no such student'));
    expect(none).toMatchObject({ rows: [], matched: 0, total: 3 });
    expect(filterFollowUps(clat.rows, '  ')).toHaveLength(1);
  });

  it('follow-ups are bounded: at most the first rows due, with the true match count', async () => {
    const r1 = await lead(ravi, 'contacted');
    for (let i = 0; i < FOLLOW_UP_ROWS; i += 1)
      await followUp(ravi, r1, `Bulk follow-up ${i}`, day(3));
    const w = ok(await loadFollowUps(manager, undefined));
    expect(w.rows).toHaveLength(FOLLOW_UP_ROWS);
    expect(w).toMatchObject({ matched: FOLLOW_UP_ROWS + 3, total: FOLLOW_UP_ROWS + 3 });
  });
});

describe('overview — pure helpers', () => {
  it('maps Business Ops statuses onto the five overview stages (lost / on hold excluded)', () => {
    const stages = mapPipeline({
      new: 1,
      contacted: 2,
      counselling_scheduled: 1,
      counselled: 1,
      demo_scheduled: 1,
      demo_attended: 1,
      admission_pending: 1,
      admitted: 1,
      enrolment_requested: 1,
      enrolled: 5,
      lost: 9,
      on_hold: 9,
    });
    expect(stages.map((s) => [s.label, s.count])).toEqual([
      ['New', 1],
      ['Contacted', 2],
      ['Counselling', 4],
      ['Application', 3],
      ['Enrolled', 5],
    ]);
    expect(mapPipeline({}).every((s) => s.count === 0)).toBe(true);
  });
});
