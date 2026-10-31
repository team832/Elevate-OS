/**
 * Owner, 31 Oct 2026: Academic must look fully worked for every sample teacher and for the demo
 * login (teacher@elevateeducation.in, co-teaches Quant on SAMPLE-IPMAT-B): rooms, a published weekly
 * pattern, recent classes with attendance and logs, logs at every stage, classes still to mark,
 * reviews (draft, submitted, withdrawn), catch-up work, support cases and availability. All on sample
 * batches and sample teachers; real teachers never appear (D-036). A class is one row per batch,
 * subject, day and hour, so running again adds nothing. Rooms carry the marker in their code.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatches,
  academicBatchPlacements,
  academicCatchupTasks,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicInterventions,
  academicRooms,
  academicSessionTeachers,
  academicStudents,
  academicSubjects,
  academicTeacherReviews,
  academicTeacherUnavailability,
  academicTimetablePatterns,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { sampleAnchorDate } from './samples';

const SAMPLE_ROOM_PREFIX = 'SAMPLE-';
const DEMO = 'teacher@elevateeducation.in';
const MANAGER = 'academic-manager@example.test';
const mail = (who: string) => (who.includes('@') ? who : `${who}@example.test`);

const instant = (date: string, time: string, plus = 0) =>
  new Date(new Date(`${date}T${time}:00+05:30`).getTime() + plus * 60_000);

/** Regular weekly classes of the last two weeks: [batch, subject, teacher, time, days back]. */
const STREAMS: readonly [string, string, string, string, number[]][] = [
  ['SAMPLE-IPMAT-A', 'QUANT', 'arjun.menon', '12:30', [-13, -11, -9, -6, -4, -2]],
  ['SAMPLE-IPMAT-A', 'VERBAL', 'isha.nair', '10:30', [-12, -10, -8, -5, -3]],
  ['SAMPLE-IPMAT-A', 'LR', 'raghav.sethi', '15:30', [-13, -10, -6, -3]],
  ['SAMPLE-IPMAT-A', 'DI', 'nisha.rao', '08:00', [-12, -9, -5, -2]],
  ['SAMPLE-IPMAT-B', 'QUANT', 'arjun.menon', '14:00', [-12, -9, -5, -2]],
  ['SAMPLE-CAF', 'ACC', 'aditi.mehra', '16:30', [-13, -11, -8, -6, -4, -1]],
];

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

  await db
    .insert(academicRooms)
    .values(
      [
        ['R1', 'Sample Room 1 (fictional)', 30],
        ['R2', 'Sample Room 2 (fictional)', 40],
        ['HALL', 'Sample seminar hall (fictional)', 80],
      ].map(([code, name, capacity]) => ({
        code: `${SAMPLE_ROOM_PREFIX}${code}`,
        name: name as string,
        capacity: capacity as number,
      })),
    )
    .onConflictDoNothing();
  const rooms = await db
    .select()
    .from(academicRooms)
    .where(like(academicRooms.code, `${SAMPLE_ROOM_PREFIX}%`));
  const roomFor = (code: string) => rooms[code.length % rooms.length]!.id;
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
  const isSunday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0;

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
        roomId: roomFor(o.batchId) as never,
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
                  ? 'Told the teacher in advance (sample).'
                  : status === 'absent'
                    ? 'No message from home (sample).'
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
        notes: `${o.text.notes} (sample)`,
        materials: `${o.text.materials} (sample)`,
        homework: `${o.text.homework} (sample)`,
        homeworkDueOn: addDays(o.date as IsoDate, 2),
        difficulties: `${o.text.difficulties} (sample)`,
        nextPlan: `${o.text.next} (sample)`,
        catchUpNeeded: o.partial ? 'Finish the exercise next class (sample).' : null,
        state: o.state,
        submittedAt: o.state === 'draft' ? null : instant(o.date, o.time, o.minutes + 90),
        verifiedAt: o.state === 'verified' ? instant(addDays(o.date as IsoDate, 1), '11:00') : null,
        verifiedByUserId: o.state === 'verified' ? manager.userId : null,
        supersededAt:
          o.state === 'superseded' ? instant(addDays(o.date as IsoDate, 1), '10:00') : null,
        correctsRecordId: (o.corrects ?? null) as never,
        correctionReason: o.corrects
          ? 'The chapter was named wrongly in the first log (sample).'
          : null,
        version: o.version ?? 1,
        recordedByUserId: o.teacher.userId,
      })
      .returning({ id: academicClassRecords.id });

  for (const [code, subject, teacherKey, time, days] of STREAMS) {
    const b = batch(code);
    const s = subjectOf(code, subject);
    const t = who(teacherKey);
    if (!b || !s || !t) continue;
    const chapters = await chaptersOf(s.id);
    const students = await rosterOf(b.id);
    const minutes = code === 'SAMPLE-CAF' ? 60 : 75;
    for (const [i, d] of days.entries()) {
      const date = day(d);
      if (isSunday(date) || known.has(`${b.id}:${s.id}:${date}:${time}`)) continue;
      const chapter = chapters[i % Math.max(chapters.length, 1)];
      const id = await addClass({
        batchId: b.id,
        subjectId: s.id,
        teacher: t as never,
        date,
        time,
        minutes,
        status: 'held',
        chapterId: chapter?.id ?? null,
        note: 'Taught as planned (sample).',
      });
      await mark(id, students, t.userId, instant(date, time, minutes));
      if (!chapter || (i === days.length - 1 && code === 'SAMPLE-IPMAT-A' && subject === 'LR'))
        continue; // one log still owed
      await writeLog({
        sessionId: id,
        batchId: b.id,
        chapterId: chapter.id,
        teacher: t as never,
        minutes,
        date,
        time,
        text: LOG_TEXT[i % LOG_TEXT.length]!,
        state: i < 2 ? 'verified' : 'submitted',
        partial: i % 4 === 3,
      });
    }
  }

  // The demo teacher's classes, one per stage, and its published weekly pattern.
  const demo = who(DEMO);
  const bB = batch('SAMPLE-IPMAT-B');
  const quant = subjectOf('SAMPLE-IPMAT-B', 'QUANT');
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
            roomId: roomFor(bB.id) as never,
            weekday: ((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7) + 1,
            startTime: '19:30',
            durationMinutes: 75,
            effectiveFrom: day(-21),
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
        reason: c.status === 'cancelled' ? 'Room needed for a mock test (sample).' : undefined,
        makeupFor: c.makeupOf === undefined ? null : ids.get(c.makeupOf),
        note: c.status === 'held' ? `Sample class: ${c.shows}.` : undefined,
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
          strengths: 'Quick with percentages and ratio (sample).',
          areasForSupport: 'Rushes word problems (sample).',
          suggestedAction: 'To finish before Friday (sample).',
        }),
        base(b2, {
          strengths: 'Regular and careful with steps (sample).',
          areasForSupport: 'Time and work takes too long (sample).',
          attendanceEvidence: 'Present in five of six classes (sample).',
          homeworkEvidence: 'All homework handed in (sample).',
          academicConcerns: 'Fell behind after one absence (sample).',
          suggestedAction: 'Timed set twice a week (sample).',
          followUpOn: day(7),
          status: 'submitted',
          submittedAt: instant(day(-1), '20:00'),
        }),
        base(c2, {
          reviewType: 'support_referral',
          strengths: 'Asks for help when stuck (sample).',
          areasForSupport: 'Needs extra practice in number systems (sample).',
          status: 'withdrawn',
          submittedAt: instant(day(-6), '19:00'),
          withdrawnAt: instant(day(-5), '10:00'),
          withdrawnReason: 'Written about the wrong student (sample).',
        }),
      ]);
    }
  }

  // Sample rows that existed before: fill what the screens show as blank.
  const FILLS = [
    sql`UPDATE academic.batches SET capacity = coalesce(capacity, 30), campus = coalesce(campus, 'Sikar centre (sample)') WHERE is_sample`,
    sql`UPDATE academic.students SET
        preferred_name = coalesce(preferred_name, split_part(full_name, ' ', 1)),
        date_of_birth = coalesce(date_of_birth, DATE '2008-04-01' + abs(hashtext(code)) % 700)
      WHERE is_sample`,
    sql`UPDATE academic.class_sessions s SET
        room_id = coalesce(s.room_id, ${rooms[0]!.id}::uuid),
        delivery_note = CASE WHEN s.status = 'held' THEN coalesce(s.delivery_note, 'Taught as planned (sample).') END
      FROM academic.batches b WHERE b.id = s.batch_id AND b.is_sample`,
    sql`UPDATE academic.class_records r SET
        notes = CASE WHEN r.notes = 'Sample teaching log.' THEN 'Covered the first chapter with worked examples (sample).' ELSE r.notes END,
        materials = coalesce(r.materials, 'Board notes and practice sheet 1 (sample)'),
        homework = coalesce(r.homework, 'Sheet 1, questions 1 to 10 (sample)'),
        homework_due_on = coalesce(r.homework_due_on, r.recorded_at::date + 2),
        difficulties = coalesce(r.difficulties, 'Some students mix up the two formulas (sample).'),
        next_plan = coalesce(r.next_plan, 'Start with a short recap (sample).')
      FROM academic.batches b WHERE b.id = r.batch_id AND b.is_sample`,
    sql`UPDATE academic.teacher_reviews SET
        homework_evidence = coalesce(homework_evidence, 'Most homework handed in on time (sample).'),
        academic_concerns = coalesce(academic_concerns, 'Nothing serious for now (sample).'),
        observation_on = coalesce(observation_on, (created_at AT TIME ZONE 'Asia/Kolkata')::date - 1)
      WHERE is_sample AND status = 'submitted'`,
    sql`UPDATE academic.attendance a SET note = 'No message from home (sample).'
      FROM academic.students st WHERE st.id = a.student_id AND st.is_sample AND a.status = 'absent' AND a.note IS NULL`,
  ];
  for (const s of FILLS) await db.execute(s);

  // Catch-up work for absences, support cases and availability, once.
  if (!(await db.$count(academicCatchupTasks))) {
    const absences = await db
      .select({
        studentId: academicAttendance.studentId,
        sessionId: academicAttendance.sessionId,
        batchId: academicClassSessions.batchId,
        chapterId: academicClassSessions.plannedChapterId,
        teacher: academicClassSessions.teacherStaffId,
        enrolmentId: academicEnrolments.id,
      })
      .from(academicAttendance)
      .innerJoin(academicClassSessions, eq(academicClassSessions.id, academicAttendance.sessionId))
      .innerJoin(
        academicEnrolments,
        and(
          eq(academicEnrolments.studentId, academicAttendance.studentId),
          eq(academicEnrolments.batchId, academicClassSessions.batchId),
        ),
      )
      .where(
        and(
          eq(academicAttendance.status, 'absent'),
          inArray(
            academicClassSessions.batchId,
            batches.map((b) => b.id),
          ),
        ),
      )
      .limit(12);
    const states = ['open', 'in_progress', 'done', 'open'] as const;
    if (absences.length)
      await db
        .insert(academicCatchupTasks)
        .values(
          absences.map((a, i) => ({
            studentId: a.studentId,
            enrolmentId: a.enrolmentId,
            batchId: a.batchId,
            sessionId: a.sessionId,
            chapterId: a.chapterId,
            reason: 'absent' as const,
            status: states[i % 4]!,
            assignedStaffId: a.teacher,
            dueDate: day(3 + (i % 5)),
            note: 'Copy the class notes and try the homework set (sample).',
            completedAt: states[i % 4] === 'done' ? instant(day(-1), '17:00') : null,
            createdByUserId: manager.userId,
          })),
        )
        .onConflictDoNothing();
    const student = async (code: string, i: number) => (await rosterOf(batch(code)!.id))[i];
    const cases: [
      string,
      number,
      string,
      typeof academicInterventions.$inferInsert.trigger,
      string,
      string,
      'open' | 'in_progress' | 'resolved',
    ][] = [
      [
        'SAMPLE-IPMAT-B',
        2,
        DEMO,
        'repeated_absence',
        'Missed three Quant classes in two weeks.',
        'Call home and agree a catch-up plan.',
        'open',
      ],
      [
        'SAMPLE-IPMAT-B',
        3,
        DEMO,
        'declining_scores',
        'Scores fell in the last two tests.',
        'Extra practice on percentages for two weeks.',
        'in_progress',
      ],
      [
        'SAMPLE-IPMAT-A',
        1,
        'arjun.menon',
        'low_scores',
        'Below half marks in the mock.',
        'Pair with a stronger student for practice.',
        'in_progress',
      ],
      [
        'SAMPLE-CAF',
        0,
        'aditi.mehra',
        'missed_assessments',
        'Missed the first chapter test.',
        'Write the test on the next free day.',
        'resolved',
      ],
    ];
    for (const [code, i, t, trigger, description, action, status] of cases) {
      const s = await student(code, i);
      const responsible = who(t);
      if (s && responsible)
        await db.insert(academicInterventions).values({
          studentId: s.studentId,
          batchId: batch(code)!.id,
          trigger,
          description: `${description} (sample)`,
          responsibleStaffId: responsible.staffId,
          action: `${action} (sample)`,
          dueDate: day(5),
          status,
          outcome:
            status === 'resolved'
              ? 'Wrote the test and scored above the batch average (sample).'
              : null,
          parentContactStatus: status === 'open' ? 'not_contacted' : 'not_required',
          goal: 'Back with the batch in three weeks (sample).',
          reviewOn: day(14),
          evidence: 'Attendance and marks on this record (sample).',
          resolvedAt: status === 'resolved' ? instant(day(-1), '12:00') : null,
          createdByUserId: manager.userId,
        });
    }
    const away: [string, number, number, string, boolean][] = [
      ['isha.nair', -2, -1, 'Board-exam duty at another school (sample).', false],
      ['nisha.rao', 4, 5, 'Training in Jaipur (sample).', false],
      ['raghav.sethi', 8, 8, 'Planned absence, later not needed (sample).', true],
    ];
    for (const [t, from, to, reason, cancelled] of away) {
      const p = who(t);
      if (p)
        await db.insert(academicTeacherUnavailability).values({
          staffId: p.staffId,
          fromDate: day(from),
          toDate: day(to),
          reason,
          enteredByUserId: manager.userId,
          cancelledAt: cancelled ? instant(day(-1), '09:00') : null,
          cancelledByUserId: cancelled ? manager.userId : null,
        });
    }
  }
  log(`academic.fill-teaching: ${classes} class(es) added around ${anchor}`);
}
