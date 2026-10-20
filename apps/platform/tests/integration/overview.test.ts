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
  opsAttendanceSessions,
  opsFollowUps,
  opsLeads,
  opsTasks,
  programmes,
  staffMembers,
} from '@elevate/database';
import { SEED_PROGRAMMES } from '@elevate/database/seed';
import type { LeadId, RoleKey, StaffMemberId } from '@elevate/shared-types';
import { createTestUser, setupTestDatabase, type TestUser } from '@elevate/testing';
import {
  FOLLOW_UP_ROWS,
  filterFollowUps,
  filterPriorities,
  istDate,
  istWeek,
  loadAttention,
  loadFollowUps,
  loadInbox,
  loadMetrics,
  loadPipeline,
  loadPriorities,
  loadTodayClasses,
  mapPipeline,
  parsePriorityTab,
  type OverviewDeps,
  type PriorityRow,
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
  status: string,
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
      ? { enrolmentId: randomUUID() as never, studentId: randomUUID() as never }
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
  } as never);

const task = (owner: Staff, title: string, due: string | null, status = 'not_started') => {
  n += 1;
  return ctx.db.insert(opsTasks).values({
    code: `TSK-${String(80000 + n)}`,
    title,
    ownerStaffId: owner.staffId,
    dueDate: due,
    status,
    completedAt: status === 'completed' ? now : null,
    completionNote: status === 'completed' ? 'Done (test)' : null,
    createdBy: owner.id,
  } as never);
};

const session = (who: Staff, status: 'open' | 'superseded') =>
  ctx.db.insert(opsAttendanceSessions).values({
    staffId: who.staffId,
    workDate: day(0),
    clockInAt: new Date(now.getTime() - 3_600_000),
    timezone: 'Asia/Kolkata',
    source: 'self',
    status,
    supersededAt: status === 'superseded' ? now : null,
    createdBy: who.id,
  } as never);

let manager: OverviewDeps;
let hr: OverviewDeps;
let asha: Staff;
let ravi: Staff;

beforeAll(async () => {
  for (const [code, name, description, status] of SEED_PROGRAMMES)
    await ctx.db
      .insert(programmes)
      .values({ code, name, description, status })
      .onConflictDoNothing();
  manager = await deps(['operations_manager']);
  hr = await deps(['hr_manager']);
  asha = await staff(['admissions_counsellor'], 'Asha Counsellor');
  ravi = await staff(['admissions_counsellor'], 'Ravi Counsellor');
});

describe('overview — permissions are respected', () => {
  it('a teacher sees no Business Ops figures: Not available with a reason, never 0', async () => {
    const d = await deps(['teacher']);
    const inbox = loadInbox(d);
    expect(await inbox).toMatchObject({ status: 'unavailable' });

    const metrics = await loadMetrics(d, inbox);
    for (const key of ['activeEnquiries', 'staffPresent', 'pendingApprovals']) {
      const m = byKey(metrics, key).metric;
      expect(m.status).toBe('missing');
      expect(m.value).toBeNull();
      expect(m.status === 'missing' && m.reason).toMatch(/role/i);
    }
    for (const w of [await loadPipeline(d), await loadFollowUps(d, undefined)])
      expect(w).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/role/) });
    // teachers hold ops:tasks:read (own tasks): the widget is shown, with only their tasks
    expect(ok(await loadPriorities(d, 'all')).rows).toEqual([]);

    const attention = await loadAttention(d, inbox);
    expect(attention.map((a) => a.key)).toEqual([
      'admissionDecisions',
      'attendanceCorrections',
      'contentApprovals',
    ]);
    for (const a of attention) {
      expect(a.count).toBeNull();
      expect(a.reason).toBeTruthy();
    }
  });

  it('a marketing contributor (no Academic timetable) gets "unavailable" for today’s classes, not an empty list', async () => {
    const d = await deps(['marketing_contributor']);
    expect(await loadTodayClasses(d)).toMatchObject({ status: 'unavailable' });
  });

  it('an HR manager has no lead, admissions or follow-up access', async () => {
    expect(await metricOf(hr, 'activeEnquiries')).toMatchObject({ status: 'missing' });
    expect(await loadPipeline(hr)).toMatchObject({ status: 'unavailable' });
    expect(await loadFollowUps(hr, undefined)).toMatchObject({ status: 'unavailable' });
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
  it('no leads, cases, follow-ups or tasks yet: measured zeros and empty lists, no rows invented', async () => {
    expect(await metricOf(manager, 'activeEnquiries')).toMatchObject({ status: 'ok', value: 0 });
    expect(ok(await loadPipeline(manager)).every((s) => s.count === 0)).toBe(true);
    expect(ok(await loadFollowUps(manager, undefined))).toEqual({
      rows: [],
      matched: 0,
      total: 0,
      capped: false,
    });
    expect(ok(await loadPriorities(manager, 'all'))).toMatchObject({
      rows: [],
      counts: { today: 0, week: 0, all: 0 },
    });
  });

  it('staff present: no attendance recorded by anyone today is "Not available", not 0', async () => {
    const m = await metricOf(hr, 'staffPresent');
    expect(m).toMatchObject({ status: 'missing', value: null });
    expect(m.status === 'missing' && m.reason).toBe(
      'No attendance recorded today, and no shifts are assigned for today.',
    );
  });

  it('a failed inbox becomes "Not available", never 0', async () => {
    const failed: Promise<Widget<never>> = Promise.resolve({ status: 'error', message: 'x' });
    const pending = byKey(await loadMetrics(manager, failed), 'pendingApprovals');
    expect(pending.metric).toMatchObject({ status: 'missing', value: null });
    for (const a of (await loadAttention(manager, failed)).slice(0, 2)) expect(a.count).toBeNull();
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

    await task(asha, 'Close September attendance corrections', day(-1), 'blocked');
    await task(asha, 'Publish the weekend timetable', istWeek(now).to, 'in_progress');
    await task(asha, 'Plan the mock test hall', day(8));
    await task(asha, 'Review call scripts', null);
    await task(asha, 'Finished task', day(0), 'completed');
    await task(ravi, 'Reconcile fee receipts', day(0), 'at_risk');
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
    expect(all.rows[0]).toMatchObject({ programme: 'CLAT', owner: 'Asha Counsellor (fictional)' });
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
    expect(clat.rows.map((r) => r.programme)).toEqual(['CLAT']);
    expect(clat).toMatchObject({ matched: 1, total: 3 });
    expect(ok(await loadFollowUps(manager, 'ravi')).rows).toHaveLength(1);
    expect(ok(await loadFollowUps(manager, 'FEE STRUCTURE')).rows).toHaveLength(1);
    const none = ok(await loadFollowUps(manager, 'no such student'));
    expect(none).toMatchObject({ rows: [], matched: 0, total: 3 });
    expect(filterFollowUps(clat.rows, '  ')).toHaveLength(1);
  });

  it('team priorities: open tasks per tab, own scope, real status labels', async () => {
    const all = ok(await loadPriorities(manager, 'all'));
    expect(all.counts).toEqual({ today: 2, week: 3, all: 5 });
    expect(all.rows.map((r) => r.title)).toEqual([
      'Close September attendance corrections',
      'Reconcile fee receipts',
      'Publish the weekend timetable',
      'Plan the mock test hall',
      'Review call scripts',
    ]);
    expect(all.rows.map((r) => r.status)).toEqual([
      'Blocked',
      'At risk',
      'In progress',
      'Not started',
      'Not started',
    ]);
    for (const tab of ['today', 'week', 'all'] as const) {
      const w = ok(await loadPriorities(manager, tab));
      expect(w.rows).toHaveLength(w.counts[tab]);
    }
    expect(ok(await loadPriorities(as(ravi), 'all')).rows.map((r) => r.title)).toEqual([
      'Reconcile fee receipts',
    ]);
    expect(ok(await loadPriorities(as(asha), 'today')).counts).toEqual({
      today: 1,
      week: 2,
      all: 4,
    });
  });

  it('staff present: distinct staff with a live session today; 0 is real once attendance exists', async () => {
    const present = await staff(['employee'], 'Present Employee');
    const absent = await staff(['employee'], 'Absent Employee');
    await session(present, 'open');
    await session(absent, 'superseded'); // a replaced session is not attendance

    const all = byKey(await loadMetrics(hr, loadInbox(hr)), 'staffPresent');
    expect(all.metric).toMatchObject({ status: 'ok', value: 1 });
    expect(all.note).toBe('No shifts are assigned for today');
    expect(await metricOf(as(present), 'staffPresent')).toMatchObject({ status: 'ok', value: 1 });
    // someone recorded attendance today, so "none of mine" is a measured 0
    expect(await metricOf(as(absent), 'staffPresent')).toMatchObject({ status: 'ok', value: 0 });
    // an employee login with no staff record: unknown, not 0
    const unlinked = await metricOf(await deps(['employee']), 'staffPresent');
    expect(unlinked).toMatchObject({ status: 'missing', value: null });
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
  it('priority tabs: Today = due today or overdue; This week = by Sunday; All = everything', () => {
    const rows: PriorityRow[] = [
      { id: 'a', title: 'overdue', owner: 'x', due: '2026-10-19', status: 'Not started' },
      { id: 'b', title: 'today', owner: 'x', due: '2026-10-20', status: 'Not started' },
      { id: 'c', title: 'sunday', owner: 'x', due: '2026-10-25', status: 'Not started' },
      { id: 'd', title: 'next week', owner: 'x', due: '2026-10-26', status: 'Not started' },
      { id: 'e', title: 'no due date', owner: 'x', due: null, status: 'Not started' },
    ];
    expect(istWeek(now)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(filterPriorities(rows, 'today', now).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterPriorities(rows, 'week', now).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(filterPriorities(rows, 'all', now).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parsePriorityTab('week')).toBe('week');
    expect(parsePriorityTab('nonsense')).toBe('today');
  });

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
