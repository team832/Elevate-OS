/**
 * Owner, 31 Oct 2026: tasks had no details, no expected deliverable and no acceptance criteria, and
 * department and requester were not recorded. This fills every sample task, old and new, in place
 * (matched by title, so a database seeded earlier is filled too) and adds the demo teacher's tasks
 * and those of the office staff in every state, with deadline changes (who and why), comments,
 * checklists, reminders and review outcomes, and work reports by day, week and month. Sample rows
 * only (D-036); nothing is sent, in-app reminders are records of what the job would have written.
 * Safe to run again.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicBatches,
  opsEodReports,
  opsHrRequests,
  opsLeads,
  opsStaffTasks,
  opsTaskChecklistItems,
  opsTaskCollaborators,
  opsTaskDependencies,
  opsTaskEvents,
  opsTaskReminders,
  opsTaskReviews,
  opsTaskSubmissions,
  opsTaskUpdates,
  staffMembers,
  type Database,
} from '@elevate/database';
import { POOJA_EMAIL, ROHIT_EMAIL } from '@elevate/database/seed';
import { addDays, type IsoDate } from '../src/domain/dates';
import { periodOf } from '../src/domain/work-report';
import { createTask } from '../src/server/task-create';
import { DEMO_TEACHER_EMAIL, sampleRoster } from './fill-people';
import { sampleAnchorDate } from './sample-staff';
import { seedActor } from './samples';
import {
  samplePeople,
  workContext,
  workHistory,
  writeSampleReport,
  writeSampleTask,
  type Person,
  type SampleTask,
} from './sample-work';
import {
  CHECKLISTS,
  COMMENTS,
  DEMO,
  DUE_CHANGES,
  FILL_MARKETING_REPORTS,
  FILL_OFFICE_TASKS,
  FILL_REPORTS,
  FILL_TEACHER_TASKS,
  NOTES,
  TASK_TEXT,
} from './fill-tasks-data';

export async function seedFillTasks(db: Database, log: (m: string) => void = () => {}) {
  const base = await samplePeople(db);
  if (!base) return log('ops.fill-tasks skipped: sample staff missing');
  const roster = await sampleRoster(db);
  const person = (email: string): Person | null => {
    const p = roster.find((x) => x.email === email);
    return p ? { staffId: p.staffId, userId: p.userId as never } : null;
  };
  const opsManager = person('operations-manager@example.test')!;
  const named = {
    [DEMO]: person(DEMO_TEACHER_EMAIL),
    counsellor: person('admissions-counsellor@example.test'),
    coordinator: person('academic-coordinator@example.test'),
    schar: person('schar.sample@example.test'),
    contributor: person('marketing-contributor@example.test'),
    pooja: person(POOJA_EMAIL),
    rohit: person(ROHIT_EMAIL),
  };
  const people = new Map<string, Person>([
    ...base,
    ...Object.entries(named).filter((e): e is [string, Person] => Boolean(e[1])),
  ]);
  const c = workContext(people);
  const existing = new Set(
    (
      await db
        .select({ t: opsStaffTasks.title })
        .from(opsStaffTasks)
        .where(eq(opsStaffTasks.isSample, true))
    ).map((r) => r.t),
  );
  const add = async (list: readonly SampleTask[], ctx: typeof c) => {
    for (const t of list)
      if (people.has(t.owner) && !existing.has(`${t.title} (sample)`))
        await writeSampleTask(db, t, ctx);
  };
  await add(FILL_TEACHER_TASKS, c);
  await add(FILL_OFFICE_TASKS, { ...c, manager: opsManager });

  // One draft: HR has written it and not assigned it yet (createTask keeps it a draft).
  const hr = (await seedActor(db, 'hr-manager@example.test'))!;
  const DRAFT = 'Plan the November staff meeting (sample)';
  if (named[DEMO] && !existing.has(DRAFT)) {
    const draft = await createTask(db, hr.actor, {
      title: DRAFT,
      staffId: named[DEMO].staffId,
      reviewRequired: false,
      dueOn: c.day(7),
      priority: 'low',
      status: 'pending',
      progressPercent: 0,
      recurrence: 'none',
      visibility: 'assignee_chain',
      publish: false,
    } as never);
    await db
      .update(opsStaffTasks)
      .set({ isSample: true })
      .where(eq(opsStaffTasks.id, draft.id as never));
  }

  const staffOf = new Map(
    (
      await db
        .select({ id: staffMembers.id, departmentId: staffMembers.departmentId })
        .from(staffMembers)
    ).map((s) => [s.id as string, s.departmentId]),
  );
  const marketing = person('marketing-manager@example.test');
  const askers = {
    coordinator: named.coordinator,
    hr: person('hr-manager@example.test'),
    counsellor: named.counsellor,
    marketing,
  };
  const [batch] = await db
    .select({ id: academicBatches.id, code: academicBatches.code })
    .from(academicBatches)
    .where(eq(academicBatches.code, 'SAMPLE-IPMAT-B'));
  const tasks = await db.select().from(opsStaffTasks).where(eq(opsStaffTasks.isSample, true));
  for (const t of tasks) {
    const text = TASK_TEXT[t.title.replace(/ \(sample\)$/, '')];
    if (!text) continue;
    await db
      .update(opsStaffTasks)
      .set({
        details: text.details,
        expectedDeliverable: text.deliverable ?? t.expectedDeliverable,
        acceptanceCriteria: text.done,
        category: text.category,
        departmentId: staffOf.get(t.staffId) ?? null,
        requesterStaffId:
          (text.requested && askers[text.requested]?.staffId) ||
          t.requesterStaffId ||
          t.assignedByStaffId,
        requesterNote:
          text.note ?? t.requesterNote ?? (t.source === 'self' ? 'My own task (sample).' : null),
        plannedStartOn: text.start === undefined ? t.plannedStartOn : addDays(c.day(0), text.start),
        deliveredAt: t.status === 'draft' ? null : t.receivedAt,
        ...(batch && t.staffId === named[DEMO]?.staffId && !t.relatedId
          ? {
              relatedKind: 'batch' as const,
              relatedId: batch.id,
              relatedLabel: `${batch.code} · Quant`,
            }
          : {}),
      })
      .where(eq(opsStaffTasks.id, t.id));
    if (text.submitted)
      await db
        .update(opsTaskSubmissions)
        .set({
          completionNote: text.submitted,
          evidence: 'Sample shared folder; no real file (sample).',
        })
        .where(eq(opsTaskSubmissions.taskId, t.id));
  }
  // What some tasks are about, who stands in, and a task that repeats.
  const links: [string, Partial<typeof opsStaffTasks.$inferInsert>][] = [
    ['Send the weekly enquiry summary', { recurrence: 'weekly' }],
    ['Compile the weekly current-affairs notes', { recurrence: 'weekly' }],
    ['Set the Quant practice paper for Friday', { backupStaffId: people.get('DEMO-T08')?.staffId }],
    [
      'Set 30 Time and Work questions for the Friday practice',
      { backupStaffId: people.get('DEMO-T03')?.staffId },
    ],
  ];
  const [tanisha] = await db
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(eq(opsLeads.studentEmail, 'tanisha.sample@example.test'));
  if (tanisha)
    links.push(['Call back the parents waiting for the fee structure', { leadId: tanisha.id }]);
  for (const [title, set] of links)
    await db
      .update(opsStaffTasks)
      .set(set)
      .where(and(eq(opsStaffTasks.title, `${title} (sample)`), eq(opsStaffTasks.isSample, true)));
  // Submitted before an expected deliverable was recorded: the service would have asked for evidence.
  await db.execute(sql`UPDATE ops.task_submissions s SET evidence = 'Sample shared folder; no real file (sample).'
    FROM ops.staff_tasks t WHERE t.id = s.task_id AND t.is_sample AND t.expected_deliverable IS NOT NULL AND s.evidence IS NULL`);
  const taskOf = (title: string) => tasks.find((t) => t.title === `${title} (sample)`);

  const sampleIds = tasks.map((t) => t.id);
  for (const [work, n] of Object.entries(NOTES))
    await db
      .update(opsTaskUpdates)
      .set({
        result: n.result,
        remainingWork: n.remaining ?? null,
        nextStep: n.next ?? null,
        evidence: n.evidence ?? null,
      })
      .where(
        and(
          eq(opsTaskUpdates.workPerformed, work),
          inArray(opsTaskUpdates.taskId, sampleIds),
          isNull(opsTaskUpdates.result),
        ),
      );

  // One correction: a later update that points at the one it corrects (no second run: unique key).
  const [marked] = await db
    .select()
    .from(opsTaskUpdates)
    .where(
      and(
        eq(opsTaskUpdates.workPerformed, 'Marked half of the answer sheets (sample).'),
        inArray(opsTaskUpdates.taskId, sampleIds),
      ),
    );
  if (marked)
    await db
      .insert(opsTaskUpdates)
      .values({
        taskId: marked.taskId,
        authorUserId: marked.authorUserId,
        authorStaffId: marked.authorStaffId,
        occurredOn: marked.occurredOn,
        occurredAt: marked.occurredAt,
        recordedAt: c.at([-2, '10:00']),
        workPerformed: 'Marked four of the six answer sheets (sample).',
        result: 'Four sheets marked, not three.',
        remainingWork: 'Two sheets, then enter the marks.',
        nextStep: 'Finish marking and enter them on the sheet.',
        durationMinutes: marked.durationMinutes,
        correctsUpdateId: marked.id,
        correctionReason: 'I counted the sheets again (sample).',
        isSample: true,
      })
      .onConflictDoNothing();

  const done = new Set(
    (
      await db
        .select({ id: opsTaskEvents.taskId, k: opsTaskEvents.kind })
        .from(opsTaskEvents)
        .where(
          and(
            inArray(opsTaskEvents.taskId, sampleIds),
            inArray(opsTaskEvents.kind, ['due_changed', 'comment']),
          ),
        )
    ).map((e) => `${e.id}:${e.k}`),
  );
  const manager = c.manager;
  for (const [title, later, , reason, day] of DUE_CHANGES) {
    const t = taskOf(title);
    if (!t || done.has(`${t.id}:due_changed`)) continue;
    const first = addDays(t.dueOn as IsoDate, -later);
    await db.update(opsStaffTasks).set({ originalDueOn: first }).where(eq(opsStaffTasks.id, t.id));
    await db.insert(opsTaskEvents).values({
      taskId: t.id,
      kind: 'due_changed',
      actorUserId: manager.userId,
      occurredAt: c.at([day, '12:00']),
      reason,
      data: { fromDueOn: first, toDueOn: t.dueOn, fromDueTime: t.dueTime, toDueTime: t.dueTime },
    });
  }
  for (const [title, who, day, time, text] of COMMENTS) {
    const t = taskOf(title);
    if (!t || done.has(`${t.id}:comment`)) continue;
    const ownerUser = [...people.values()].find((p) => p.staffId === t.staffId)?.userId;
    const actor = who === 'manager' ? manager.userId : ownerUser!;
    await db.insert(opsTaskEvents).values({
      taskId: t.id,
      kind: 'comment',
      actorUserId: actor,
      occurredAt: c.at([day, time]),
      reason: text,
    });
    if (who === 'manager')
      await db.insert(opsTaskReviews).values({
        taskId: t.id,
        decision: 'comment',
        note: text,
        reviewerUserId: actor,
        createdAt: c.at([day, time]),
      });
  }
  const hasItems = new Set(
    (
      await db
        .select({ id: opsTaskChecklistItems.taskId })
        .from(opsTaskChecklistItems)
        .where(inArray(opsTaskChecklistItems.taskId, sampleIds))
    ).map((r) => r.id),
  );
  for (const [title, items, finished] of CHECKLISTS) {
    const t = taskOf(title);
    if (!t || hasItems.has(t.id)) continue;
    await db.insert(opsTaskChecklistItems).values(
      items.map((text, position) => ({
        taskId: t.id,
        position,
        text,
        doneAt: position < finished ? c.at([-1, '12:00']) : null,
        doneBy: position < finished ? manager.userId : null,
      })),
    );
  }
  const peer = named[DEMO] && people.get('DEMO-T08');
  const shared = taskOf('Set 30 Time and Work questions for the Friday practice');
  if (peer && shared)
    await db
      .insert(opsTaskCollaborators)
      .values({ taskId: shared.id, staffId: peer.staffId, addedBy: manager.userId })
      .onConflictDoNothing();
  const first = taskOf('Enter the marks of the Quant unit test');
  const then = taskOf('Collect the answer sheets of the Ratio and Proportion test');
  if (first && then)
    await db
      .insert(opsTaskDependencies)
      .values({ taskId: first.id, dependsOnTaskId: then.id, createdByUserId: manager.userId })
      .onConflictDoNothing();
  // What the reminder job would have written (no message leaves the app).
  const overdue = tasks.filter(
    (t) => ['pending', 'in_progress', 'changes_requested'].includes(t.status) && t.dueOn < c.day(0),
  );
  if (overdue.length)
    await db
      .insert(opsTaskReminders)
      .values(
        overdue.map((t) => ({
          taskId: t.id,
          staffId: t.staffId,
          kind: 'overdue' as const,
          windowKey: t.dueOn,
          sentAt: c.at([0, '08:00']),
        })),
      )
      .onConflictDoNothing();

  // A request about a task: the sample request and the sample task it is about.
  const asked = taskOf('Write the CA Foundation open-house post');
  if (asked)
    await db
      .update(opsHrRequests)
      .set({ relatedKind: 'task', relatedId: asked.id })
      .where(
        and(
          eq(opsHrRequests.subject, 'Deadline of the open-house post (sample)'),
          eq(opsHrRequests.isSample, true),
        ),
      );

  // Work reports: one per person and period, whatever exists stays.
  const history = await workHistory(db);
  const seen = await db
    .select({ s: opsEodReports.staffId, k: opsEodReports.periodKind, p: opsEodReports.periodStart })
    .from(opsEodReports)
    .where(eq(opsEodReports.isSample, true));
  let reports = 0;
  for (const [list, ctx] of [
    [FILL_REPORTS, c],
    [FILL_MARKETING_REPORTS, { ...c, manager: marketing ?? c.manager }],
  ] as const)
    for (const e of list) {
      const owner = people.get(e.owner);
      const p = periodOf(e.kind ?? 'day', c.day(e.day));
      if (!owner || seen.some((r) => r.s === owner.staffId && r.k === p.kind && r.p === p.start))
        continue;
      await writeSampleReport(db, e, ctx, history);
      reports += 1;
    }
  log(
    `ops.fill-tasks: ${tasks.length} sample tasks filled, ${reports} work report(s) added around ${sampleAnchorDate()}`,
  );
}
