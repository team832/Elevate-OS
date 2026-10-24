/**
 * The whole development sample set (brief 23 Oct 2026 §25, §27) seeded as `npm run db:seed` does,
 * then reconciled: it is idempotent, fee chart totals equal their drill-down and the ledger, each
 * Marketing Overview figure equals the list it opens, test ranks follow the verified scores
 * (competition ranking), rosters equal the eligible batches, and db:clear-samples removes every
 * sample row of the new tables while real rows survive.
 */
import { describe, expect, it } from 'vitest';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { hashPassword, type AuthenticatedUser } from '@elevate/authentication';
import {
  academicBatches,
  academicStudents,
  marketingOptimisationCategories,
  opsLeadStages,
  opsTaskReminders,
  staffMembers,
  academicAssessmentBatches,
  academicAssessmentRoster,
  academicAssessments,
  academicBatchPlacements,
  academicEnrolments,
  academicResultPublications,
  marketingCalendarItems,
  marketingCampaigns,
  marketingIdeas,
  marketingOptimisationItems,
  marketingTargets,
  opsFeeRecords,
  opsHrRequests,
  opsLeadStageHistory,
  opsLeads,
  opsScoreImportRows,
  opsScoreImports,
  opsStaffTasks,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, MARKETING_EMPLOYEES, runSeeds } from '@elevate/database/seed';
import type { RoleKey, SessionId, UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds, SAMPLE_TESTS } from '@elevate/academic-os/seed';
import { clearSamples, seeds as opsSeeds } from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { feeYear } from '../../../business-ops-os/src/server/fee-year';
import { listTasks } from '../../../business-ops-os/src/server/task-list';
import { taskListQuery } from '../../../business-ops-os/src/server/staff-tasks-schemas';
import { createLead, listLeads } from '../../../business-ops-os/src/server/leads';
import { createTask } from '../../../business-ops-os/src/server/task-create';
import { createHrRequest } from '../../../business-ops-os/src/server/hr-requests';
import { createCampaign } from '../../../marketing-os/src/server/groups';
import { addCampaignMember } from '../../../marketing-os/src/server/campaign-members';
import { createCalendarItem } from '../../../marketing-os/src/server/calendar';
import {
  addObservation,
  createOptimisationItem,
} from '../../../marketing-os/src/server/optimisation';
import { createTarget } from '../../../marketing-os/src/server/targets';
import {
  createAssessmentInternal,
  internalActor,
  snapshotRosterInternal,
} from '../../../academic-os/src/server/services/assessment-ops';
import { loadOverview } from '../../../marketing-os/src/server/dashboard-overview';
import { listCalendarItems } from '../../../marketing-os/src/server/calendar-queries';
import { targetDrilldown } from '../../../marketing-os/src/server/targets';
import { istMidnightUtc } from '../../../marketing-os/src/domain';
import { addDays, toIsoDate } from '@elevate/shared-types';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const all = [...coreSeeds, ...marketingSeeds, ...academicSeeds, ...opsSeeds, ...platformSeeds];
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };

const SAMPLE_TABLES = {
  'ops.leads': opsLeads,
  'ops.lead_stage_history': opsLeadStageHistory,
  'ops.staff_tasks': opsStaffTasks,
  'ops.hr_requests': opsHrRequests,
  'ops.score_imports': opsScoreImports,
  'ops.score_import_rows': opsScoreImportRows,
  'ops.fee_records': opsFeeRecords,
  'academic.assessments': academicAssessments,
  'academic.assessment_roster': academicAssessmentRoster,
  'academic.result_publications': academicResultPublications,
  'marketing.campaigns': marketingCampaigns,
  'marketing.ideas': marketingIdeas,
  'marketing.calendar_items': marketingCalendarItems,
  'marketing.optimisation_items': marketingOptimisationItems,
  'marketing.targets': marketingTargets,
};
const tally = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(SAMPLE_TABLES).map(async ([k, t]) => [k, await db().$count(t)] as const),
    ),
  );

async function userOf(email: string): Promise<AuthenticatedUser> {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  const roles = await db()
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u!.id));
  return {
    id: u!.id as UserId,
    email: u!.email,
    displayName: u!.displayName,
    roles: roles.map((r) => r.role as RoleKey),
    sessionId: 'test' as SessionId,
  } as AuthenticatedUser;
}

/** Competition ranking (1, 2, 2, 4) of verified present scores, highest first. */
const competition = (scores: number[]) => scores.map((s) => 1 + scores.filter((x) => x > s).length);

describe('development sample set (db:seed) reconciles', () => {
  it('seeds everything and a second run changes no counts', async () => {
    await runSeeds(db(), all, context);
    const first = await tally();
    await runSeeds(db(), all, context);
    expect(await tally()).toEqual(first);
    expect(first['ops.leads']).toBeGreaterThanOrEqual(38);
    expect(first['academic.assessments']).toBe(SAMPLE_TESTS.length);
  }, 600_000);

  it('test rosters equal the eligible batches and ranks follow the verified scores', async () => {
    const tests = await db()
      .select()
      .from(academicAssessments)
      .where(eq(academicAssessments.isSample, true));
    for (const t of tests.filter((x) => x.rosterSnapshotAt)) {
      const batchIds = (
        await db()
          .select()
          .from(academicAssessmentBatches)
          .where(eq(academicAssessmentBatches.assessmentId, t.id))
      ).map((b) => b.batchId);
      const eligible = await db()
        .selectDistinct({ studentId: academicEnrolments.studentId })
        .from(academicBatchPlacements)
        .innerJoin(
          academicEnrolments,
          eq(academicEnrolments.id, academicBatchPlacements.enrolmentId),
        )
        .where(
          and(
            inArray(academicBatchPlacements.batchId, batchIds),
            eq(academicEnrolments.status, 'active'),
            lte(academicBatchPlacements.startDate, t.scheduledDate!),
            or(
              isNull(academicBatchPlacements.endDate),
              gte(academicBatchPlacements.endDate, t.scheduledDate!),
            ),
          ),
        );
      const roster = await db()
        .select()
        .from(academicAssessmentRoster)
        .where(eq(academicAssessmentRoster.assessmentId, t.id));
      expect(roster.map((r) => r.studentId).sort()).toEqual(
        eligible.map((e) => e.studentId).sort(),
      );
      expect(roster.every((r) => r.isSample)).toBe(true);
    }
    // Only sample teachers are responsible for or evaluate a sample test (never a real teacher).
    const teacherIds = tests.flatMap((t) => [t.responsibleTeacherStaffId, t.evaluatorStaffId]);
    const teachers = await db()
      .select({ name: staffMembers.fullName })
      .from(staffMembers)
      .where(
        inArray(
          staffMembers.id,
          teacherIds.filter((x) => x !== null),
        ),
      );
    expect(teachers.length).toBeGreaterThan(0);
    expect(teachers.every((t) => t.name.startsWith('Sample '))).toBe(true);
    const mock = tests.find((t) => t.code === 'SAMPLE-IPMAT-MOCK-01')!;
    expect(
      await db().$count(
        academicAssessmentBatches,
        eq(academicAssessmentBatches.assessmentId, mock.id),
      ),
    ).toBe(2);
    const rows = await db()
      .select()
      .from(academicAssessmentRoster)
      .where(eq(academicAssessmentRoster.assessmentId, mock.id));
    const ranked = rows.filter((r) => r.marksState === 'verified');
    const scores = ranked.map((r) => Number(r.score));
    expect(ranked.map((r) => r.rank)).toEqual(competition(scores));
    expect([...ranked.map((r) => r.rank!)].sort((a, b) => a - b).slice(0, 4)).toEqual([1, 2, 2, 4]);
    expect(scores).toContain(0); // present with zero
    expect(scores.some((s) => s < 0)).toBe(true); // negative marking
    expect(rows.some((r) => r.attendance === 'absent' && r.score === null)).toBe(true);
    expect(rows.some((r) => r.admissionNumberSnapshot)).toBe(true);
    expect(
      await db().$count(
        academicResultPublications,
        and(
          eq(academicResultPublications.assessmentId, mock.id),
          eq(academicResultPublications.status, 'current'),
        ),
      ),
    ).toBe(1);

    const clat = tests.find((t) => t.code === 'SAMPLE-CLAT-CA-01')!;
    const clatRows = await db()
      .select()
      .from(academicAssessmentRoster)
      .where(eq(academicAssessmentRoster.assessmentId, clat.id));
    expect(clatRows.some((r) => r.attendance === 'present' && r.marksState === 'not_entered')).toBe(
      true,
    ); // missing score, not absence
    const [imp] = await db()
      .select()
      .from(opsScoreImports)
      .where(eq(opsScoreImports.assessmentId, clat.id));
    expect(imp).toMatchObject({ status: 'in_review', isSample: true });
    const statuses = (
      await db().select().from(opsScoreImportRows).where(eq(opsScoreImportRows.importId, imp!.id))
    ).map((r) => r.matchStatus);
    expect(statuses).toContain('ambiguous');
    expect(statuses).toContain('unmatched');
    const states = tests.map((t) => [t.code, t.status]);
    expect(states).toEqual(
      expect.arrayContaining([
        ['SAMPLE-C11-MATH-01', 'finalised'],
        ['SAMPLE-CAF-ACC-01', 'scheduled'],
      ]),
    );
  });

  it('fee chart totals equal their drill-down rows and the ledger; every fee scenario exists', async () => {
    const ops = await userOf('operations-manager@example.test');
    const year = await feeYear(db(), ops, {});
    const sum = (k: 'billedPaise' | 'paidPaise' | 'outstandingPaise') =>
      year.rows.reduce((n, r) => n + r[k], 0);
    expect(year.totals.billedPaise).toBe(sum('billedPaise'));
    expect(year.totals.paidPaise).toBe(sum('paidPaise'));
    expect(year.totals.outstandingPaise).toBe(sum('outstandingPaise'));
    const [ledger] = await db()
      .select({ n: sql<number>`coalesce(sum(${opsFeeRecords.amountPaise}), 0)::int` })
      .from(opsFeeRecords)
      .where(
        and(
          eq(opsFeeRecords.kind, 'received'),
          inArray(opsFeeRecords.planId, year.rows.map((r) => r.planId) as never[]),
        ),
      );
    expect(year.totals.paidPaise).toBe(ledger!.n);
    expect(year.rows.some((r) => r.paidPaise === r.billedPaise && r.billedPaise > 0)).toBe(true); // paid
    expect(year.rows.some((r) => r.paidPaise > 0 && r.paidPaise < r.billedPaise)).toBe(true); // partly paid
    expect(year.rows.some((r) => r.paidPaise === 0)).toBe(true); // unpaid
    expect(year.rows.some((r) => r.outstandingPaise > r.overduePaise)).toBe(true); // future instalment
  });

  it('each Marketing Overview figure equals the list it opens', async () => {
    const manager = await userOf('marketing-manager@example.test');
    const today = toIsoDate();
    const f = {
      from: `${today.slice(0, 8)}01` as typeof today,
      to: addDays(today, 30),
      fromDefaults: false,
    };
    const o = await loadOverview(db(), manager, f);
    const period = { from: istMidnightUtc(f.from), to: istMidnightUtc(addDays(f.to, 1)) };
    expect(o.calendar).toMatchObject({
      due: (await listCalendarItems(db(), { ...period, due: true })).length,
      awaitingReview: (await listCalendarItems(db(), { ...period, status: 'submitted' })).length,
    });
    if (typeof o.leads !== 'object') throw new Error('leads not loaded');
    expect(o.leads.awaitingContact).toBe(
      (await listLeads(db(), manager, { flag: 'awaiting_contact' })).length,
    );
    const overdue = await listTasks(db(), manager, taskListQuery.parse({ due: 'overdue' }), 500);
    if (typeof o.tasks.overdue !== 'object') throw new Error('tasks not loaded');
    expect(o.tasks.overdue.total).toBe(overdue.total);
    expect(overdue.total).toBeGreaterThan(0);
    if (!Array.isArray(o.targets)) throw new Error('targets not loaded');
    expect(o.targets.length).toBeGreaterThan(0);
    for (const t of o.targets) {
      const drill = await targetDrilldown(db(), manager, t.target.id);
      expect(drill.actual.value).toBe(t.actual.value);
      if (t.actual.value !== null && drill.records.status === 'ok')
        expect(drill.records.rows.length).toBe(t.actual.value);
    }
  });

  it('db:clear-samples removes every sample row of the new tables, keeps real rows, and runs clean twice', async () => {
    const ops = await userOf('operations-manager@example.test');
    const manager = await userOf('marketing-manager@example.test');
    const pooja = await userOf(MARKETING_EMPLOYEES[0].email);
    const [poojaStaff] = await db()
      .select()
      .from(staffMembers)
      .where(eq(staffMembers.userId, pooja.id));
    const today = toIsoDate();
    // One REAL (not sample) row in each new table, made through the services where they exist.
    const { lead } = await createLead(db(), ops, {
      studentName: 'Real Lead (test)',
      studentEmail: 'real.lead@example.test',
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
    } as never);
    const task = await createTask(db(), manager, {
      title: 'Real task (test)',
      staffId: poojaStaff!.id,
      dueOn: today,
      priority: 'medium',
      status: 'pending',
      progressPercent: 0,
      recurrence: 'none',
      visibility: 'assignee_chain',
      publish: true,
      reviewRequired: false,
    } as never);
    await db()
      .insert(opsTaskReminders)
      .values({
        taskId: task.id as never,
        staffId: poojaStaff!.id,
        kind: 'due_soon',
        windowKey: `real-${today}`,
      });
    await createHrRequest(db(), pooja, {
      category: 'other',
      subject: 'Real request (test)',
      message: 'Real.',
      recipient: 'hr',
      relatedKind: 'none',
      urgency: 'normal',
      draft: false,
    } as never);
    const campaign = await createCampaign(db(), manager, {
      code: 'REAL-TEST',
      name: 'Real campaign (test)',
      status: 'active',
    });
    await addCampaignMember(db(), manager, campaign.id, { staffId: poojaStaff!.id, role: 'owner' });
    await createCalendarItem(db(), manager, {
      title: 'Real calendar item (test)',
      itemType: 'social_post',
      campaignId: campaign.id,
    });
    const item = await createOptimisationItem(db(), manager, {
      pageUrl: 'https://www.example.test/real',
      topic: 'Real item (test)',
      categoryKey: 'seo',
      checks: [],
    });
    await addObservation(db(), manager, item.id, {
      platform: 'Search',
      query: 'real',
      observedOn: today,
      result: 'Real observation (test).',
    });
    await createTarget(db(), manager, {
      scope: 'campaign',
      campaignId: campaign.id,
      periodStart: today,
      periodEnd: today,
      metricKey: 'campaign_deliverables',
      targetValue: 1,
    });
    const [batch] = await db()
      .select()
      .from(academicBatches)
      .where(eq(academicBatches.code, 'IPMAT-C12-APR27'));
    const [student] = await db()
      .insert(academicStudents)
      .values({ code: 'STU-REAL01', fullName: 'Real Student (test)' })
      .returning();
    const [enrolment] = await db()
      .insert(academicEnrolments)
      .values({
        studentId: student!.id,
        programmeId: batch!.programmeId,
        courseId: batch!.courseId,
        batchId: batch!.id,
        startDate: today,
        source: 'manual',
        manualReason: 'Real student (test).',
      })
      .returning();
    await db().insert(academicBatchPlacements).values({
      enrolmentId: enrolment!.id,
      batchId: batch!.id,
      startDate: today,
      placedByUserId: ops.id,
    });
    const actor = await internalActor(db(), ops.id, 'test');
    const testId = await createAssessmentInternal(db(), actor, {
      code: 'REAL-TEST-01',
      title: 'Real test',
      kind: 'chapter_test',
      academicYear: '2026-27',
      batchIds: [batch!.id],
      scheduledDate: today,
      maxMarks: '10',
    } as never);
    await snapshotRosterInternal(db(), actor, testId, { admissionNumbers: [] });
    const [imp] = await db()
      .insert(opsScoreImports)
      .values({
        assessmentId: testId,
        source: 'manual',
        status: 'in_review',
        mapping: {},
        rowsTotal: 1,
        counts: {},
        createdBy: ops.id,
      } as never)
      .returning();
    await db()
      .insert(opsScoreImportRows)
      .values({ importId: imp!.id, rowNo: 1, original: {}, parsed: {}, matchStatus: 'unmatched' });
    const real = {
      'ops.leads': 1,
      'ops.lead_stage_history': await db().$count(
        opsLeadStageHistory,
        eq(opsLeadStageHistory.leadId, lead.id),
      ),
      'ops.staff_tasks': 1,
      'ops.task_reminders': 1,
      'ops.hr_requests': 1,
      'ops.score_imports': 1,
      'ops.score_import_rows': 1,
      'academic.assessments': 1,
      'academic.assessment_roster': 1,
      'marketing.campaigns': 1,
      'marketing.campaign_members': 1,
      'marketing.calendar_items': 1,
      'marketing.optimisation_items': 1,
      'marketing.optimisation_observations': 1,
      'marketing.targets': 1,
    };
    const legacyIdeas = await db().$count(marketingIdeas, eq(marketingIdeas.isSample, false));

    const deleted = await clearSamples(db());
    for (const table of [
      'ops.hr_requests',
      'ops.score_imports',
      'academic.assessments',
      'academic.assessment_roster',
      'academic.result_publications',
      'ops.lead_stage_history',
      'marketing.campaigns',
      'marketing.ideas',
      'marketing.calendar_items',
      'marketing.optimisation_items',
      'marketing.optimisation_observations',
      'marketing.targets',
    ])
      expect(deleted[table], table).toBeGreaterThan(0);
    const left = Object.fromEntries(
      await Promise.all(
        Object.keys(real).map(
          async (t) =>
            [
              t,
              Number(
                (
                  (await db().execute(sql.raw(`SELECT count(*) AS n FROM ${t}`))) as unknown as {
                    rows: { n: number }[];
                  }
                ).rows[0]!.n,
              ),
            ] as const,
        ),
      ),
    );
    expect(left).toEqual(real);
    expect(await db().$count(marketingIdeas)).toBe(legacyIdeas);
    // Reference data is not sample.
    expect(await db().$count(opsLeadStages)).toBe(12);
    expect(await db().$count(marketingOptimisationCategories)).toBe(3);
    expect(await clearSamples(db())).toEqual({});
  });
});
