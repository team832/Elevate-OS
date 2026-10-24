/**
 * Marketing team sample set in Business Ops (brief 23 Oct 2026 §25): about 40 leads with owners,
 * calls and follow-ups, a duplicate pair, a Do-not-contact lead, tasks in every state with valid
 * people, requests through HR (one for Schar in HR's queue). Idempotent.
 */
import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { hashPassword } from '@elevate/authentication';
import {
  opsDuplicateFlags,
  opsFollowUps,
  opsHrRequests,
  opsLeadActivities,
  opsLeadStageHistory,
  opsLeads,
  opsStaffTasks,
  staffMembers,
  users,
} from '@elevate/database';
import { coreSeeds, MARKETING_EMPLOYEES, runSeeds } from '@elevate/database/seed';
import { setupTestDatabase } from '@elevate/testing';
import { seeds } from '../../seed';
import { SAMPLE_MARKETING_LEADS } from '../../seed/sample-leads';
import { SAMPLE_LEAD_COUNT } from '../../seed/samples';
import { SAMPLE_HR_REQUESTS, SAMPLE_TEAM_TASKS } from '../../seed/sample-team-work';
import { istToday } from '../../src/domain';

const ctx = setupTestDatabase();
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };
const counts = () =>
  Promise.all(
    [
      opsLeads,
      opsLeadActivities,
      opsLeadStageHistory,
      opsFollowUps,
      opsStaffTasks,
      opsHrRequests,
    ].map((t) => ctx.db.$count(t)),
  );

describe('marketing team sample set (Ops)', () => {
  it('is idempotent', async () => {
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    const first = await counts();
    await runSeeds(ctx.db, [...coreSeeds, ...seeds], context);
    expect(await counts()).toEqual(first);
  });

  it('has about 40 leads, each employee owning some, with calls and follow-ups due today and overdue', async () => {
    const leads = await ctx.db.select().from(opsLeads);
    expect(leads).toHaveLength(SAMPLE_LEAD_COUNT + SAMPLE_MARKETING_LEADS.length);
    expect(leads.every((l) => l.isSample && !l.studentPhone && !l.guardianPhone)).toBe(true);
    const staff = await ctx.db
      .select({ email: users.email, id: staffMembers.id })
      .from(staffMembers)
      .innerJoin(users, eq(users.id, staffMembers.userId));
    for (const e of MARKETING_EMPLOYEES) {
      const id = staff.find((s) => s.email === e.email)!.id;
      expect(leads.filter((l) => l.ownerStaffId === id).length).toBeGreaterThan(5);
    }
    expect(leads.filter((l) => !l.ownerStaffId).length).toBeGreaterThan(0);
    const calls = await ctx.db
      .select()
      .from(opsLeadActivities)
      .where(eq(opsLeadActivities.kind, 'call'));
    expect(new Set(calls.map((c) => c.direction))).toEqual(new Set(['inbound', 'outbound']));
    const today = istToday(new Date());
    const open = await ctx.db.select().from(opsFollowUps).where(eq(opsFollowUps.status, 'open'));
    expect(open.some((f) => f.dueDate === today)).toBe(true);
    expect(open.some((f) => f.dueDate < today)).toBe(true);
    expect(await ctx.db.$count(opsFollowUps, eq(opsFollowUps.status, 'done'))).toBeGreaterThan(0);
  });

  it('has a duplicate pair for review, one Do-not-contact lead, stages with history and no Converted sample', async () => {
    expect(
      await ctx.db.$count(opsDuplicateFlags, isNull(opsDuplicateFlags.reviewedAt)),
    ).toBeGreaterThan(0);
    const dnc = await ctx.db.select().from(opsLeads).where(eq(opsLeads.doNotContact, true));
    expect(dnc.map((l) => l.stageKey)).toEqual(['do_not_contact']);
    const leads = await ctx.db.select().from(opsLeads);
    expect(new Set(leads.map((l) => l.stageKey))).toEqual(
      new Set([
        'new',
        'contacted',
        'qualified',
        'demo_booked',
        'demo_attended',
        'admission_in_progress',
        'nurture',
        'lost',
        'do_not_contact',
      ]),
    );
    // Sample admissions are legacy-unverified, so Converted would be a false claim.
    expect(leads.some((l) => l.stageKey === 'converted')).toBe(false);
    for (const l of leads.filter((x) => x.stageKey && x.stageKey !== 'new'))
      expect(
        await ctx.db.$count(
          opsLeadStageHistory,
          and(eq(opsLeadStageHistory.leadId, l.id), eq(opsLeadStageHistory.toKey, l.stageKey!)),
        ),
      ).toBeGreaterThan(0);
  });

  it('every task has a valid assignee and reviewer, and every state the brief names exists', async () => {
    const tasks = await ctx.db.select().from(opsStaffTasks);
    const active = new Set(
      (
        await ctx.db
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .where(eq(staffMembers.status, 'active'))
      ).map((s) => s.id),
    );
    for (const t of tasks) {
      expect(active.has(t.staffId)).toBe(true);
      if (t.reviewRequired) expect(t.reviewerStaffId).not.toBeNull();
      if (t.reviewerStaffId) {
        expect(active.has(t.reviewerStaffId)).toBe(true);
        expect([t.staffId, t.backupStaffId]).not.toContain(t.reviewerStaffId);
      }
    }
    const team = tasks.filter(
      (t) => t.title.endsWith('(sample)') && t.details?.startsWith('Sample task:'),
    );
    expect(team.length).toBeGreaterThanOrEqual(SAMPLE_TEAM_TASKS.length);
    const today = istToday(new Date());
    const has = (f: (t: (typeof tasks)[number]) => boolean) => expect(tasks.some(f)).toBe(true);
    has((t) => t.status === 'pending' && !t.acknowledgedAt);
    has((t) => t.status === 'pending' && Boolean(t.acknowledgedAt));
    has((t) => t.status === 'in_progress' && !t.blockedAt);
    has((t) => Boolean(t.blockedAt));
    has((t) => t.status === 'in_review');
    has((t) => t.status === 'changes_requested');
    has((t) => t.status === 'done' && Boolean(t.approvedAt));
    has((t) => !['done', 'cancelled'].includes(t.status) && t.dueOn < today);
    const parent = tasks.find((t) =>
      t.title.startsWith('Share the CA Foundation open-house post'),
    )!;
    expect(tasks.filter((t) => t.parentTaskId === parent.id)).toHaveLength(
      MARKETING_EMPLOYEES.length,
    );
    expect(tasks.every((t) => t.isSample)).toBe(true);
  });

  it('requests go through HR: submitted, forwarded, resolved, and one for Schar waiting in the HR queue', async () => {
    const requests = await ctx.db.select().from(opsHrRequests);
    expect(requests).toHaveLength(SAMPLE_HR_REQUESTS.length);
    expect(requests.every((r) => r.isSample)).toBe(true);
    expect(requests.map((r) => r.status).sort()).toEqual([
      'forwarded',
      'resolved',
      'submitted',
      'submitted',
    ]);
    const schar = requests.find((r) => r.recipientKey === 'schar')!;
    expect(schar).toMatchObject({ status: 'submitted', recipientStaffId: null });
  });
});
