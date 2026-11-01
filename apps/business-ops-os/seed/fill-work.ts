/**
 * Owner, 31 Oct 2026: "total work". Everyone on the sample staff, login or not, has tasks in every
 * lifecycle state (brief, deliverable, checklist, reviews, submissions, comments, dependencies,
 * reminders) and daily, weekly and monthly work reports; someone with no login has theirs keyed in by
 * the coordinator. A few people are left short of yesterday's report, so the missing lists have work.
 * Same writers as ./sample-work.ts. Sample rows only; written once per person, task and period.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  academicBatches,
  academicSubjects,
  academicTeacherAssignments,
  opsAdmissions,
  opsEodReports,
  opsHolidays,
  opsLeads,
  opsLeaveRecords,
  opsStaffProfiles,
  opsStaffTasks,
  opsTaskChecklistItems,
  opsTaskCollaborators,
  opsTaskDependencies,
  opsTaskEvents,
  opsTaskImportBatches,
  opsTaskImportRows,
  opsTaskReminders,
  opsTaskReviews,
  opsWorkSchedules,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { sampleRowIds } from '@elevate/database/seed';
import type { AcademicTeacherActivityV1 } from '@elevate/shared-contracts';
import type { StaffMemberId, UserId } from '@elevate/shared-types';
import { addDays, daysBetween, weekdayOf, type IsoDate } from '../src/domain/dates';
import { periodOf } from '../src/domain/work-report';
import { sampleAnchorDate } from './sample-staff';
import {
  ack,
  to,
  workContext,
  workHistory,
  writeSampleReport,
  writeSampleTask,
  type Person,
  type SampleTask,
  type Step,
} from './sample-work';
import {
  BLOCK_ON_HOLD,
  CANCEL_REASONS,
  CHANGE_ASKS,
  COMMENTS_MANAGER,
  COMMENTS_OWNER,
  DUE_MOVES,
  MONTH_WORDS,
  OFFICE_BRIEFS,
  REOPEN_REASONS,
  REPORT_WORDS,
  REVISION_ASKS,
  TEACHER_BRIEFS,
  WEEK_WORDS,
  type Brief,
} from './fill-work-data';

export type AcademicFor = (
  staffId: string,
  window: { from: string; to: string },
) => Promise<AcademicTeacherActivityV1>;

const pick = <T>(list: readonly T[], i: number) => list[i % list.length]!;
const groupOf = (title: string | null) => {
  const t = (title ?? '').toLowerCase();
  if (t.includes('teacher')) return 'teacher';
  if (t.includes('academic')) return 'academic';
  if (t.includes('counsellor')) return 'counsellor';
  if (t.includes('marketing') || t.includes('content')) return 'marketing';
  if (t.includes('hr ')) return 'hr';
  return 'office';
};

/** One state each; `j` makes dates differ from person to person. */
const SHAPES: readonly ((j: number, b: Brief) => Omit<SampleTask, 'owner' | 'title'>)[] = [
  (j) => ({ shows: 'assigned, not acknowledged', source: 'manager', received: [-1, '16:40'], due: 3 + j, priority: 'medium', steps: [] }),
  (j) => ({ shows: 'asked in person, acknowledged', source: 'verbal', received: [-2, '11:10'], due: 1 + j, priority: 'low', steps: [ack(-2, '11:30')] }),
  (j, b) => ({
    shows: 'in progress',
    source: 'manager',
    received: [-5, '09:45'],
    due: 2 + j,
    dueTime: '17:00',
    priority: 'high',
    progress: 40 + j * 10,
    steps: [ack(-5, '10:05'), to('in_progress', -4, '10:30')],
    updates: [
      { on: -3, work: b.work, at: [-3, '15:00'], minutes: 45 + j * 15, extra: { result: b.result, remainingWork: b.remaining, nextStep: b.next } },
      { on: -1, work: `Carried on: ${b.next.charAt(0).toLowerCase()}${b.next.slice(1).replace(/\.$/, '')}`, at: [-1, '16:15'], minutes: 30 },
    ],
  }),
  (j, b) => ({
    shows: 'blocked with a reason',
    source: 'manager',
    received: [-6, '10:20'],
    due: 1 + j,
    priority: 'medium',
    progress: 20,
    steps: [ack(-6, '11:00'), to('in_progress', -5, '09:30'), { kind: 'blocked_set', at: [-2, '14:30'], reason: b.blocker }],
    updates: [{ on: -5, work: b.work, at: [-5, '12:00'], minutes: 40, blocker: b.blocker, extra: { result: b.result, nextStep: b.next } }],
  }),
  (j, b) => ({
    shows: 'submitted, waiting for review',
    source: 'manager',
    review: true,
    received: [-5, '09:10'],
    due: j,
    priority: 'medium',
    progress: 100,
    deliverable: b.deliverable,
    steps: [ack(-5, '09:40'), to('in_progress', -4, '10:00'), { kind: 'submitted_for_review', at: [-1, '16:30'] }],
    updates: [{ on: -2, work: b.work, at: [-2, '15:30'], minutes: 60, extra: { result: b.result, evidence: b.deliverable } }],
  }),
  (j, b) => ({
    shows: 'changes requested',
    source: 'manager',
    review: true,
    received: [-7, '10:00'],
    due: 1 + j,
    priority: 'high',
    progress: 80,
    deliverable: b.deliverable,
    steps: [ack(-7, '10:10'), to('in_progress', -6, '09:30'), { kind: 'submitted_for_review', at: [-3, '15:00'] }, { kind: 'changes_requested', at: [-2, '11:00'], reason: pick(CHANGE_ASKS, j) }],
    updates: [{ on: -4, work: b.work, at: [-4, '14:00'], minutes: 75, extra: { result: b.result } }],
  }),
  (j, b) => ({
    shows: 'resubmitted as version 2',
    source: 'manager',
    review: true,
    received: [-8, '09:30'],
    due: j,
    priority: 'medium',
    progress: 100,
    deliverable: b.deliverable,
    steps: [ack(-8, '09:50'), to('in_progress', -8, '11:00'), { kind: 'submitted_for_review', at: [-4, '16:00'] }, { kind: 'changes_requested', at: [-3, '10:30'], reason: pick(CHANGE_ASKS, j + 1) }, { kind: 'submitted_for_review', at: [-2, '17:10'] }],
  }),
  (j, b) => ({
    shows: 'approved after review',
    source: 'manager',
    review: true,
    received: [-11, '09:00'],
    due: -4 - j,
    priority: 'medium',
    progress: 100,
    deliverable: b.deliverable,
    steps: [ack(-11, '09:15'), to('in_progress', -10, '10:00'), { kind: 'submitted_for_review', at: [-7, '16:00'] }, { kind: 'review_approved', at: [-6, '10:30'] }],
    updates: [{ on: -8, work: b.work, at: [-8, '15:40'], minutes: 50, extra: { result: b.result } }],
  }),
  (j, b) => ({
    shows: 'finished',
    source: 'self',
    received: [-12, '08:45'],
    due: -6 - j,
    priority: 'low',
    progress: 100,
    steps: [ack(-12, '08:45'), to('in_progress', -11, '09:00'), to('done', -8, '17:00')],
    updates: [{ on: -9, work: b.work, at: [-9, '11:00'], minutes: 35, extra: { result: b.result } }],
  }),
  (j, b) => ({
    shows: 'overdue, still in progress',
    source: 'manager',
    received: [-9, '09:20'],
    due: -2 - j,
    priority: 'high',
    progress: 50,
    steps: [ack(-9, '09:30'), to('in_progress', -6, '10:00')],
    updates: [{ on: -6, work: b.work, at: [-6, '13:00'], minutes: 60, extra: { result: b.result, remainingWork: b.remaining } }],
  }),
  (j) => ({
    shows: 'cancelled with a reason',
    source: 'manager',
    received: [-10, '12:00'],
    due: j,
    priority: 'low',
    steps: [ack(-10, '12:20'), { kind: 'cancelled', at: [-4, '11:00'], reason: pick(CANCEL_REASONS, j) }],
  }),
  (j, b) => ({
    shows: 'finished, then reopened',
    source: 'manager',
    received: [-9, '09:00'],
    due: 1 + j,
    priority: 'high',
    progress: 60,
    steps: [ack(-9, '09:05'), to('in_progress', -8, '10:00'), to('done', -5, '16:00'), { kind: 'reopened', at: [-2, '09:30'], reason: pick(REOPEN_REASONS, j) }],
    updates: [{ on: -6, work: b.work, at: [-6, '12:00'], minutes: 55, extra: { result: b.result } }],
  }),
];

const BLOCKED = 3;
const ACKNOWLEDGED = 1;
const IN_PROGRESS = 2;
const SUBMITTED = 4;
const OVERDUE = 9;
const FINISHED = 8;

export async function seedFillWork(
  db: Database,
  log: (m: string) => void = () => {},
  academicFor?: AcademicFor,
) {
  const staff = await db
    .select({
      staffId: staffMembers.id,
      userId: staffMembers.userId,
      name: staffMembers.fullName,
      title: staffMembers.title,
      departmentId: staffMembers.departmentId,
      managerId: staffMembers.managerId,
      scheduleId: opsStaffProfiles.workScheduleId,
      leftOn: opsStaffProfiles.leftOn,
    })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(eq(opsStaffProfiles.isSample, true))
    .orderBy(staffMembers.fullName);
  const emails = await db.select({ id: users.id, email: users.email }).from(users);
  const userOf = (email: string) => emails.find((u) => u.email === email)?.id;
  const coordinatorUser = userOf('academic-coordinator@example.test');
  const opsUser = userOf('operations-manager@example.test');
  if (!coordinatorUser || !opsUser) return log('ops.fill-work skipped: sample managers missing');
  const person = (s: (typeof staff)[number]): Person => ({
    staffId: s.staffId as StaffMemberId,
    userId: (s.userId ?? coordinatorUser) as UserId,
  });
  const people = new Map<string, Person>(staff.map((s) => [s.staffId as string, person(s)]));
  const fallback = staff.find((s) => s.userId === opsUser)!;
  const managerOf = (s: (typeof staff)[number]) => {
    const m = staff.find((x) => x.staffId === s.managerId && x.userId);
    return person(m && m.staffId !== s.staffId ? m : s.staffId === fallback.staffId ? staff.find((x) => x.userId === coordinatorUser)! : fallback);
  };
  const base = workContext(people);
  const context = (s: (typeof staff)[number]) => ({ ...base, manager: managerOf(s) });
  const teaching = await db
    .select({
      staffId: academicTeacherAssignments.staffMemberId,
      subject: academicSubjects.name,
      batch: academicBatches.code,
      batchId: academicBatches.id,
    })
    .from(academicTeacherAssignments)
    .innerJoin(academicSubjects, eq(academicSubjects.id, academicTeacherAssignments.subjectId))
    .innerJoin(academicBatches, eq(academicBatches.id, academicTeacherAssignments.batchId))
    .where(eq(academicBatches.isSample, true));
  const admissions = await db
    .select({ id: opsAdmissions.id, student: opsAdmissions.studentId, lead: opsAdmissions.leadId })
    .from(opsAdmissions)
    .innerJoin(opsLeads, eq(opsLeads.id, opsAdmissions.leadId))
    .where(eq(opsLeads.isSample, true));

  let added = 0;
  // Written once: a recurring occurrence exists only after this block has run.
  if (!(await db.$count(opsStaffTasks, and(eq(opsStaffTasks.isSample, true), eq(opsStaffTasks.source, 'recurring'))))) {
    type Made = { id: string; s: (typeof staff)[number]; brief: Brief; shape: number; progress: number };
    const made: Made[] = [];
    for (const [place, s] of staff.entries()) {
      const group = groupOf(s.title);
      const job = teaching.find((t) => t.staffId === s.staffId);
      const briefs = group === 'teacher' ? TEACHER_BRIEFS(job?.subject ?? 'class', job?.batch ?? 'the batch') : OFFICE_BRIEFS[group]!;
      const c = context(s);
      for (const [i, b] of briefs.entries()) {
        const shape = (i + place) % SHAPES.length;
        const j = (place + i) % 3;
        const t = SHAPES[shape]!(j, b);
        const extra: NonNullable<SampleTask['extra']> = {
          details: b.details,
          acceptanceCriteria: b.done,
          category: b.category,
          departmentId: s.departmentId,
          expectedDeliverable: b.deliverable,
          requesterNote: t.source === 'verbal' ? 'Asked in person in the staff room.' : t.source === 'self' ? 'My own task.' : null,
          visibility: shape === BLOCKED ? 'collaborators' : i % 5 === 4 ? 'department' : 'assignee_chain',
          recurrence: shape === FINISHED && i % 2 === 0 ? 'weekly' : 'none',
          ...(shape === BLOCKED && i % 4 === 3 ? { blockedKind: 'on_hold' as const } : {}),
          ...(job ? { relatedKind: 'batch' as const, relatedId: job.batchId, relatedLabel: `${job.batch} · ${job.subject}` } : {}),
          ...(group === 'counsellor' && admissions.length
            ? i % 2 && pick(admissions, i).student
              ? { studentId: pick(admissions, i).student }
              : { admissionId: pick(admissions, i).id }
            : {}),
          ...(group === 'academic' ? { linkedRef: `Academic support case ${String(place * 10 + i + 1).padStart(3, '0')}` } : {}),
          deliveredAt: base.at(t.received),
        };
        if (extra.blockedKind === 'on_hold') {
          t.steps = t.steps.map((step: Step) => (step.kind === 'blocked_set' ? { ...step, reason: BLOCK_ON_HOLD } : step));
          extra.blockedReason = BLOCK_ON_HOLD;
        }
        const id = await writeSampleTask(db, { ...t, owner: s.staffId, title: b.title, completionNote: b.result, extra }, c);
        made.push({ id, s, brief: b, shape, progress: t.progress ?? 0 });
        added += 1;
      }
    }

    // The next occurrence of a repeating task that finished.
    for (const m of made.filter((x) => x.shape === FINISHED && x.brief === OFFICE_BRIEFS[groupOf(x.s.title)]?.[0]))
      await writeSampleTask(
        db,
        {
          owner: m.s.staffId,
          title: m.brief.title,
          shows: 'next occurrence',
          source: 'manager',
          received: [-1, '08:00'],
          due: 5,
          priority: 'low',
          steps: [],
          extra: {
            source: 'recurring',
            recurrence: 'weekly',
            recurrenceParentId: m.id as never,
            details: m.brief.details,
            acceptanceCriteria: m.brief.done,
            expectedDeliverable: m.brief.deliverable,
            category: m.brief.category,
            departmentId: m.s.departmentId,
          },
        },
        context(m.s),
      );

    const checklist = made.flatMap((m) =>
      m.brief.checklist.map((text, position) => {
        const done = Math.round((m.progress / 100) * m.brief.checklist.length) > position;
        return {
          taskId: m.id as never,
          position,
          text,
          doneAt: done ? base.at([-1, '12:00']) : null,
          doneBy: (done ? people.get(m.s.staffId)!.userId : null) as never,
        };
      }),
    );
    for (let i = 0; i < checklist.length; i += 400) await db.insert(opsTaskChecklistItems).values(checklist.slice(i, i + 400));

    // Comments, moved deadlines, reminders, dependencies and a colleague on blocked work.
    const events: (typeof opsTaskEvents.$inferInsert)[] = [];
    const notes: (typeof opsTaskReviews.$inferInsert)[] = [];
    const reminders: (typeof opsTaskReminders.$inferInsert)[] = [];
    for (const [n, m] of made.entries()) {
      const owner = people.get(m.s.staffId)!;
      const manager = context(m.s).manager;
      if (m.shape === IN_PROGRESS || m.shape === BLOCKED || m.shape === OVERDUE) {
        const at = base.at([-2, '10:30']);
        const note = pick(COMMENTS_MANAGER, n);
        events.push({ taskId: m.id as never, kind: 'comment', actorUserId: manager.userId, occurredAt: at, reason: note });
        notes.push({ taskId: m.id as never, decision: 'comment', note, reviewerUserId: manager.userId, createdAt: at });
        events.push({ taskId: m.id as never, kind: 'comment', actorUserId: owner.userId, occurredAt: base.at([-1, '11:15']), reason: pick(COMMENTS_OWNER, n) });
      }
      if (m.shape === OVERDUE || n % 6 === 0) {
        const [t] = await db.select({ dueOn: opsStaffTasks.dueOn, dueTime: opsStaffTasks.dueTime }).from(opsStaffTasks).where(eq(opsStaffTasks.id, m.id as never));
        const first = addDays(t!.dueOn as IsoDate, -2);
        await db.update(opsStaffTasks).set({ originalDueOn: first }).where(eq(opsStaffTasks.id, m.id as never));
        events.push({
          taskId: m.id as never,
          kind: 'due_changed',
          actorUserId: manager.userId,
          occurredAt: base.at([-4, '12:00']),
          reason: pick(DUE_MOVES, n),
          data: { fromDueOn: first, toDueOn: t!.dueOn, fromDueTime: t!.dueTime, toDueTime: t!.dueTime },
        });
      }
      if (m.shape === OVERDUE)
        reminders.push({ taskId: m.id as never, staffId: m.s.staffId as never, kind: 'overdue', windowKey: base.day(0), sentAt: base.at([0, '08:00']) });
      if (m.shape === 0)
        reminders.push({ taskId: m.id as never, staffId: m.s.staffId as never, kind: 'unacknowledged', windowKey: base.day(0), sentAt: base.at([0, '08:00']) });
      if (m.shape === IN_PROGRESS)
        reminders.push({ taskId: m.id as never, staffId: m.s.staffId as never, kind: 'due_soon', windowKey: base.day(1), sentAt: base.at([0, '08:00']) });
    }
    if (events.length) await db.insert(opsTaskEvents).values(events);
    if (notes.length) await db.insert(opsTaskReviews).values(notes);
    if (reminders.length) await db.insert(opsTaskReminders).values(reminders).onConflictDoNothing();
    for (const [place, s] of staff.entries()) {
      const mine = made.filter((m) => m.s === s);
      const [waits, on] = [mine.find((m) => m.shape === ACKNOWLEDGED), mine.find((m) => m.shape === IN_PROGRESS || m.shape === SUBMITTED)];
      if (waits && on)
        await db.insert(opsTaskDependencies).values({ taskId: waits.id as never, dependsOnTaskId: on.id as never, createdByUserId: context(s).manager.userId }).onConflictDoNothing();
      const blocked = mine.find((m) => m.shape === BLOCKED);
      const peer = staff[(place + 1) % staff.length]!;
      if (blocked)
        await db.insert(opsTaskCollaborators).values({ taskId: blocked.id as never, staffId: peer.staffId, addedBy: context(s).manager.userId }).onConflictDoNothing();
    }

    // The old tracker's files: one person's committed backup, one still in preview.
    const rohit = staff.find((s) => s.name === 'Rohit Saini');
    if (rohit) {
      const file = 'Task-EOD-backup-2026-10-12.json';
      const legacy = ['T-104', 'T-117', 'T-121'];
      const hrUser = userOf('hr-manager@example.test')!;
      const [batch] = await db
        .insert(opsTaskImportBatches)
        .values({
          sourceFilename: file,
          sourceSha256: createHash('sha256').update(file).digest('hex'),
          sourceVersion: 'Exported 12 Oct 2026',
          staffId: rohit.staffId,
          status: 'committed',
          counts: { parsed: 5, accepted: 3, duplicate: 1, unresolved: 1 },
          raw: { tasks: legacy.map((id) => ({ id })), reports: [{ id: 'R-9' }, { id: 'R-10' }] },
          isSample: true,
          createdByUserId: hrUser as never,
          committedAt: base.at([-20, '11:00']),
          committedByUserId: hrUser as never,
        })
        .returning({ id: opsTaskImportBatches.id });
      const titles = ['Old tracker: weekly enquiry sheet', 'Old tracker: open-house poster text', 'Old tracker: seminar list'];
      const rows: (typeof opsTaskImportRows.$inferInsert)[] = [];
      for (const [i, legacyId] of legacy.entries()) {
        const id = await writeSampleTask(
          db,
          {
            owner: rohit.staffId,
            title: titles[i]!,
            shows: 'imported',
            source: 'self',
            received: [-40 + i * 3, '10:00'],
            due: -35 + i * 3,
            priority: 'medium',
            progress: 100,
            steps: [ack(-40 + i * 3, '10:05'), to('done', -36 + i * 3, '16:30')],
            extra: {
              source: 'import',
              legacyRef: `deskday_backup_json:rohit:${legacyId}`,
              importBatchId: batch!.id,
              details: 'Carried over from the old task tracker with its dates.',
              expectedDeliverable: 'The finished item, as filed in the old tracker.',
              acceptanceCriteria: 'Marked done in the old tracker on the date shown.',
              category: 'Content',
              departmentId: rohit.departmentId,
            },
          },
          context(rohit),
        );
        rows.push({ batchId: batch!.id, kind: 'task', legacyId, contentHash: createHash('sha256').update(legacyId).digest('hex'), outcome: 'accepted', taskId: id as never });
      }
      rows.push(
        { batchId: batch!.id, kind: 'report', legacyId: 'R-9', contentHash: createHash('sha256').update('R-9').digest('hex'), outcome: 'duplicate', message: 'This day already has a report in Elevate.' },
        { batchId: batch!.id, kind: 'report', legacyId: 'R-10', contentHash: createHash('sha256').update('R-10').digest('hex'), outcome: 'unresolved', message: 'The date in the file cannot be read; a person must choose the day.' },
      );
      await db.insert(opsTaskImportRows).values(rows);
      const pooja = staff.find((s) => s.name === 'Pooja Verma');
      if (pooja)
        await db.insert(opsTaskImportBatches).values({
          sourceFilename: 'Task-EOD-backup-2026-10-28.json',
          sourceSha256: createHash('sha256').update('Task-EOD-backup-2026-10-28.json').digest('hex'),
          sourceVersion: 'Exported 28 Oct 2026',
          staffId: pooja.staffId,
          status: 'previewed',
          counts: { parsed: 4, accepted: 0, changed: 1, skipped: 3 },
          raw: { tasks: [{ id: 'T-201' }], reports: [] },
          isSample: true,
          createdByUserId: hrUser as never,
        });
    }
  }

  // Work reports. Nobody reports on a weekly off, a holiday or leave; yesterday's is missing for some.
  const anchor = sampleAnchorDate() as IsoDate;
  const schedules = await db.select().from(opsWorkSchedules);
  const leave = await db.select().from(opsLeaveRecords).where(and(eq(opsLeaveRecords.isSample, true), eq(opsLeaveRecords.status, 'approved')));
  const holidays = await db.select({ id: opsHolidays.id, on: opsHolidays.holidayOn }).from(opsHolidays);
  const sampleHolidays = new Set(await sampleRowIds(db, 'ops.holidays'));
  const shut = new Set(holidays.filter((h) => sampleHolidays.has(h.id)).map((h) => h.on));
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const seen = new Set(
    (
      await db
        .select({ s: opsEodReports.staffId, k: opsEodReports.periodKind, p: opsEodReports.periodStart })
        .from(opsEodReports)
        .where(eq(opsEodReports.isSample, true))
    ).map((r) => `${r.s}:${r.k}:${r.p}`),
  );
  const history = await workHistory(db);
  const facts = new Map<string, AcademicTeacherActivityV1>();
  const academic = async (s: (typeof staff)[number], from: string, to: string) => {
    if (!academicFor || groupOf(s.title) !== 'teacher') return undefined;
    const key = `${s.staffId}:${from}:${to}`;
    if (!facts.has(key)) facts.set(key, await academicFor(s.staffId, { from, to }));
    return facts.get(key);
  };
  let reports = 0;
  const offset = (d: string) => daysBetween(anchor, d as IsoDate);
  for (const [place, s] of staff.entries()) {
    const c = context(s);
    const pattern = schedules.find((x) => x.id === s.scheduleId)?.weeklyPattern;
    const words = REPORT_WORDS[groupOf(s.title) === 'teacher' ? 'teacher' : 'office']!;
    const works = (d: string) =>
      Boolean(pattern?.[DAY_KEYS[weekdayOf(d as IsoDate)]!]) &&
      !shut.has(d) &&
      !(s.leftOn && d > s.leftOn) &&
      !leave.some((l) => l.staffId === s.staffId && l.fromDate <= d && l.toDate >= d);
    for (let d = -14; d <= -1; d += 1) {
      const date = addDays(anchor, d);
      if (!works(date) || seen.has(`${s.staffId}:day:${date}`)) continue;
      const n = place + d + 30;
      // Yesterday: some missing, some in draft, the rest sent and waiting. Older: mostly acknowledged.
      if (d === -1 && place % 5 === 2) continue;
      if (d < -1 && n % 13 === 0) continue;
      const [summary, plan] = pick(words, n);
      const draft = d === -1 && place % 5 === 3;
      const submit: [number, string] = [d, `18:${String(10 + (n % 40)).padStart(2, '0')}`];
      await writeSampleReport(
        db,
        {
          owner: s.staffId,
          day: d,
          summary,
          plan,
          notes: n % 4 === 0 ? 'Nothing to raise today.' : null,
          ...(draft ? {} : { submit }),
          ...(draft || d === -1
            ? {}
            : n % 7 === 0
              ? { review: { kind: 'revision_requested' as const, at: [d + 1, '10:15'] as [number, string], text: pick(REVISION_ASKS, n) } }
              : d < -3 || n % 2
                ? { review: { kind: 'acknowledged' as const, at: [d + 1, `09:${String(10 + (n % 40)).padStart(2, '0')}`] as [number, string] } }
                : {}),
        } as never,
        c,
        history,
        await academic(s, date, date),
      );
      reports += 1;
    }
    for (const [i, d] of [-7, -14, -21].entries()) {
      const p = periodOf('week', addDays(anchor, d));
      if (seen.has(`${s.staffId}:week:${p.start}`) || (i === 0 && place % 4 === 1)) continue;
      const [summary, plan] = pick(WEEK_WORDS, place + i);
      const sent = offset(p.end) + 1;
      if (sent >= 0) continue;
      await writeSampleReport(
        db,
        {
          owner: s.staffId,
          day: d,
          kind: 'week',
          summary,
          plan,
          submit: [sent, '11:20'],
          ...(i === 0 && place % 3 === 0 ? {} : { review: { kind: place % 9 === 1 ? ('revision_requested' as const) : ('acknowledged' as const), at: [sent + 1, '10:00'] as [number, string], ...(place % 9 === 1 ? { text: pick(REVISION_ASKS, place) } : {}) } }),
        } as never,
        c,
        history,
        await academic(s, p.start, p.end),
      );
      reports += 1;
    }
    const last = periodOf('month', addDays(periodOf('month', anchor).start, -1));
    if (!seen.has(`${s.staffId}:month:${last.start}`) && offset(last.end) < 0) {
      const [summary, plan] = pick(MONTH_WORDS, place);
      const sent = offset(last.end) + 1;
      await writeSampleReport(
        db,
        {
          owner: s.staffId,
          day: offset(last.end),
          kind: 'month',
          summary,
          plan,
          ...(place % 6 === 2 ? {} : { submit: [Math.min(sent, -1), '12:30'] as [number, string] }),
        } as never,
        c,
        history,
        await academic(s, last.start, last.end),
      );
      reports += 1;
    }
  }
  await db.execute(sql`UPDATE ops.eod_reports SET notes = 'Nothing to raise today.' WHERE is_sample AND notes IS NULL AND status = 'draft'`);
  await db.execute(sql`UPDATE ops.staff_tasks SET requester_note = CASE source WHEN 'recurring' THEN 'Weekly routine set by the department head.' WHEN 'import' THEN 'Carried over from the old tracker.' ELSE 'Asked for by the department head.' END
    WHERE is_sample AND source <> 'self' AND requester_staff_id IS NULL AND requester_note IS NULL`);
  await db.execute(sql`UPDATE ops.task_submissions SET evidence = 'Team shared folder.' WHERE evidence IS NULL AND task_id IN (SELECT id FROM ops.staff_tasks WHERE is_sample)`);
  await db.execute(sql`UPDATE ops.task_submissions SET completion_note = 'Finished and shared with the reviewer.' WHERE completion_note LIKE 'Version%' AND task_id IN (SELECT id FROM ops.staff_tasks WHERE is_sample)`);
  log(`ops.fill-work: ${added} task(s), ${reports} work report(s) for ${staff.length} people`);
}
