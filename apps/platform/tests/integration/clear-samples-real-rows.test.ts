/**
 * db:clear-samples never deletes a real record (R-SEED ruling). After the full sample set:
 * - optional links of real rows to sample rows are emptied, reported in one line per table and
 *   audited: a real calendar item from a sample idea, a real task about a sample lead, a real HR
 *   request linked to a sample task;
 * - required links stop the command before anything changes, with a plain list: a real target on a
 *   sample campaign, a real test covering a real batch and SAMPLE-CAF, a real content item made
 *   from a sample idea.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { hashPassword, type AuthenticatedUser } from '@elevate/authentication';
import {
  academicAssessments,
  academicBatches,
  auditEvents,
  marketingCalendarItems,
  marketingCampaigns,
  marketingContentItems,
  marketingIdeas,
  marketingTargets,
  opsHrRequests,
  opsLeads,
  opsStaffTasks,
  staffMembers,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { coreSeeds, MARKETING_EMPLOYEES, runSeeds } from '@elevate/database/seed';
import type { RoleKey, SessionId, UserId } from '@elevate/shared-types';
import { setupTestDatabase } from '@elevate/testing';
import { seeds as academicSeeds } from '@elevate/academic-os/seed';
import {
  ClearSamplesRefused,
  clearSamples,
  seeds as opsSeeds,
} from '@elevate/business-ops-os/seed';
import { seeds as marketingSeeds } from '@elevate/marketing-os/seed';
import { seeds as platformSeeds } from '../../seed';
import { createHrRequest } from '../../../business-ops-os/src/server/hr-requests';
import { createTask } from '../../../business-ops-os/src/server/task-create';
import { createContentItem } from '../../../marketing-os/src/server/content';
import { createTarget } from '../../../marketing-os/src/server/targets';
import {
  createAssessmentInternal,
  internalActor,
} from '../../../academic-os/src/server/services/assessment-ops';

const ctx = setupTestDatabase();
const db = () => ctx.db as Database;
const context = { seedUserPassword: 'test-only-seed-password', hashPassword, log: () => {} };

async function userOf(email: string) {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  const roles = await db()
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, u!.id));
  const [staff] = await db().select().from(staffMembers).where(eq(staffMembers.userId, u!.id));
  const user = {
    id: u!.id as UserId,
    email,
    displayName: u!.displayName,
    roles: roles.map((r) => r.role as RoleKey),
    sessionId: 't' as SessionId,
  } as AuthenticatedUser;
  return { user, staffId: staff!.id };
}
const ideaOf = async (title: string) =>
  (
    await db()
      .select()
      .from(marketingIdeas)
      .where(eq(marketingIdeas.title, `${title} (sample proposal)`))
  )[0]!;

let real: { calendarId: string; taskId: string; requestId: string };

beforeAll(async () => {
  await runSeeds(
    db(),
    [...coreSeeds, ...marketingSeeds, ...academicSeeds, ...opsSeeds, ...platformSeeds],
    context,
  );
  const ops = await userOf('operations-manager@example.test');
  const pooja = await userOf(MARKETING_EMPLOYEES[0].email);
  const [sampleLead] = await db()
    .select()
    .from(opsLeads)
    .where(eq(opsLeads.isSample, true))
    .limit(1);
  const [sampleTask] = await db()
    .select()
    .from(opsStaffTasks)
    .where(and(eq(opsStaffTasks.isSample, true), eq(opsStaffTasks.staffId, pooja.staffId)))
    .limit(1);
  // Optional links: what normal demo use produces.
  const [calendar] = await db()
    .insert(marketingCalendarItems)
    .values({
      title: 'Real post from a sample idea',
      itemType: 'social_post',
      status: 'idea',
      ideaId: (await ideaOf('CLAT current-affairs recap')).id,
      createdBy: ops.user.id,
    })
    .returning();
  const task = await createTask(db(), ops.user, {
    title: 'Real call about a sample lead',
    staffId: pooja.staffId,
    leadId: sampleLead!.id,
    priority: 'medium',
    status: 'pending',
    progressPercent: 0,
    recurrence: 'none',
    visibility: 'assignee_chain',
    publish: true,
    reviewRequired: false,
  } as never);
  const request = await createHrRequest(db(), pooja.user, {
    category: 'tasks',
    subject: 'Real request about my task',
    message: 'Real.',
    recipient: 'hr',
    relatedKind: 'none',
    urgency: 'normal',
    draft: false,
  } as never);
  await db()
    .update(opsHrRequests)
    .set({ linkedTaskId: sampleTask!.id })
    .where(eq(opsHrRequests.id, request.id));
  real = { calendarId: calendar!.id, taskId: task.id, requestId: request.id };
}, 600_000);

describe('db:clear-samples and real rows', () => {
  it('refuses with a plain list and deletes nothing while a real record needs a sample one', async () => {
    const manager = await userOf('marketing-manager@example.test');
    const ops = await userOf('operations-manager@example.test');
    const [campaign] = await db()
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.code, 'SAMPLE-IPMAT-WEBINAR'));
    const today = new Date().toISOString().slice(0, 10);
    const target = await createTarget(db(), manager.user, {
      scope: 'campaign',
      campaignId: campaign!.id,
      periodStart: today,
      periodEnd: today,
      metricKey: 'campaign_deliverables',
      targetValue: 2,
    });
    const batches = await db().select().from(academicBatches);
    const id = (code: string) => batches.find((b) => b.code === code)!.id;
    const testId = await createAssessmentInternal(
      db(),
      await internalActor(db(), ops.user.id, 't'),
      {
        code: 'MOCK-07',
        title: 'Real mixed test',
        kind: 'chapter_test',
        academicYear: '2026-27',
        batchIds: [id('CAF-SEP27-REG'), id('SAMPLE-CAF')],
        maxMarks: '10',
      } as never,
    );
    const content = await createContentItem(
      db(),
      manager.user,
      (await ideaOf('Admission webinar')).id,
      { title: 'Real webinar script', format: 'script' },
    );
    const sampleLeads = await db().$count(opsLeads);

    const refusal = await clearSamples(db()).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ClearSamplesRefused);
    const problems = (refusal as ClearSamplesRefused).problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Target "campaign_deliverables" .* sample campaign SAMPLE-IPMAT-WEBINAR/,
        ),
        'Test MOCK-07 covers real batch CAF-SEP27-REG and sample batch SAMPLE-CAF; remove the sample batch from it first.',
        expect.stringMatching(/^Content item "Real webinar script" was made from sample idea /),
      ]),
    );
    expect(problems).toHaveLength(3);
    expect(await db().$count(opsLeads)).toBe(sampleLeads); // nothing deleted
    expect(await db().$count(opsStaffTasks, eq(opsStaffTasks.id, real.taskId as never))).toBe(1);

    // The owner fixes them (here: removes them); then the clear runs.
    await db().delete(marketingTargets).where(eq(marketingTargets.id, target.id));
    await db()
      .delete(academicAssessments)
      .where(eq(academicAssessments.id, testId as never));
    await db().delete(marketingContentItems).where(eq(marketingContentItems.id, content.id));
  });

  it('keeps real rows, empties their optional links to sample rows, says so and audits it', async () => {
    const lines: string[] = [];
    const deleted = await clearSamples(db(), (l) => lines.push(l));
    expect(deleted['ops.leads']).toBeGreaterThan(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Unlinked 1 real calendar item(s) from sample ideas, campaigns or tasks',
        'Unlinked 1 real task(s) about sample leads, students, tests, batches, requests or parent tasks',
        'Unlinked 1 real request(s) through HR linked to sample tasks or records',
      ]),
    );
    const [calendar] = await db()
      .select()
      .from(marketingCalendarItems)
      .where(eq(marketingCalendarItems.id, real.calendarId as never));
    expect(calendar).toMatchObject({ ideaId: null, isSample: false });
    const [task] = await db()
      .select()
      .from(opsStaffTasks)
      .where(eq(opsStaffTasks.id, real.taskId as never));
    expect(task).toMatchObject({ leadId: null, isSample: false });
    const [request] = await db()
      .select()
      .from(opsHrRequests)
      .where(eq(opsHrRequests.id, real.requestId as never));
    expect(request).toMatchObject({ linkedTaskId: null, isSample: false });
    expect(
      await db().$count(auditEvents, eq(auditEvents.action, 'samples.real_rows_unlinked')),
    ).toBe(3);
    expect(await db().$count(opsLeads)).toBe(0);
    expect(await clearSamples(db())).toEqual({});
  });
});
