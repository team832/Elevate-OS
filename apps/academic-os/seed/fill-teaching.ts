/**
 * Owner, 31 Oct 2026: Academic must look fully worked for every sample teacher and for the demo
 * login (teacher@elevateeducation.in, co-teaches Quant on IPMAT-B): rooms, batch details, the demo
 * login's classes at every stage and its reviews; every other teacher's classes are in
 * ./fill-timetable.ts and the support work in ./fill-support.ts. All on sample batches and sample
 * teachers; real teachers never appear (D-036). A class is one row per batch,
 * subject, day and hour, so running again adds nothing. Rooms have no is_sample column:
 * markSampleRows records them.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatches,
  academicBatchPlacements,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicRooms,
  academicSessionTeachers,
  academicStudents,
  academicSubjects,
  academicTeacherReviews,
  academicTimetablePatterns,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { markSampleRows, samplePerson } from '@elevate/database/seed';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { seedFillSupport } from './fill-support';
import { seedFillTimetable } from './fill-timetable';
import { sampleAnchorDate } from './samples';

const DEMO = 'teacher@elevateeducation.in';
const MANAGER = 'academic-manager@example.test';
const mail = (who: string) => (who.includes('@') ? who : `${who}@example.test`);

const instant = (date: string, time: string, plus = 0) =>
  new Date(new Date(`${date}T${time}:00+05:30`).getTime() + plus * 60_000);

/** What a teaching log says, in turn, so logs differ from each other. */
const LOG_TEXT = [
  {
    notes: 'Covered the chapter basics with four worked examples.',
    materials: 'Board notes; practice sheet 1',
    homework: 'Sheet 1, questions 1 to 10',
    difficulties: 'Some students mix up the two formulas.',
    next: 'Start with a five-minute recap.',
  },
  {
    notes: 'Second part of the chapter and a timed exercise.',
    materials: 'Practice sheet 2',
    homework: 'Finish the timed exercise at home',
    difficulties: 'Three students could not finish in time.',
    next: 'Go through the hardest two questions.',
  },
  {
    notes: 'Doubt clearing, then mixed practice.',
    materials: 'Question bank pages 14 to 18',
    homework: 'Five mixed questions a day',
    difficulties: 'Word problems take too long.',
    next: 'Short test at the end of class.',
  },
  {
    notes: 'Short test and discussion of answers.',
    materials: 'Test paper and key',
    homework: 'Correct your mistakes in the notebook',
    difficulties: 'Careless mistakes with units.',
    next: 'Move to the next chapter.',
  },
];

/** Stable pick per student and class; absences are the minority. */
const markOf = (student: string, session: string): 'present' | 'late' | 'absent' | 'excused' => {
  let h = 11;
  for (const c of `${student}:${session}`) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const r = h % 100;
  return r < 80 ? 'present' : r < 88 ? 'late' : r < 96 ? 'absent' : 'excused';
};

/** The demo teacher's classes at every stage. */
const DEMO_CLASSES: readonly {
  day: number;
  time: string;
  shows: string;
  status: 'held' | 'scheduled' | 'cancelled';
  marked?: 'all' | 'some';
  log?: 'verified' | 'submitted' | 'draft' | 'corrected';
  makeupOf?: number;
  pattern?: true;
}[] = [
  { day: -8, time: '17:00', shows: 'log verified', status: 'held', marked: 'all', log: 'verified' },
  {
    day: -6,
    time: '17:00',
    shows: 'log submitted',
    status: 'held',
    marked: 'all',
    log: 'submitted',
  },
  {
    day: -5,
    time: '17:00',
    shows: 'log corrected to version 2',
    status: 'held',
    marked: 'all',
    log: 'corrected',
  },
  { day: -4, time: '17:00', shows: 'cancelled, make-up planned', status: 'cancelled' },
  {
    day: -3,
    time: '17:00',
    shows: 'log still a draft',
    status: 'held',
    marked: 'all',
    log: 'draft',
  },
  {
    day: -2,
    time: '17:00',
    shows: 'attendance half marked, no log',
    status: 'held',
    marked: 'some',
  },
  { day: -1, time: '17:00', shows: 'taught, attendance and log to do', status: 'held' },
  { day: 0, time: '08:00', shows: 'today, attendance to mark once ended', status: 'scheduled' },
  { day: 0, time: '19:30', shows: 'the next class', status: 'scheduled', pattern: true },
  { day: 1, time: '19:30', shows: 'tomorrow', status: 'scheduled' },
  {
    day: 2,
    time: '19:30',
    shows: 'make-up for the cancelled class',
    status: 'scheduled',
    makeupOf: -4,
  },
  { day: 3, time: '19:30', shows: 'later this week', status: 'scheduled' },
];

/** One room per batch, so a room is never double-booked. */
const ROOMS = [
  { code: 'R-101', name: 'Room 101', capacity: 30, batch: 'IPMAT-A' },
  { code: 'R-102', name: 'Room 102', capacity: 30, batch: 'IPMAT-B' },
  { code: 'R-103', name: 'Room 103', capacity: 25, batch: 'CAF-A' },
  { code: 'R-104', name: 'Room 104', capacity: 40, batch: 'CLAT-A' },
  { code: 'R-105', name: 'Room 105', capacity: 20, batch: 'COM-C11-A' },
  { code: 'R-106', name: 'Room 106', capacity: 20, batch: 'COM-C12-A' },
  { code: 'HALL-1', name: 'Seminar hall', capacity: 80, batch: '' },
];
/** These batches also meet online; the rest are in a room only. */
const ONLINE_BATCHES = ['CAF-A', 'CLAT-A'];
/** [route, mode, capacity, target exam, its date status, days to the exam, campus]. */
const BATCH_DETAILS: Readonly<Record<string, readonly [string, string, number, string, 'official' | 'tentative' | 'assumed' | 'unverified', number, string]>> = {
  'IPMAT-A': ['regular', 'offline', 30, 'IPMAT 2027', 'tentative', 195, 'Sikar centre'],
  'IPMAT-B': ['fast_track', 'offline', 24, 'IPMAT 2027', 'tentative', 195, 'Sikar centre'],
  'CAF-A': ['dropper', 'hybrid', 25, 'CA Foundation, May 2027', 'official', 210, 'Fatehpur Road centre'],
  'CLAT-A': ['regular', 'hybrid', 40, 'CLAT 2027', 'assumed', 35, 'Sikar centre'],
  'COM-C11-A': ['class11_two_year', 'offline', 20, 'Class 11 school exam', 'unverified', 140, 'Sikar centre'],
  'COM-C12-A': ['regular', 'offline', 20, 'Class 12 board exam', 'tentative', 120, 'Fatehpur Road centre'],
};

export async function seedFillTeaching(db: Database, log: (m: string) => void = () => {}) {
  const batches = await db.select().from(academicBatches).where(eq(academicBatches.isSample, true));
  if (!batches.length) return log('academic.fill-teaching skipped: no sample batches');
  const anchor = sampleAnchorDate() as IsoDate;
  const day = (d: number) => addDays(anchor, d);
  const people = new Map(
    (
      await db
        .select({ email: users.email, userId: users.id, staffId: staffMembers.id })
        .from(users)
        .innerJoin(staffMembers, eq(staffMembers.userId, users.id))
    ).map((p) => [p.email, p]),
  );
  const who = (t: string) => people.get(mail(t));
  const manager = who(MANAGER);
  if (!manager) return log('academic.fill-teaching skipped: sample manager missing');

  const newRooms = await db
    .insert(academicRooms)
    .values(ROOMS.map(({ batch: _b, ...r }) => r))
    .onConflictDoNothing()
    .returning({ id: academicRooms.id });
  await markSampleRows(
    db,
    'academic.rooms',
    newRooms.map((r) => r.id),
  );
  const rooms = await db
    .select()
    .from(academicRooms)
    .where(
      inArray(
        academicRooms.code,
        ROOMS.map((r) => r.code),
      ),
    );
  const roomFor = (code: string) =>
    rooms.find((r) => r.code === ROOMS.find((x) => x.batch === code)?.code)?.id ?? rooms[0]!.id;
  const batch = (code: string) => batches.find((b) => b.code === code);
  const subjects = await db
    .select({
      id: academicSubjects.id,
      courseId: academicSubjects.courseId,
      code: academicSubjects.code,
      name: academicSubjects.name,
    })
    .from(academicSubjects)
    .where(
      inArray(
        academicSubjects.courseId,
        batches.map((b) => b.courseId),
      ),
    );
  const subjectOf = (b: string, s: string) =>
    subjects.find((x) => x.courseId === batch(b)?.courseId && x.code === s);
  const chaptersOf = async (subjectId: string) =>
    db
      .select({ id: academicChapters.id, title: academicChapters.title })
      .from(academicChapters)
      .where(eq(academicChapters.subjectId, subjectId as never))
      .orderBy(asc(academicChapters.sortOrder));
  const rosterOf = async (batchId: string) =>
    db
      .select({
        studentId: academicEnrolments.studentId,
        enrolmentId: academicEnrolments.id,
        name: academicStudents.fullName,
      })
      .from(academicBatchPlacements)
      .innerJoin(academicEnrolments, eq(academicEnrolments.id, academicBatchPlacements.enrolmentId))
      .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
      .where(
        and(
          eq(academicBatchPlacements.batchId, batchId as never),
          isNull(academicBatchPlacements.endDate),
        ),
      )
      .orderBy(asc(academicStudents.code));
  const existing = await db
    .select({
      batchId: academicClassSessions.batchId,
      subjectId: academicClassSessions.subjectId,
      date: academicClassSessions.date,
      time: academicClassSessions.startTime,
    })
    .from(academicClassSessions)
    .where(
      inArray(
        academicClassSessions.batchId,
        batches.map((b) => b.id),
      ),
    );
  const known = new Set(existing.map((s) => `${s.batchId}:${s.subjectId}:${s.date}:${s.time}`));

  let classes = 0;
  const addClass = async (o: {
    batchId: string;
    subjectId: string;
    teacher: { userId: never; staffId: never };
    date: string;
    time: string;
    minutes: number;
    status: 'held' | 'scheduled' | 'cancelled';
    chapterId: string | null;
    patternId?: string | null;
    reason?: string;
    makeupFor?: string | null;
    note?: string;
  }) => {
    const [row] = await db
      .insert(academicClassSessions)
      .values({
        batchId: o.batchId as never,
        subjectId: o.subjectId as never,
        teacherStaffId: o.teacher.staffId,
        plannedChapterId: o.chapterId as never,
        roomId: roomFor(batches.find((b) => b.id === o.batchId)!.code) as never,
        date: o.date,
        startTime: o.time,
        durationMinutes: o.minutes,
        status: o.status,
        statusReason: o.reason ?? null,
        kind: o.makeupFor ? 'makeup' : 'regular',
        makeupForSessionId: (o.makeupFor ?? null) as never,
        patternId: (o.patternId ?? null) as never,
        deliveredAt: o.status === 'held' ? instant(o.date, o.time, o.minutes) : null,
        deliveredByUserId: o.status === 'held' ? o.teacher.userId : null,
        deliveryNote: o.note ?? null,
        createdByUserId: manager.userId,
      })
      .returning({ id: academicClassSessions.id });
    await db.insert(academicSessionTeachers).values([
      {
        sessionId: row!.id,
        staffId: o.teacher.staffId,
        role: 'primary',
        participation: 'planned',
      },
      ...(o.status === 'held'
        ? [
            {
              sessionId: row!.id,
              staffId: o.teacher.staffId,
              role: 'primary' as const,
              participation: 'actual' as const,
            },
          ]
        : []),
    ]);
    classes += 1;
    return row!.id as string;
  };
  const mark = (
    sessionId: string,
    students: { studentId: unknown }[],
    teacherUser: unknown,
    at: Date,
  ) =>
    students.length
      ? db.insert(academicAttendance).values(
          students.map((s) => {
            const status = markOf(String(s.studentId), sessionId);
            return {
              sessionId: sessionId as never,
              studentId: s.studentId as never,
              status,
              recordedByUserId: teacherUser as never,
              recordedAt: at,
              note:
                status === 'excused'
                  ? 'Told the teacher in advance.'
                  : status === 'absent'
                    ? 'No message from home.'
                    : null,
            };
          }),
        )
      : null;
  const writeLog = (o: {
    sessionId: string;
    batchId: string;
    chapterId: string;
    teacher: { userId: never; staffId: never };
    minutes: number;
    date: string;
    time: string;
    text: (typeof LOG_TEXT)[number];
    state: 'draft' | 'submitted' | 'verified' | 'superseded';
    partial?: boolean;
    version?: number;
    corrects?: string;
  }) =>
    db
      .insert(academicClassRecords)
      .values({
        sessionId: o.sessionId as never,
        batchId: o.batchId as never,
        chapterId: o.chapterId as never,
        teacherStaffId: o.teacher.staffId,
        activity: o.corrects ? 'revision' : 'main',
        completion: o.partial ? 'partial' : 'completed',
        actualMinutes: o.minutes,
        notes: `${o.text.notes}`,
        materials: `${o.text.materials}`,
        homework: `${o.text.homework}`,
        homeworkDueOn: addDays(o.date as IsoDate, 2),
        difficulties: `${o.text.difficulties}`,
        nextPlan: `${o.text.next}`,
        catchUpNeeded: o.partial ? 'Finish the exercise next class.' : null,
        state: o.state,
        submittedAt: o.state === 'draft' ? null : instant(o.date, o.time, o.minutes + 90),
        verifiedAt: o.state === 'verified' ? instant(addDays(o.date as IsoDate, 1), '11:00') : null,
        verifiedByUserId: o.state === 'verified' ? manager.userId : null,
        supersededAt:
          o.state === 'superseded' ? instant(addDays(o.date as IsoDate, 1), '10:00') : null,
        correctsRecordId: (o.corrects ?? null) as never,
        correctionReason: o.corrects
          ? 'The chapter was named wrongly in the first log.'
          : null,
        version: o.version ?? 1,
        recordedByUserId: o.teacher.userId,
      })
      .returning({ id: academicClassRecords.id });

  // The demo teacher's classes, one per stage, and its published weekly pattern.
  const demo = who(DEMO);
  const bB = batch('IPMAT-B');
  const quant = subjectOf('IPMAT-B', 'QUANT');
  if (demo && bB && quant) {
    const chapters = await chaptersOf(quant.id);
    const students = await rosterOf(bB.id);
    const [pattern] = await db
      .select({ id: academicTimetablePatterns.id })
      .from(academicTimetablePatterns)
      .where(
        and(
          eq(academicTimetablePatterns.batchId, bB.id),
          eq(academicTimetablePatterns.staffId, demo.staffId),
        ),
      )
      .limit(1);
    const patternId =
      pattern?.id ??
      (
        await db
          .insert(academicTimetablePatterns)
          .values({
            batchId: bB.id,
            subjectId: quant.id,
            staffId: demo.staffId,
            roomId: roomFor(bB.code) as never,
            weekday: ((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7) + 1,
            startTime: '19:30',
            durationMinutes: 75,
            effectiveFrom: day(-21),
            effectiveTo: bB.endDate ?? day(150),
            status: 'published',
            publishedAt: instant(day(-22), '12:00'),
            publishedByUserId: manager.userId,
            createdByUserId: manager.userId,
          })
          .returning({ id: academicTimetablePatterns.id })
      )[0]!.id;
    const ids = new Map<number, string>();
    for (const [i, c] of DEMO_CLASSES.entries()) {
      const date = day(c.day);
      if (known.has(`${bB.id}:${quant.id}:${date}:${c.time}`)) continue;
      const chapter = chapters[i % Math.max(chapters.length, 1)];
      const id = await addClass({
        batchId: bB.id,
        subjectId: quant.id,
        teacher: demo as never,
        date,
        time: c.time,
        minutes: 75,
        status: c.status,
        chapterId: chapter?.id ?? null,
        patternId: c.pattern ? patternId : null,
        reason: c.status === 'cancelled' ? 'Room needed for a mock test.' : undefined,
        makeupFor: c.makeupOf === undefined ? null : ids.get(c.makeupOf),
        note: c.status === 'held' ? 'Taught as planned.' : undefined,
      });
      ids.set(c.day, id);
      if (c.marked)
        await mark(
          id,
          c.marked === 'all' ? students : students.slice(0, 3),
          demo.userId,
          instant(date, c.time, 75),
        );
      if (!c.log || !chapter) continue;
      const base = {
        sessionId: id,
        batchId: bB.id,
        chapterId: chapter.id,
        teacher: demo as never,
        minutes: 75,
        date,
        time: c.time,
        text: LOG_TEXT[i % LOG_TEXT.length]!,
      };
      if (c.log === 'corrected') {
        const [first] = await writeLog({ ...base, state: 'superseded' });
        await writeLog({ ...base, state: 'submitted', version: 2, corrects: first!.id });
      } else await writeLog({ ...base, state: c.log });
    }
    // Reviews by the demo teacher: a draft to finish, one sent, one withdrawn.
    if (
      !(await db.$count(
        academicTeacherReviews,
        eq(academicTeacherReviews.authorStaffId, demo.staffId),
      ))
    ) {
      const [a, b2, c2] = students;
      const base = (s: typeof a, extra: Partial<typeof academicTeacherReviews.$inferInsert>) => ({
        reviewKey: randomUUID() as never,
        authorStaffId: demo.staffId,
        createdByUserId: demo.userId,
        academicStudentId: s!.studentId,
        enrolmentId: s!.enrolmentId,
        subjectId: quant.id,
        batchId: bB.id,
        reviewType: 'periodic_progress' as const,
        periodFrom: day(-14),
        periodTo: day(-1),
        observationOn: day(-1),
        isSample: true,
        ...extra,
      });
      await db.insert(academicTeacherReviews).values([
        base(a, {
          strengths: 'Quick with percentages and ratio.',
          areasForSupport: 'Rushes word problems.',
          suggestedAction: 'To finish before Friday.',
        }),
        base(b2, {
          strengths: 'Regular and careful with steps.',
          areasForSupport: 'Time and work takes too long.',
          attendanceEvidence: 'Present in five of six classes.',
          homeworkEvidence: 'All homework handed in.',
          academicConcerns: 'Fell behind after one absence.',
          suggestedAction: 'Timed set twice a week.',
          followUpOn: day(7),
          status: 'submitted',
          submittedAt: instant(day(-1), '20:00'),
        }),
        base(c2, {
          reviewType: 'support_referral',
          strengths: 'Asks for help when stuck.',
          areasForSupport: 'Needs extra practice in number systems.',
          status: 'withdrawn',
          submittedAt: instant(day(-6), '19:00'),
          withdrawnAt: instant(day(-5), '10:00'),
          withdrawnReason: 'Written about the wrong student.',
        }),
      ]);
    }
  }

  // Sample rows that existed before: fill what the screens show as blank.
  const FILLS = [
    sql`UPDATE academic.class_sessions s SET
        room_id = coalesce(s.room_id, ${rooms[0]!.id}::uuid),
        delivery_note = CASE WHEN s.status = 'held' THEN coalesce(s.delivery_note, 'Taught as planned.') END
      FROM academic.batches b WHERE b.id = s.batch_id AND b.is_sample`,
    sql`UPDATE academic.class_records r SET
        notes = CASE WHEN r.notes = 'Sample teaching log.' THEN 'Covered the first chapter with worked examples.' ELSE r.notes END,
        materials = coalesce(r.materials, 'Board notes and practice sheet 1'),
        homework = coalesce(r.homework, 'Sheet 1, questions 1 to 10'),
        homework_due_on = coalesce(r.homework_due_on, r.recorded_at::date + 2),
        difficulties = coalesce(r.difficulties, 'Some students mix up the two formulas.'),
        next_plan = coalesce(r.next_plan, 'Start with a short recap.')
      FROM academic.batches b WHERE b.id = r.batch_id AND b.is_sample`,
    sql`UPDATE academic.teacher_reviews SET
        homework_evidence = coalesce(homework_evidence, 'Most homework handed in on time.'),
        academic_concerns = coalesce(academic_concerns, 'Nothing serious for now.'),
        observation_on = coalesce(observation_on, (created_at AT TIME ZONE 'Asia/Kolkata')::date - 1)
      WHERE is_sample AND status = 'submitted'`,
    sql`UPDATE academic.attendance a SET note = 'No message from home.'
      FROM academic.students st WHERE st.id = a.student_id AND st.is_sample AND a.status = 'absent' AND a.note IS NULL`,
  ];
  for (const s of FILLS) await db.execute(s);
  for (const [code, [route, mode, capacity, targetExam, status, days, campus]] of Object.entries(BATCH_DETAILS))
    await db
      .update(academicBatches)
      .set({
        route: route as never,
        mode: mode as never,
        capacity,
        targetExam,
        targetExamDate: day(days),
        targetExamDateStatus: status,
        campus,
      })
      .where(and(eq(academicBatches.code, code), eq(academicBatches.isSample, true)));
  // Students Ops handed over come with their name and contacts: the rest of the record, once.
  for (const s of await db
    .select()
    .from(academicStudents)
    .where(eq(academicStudents.isSample, true))) {
    const first = s.fullName.split(' ')[0]!;
    const p = samplePerson(first);
    if (!p) continue;
    const parent = s.guardianRelationship === 'mother' ? p.mother : p.father;
    const wanted = {
      preferredName: first,
      dateOfBirth: p.dateOfBirth,
      schoolBoard: p.board,
      city: p.city,
      phone: p.phone,
      guardianName: parent.fullName,
      guardianRelationship: parent.relationship,
      guardianEmail: parent.email,
      guardianPhone: parent.phone,
    };
    const empty = Object.entries(wanted).filter(([k]) => s[k as keyof typeof wanted] === null);
    if (empty.length)
      await db
        .update(academicStudents)
        .set(Object.fromEntries(empty))
        .where(eq(academicStudents.id, s.id));
  }

  await seedFillTimetable(db, {
    roomOf: (code) => roomFor(code),
    onlineLink: (code) => (ONLINE_BATCHES.includes(code) ? `https://example.test/live/${code.toLowerCase()}` : null),
    managerUserId: manager.userId,
  }, log);
  await seedFillSupport(db, log);
  log(`academic.fill-teaching: ${classes} class(es) added around ${anchor}`);
}
