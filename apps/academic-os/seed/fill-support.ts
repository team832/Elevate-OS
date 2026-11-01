/**
 * Owner, 31 Oct 2026: "Student review. Particular student review." The work around the classes of
 * ./fill-timetable.ts: reviews by every teacher with real periods, follow-ups, visibility, corrected
 * versions and withdrawals (each attendance line counted from the student's own marks), catch-up
 * tasks in every state, support cases, availability records and a curriculum plan per batch through
 * the real plan services (so approvers and approvals are genuine). Rows hang off sample batches and
 * students; db:clear-samples removes them. Written once; history reads back in the audit trail.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  academicAttendance,
  academicBatches,
  academicBatchPlacements,
  academicCatchupTasks,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicCurriculumPlans,
  academicEnrolments,
  academicInterventions,
  academicSettings,
  academicStudents,
  academicSubjects,
  academicTeacherAssignments,
  academicTeacherReviews,
  academicTeacherUnavailability,
  auditEvents,
  opsStaffProfiles,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { markSampleRows } from '@elevate/database/seed';
import { addDays, type IsoDate, type SessionId } from '@elevate/shared-types';
import { addPlanItems, createPlan, decidePlanStatusChange, requestPlanStatusChange } from '../src/server/services/curriculum';
import { pick, roll } from './fill-timetable';
import { sampleAnchorDate } from './samples';

const instant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

const REVIEW_TEXT = {
  strengths: [
    'Sets out each step clearly and checks the answer before moving on.',
    'Asks good questions in class and is not shy about saying when something is unclear.',
    'Quick with the basics; picks up a new method after one example.',
    'Careful written work and neat notes; revision comes easily from them.',
    'Steady effort week after week, even in the chapters they find hard.',
    'Explains solved questions to classmates, which helps both of them.',
    'Reads the question properly and rarely loses marks to misreading.',
  ],
  support: [
    'Rushes the last step under time pressure and loses easy marks.',
    'Needs more practice with word problems before the next test.',
    'Falls behind after a missed class and takes a week to catch up.',
    'Knows the method but is slow; timed sets twice a week would help.',
    'Hesitates to ask for help until the test shows the gap.',
    'Mixes up similar terms when the question is worded differently.',
  ],
  homework: [
    'All homework handed in on time.',
    'Handed in four of five sets; the missing one was the week of the school exam.',
    'Homework is usually done but often the night before it is due.',
    'Two sets were late this period; both were complete when they came.',
    'Homework done regularly, with corrections written in after class.',
  ],
  concerns: [
    'Nothing serious for now.',
    'Marks dropped in the last test after the absences; worth watching.',
    'Tired in morning classes; mentioned late-night school project work.',
    'Comfortable with the concepts; only speed is a concern.',
    'Nothing to raise with the family at this stage.',
  ],
  action: [
    'Two timed sets a week until the next test.',
    'Sit with the coordinator for ten minutes after class on Fridays.',
    'Redo the last test’s wrong answers and show them to me.',
    'Keep a short list of mistakes and read it before each class.',
    'One extra practice sheet on the weak chapter; I will check it next week.',
  ],
  withdrawn: [
    'Written about the wrong student.',
    'The dates in the review were wrong; a fresh one will follow.',
    'Sent before the test results were final.',
  ],
} as const;

const CATCHUP_NOTES = [
  'Copy the class notes from a classmate and try the homework set.',
  'Watch the recorded explanation, then bring doubts to the next doubt class.',
  'Do the first ten questions of the practice sheet and show them to the teacher.',
  'Read the chapter summary and redo the two worked examples from the board.',
  'Sit with the teacher for fifteen minutes before the next class.',
];

/** [trigger, what was seen, goal, action, status, parent contact]. */
const CASES: readonly (readonly [
  typeof academicInterventions.$inferInsert.trigger,
  string,
  string,
  string,
  'open' | 'in_progress' | 'resolved' | 'closed',
  'not_contacted' | 'contacted' | 'unreachable' | 'not_required',
])[] = [
  ['repeated_absence', 'Missed four classes in the last two weeks.', 'Attendance back above 85% this month.', 'Call home and agree a catch-up plan with the parent.', 'open', 'not_contacted'],
  ['declining_scores', 'Marks fell in each of the last two tests.', 'Back to the batch average by the next mock.', 'Extra practice on the weak chapter for two weeks.', 'in_progress', 'contacted'],
  ['low_scores', 'Below half marks in the last mock.', 'Above 60% in the next chapter test.', 'Pair with a stronger student for practice twice a week.', 'in_progress', 'not_required'],
  ['missed_assessments', 'Missed the chapter test without telling anyone.', 'Sit the test on the next free day.', 'Write the test on the next free day and review the paper together.', 'resolved', 'contacted'],
  ['overdue_catch_up', 'Catch-up work is ten days overdue.', 'All catch-up work handed in within a week.', 'Coordinator to check progress every second day.', 'in_progress', 'unreachable'],
  ['other', 'Parent asked for help with study routine at home.', 'A written weekly routine the student actually keeps.', 'Counsellor and teacher to draft a routine with the student.', 'closed', 'contacted'],
];

/** [teacher, from, to, reason, withdrawn]. */
const AWAY: readonly (readonly [string, number, number, string, boolean])[] = [
  ['Isha Nair', -2, -1, 'Board-exam duty at another school.', false],
  ['Nisha Rao', 4, 5, 'Training in Jaipur.', false],
  ['Raghav Sethi', 8, 8, 'Planned absence, later not needed.', true],
  ['Kunal Vyas', -12, -11, 'Family wedding in Ajmer.', false],
  ['Farida Khan', 10, 11, 'Paper-setting at the university.', false],
  ['Ramesh Chandak', -6, -6, 'Audit work for a client that day.', false],
  ['Tanvi Gokhale', 6, 6, 'Exam invigilation duty.', false],
  ['Lalit Bhatt', -20, -19, 'Attending a teachers’ workshop.', false],
];

const PLAN_STATES: Readonly<Record<string, 'locked' | 'provisional' | 'pending' | 'proposed' | 'rejected' | 'revised'>> = {
  'IPMAT-A': 'locked',
  'IPMAT-B': 'provisional',
  'CAF-A': 'revised',
  'CLAT-A': 'pending',
  'COM-C11-A': 'proposed',
  'COM-C12-A': 'rejected',
};

type Person = { staffId: string; userId: string | null; name: string };

async function actorFor(db: Database, email: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u
    ? {
        user: {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          roles: ['academic_coordinator'],
          sessionId: '' as SessionId,
        } as unknown as AuthenticatedUser,
      }
    : null;
}

/** A plan for each sample batch, in the state the table names, with its lessons and dated items. */
async function fillPlans(db: Database, batches: (typeof academicBatches.$inferSelect)[], day: (d: number) => string) {
  const maker = await actorFor(db, 'academic-manager@example.test');
  const approver = await actorFor(db, 'academic-coordinator@example.test');
  if (!maker || !approver) return 0;
  let made = 0;
  for (const b of batches) {
    const state = PLAN_STATES[b.code];
    if (!state) continue;
    const code = `${b.code}-PLAN`;
    const [known] = await db
      .select({ id: academicCurriculumPlans.id })
      .from(academicCurriculumPlans)
      .where(eq(academicCurriculumPlans.code, code));
    if (known) continue;
    const minutes = b.code.startsWith('IPMAT') ? 75 : 60;
    const plan = await createPlan(db, maker, {
      courseId: b.courseId,
      batchId: b.id,
      code,
      title: `${b.name} teaching plan`,
      copyItems: false,
      classMinutes: minutes,
      countsStatus: state === 'locked' ? 'locked' : 'proposed',
      datesStatus: state === 'locked' ? 'approved' : 'provisional',
      scopeNote: `Chapter order and class counts for ${b.name}, agreed with the subject teachers.`,
      changeLog: 'First version for this batch.',
    } as never);
    const subjects = await db
      .select({ id: academicSubjects.id, code: academicSubjects.code })
      .from(academicSubjects)
      .where(eq(academicSubjects.courseId, b.courseId))
      .orderBy(asc(academicSubjects.sortOrder));
    const items: { chapterId: string; lessonCode: string; sessionType: 'teaching' | 'practice'; plannedClasses: number; plannedDate: string; coverage: string }[] = [];
    for (const s of subjects) {
      const chapters = await db
        .select({ id: academicChapters.id, title: academicChapters.title })
        .from(academicChapters)
        .where(and(eq(academicChapters.subjectId, s.id), eq(academicChapters.status, 'active')))
        .orderBy(asc(academicChapters.sortOrder))
        .limit(24);
      chapters.forEach((c, i) =>
        items.push({
          chapterId: c.id,
          lessonCode: `${s.code}-${String(i + 1).padStart(3, '0')}`,
          sessionType: i % 5 === 4 ? 'practice' : 'teaching',
          plannedClasses: 2 + (i % 2),
          plannedDate: addDays(b.startDate as IsoDate, i * 6 + 2),
          coverage: i % 5 === 4 ? `Mixed practice up to ${c.title}` : c.title,
        }),
      );
    }
    await addPlanItems(db, maker, plan.id, { items } as never);
    made += 1;
    if (state === 'proposed') continue;
    if (state === 'revised') {
      // Version 1 approved, then a version 2 that replaced it; version 1 stays, superseded.
      await requestPlanStatusChange(db, maker, plan.id, { targetStatus: 'locked', comment: 'Ready to lock for the batch.' } as never);
      await decidePlanStatusChange(db, approver, plan.id, { decision: 'approved', comment: 'Matches the course order.' } as never);
      const next = await createPlan(db, maker, {
        courseId: b.courseId,
        batchId: b.id,
        code: `${code}-V2`,
        title: `${b.name} teaching plan, version 2`,
        supersedesPlanId: plan.id,
        copyItems: true,
        countsStatus: 'approved',
        datesStatus: 'provisional',
        scopeNote: 'Two classes moved to make room for the first mock test.',
        changeLog: 'Moved two classes to make room for the first mock test.',
      } as never);
      await requestPlanStatusChange(db, maker, next.id, { targetStatus: 'locked', comment: 'New dates after the mock test was fixed.' } as never);
      await decidePlanStatusChange(db, approver, next.id, { decision: 'approved', comment: 'Fine, the counts are unchanged.' } as never);
      continue;
    }
    await requestPlanStatusChange(db, maker, plan.id, {
      targetStatus: state === 'provisional' ? 'provisional' : 'locked',
      comment: state === 'pending' ? 'Please check the legal reasoning order before locking.' : 'Ready for approval.',
    } as never);
    if (state === 'pending') continue;
    await decidePlanStatusChange(db, approver, plan.id, {
      decision: state === 'rejected' ? 'rejected' : 'approved',
      comment: state === 'rejected' ? 'Accountancy needs two more classes before the first test; please revise.' : 'Agreed with the subject teachers.',
    } as never);
    await db
      .update(academicCurriculumPlans)
      .set({ legacyApprovedOn: null, approvedAt: state === 'rejected' ? null : instant(day(-27), '12:00') })
      .where(eq(academicCurriculumPlans.id, plan.id));
  }
  return made;
}

/** Values the screens show and rank lists need; only where nothing is stored yet (a real choice stays). */
const SETTINGS: readonly (readonly [string, object, 'proposed' | 'approved', string])[] = [
  ['progress.show_rank_percentile', { show: true }, 'approved', 'Show rank and percentile beside results.'],
  ['teaching_log.deadline_hours', { hours: 48 }, 'proposed', 'Teaching logs are due within two days.'],
  ['reviews.cadence_days', { days: 30 }, 'proposed', 'A progress review per student and subject each month.'],
  ['assessments.min_gap_days', { minDays: 2, enforcement: 'warning' }, 'proposed', 'Two days between tests of a batch.'],
  ['timetable.teacher_workload_cap', { maxMinutesPerDay: 300, maxMinutesPerWeek: 1500, enforcement: 'warning' }, 'proposed', 'Five teaching hours a day, twenty-five a week.'],
];

export async function seedFillSupport(db: Database, log: (m: string) => void = () => {}) {
  const batches = await db.select().from(academicBatches).where(eq(academicBatches.isSample, true));
  if (!batches.length) return;
  const anchor = sampleAnchorDate();
  const day = (d: number) => addDays(anchor as IsoDate, d);
  const planCount = await fillPlans(db, batches, day);
  const [settingBy] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'academic-manager@example.test'));
  if (settingBy) {
    const stored = await db
      .insert(academicSettings)
      .values(SETTINGS.map(([key, value, status, description]) => ({ key, value, status, description, updatedByUserId: settingBy.id })))
      .onConflictDoNothing()
      .returning({ key: academicSettings.key });
    await markSampleRows(db, 'academic.settings', stored.map((s) => s.key));
    if (stored.length)
      await db.insert(auditEvents).values(
        stored.map((s) => ({
          at: instant(day(-28), '10:00'),
          actorType: 'user' as const,
          actorUserId: settingBy.id,
          module: 'academic' as const,
          action: 'setting.updated',
          entityType: 'setting',
          entityId: s.key,
        })),
      );
  }
  const staff = await db
    .select({ staffId: staffMembers.id, userId: staffMembers.userId, name: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(eq(opsStaffProfiles.isSample, true));
  const person = (id: string) => staff.find((s) => s.staffId === id) as Person | undefined;
  const [manager] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'academic-manager@example.test'));
  if (!manager) return;
  const assignments = await db
    .select()
    .from(academicTeacherAssignments)
    .where(
      and(
        inArray(
          academicTeacherAssignments.batchId,
          batches.map((b) => b.id),
        ),
        eq(academicTeacherAssignments.status, 'active'),
      ),
    );
  const rosters = new Map<string, { studentId: string; enrolmentId: string }[]>();
  for (const b of batches)
    rosters.set(
      b.id,
      (
        await db
          .select({ studentId: academicEnrolments.studentId, enrolmentId: academicEnrolments.id })
          .from(academicBatchPlacements)
          .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
          .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
          .where(and(eq(academicBatchPlacements.batchId, b.id), isNull(academicBatchPlacements.endDate)))
          .orderBy(asc(academicStudents.code))
      ).map((x) => ({ studentId: x.studentId as string, enrolmentId: x.enrolmentId as string })),
    );

  // Marks per student and day, for what a review says and who needs a support case.
  const marks = await db
    .select({
      studentId: academicAttendance.studentId,
      status: academicAttendance.status,
      date: academicClassSessions.date,
      sessionId: academicAttendance.sessionId,
      batchId: academicClassSessions.batchId,
      subjectId: academicClassSessions.subjectId,
      chapterId: academicClassSessions.plannedChapterId,
      teacher: academicClassSessions.teacherStaffId,
    })
    .from(academicAttendance)
    .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicAttendance.sessionId))
    .where(
      inArray(
        academicClassSessions.batchId,
        batches.map((b) => b.id),
      ),
    );
  const presence = (student: string, from: string, to: string) => {
    const mine = marks.filter((m) => m.studentId === student && m.date >= from && m.date <= to);
    return { held: mine.length, in: mine.filter((m) => m.status !== 'absent' && m.status !== 'excused').length };
  };

  // Reviews: every teacher writes on their students; the first student of a batch has a long history.
  const already = await db.$count(
    academicTeacherReviews,
    and(eq(academicTeacherReviews.isSample, true), eq(academicTeacherReviews.reviewType, 'assessment_follow_up')),
  );
  let reviews = 0;
  if (!already) {
    const rows: (typeof academicTeacherReviews.$inferInsert)[] = [];
    const add = (
      a: (typeof assignments)[number],
      s: { studentId: string; enrolmentId: string },
      kind: 'submitted' | 'draft' | 'withdrawn' | 'corrected' | 'shared',
      type: 'periodic_progress' | 'assessment_follow_up' | 'support_referral',
      back: number,
    ) => {
      const author = person(a.staffMemberId as string);
      if (!author) return;
      const key = `${a.id}:${s.studentId}:${back}`;
      const from = day(-back - 14);
      const to = day(-back);
      const seen = presence(s.studentId, from, to);
      const base: typeof academicTeacherReviews.$inferInsert = {
        reviewKey: randomUUID() as never,
        authorStaffId: author.staffId as never,
        createdByUserId: (author.userId ?? manager.id) as never,
        academicStudentId: s.studentId as never,
        enrolmentId: s.enrolmentId as never,
        subjectId: a.subjectId,
        batchId: a.batchId,
        reviewType: type,
        periodFrom: from,
        periodTo: to,
        observationOn: to,
        strengths: pick(REVIEW_TEXT.strengths, key),
        areasForSupport: pick(REVIEW_TEXT.support, `${key}:s`),
        attendanceEvidence: seen.held
          ? `Present in ${seen.in} of ${seen.held} classes marked in this period.`
          : 'No class marked for this student in this period.',
        homeworkEvidence: pick(REVIEW_TEXT.homework, `${key}:h`),
        academicConcerns: pick(REVIEW_TEXT.concerns, `${key}:c`),
        suggestedAction: pick(REVIEW_TEXT.action, `${key}:a`),
        followUpOn: roll(key) % 3 === 0 ? null : day(-back + 7 + (roll(key) % 7)),
        visibility: kind === 'shared' || roll(key) % 4 === 0 ? 'shareable' : 'internal',
        isSample: true,
      };
      const sent = instant(to, '19:30');
      if (kind === 'draft') rows.push({ ...base, followUpOn: null });
      else if (kind === 'withdrawn')
        rows.push({
          ...base,
          status: 'withdrawn',
          submittedAt: sent,
          withdrawnAt: instant(addDays(to as IsoDate, 1), '10:00'),
          withdrawnReason: pick(REVIEW_TEXT.withdrawn, key),
        });
      else if (kind === 'corrected') {
        const first = randomUUID();
        rows.push({ ...base, id: first as never, status: 'submitted', submittedAt: sent });
        rows.push({
          ...base,
          version: 2,
          supersedesId: first as never,
          status: 'submitted',
          submittedAt: instant(addDays(to as IsoDate, 2), '18:00'),
          suggestedAction: `${base.suggestedAction} Added after talking to the coordinator.`,
        });
      } else rows.push({ ...base, status: 'submitted', submittedAt: sent });
    };
    const kinds = ['submitted', 'shared', 'corrected', 'submitted', 'draft', 'withdrawn', 'submitted'] as const;
    assignments.forEach((a, i) => {
      const roster = rosters.get(a.batchId as string) ?? [];
      if (!roster.length) return;
      add(a, roster[i % roster.length]!, kinds[i % kinds.length]!, i % 3 === 2 ? 'assessment_follow_up' : i % 5 === 4 ? 'support_referral' : 'periodic_progress', 2 + (i % 4) * 3);
      add(a, roster[(i + 2) % roster.length]!, 'submitted', 'periodic_progress', 15);
    });
    for (const b of batches) {
      const [first] = rosters.get(b.id) ?? [];
      if (!first) continue;
      assignments
        .filter((a) => a.batchId === b.id)
        .slice(0, 5)
        .forEach((a, i) => add(a, first, i === 3 ? 'corrected' : 'shared', i === 1 ? 'assessment_follow_up' : 'periodic_progress', 1 + i * 3));
    }
    for (let i = 0; i < rows.length; i += 200) await db.insert(academicTeacherReviews).values(rows.slice(i, i + 200));
    reviews = rows.length;
    await db.insert(auditEvents).values(
      rows
        .filter((r) => r.status === 'submitted' || r.status === 'withdrawn')
        .map((r) => ({
          at: r.withdrawnAt ?? r.submittedAt!,
          actorType: 'user' as const,
          actorUserId: r.createdByUserId,
          module: 'academic' as const,
          action: r.status === 'withdrawn' ? 'teacher_review.withdrawn' : 'teacher_review.submitted',
          entityType: 'teacher_review',
          entityId: r.reviewKey as string,
          metadata: r.withdrawnReason ? { reason: r.withdrawnReason } : null,
        })),
    );
  }

  // Catch-up work for absences, in every state; some past their date.
  if (!(await db.$count(academicCatchupTasks, inArray(academicCatchupTasks.batchId, batches.map((b) => b.id))))) {
    const states = ['open', 'in_progress', 'done', 'cancelled', 'open', 'done', 'in_progress'] as const;
    const rows: (typeof academicCatchupTasks.$inferInsert)[] = [];
    for (const b of batches) {
      const roster = rosters.get(b.id) ?? [];
      const missed = marks
        .filter((m) => m.batchId === b.id && (m.status === 'absent' || m.status === 'excused'))
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 7);
      missed.forEach((m, i) => {
        const enrolment = roster.find((r) => r.studentId === m.studentId);
        if (!enrolment) return;
        const state = states[i % states.length]!;
        rows.push({
          studentId: m.studentId,
          enrolmentId: enrolment.enrolmentId as never,
          batchId: b.id,
          sessionId: m.sessionId,
          chapterId: m.chapterId,
          reason: m.status === 'excused' ? 'excused' : 'absent',
          status: state,
          assignedStaffId: m.teacher,
          dueDate: addDays(m.date as IsoDate, 5 + (i % 3)),
          note:
            state === 'cancelled'
              ? 'Not needed: the student attended the make-up class instead.'
              : CATCHUP_NOTES[i % CATCHUP_NOTES.length]!,
          completedAt: state === 'done' ? instant(addDays(m.date as IsoDate, 4), '17:00') : null,
          createdByUserId: manager.id as never,
        });
      });
    }
    if (rows.length) await db.insert(academicCatchupTasks).values(rows).onConflictDoNothing();
    await db.insert(auditEvents).values(
      batches.map((b) => ({
        at: instant(day(-1), '09:00'),
        actorType: 'user' as const,
        actorUserId: manager.id,
        module: 'academic' as const,
        action: 'catchup.generated',
        entityType: 'batch',
        entityId: b.id,
      })),
    );
  }

  // Support cases for the students who miss the most, then availability records.
  if (!(await db.$count(academicInterventions, inArray(academicInterventions.batchId, batches.map((b) => b.id))))) {
    const rows: (typeof academicInterventions.$inferInsert)[] = [];
    batches.forEach((b, bi) => {
      const roster = rosters.get(b.id) ?? [];
      const low = roster
        .map((r) => ({ r, p: presence(r.studentId, day(-30), day(0)) }))
        .sort((x, y) => x.p.in / Math.max(x.p.held, 1) - y.p.in / Math.max(y.p.held, 1));
      const teachers = assignments.filter((a) => a.batchId === b.id);
      low.slice(0, 2).forEach(({ r, p }, i) => {
        const [trigger, seen, goal, action, status, contact] = CASES[(bi * 2 + i) % CASES.length]!;
        const closed = status === 'resolved' || status === 'closed';
        rows.push({
          studentId: r.studentId as never,
          batchId: b.id,
          trigger,
          description: seen,
          evidence: `Present in ${p.in} of ${p.held} classes marked since the batch started.`,
          goal,
          responsibleStaffId: teachers[i % Math.max(teachers.length, 1)]!.staffMemberId,
          action,
          dueDate: day(closed ? -3 : 3 + i * 4),
          reviewOn: day(closed ? -1 : 10 + i * 3),
          status,
          outcome: closed ? 'The student caught up and scored above the batch average in the next test.' : null,
          parentContactStatus: contact,
          resolvedAt: closed ? instant(day(-1), '12:00') : null,
          createdByUserId: manager.id as never,
        });
      });
    });
    if (rows.length) {
      await db.insert(academicInterventions).values(rows);
      // The demo teacher's My day needs live support work to show.
      await db.execute(sql`UPDATE academic.interventions SET responsible_staff_id = coalesce((SELECT s.id FROM core.staff_members s JOIN core.users u ON u.id = s.user_id WHERE u.email = 'teacher@elevateeducation.in'), responsible_staff_id)
        WHERE id IN (SELECT id FROM academic.interventions WHERE status IN ('open', 'in_progress') ORDER BY id LIMIT 2)`);
    }
    const away = AWAY.flatMap(([name, from, to, reason, withdrawn]) => {
      const p = staff.find((s) => s.name === name);
      return p
        ? [
            {
              staffId: p.staffId as never,
              fromDate: day(from),
              toDate: day(to),
              reason,
              enteredByUserId: manager.id as never,
              cancelledAt: withdrawn ? instant(day(-1), '09:00') : null,
              cancelledByUserId: (withdrawn ? manager.id : null) as never,
            },
          ]
        : [];
    });
    if (away.length) await db.insert(academicTeacherUnavailability).values(away);
  }

  // Verified logs carry the verifier's audit row; delivery and attendance carry the marker's.
  const delivered = await db.execute(sql`
    INSERT INTO core.audit_events (at, actor_type, actor_user_id, module, action, entity_type, entity_id, metadata)
    SELECT s.delivered_at, 'user', s.delivered_by_user_id, 'academic', 'class_session.delivered', 'class_session', s.id::text, '{}'::jsonb
    FROM academic.class_sessions s JOIN academic.batches b ON b.id = s.batch_id
    WHERE b.is_sample AND s.delivered_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.audit_events e WHERE e.entity_type = 'class_session' AND e.entity_id = s.id::text AND e.action = 'class_session.delivered')`);
  await db.execute(sql`
    INSERT INTO core.audit_events (at, actor_type, actor_user_id, module, action, entity_type, entity_id, metadata)
    SELECT min(a.recorded_at), 'user', min(a.recorded_by_user_id::text)::uuid, 'academic', 'attendance.recorded', 'class_session', a.session_id::text, jsonb_build_object('marked', count(*))
    FROM academic.attendance a JOIN academic.class_sessions s ON s.id = a.session_id JOIN academic.batches b ON b.id = s.batch_id
    WHERE b.is_sample AND NOT EXISTS (SELECT 1 FROM core.audit_events e WHERE e.entity_type = 'class_session' AND e.entity_id = a.session_id::text AND e.action = 'attendance.recorded')
    GROUP BY a.session_id`);
  await db.execute(sql`
    INSERT INTO core.audit_events (at, actor_type, actor_user_id, module, action, entity_type, entity_id, metadata)
    SELECT s.updated_at - interval '1 hour', 'user', s.created_by_user_id, 'academic', 'class_session.' || s.status, 'class_session', s.id::text, jsonb_build_object('reason', s.status_reason)
    FROM academic.class_sessions s JOIN academic.batches b ON b.id = s.batch_id
    WHERE b.is_sample AND s.status IN ('cancelled', 'rescheduled')
      AND NOT EXISTS (SELECT 1 FROM core.audit_events e WHERE e.entity_type = 'class_session' AND e.entity_id = s.id::text AND e.action = 'class_session.' || s.status)`);
  await db.execute(sql`
    INSERT INTO core.audit_events (at, actor_type, actor_user_id, module, action, entity_type, entity_id)
    SELECT r.verified_at, 'user', r.verified_by_user_id, 'academic', 'class_record.verified', 'class_record', r.id::text
    FROM ${academicClassRecords} r JOIN academic.batches b ON b.id = r.batch_id
    WHERE b.is_sample AND r.verified_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.audit_events e WHERE e.entity_type = 'class_record' AND e.entity_id = r.id::text AND e.action = 'class_record.verified')`);
  log(`academic.fill-support: ${planCount} plan(s), ${reviews} review row(s); delivery audit ${(delivered as unknown as { rowCount?: number }).rowCount ?? 0}`);
}
