/**
 * Academic SAMPLE data (D-036, owner answer 4, brief 2 §14). Everything here is made up and marked
 * `is_sample` (removed by `npm run db:clear-samples`): names, @example.test emails and numbers no
 * real line uses come from seed/sample-people.ts. Real curriculum imports are never touched.
 *
 *   academic.students        SAMPLE_BATCHES (6) and the sample students placed in each (31)
 *   academic.sample-teaching the sample teachers' assignments, classes around the anchor date
 *                            (delivered, cancelled + make-up, substituted, log pending, scheduled),
 *                            attendance, teaching logs, one demo attendee and teacher reviews
 *
 * Sample teachers come from the Ops seed `ops.sample-staff` (looked up by email in core.users).
 * The made-up teachers of the real seven's subjects (COVER_TEACHERS) teach sample batches only.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  COVER_TEACHERS,
  defineSeed,
  DEMO_ACCOUNTS,
  ensureDemoStaff,
  knownPerson,
} from '@elevate/database/seed';
import {
  academicAttendance,
  academicBatches,
  academicBatchPlacements,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicCourses,
  academicEnrolments,
  academicSessionDemoAttendees,
  academicSessionTeachers,
  academicStudents,
  academicSubjects,
  academicTeacherAssignments,
  academicTeacherReviews,
  opsAdmissions,
  opsDemos,
  opsDemoSessions,
  opsLeads,
  opsStaffProfiles,
  staffMembers,
  students as coreStudents,
  users,
  type Database,
} from '@elevate/database';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';

/** Mirror of the Ops seed's anchor (same env SAMPLE_ANCHOR_DATE, default today in IST). */
export function sampleAnchorDate(): IsoDate {
  const set = process.env.SAMPLE_ANCHOR_DATE;
  if (set && !isIsoDate(set)) throw new Error(`SAMPLE_ANCHOR_DATE "${set}" is not YYYY-MM-DD`);
  return (set || toIsoDate(new Date())) as IsoDate;
}

const SOURCE = 'Sample data (D-036) — fictional';
/**
 * Sample batches and the sample students placed in each (brief 23 Oct 2026 §25: IPMAT, CLAT, CA and
 * school maths). Students are numbered STU-00000001… in this order (never reordered).
 */
export const SAMPLE_BATCHES = [
  {
    code: 'IPMAT-A',
    name: 'IPMAT batch A',
    course: 'IPMAT-BASE',
    minutes: 75,
    stage: 'class_12',
    students: ['Nitya', 'Advik', 'Pihu', 'Reva', 'Tejas', 'Yuvan'],
  },
  {
    code: 'IPMAT-B',
    name: 'IPMAT batch B',
    course: 'IPMAT-BASE',
    minutes: 75,
    stage: 'class_12',
    students: ['Arnav', 'Kiara', 'Vivaan', 'Navya', 'Shaurya', 'Anvi'],
  },
  {
    code: 'CAF-A',
    name: 'CA Foundation batch A',
    course: 'CAF-ACC-SEP27',
    minutes: 60,
    stage: 'gap_year',
    students: ['Aadhya', 'Yash', 'Ritika', 'Om', 'Samaira'],
  },
  {
    code: 'CLAT-A',
    name: 'CLAT batch A',
    course: 'CLAT-SYL-2027',
    minutes: 60,
    stage: 'class_12',
    students: ['Prisha', 'Ayaan', 'Sara', 'Rudra', 'Inaya', 'Krish'],
  },
  {
    code: 'COM-C11-A',
    name: 'Class 11 Commerce batch A',
    course: 'COM-C11-2627',
    minutes: 60,
    stage: 'class_11',
    students: ['Laksh', 'Mahi', 'Veer', 'Riddhi'],
  },
  {
    code: 'COM-C12-A',
    name: 'Class 12 Commerce batch A',
    course: 'COM-C12-2627',
    minutes: 60,
    stage: 'class_12',
    students: ['Ahaan', 'Anika', 'Jai', 'Pari'],
  },
] as const;
type BatchCode = (typeof SAMPLE_BATCHES)[number]['code'];
const SAMPLE_ROSTER = SAMPLE_BATCHES.flatMap((b) =>
  b.students.map((first) => ({ first, batch: b })),
);

const userByEmail = async (db: Database, email: string) =>
  (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id ?? null;

export const studentsSeed = defineSeed({
  name: 'academic.students',
  module: 'academic',
  dependsOn: [
    'academic.ipmat-baseline',
    'academic.ca-foundation',
    'academic.syllabus-drafts',
    'core.users',
  ],
  description: `${SAMPLE_BATCHES.length} sample batches + ${SAMPLE_ROSTER.length} sample students placed in them`,
  async run({ db }) {
    const anchor = sampleAnchorDate();
    const placedBy = await userByEmail(db, 'academic-coordinator@example.test');
    if (!placedBy) throw new Error('Seed user academic-coordinator@example.test missing');
    for (const b of SAMPLE_BATCHES) {
      const [course] = await db
        .select()
        .from(academicCourses)
        .where(eq(academicCourses.code, b.course));
      if (!course) throw new Error(`Course ${b.course} missing — run the curriculum seeds first.`);
      // Created once: a later run on another day never moves the dates of seeded classes.
      await db
        .insert(academicBatches)
        .values({
          code: b.code,
          name: b.name,
          courseId: course.id,
          programmeId: course.programmeId,
          route: 'regular',
          mode: 'offline',
          startDate: addDays(anchor, -30),
          endDate: addDays(anchor, 150),
          status: 'active',
          isSample: true,
          sourceRef: SOURCE,
        })
        .onConflictDoNothing();
    }
    const batches = await db
      .select()
      .from(academicBatches)
      .where(eq(academicBatches.isSample, true));
    for (const [i, { first, batch: b }] of SAMPLE_ROSTER.entries()) {
      const batch = batches.find((x) => x.code === b.code);
      const p = knownPerson(first);
      const values = {
        code: `STU-${String(i + 1).padStart(8, '0')}`,
        fullName: p.fullName,
        preferredName: first,
        dateOfBirth: p.dateOfBirth,
        currentStage: b.stage,
        schoolBoard: p.board,
        email: p.email,
        phone: p.phone,
        city: p.city,
        guardianName: p.father.fullName,
        guardianRelationship: p.father.relationship,
        guardianEmail: p.father.email,
        guardianPhone: p.father.phone,
        isSample: true,
      };
      const { code: _c, ...set } = values;
      const [student] = await db
        .insert(academicStudents)
        .values(values)
        .onConflictDoUpdate({ target: academicStudents.code, set })
        .returning({ id: academicStudents.id });
      // Older seeds enrolled these students in the real planning batch: take them off it.
      const stray = await db
        .select({ id: academicEnrolments.id })
        .from(academicEnrolments)
        .innerJoin(academicBatches, eq(academicBatches.id, academicEnrolments.batchId))
        .where(
          and(eq(academicEnrolments.studentId, student!.id), eq(academicBatches.isSample, false)),
        );
      if (stray.length) {
        const ids = stray.map((e) => e.id);
        await db
          .delete(academicBatchPlacements)
          .where(inArray(academicBatchPlacements.enrolmentId, ids));
        await db.delete(academicEnrolments).where(inArray(academicEnrolments.id, ids));
      }
      const [enrolled] = await db
        .select({ id: academicEnrolments.id })
        .from(academicEnrolments)
        .where(
          and(
            eq(academicEnrolments.studentId, student!.id),
            eq(academicEnrolments.batchId, batch!.id),
          ),
        );
      const enrolmentId =
        enrolled?.id ??
        (
          await db
            .insert(academicEnrolments)
            .values({
              studentId: student!.id,
              programmeId: batch!.programmeId,
              courseId: batch!.courseId,
              batchId: batch!.id,
              startDate: batch!.startDate,
              source: 'manual',
              manualReason: 'Development seed (sample student)',
            })
            .returning({ id: academicEnrolments.id })
        )[0]!.id;
      const open = await db.$count(
        academicBatchPlacements,
        and(
          eq(academicBatchPlacements.enrolmentId, enrolmentId),
          isNull(academicBatchPlacements.endDate),
        ),
      );
      if (!open)
        await db.insert(academicBatchPlacements).values({
          enrolmentId,
          batchId: batch!.id,
          startDate: batch!.startDate!,
          placedByUserId: placedBy,
          isSample: true,
        });
    }
  },
});

const MANAGER_EMAIL = 'academic-manager@example.test';
const emailOf = (who: string) => `${who}@example.test`;
/** [teacher, batch, subject code, role]: fixture associations, not qualifications. */
const ASSIGNMENTS: readonly [string, BatchCode, string, 'primary' | 'co_teacher'][] = [
  ['arjun.menon', 'IPMAT-A', 'QUANT', 'primary'],
  ['arjun.menon', 'IPMAT-B', 'QUANT', 'primary'],
  ['isha.nair', 'IPMAT-A', 'VERBAL', 'primary'],
  ['raghav.sethi', 'IPMAT-A', 'LR', 'primary'],
  ['nisha.rao', 'IPMAT-A', 'DI', 'primary'],
  ['aditi.mehra', 'CAF-A', 'ACC', 'primary'],
  ['neel.shah', 'CAF-A', 'ACC', 'co_teacher'],
];
export const SAMPLE_TEACHING_EMAILS = [
  ...new Set([...ASSIGNMENTS.map(([t]) => emailOf(t)), MANAGER_EMAIL]),
];

/**
 * Classes around the anchor. `attendance`: one letter per placed student (P present, L late,
 * A absent, E excused). Nisha Rao has nothing on the anchor day; Arjun Menon teaches two batches.
 */
interface SampleSession {
  key: string;
  batch: BatchCode;
  subject: string;
  teacher: string;
  day: number;
  time: string;
  outcome: 'delivered' | 'cancelled' | 'scheduled';
  substitute?: string;
  coTeacher?: string;
  log?: 'completed' | 'partial';
  attendance?: string;
  makeupFor?: string;
}
export const SAMPLE_SESSIONS: readonly SampleSession[] = [
  {
    key: 'q1',
    batch: 'IPMAT-A',
    subject: 'QUANT',
    teacher: 'arjun.menon',
    day: -1,
    time: '09:00',
    outcome: 'delivered',
    log: 'completed',
    attendance: 'PPLPAP',
  },
  {
    key: 'v1',
    batch: 'IPMAT-A',
    subject: 'VERBAL',
    teacher: 'isha.nair',
    day: -1,
    time: '11:00',
    outcome: 'delivered',
    substitute: 'raghav.sethi',
    log: 'partial',
    attendance: 'PPPPPP',
  },
  {
    key: 'lr1',
    batch: 'IPMAT-A',
    subject: 'LR',
    teacher: 'raghav.sethi',
    day: 0,
    time: '09:00',
    outcome: 'delivered',
    attendance: 'PPPEPP',
  },
  {
    key: 'qb1',
    batch: 'IPMAT-B',
    subject: 'QUANT',
    teacher: 'arjun.menon',
    day: 0,
    time: '11:00',
    outcome: 'cancelled',
  },
  {
    key: 'q2',
    batch: 'IPMAT-A',
    subject: 'QUANT',
    teacher: 'arjun.menon',
    day: 0,
    time: '14:00',
    outcome: 'scheduled',
  },
  {
    key: 'acc1',
    batch: 'CAF-A',
    subject: 'ACC',
    teacher: 'aditi.mehra',
    coTeacher: 'neel.shah',
    day: 0,
    time: '16:00',
    outcome: 'scheduled',
  },
  {
    key: 'di1',
    batch: 'IPMAT-A',
    subject: 'DI',
    teacher: 'nisha.rao',
    day: 1,
    time: '09:00',
    outcome: 'scheduled',
  },
  {
    key: 'qb2',
    batch: 'IPMAT-B',
    subject: 'QUANT',
    teacher: 'arjun.menon',
    day: 2,
    time: '11:00',
    outcome: 'scheduled',
    makeupFor: 'qb1',
  },
];
const MARK = { P: 'present', L: 'late', A: 'absent', E: 'excused' } as const;

/** Read-only lookup of a sample demo class (Diya's day 3, IPMAT Logical Reasoning) for the demo-attendee case. */
async function sampleDemoClass(db: Database) {
  const [demo] = await db
    .select({
      id: opsDemoSessions.id,
      startsAt: opsDemoSessions.startsAt,
      dayNumber: opsDemoSessions.dayNumber,
      coreStudentId: opsAdmissions.studentId,
      name: coreStudents.fullName,
    })
    .from(opsDemoSessions)
    .innerJoin(opsDemos, eq(opsDemos.id, opsDemoSessions.demoId))
    .innerJoin(opsLeads, eq(opsLeads.id, opsDemos.leadId))
    .innerJoin(opsAdmissions, eq(opsAdmissions.id, opsDemos.admissionId))
    .innerJoin(coreStudents, eq(coreStudents.id, opsAdmissions.studentId))
    .where(
      and(
        eq(opsLeads.studentEmail, knownPerson('Diya').email),
        eq(opsDemoSessions.sessionNumber, 3),
        eq(opsLeads.isSample, true),
      ),
    );
  return demo ?? null;
}

export async function seedSampleTeaching(db: Database, log: (m: string) => void = () => {}) {
  const people = new Map(
    (
      await db
        .select({ email: users.email, userId: users.id, staffId: staffMembers.id })
        .from(users)
        .innerJoin(staffMembers, eq(staffMembers.userId, users.id))
        .where(inArray(users.email, SAMPLE_TEACHING_EMAILS))
    ).map((p) => [p.email, p]),
  );
  if (people.size < SAMPLE_TEACHING_EMAILS.length)
    return log('academic.sample-teaching skipped: sample teachers missing (run ops.sample-staff)');
  const who = (t: string) => people.get(emailOf(t))!;
  const manager = people.get(MANAGER_EMAIL)!;
  const batchRows = await db
    .select()
    .from(academicBatches)
    .where(
      inArray(
        academicBatches.code,
        SAMPLE_BATCHES.map((b) => b.code),
      ),
    );
  const batch = (code: BatchCode) => batchRows.find((b) => b.code === code)!;
  await db
    .update(academicBatches)
    .set({ coordinatorStaffId: manager.staffId })
    .where(
      inArray(
        academicBatches.id,
        batchRows.map((b) => b.id),
      ),
    );
  const subjects = await db
    .select({
      id: academicSubjects.id,
      courseId: academicSubjects.courseId,
      code: academicSubjects.code,
    })
    .from(academicSubjects)
    .where(
      inArray(
        academicSubjects.courseId,
        batchRows.map((b) => b.courseId),
      ),
    );
  const subjectOf = (code: BatchCode, s: string) =>
    subjects.find((x) => x.courseId === batch(code).courseId && x.code === s)!.id;
  // The demo teacher login (teacher@, D-072) co-teaches Quant in batch B, so its My Day shows a
  // batch, its students and the IPMAT mock. Its record has no password until db:seed-demo-accounts.
  const demoTeacher = await ensureDemoStaff(
    db,
    DEMO_ACCOUNTS.filter((a) => a.role === 'teacher'),
    manager.staffId,
  );
  const cover = await db
    .select({ id: staffMembers.id, name: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(
      and(
        eq(opsStaffProfiles.isSample, true),
        inArray(
          staffMembers.fullName,
          COVER_TEACHERS.map((t) => t.fullName),
        ),
      ),
    );
  const teaching = [
    ...ASSIGNMENTS.map(([t, b, s, role]) => [who(t).staffId, b, s, role] as const),
    ...[...demoTeacher.values()].map(
      (d) => [d.staffId, 'IPMAT-B', 'QUANT', 'co_teacher'] as const,
    ),
    ...cover.flatMap((c) =>
      COVER_TEACHERS.find((t) => t.fullName === c.name)!.assignments.map(
        ([b, s, role]) => [c.id, b, s, role] as const,
      ),
    ),
  ];
  for (const [staffMemberId, b, s, role] of teaching) {
    const values = { batchId: batch(b).id, subjectId: subjectOf(b, s), staffMemberId };
    const found = await db.$count(
      academicTeacherAssignments,
      and(
        eq(academicTeacherAssignments.batchId, values.batchId),
        eq(academicTeacherAssignments.subjectId, values.subjectId),
        eq(academicTeacherAssignments.staffMemberId, values.staffMemberId),
        eq(academicTeacherAssignments.status, 'active'),
      ),
    );
    if (!found)
      await db
        .insert(academicTeacherAssignments)
        .values({ ...values, role, employmentType: 'full_time', startDate: batch(b).startDate });
  }
  if (
    await db.$count(
      academicClassSessions,
      inArray(
        academicClassSessions.batchId,
        batchRows.map((b) => b.id),
      ),
    )
  )
    return log('academic.sample-teaching: classes exist, assignments checked');

  const anchor = sampleAnchorDate();
  const instant = (date: string, time: string, plusMinutes = 0) =>
    new Date(new Date(`${date}T${time}:00+05:30`).getTime() + plusMinutes * 60_000);
  const placed = await db
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
        eq(academicBatchPlacements.batchId, batch('IPMAT-A').id),
        isNull(academicBatchPlacements.endDate),
      ),
    )
    .orderBy(asc(academicStudents.code));
  const firstChapter = async (subjectId: string) =>
    (
      await db
        .select({ id: academicChapters.id })
        .from(academicChapters)
        .where(eq(academicChapters.subjectId, subjectId as never))
        .orderBy(asc(academicChapters.sortOrder))
        .limit(1)
    )[0]!.id;
  const ids = new Map<string, string>();
  const demo = await sampleDemoClass(db);
  const demoDate = demo && toIsoDate(demo.startsAt);
  const sessions: (SampleSession & { date: string })[] = [
    ...SAMPLE_SESSIONS.map((s) => ({ ...s, date: addDays(anchor, s.day) })),
    // Diya's demo day 3 on an Academic roster (owner answer 3); only when it falls in the batch.
    ...(demo && demoDate! >= batch('IPMAT-A').startDate!
      ? [
          {
            key: 'demo',
            batch: 'IPMAT-A' as const,
            subject: 'LR',
            teacher: 'raghav.sethi',
            day: 0,
            date: demoDate!,
            time: demo.startsAt.toLocaleTimeString('en-GB', {
              timeZone: 'Asia/Kolkata',
              hour: '2-digit',
              minute: '2-digit',
            }),
            outcome: 'delivered' as const,
            log: 'completed' as const,
            attendance: 'PPPPPP',
          },
        ]
      : []),
  ];
  for (const s of sessions) {
    const minutes = SAMPLE_BATCHES.find((b) => b.code === s.batch)!.minutes;
    const subjectId = subjectOf(s.batch, s.subject);
    const actual = who(s.substitute ?? s.teacher);
    const deliveredAt = instant(s.date, s.time, minutes);
    const [row] = await db
      .insert(academicClassSessions)
      .values({
        batchId: batch(s.batch).id,
        subjectId,
        teacherStaffId: who(s.teacher).staffId,
        date: s.date,
        startTime: s.time,
        durationMinutes: minutes,
        status: s.outcome === 'delivered' ? 'held' : s.outcome,
        statusReason: s.outcome === 'cancelled' ? 'Room unavailable (sample).' : null,
        kind: s.makeupFor ? 'makeup' : 'regular',
        makeupForSessionId: s.makeupFor ? (ids.get(s.makeupFor) as never) : null,
        deliveredAt: s.outcome === 'delivered' ? deliveredAt : null,
        deliveredByUserId: s.outcome === 'delivered' ? actual.userId : null,
        createdByUserId: manager.userId,
      })
      .returning({ id: academicClassSessions.id });
    const sessionId = row!.id;
    ids.set(s.key, sessionId);
    await db.insert(academicSessionTeachers).values([
      {
        sessionId,
        staffId: who(s.teacher).staffId,
        role: 'primary' as const,
        participation: 'planned' as const,
      },
      ...(s.coTeacher
        ? [
            {
              sessionId,
              staffId: who(s.coTeacher).staffId,
              role: 'co_teacher' as const,
              participation: 'planned' as const,
            },
          ]
        : []),
      ...(s.outcome !== 'delivered'
        ? []
        : s.substitute
          ? [
              {
                sessionId,
                staffId: actual.staffId,
                role: 'substitute' as const,
                participation: 'actual' as const,
                replacesStaffId: who(s.teacher).staffId,
                reason: 'Isha Nair on board-exam duty (sample).',
                authorisedByUserId: manager.userId,
              },
            ]
          : [
              {
                sessionId,
                staffId: actual.staffId,
                role: 'primary' as const,
                participation: 'actual' as const,
              },
            ]),
    ]);
    if (s.attendance && placed.length)
      await db.insert(academicAttendance).values(
        placed.map((p, i) => ({
          sessionId,
          studentId: p.studentId,
          status: MARK[s.attendance![i % s.attendance!.length] as keyof typeof MARK],
          recordedByUserId: actual.userId,
          recordedAt: deliveredAt,
        })),
      );
    if (s.log)
      await db.insert(academicClassRecords).values({
        sessionId,
        batchId: batch(s.batch).id,
        chapterId: await firstChapter(subjectId),
        teacherStaffId: actual.staffId,
        activity: 'main',
        completion: s.log,
        actualMinutes: minutes,
        notes: 'Sample teaching log.',
        catchUpNeeded: s.log === 'partial' ? 'Finish the exercise set next class (sample).' : null,
        state: 'submitted',
        submittedAt: instant(s.date, s.time, minutes + 60),
        recordedByUserId: actual.userId,
      });
    if (s.key === 'demo' && demo)
      await db.insert(academicSessionDemoAttendees).values({
        sessionId,
        opsDemoSessionId: demo.id,
        coreStudentId: demo.coreStudentId!,
        displayName: demo.name,
        demoDayNumber: demo.dayNumber,
        status: 'present',
        recordedByUserId: actual.userId,
        recordedAt: deliveredAt,
        addedByUserId: manager.userId,
        isSample: true,
      });
  }
  // Reviews: one submitted, one private draft (owner answer 1); a demo review when the demo class exists.
  const review = (author: string, extra: Partial<typeof academicTeacherReviews.$inferInsert>) => ({
    reviewKey: randomUUID() as never,
    authorStaffId: who(author).staffId,
    createdByUserId: who(author).userId,
    reviewType: 'periodic_progress' as const,
    isSample: true,
    ...extra,
  });
  const [p1, p2] = placed;
  await db.insert(academicTeacherReviews).values([
    review('arjun.menon', {
      academicStudentId: p1!.studentId,
      enrolmentId: p1!.enrolmentId,
      subjectId: subjectOf('IPMAT-A', 'QUANT'),
      sessionId: ids.get('q1') as never,
      periodFrom: addDays(anchor, -14),
      periodTo: addDays(anchor, -1),
      strengths: 'Sets up equations quickly (sample).',
      areasForSupport: 'Checks units less often under time pressure (sample).',
      attendanceEvidence: 'Present in the classes recorded this fortnight (sample).',
      suggestedAction: 'Two timed arithmetic sets a week (sample).',
      status: 'submitted',
      submittedAt: instant(addDays(anchor, -1), '19:00'),
    }),
    review('isha.nair', {
      academicStudentId: p2!.studentId,
      enrolmentId: p2!.enrolmentId,
      subjectId: subjectOf('IPMAT-A', 'VERBAL'),
      strengths: 'Draft — not yet submitted (sample).',
    }),
    ...(demo && ids.has('demo')
      ? [
          review('raghav.sethi', {
            reviewType: 'demo_session' as const,
            coreStudentId: demo.coreStudentId!,
            opsDemoSessionId: demo.id,
            sessionId: ids.get('demo') as never,
            subjectId: subjectOf('IPMAT-A', 'LR'),
            strengths: 'Followed the arrangement puzzles well in the demo class (sample).',
            status: 'submitted' as const,
            submittedAt: instant(demoDate!, '20:00'),
          }),
        ]
      : []),
  ]);
  log(
    `academic.sample-teaching: ${sessions.length} sample classes around ${anchor}${demo ? ' (with a demo attendee)' : ''}`,
  );
}

export const sampleTeachingSeed = defineSeed({
  name: 'academic.sample-teaching',
  module: 'academic',
  dependsOn: ['academic.students', 'ops.sample-staff', 'ops.samples'],
  description:
    'Sample teachers’ assignments, classes, attendance, teaching logs, a demo attendee and reviews (is_sample)',
  run: ({ db, log }) => seedSampleTeaching(db, log),
});
