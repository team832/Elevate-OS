/**
 * Owner, 31 Oct 2026: "Teachers' data ... every data point filled". The weekly timetable of every
 * sample batch, published as patterns, and the classes it produced from the day the batches started
 * until two weeks ahead: delivered, cancelled with a make-up, moved, covered by another teacher,
 * doubt classes, attendance per student (each student keeps their own habit, so a percentage on a
 * report means something) and teaching logs at every stage. No teacher is an empty row. Rows hang off
 * sample batches, so db:clear-samples removes them. Written once: the patterns are the marker.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicAttendance,
  academicBatches,
  academicBatchPlacements,
  academicChapters,
  academicClassRecords,
  academicClassSessions,
  academicEnrolments,
  academicSessionTeachers,
  academicSubjects,
  academicTeacherAssignments,
  academicTimetablePatterns,
  opsHolidays,
  opsStaffProfiles,
  staffMembers,
  type Database,
} from '@elevate/database';
import { sampleRowIds } from '@elevate/database/seed';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { datedTests } from '../src/server/services/timetable';
import { sampleAnchorDate } from './samples';

/** [batch, subject, teacher, ISO weekday, start]. Tara and Neel work Wednesday to Sunday. */
export const WEEK: readonly (readonly [string, string, string, number, string])[] = [
  ['IPMAT-A', 'VERBAL', 'Isha Nair', 1, '10:30'],
  ['IPMAT-A', 'QUANT', 'Arjun Menon', 1, '12:30'],
  ['IPMAT-A', 'DI', 'Nisha Rao', 2, '08:00'],
  ['IPMAT-A', 'LR', 'Raghav Sethi', 2, '15:30'],
  ['IPMAT-A', 'VERBAL', 'Isha Nair', 3, '10:30'],
  ['IPMAT-A', 'QUANT', 'Arjun Menon', 3, '12:30'],
  ['IPMAT-A', 'DI', 'Nisha Rao', 4, '08:00'],
  ['IPMAT-A', 'LR', 'Raghav Sethi', 4, '15:30'],
  ['IPMAT-A', 'QUANT', 'Arjun Menon', 5, '12:30'],
  ['IPMAT-A', 'VERBAL', 'Isha Nair', 6, '10:30'],
  ['IPMAT-B', 'LR', 'Siddharth Rao', 1, '10:30'],
  ['IPMAT-B', 'QUANT', 'Arjun Menon', 1, '14:00'],
  ['IPMAT-B', 'DI', 'Siddharth Rao', 2, '10:30'],
  ['IPMAT-B', 'VERBAL', 'Isha Nair', 2, '12:30'],
  ['IPMAT-B', 'QUANT', 'Kunal Vyas', 3, '08:00'],
  ['IPMAT-B', 'QUANT', 'Arjun Menon', 3, '14:00'],
  ['IPMAT-B', 'LR', 'Siddharth Rao', 4, '10:30'],
  ['IPMAT-B', 'VERBAL', 'Isha Nair', 4, '12:30'],
  ['IPMAT-B', 'QUANT', 'Kunal Vyas', 5, '08:00'],
  ['IPMAT-B', 'DI', 'Siddharth Rao', 5, '10:30'],
  ['IPMAT-B', 'QUANT', 'Arjun Menon', 6, '14:00'],
  ['IPMAT-B', 'QUANT', 'Vivek Kaushik', 2, '17:00'],
  ['IPMAT-B', 'QUANT', 'Vivek Kaushik', 6, '17:00'],
  ['CAF-A', 'ACC', 'Aditi Mehra', 1, '16:30'],
  ['CAF-A', 'ACC', 'Aditi Mehra', 2, '16:30'],
  ['CAF-A', 'ACC', 'Aditi Mehra', 3, '16:30'],
  ['CAF-A', 'ACC', 'Ramesh Chandak', 4, '09:00'],
  ['CAF-A', 'ACC', 'Neel Shah', 5, '12:00'],
  ['CAF-A', 'ACC', 'Tanvi Gokhale', 6, '11:00'],
  ['CLAT-A', 'ENG', 'Farida Khan', 1, '09:00'],
  ['CLAT-A', 'LEG', 'Dev Malhotra', 1, '11:00'],
  ['CLAT-A', 'CA', 'Lata Krishnan', 2, '09:00'],
  ['CLAT-A', 'LR', 'Lalit Bhatt', 2, '11:00'],
  ['CLAT-A', 'LEG', 'Imran Qureshi', 3, '09:00'],
  ['CLAT-A', 'QT', 'Nisha Rao', 3, '11:00'],
  ['CLAT-A', 'CA', 'Geeta Menon', 4, '09:00'],
  ['CLAT-A', 'ENG', 'Farida Khan', 4, '11:00'],
  ['CLAT-A', 'LEG', 'Dev Malhotra', 5, '09:00'],
  ['CLAT-A', 'CA', 'Kavya Joshi', 5, '11:00'],
  ['CLAT-A', 'LR', 'Lalit Bhatt', 6, '09:00'],
  ['CLAT-A', 'QT', 'Nisha Rao', 6, '11:00'],
  ['COM-C11-A', 'ACC', 'Ramesh Chandak', 1, '14:00'],
  ['COM-C11-A', 'ECO', 'Jatin Oberoi', 1, '15:30'],
  ['COM-C11-A', 'MATH', 'Kunal Vyas', 2, '14:00'],
  ['COM-C11-A', 'ENG', 'Priya Thomas', 2, '15:30'],
  ['COM-C11-A', 'AMATH', 'Usha Pandey', 3, '14:00'],
  ['COM-C11-A', 'BST', 'Tara Kapoor', 3, '15:30'],
  ['COM-C11-A', 'ACC', 'Ramesh Chandak', 4, '14:00'],
  ['COM-C11-A', 'ECO', 'Hemant Joshi', 4, '15:30'],
  ['COM-C11-A', 'MATH', 'Anil Chawla', 5, '14:00'],
  ['COM-C11-A', 'ENG', 'Priya Thomas', 5, '15:30'],
  ['COM-C11-A', 'BST', 'Tara Kapoor', 6, '14:00'],
  ['COM-C11-A', 'AMATH', 'Usha Pandey', 6, '15:30'],
  ['COM-C12-A', 'ACC', 'Ramesh Chandak', 1, '09:00'],
  ['COM-C12-A', 'BST', 'Karan Bedi', 1, '10:15'],
  ['COM-C12-A', 'MATH', 'Kunal Vyas', 2, '09:00'],
  ['COM-C12-A', 'ECO', 'Bhavna Soni', 2, '10:15'],
  ['COM-C12-A', 'ENG', 'Priya Thomas', 3, '09:00'],
  ['COM-C12-A', 'AMATH', 'Usha Pandey', 3, '10:15'],
  ['COM-C12-A', 'BST', 'Karan Bedi', 4, '10:15'],
  ['COM-C12-A', 'ACC', 'Neel Shah', 4, '12:00'],
  ['COM-C12-A', 'ECO', 'Mehul Desai', 5, '09:00'],
  ['COM-C12-A', 'ENG', 'Sanya Kulkarni', 5, '10:15'],
  ['COM-C12-A', 'MATH', 'Kunal Vyas', 6, '09:00'],
  ['COM-C12-A', 'AMATH', 'Usha Pandey', 6, '10:15'],
];

/** What the logs and notes say, picked per class so they differ. */
export const CLASS_TEXT = {
  notes: [
    (c: string) => `Introduced ${c} and solved four examples on the board before the class tried two alone.`,
    (c: string) => `Continued ${c}; most of the class followed the second method once we compared it with the first.`,
    (c: string) => `Ten-minute recap of the last class, then the harder part of ${c}.`,
    (c: string) => `Timed exercise on ${c}, then discussion of the three questions most students missed.`,
    (c: string) => `Students brought doubts from the homework on ${c} and we solved them together.`,
    (c: string) => `Worked in pairs on ${c}; each pair explained one solved question to the class.`,
    (c: string) => `Mixed practice covering ${c} with the previous chapter, checking method before speed.`,
  ],
  materials: [
    'Board notes and practice sheet',
    'Question bank, section two',
    'Printed worksheet and answer key',
    'Last year’s paper, selected questions',
    'Revision sheet from the coordinator',
  ],
  homework: [
    (c: string) => `Ten questions from the ${c} sheet`,
    (c: string) => `Finish the timed set on ${c} at home`,
    (c: string) => `Write short notes on ${c} in your own words`,
    (c: string) => `Correct your mistakes from class and try two new questions on ${c}`,
  ],
  difficulties: [
    'Some students mix up the two methods when the question is worded differently.',
    'Three students could not finish in the time given.',
    'Word problems still take too long; reading the question carefully needs practice.',
    'Careless slips in the last step cost marks more than the idea itself.',
    'Two students who missed the last class need the basics again.',
  ],
  next: [
    'Start with a five-minute recap, then move on.',
    'Go through the two hardest homework questions first.',
    'Short written check at the start of the next class.',
    'Begin the next chapter once the homework is checked.',
  ],
  evidence: [
    'Register page and a photo of the board are in the batch folder.',
    'Worksheets collected and kept with the coordinator.',
    'Attendance sheet signed by the class monitor.',
  ],
  catchUp: [
    'Finish the last exercise in the next class.',
    'Two questions left; students will finish them as homework and we check them next class.',
    'Ran out of time on the final section; will take twenty minutes of the next class.',
  ],
  cancelled: [
    'The room was needed for a mock test.',
    'The teacher was on board-exam duty at another school.',
    'Power cut across the centre that afternoon.',
    'The class joined the parents’ meeting instead.',
  ],
  moved: [
    'Moved a day later so the batch could sit the school’s practical exam.',
    'Moved because the teacher was called to a training session.',
  ],
  covered: [
    'The regular teacher was on leave; covered by a colleague on the same batch.',
    'The regular teacher had an exam-duty letter; a colleague took the class.',
  ],
  absent: [
    'Family function; parent informed the front desk afterwards.',
    'No message from home.',
    'Unwell, according to the parent.',
    'Missed the bus from Fatehpur.',
  ],
  excused: [
    'Told the teacher in advance: school exam that morning.',
    'Medical note given to the coordinator.',
  ],
  late: ['Reached fifteen minutes late; the bus was delayed.', 'Came in after the recap.'],
  partial: ['Left after the first half for a school practical.', 'Came for the second half only.'],
} as const;

/** Takes the slots of a teacher who has left (fill-people.ts names who that is). */
const COVER_AFTER_LEAVING = 'Dev Malhotra';

export const roll = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 1000;
};
export const pick = <T>(list: readonly T[], key: string) => list[roll(key) % list.length]!;
const isoWeekday = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const instant = (date: string, time: string, plus = 0) =>
  new Date(new Date(`${date}T${time}:00+05:30`).getTime() + plus * 60_000);
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** How often each student misses class, by their place on the roster: [absent, excused, late, partial] in 1000. */
const HABITS = [
  [20, 10, 30, 0],
  [60, 20, 80, 20],
  [110, 30, 40, 30],
  [40, 10, 120, 10],
  [240, 60, 60, 40],
] as const;
function markFor(place: number, key: string) {
  const [absent, excused, late, partial] = HABITS[place % HABITS.length]!; // the last habit is the weakest
  const r = roll(key);
  if (r < absent) return 'absent' as const;
  if (r < absent + excused) return 'excused' as const;
  if (r < absent + excused + late) return 'late' as const;
  if (r < absent + excused + late + partial) return 'partial' as const;
  return 'present' as const;
}

interface Teacher {
  staffId: string;
  userId: string | null;
  name: string;
}
type SessionRow = typeof academicClassSessions.$inferInsert;
type Chapter = { id: string; title: string };

const chunked = async <T>(rows: T[], write: (part: T[]) => Promise<unknown>, size = 500) => {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
};

export async function seedFillTimetable(
  db: Database,
  ctx: { roomOf: (batchCode: string) => string; onlineLink: (batchCode: string) => string | null; managerUserId: string },
  log: (m: string) => void = () => {},
) {
  const batches = await db.select().from(academicBatches).where(eq(academicBatches.isSample, true));
  const known = await db
    .select({ id: academicTimetablePatterns.id })
    .from(academicTimetablePatterns)
    .where(
      and(
        inArray(
          academicTimetablePatterns.batchId,
          batches.map((b) => b.id),
        ),
        inArray(
          academicTimetablePatterns.staffId,
          db
            .select({ id: staffMembers.id })
            .from(staffMembers)
            .where(eq(staffMembers.fullName, 'Isha Nair')),
        ),
      ),
    );
  if (known.length) return log('academic.fill-timetable skipped: the weekly patterns exist');
  const anchor = sampleAnchorDate();
  const day = (d: number) => addDays(anchor as IsoDate, d);
  const staff = await db
    .select({ staffId: staffMembers.id, userId: staffMembers.userId, name: staffMembers.fullName })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(eq(opsStaffProfiles.isSample, true));
  const teacher = (name: string) => staff.find((s) => s.name === name) as Teacher | undefined;
  const subjects = await db
    .select()
    .from(academicSubjects)
    .where(
      inArray(
        academicSubjects.courseId,
        batches.map((b) => b.courseId),
      ),
    );
  const batchOf = (code: string) => batches.find((b) => b.code === code);
  const subjectOf = (code: string, s: string) =>
    subjects.find((x) => x.courseId === batchOf(code)?.courseId && x.code === s);
  // A teacher who has left keeps their past classes; a colleague takes the slot from the next day.
  const leavers = await db
    .select({ name: staffMembers.fullName, leftOn: opsStaffProfiles.leftOn })
    .from(staffMembers)
    .innerJoin(opsStaffProfiles, eq(opsStaffProfiles.staffId, staffMembers.id))
    .where(and(eq(opsStaffProfiles.isSample, true), eq(opsStaffProfiles.employmentStatus, 'exited')));
  const rows = WEEK.flatMap(([b, s, t, weekday, time]) => {
    const batch = batchOf(b);
    const subject = subjectOf(b, s);
    const who = teacher(t);
    if (!batch || !subject || !who) return [];
    const base = { batch, subject, who, weekday, time, from: batch.startDate!, to: batch.endDate };
    const left = leavers.find((l) => l.name === t)?.leftOn;
    const cover = teacher(COVER_AFTER_LEAVING);
    return left && cover
      ? [
          { ...base, to: left },
          { ...base, who: cover, from: addDays(left as IsoDate, 1) },
        ]
      : [base];
  });

  // Whoever is on the timetable holds an assignment; the first one on a subject is its primary.
  const existing = await db
    .select()
    .from(academicTeacherAssignments)
    .where(
      inArray(
        academicTeacherAssignments.batchId,
        batches.map((b) => b.id),
      ),
    );
  const holds = new Set(existing.map((a) => `${a.batchId}:${a.subjectId}:${a.staffMemberId}`));
  const primaries = new Set(
    existing.filter((a) => a.role === 'primary').map((a) => `${a.batchId}:${a.subjectId}`),
  );
  for (const r of rows) {
    const key = `${r.batch.id}:${r.subject.id}`;
    if (holds.has(`${key}:${r.who.staffId}`)) continue;
    holds.add(`${key}:${r.who.staffId}`);
    await db.insert(academicTeacherAssignments).values({
      batchId: r.batch.id,
      subjectId: r.subject.id,
      staffMemberId: r.who.staffId as never,
      courseId: r.batch.courseId,
      role: primaries.has(key) ? 'co_teacher' : 'primary',
      employmentType: r.who.userId ? 'full_time' : 'part_time',
      startDate: r.batch.startDate,
      academicYear: '2026-27',
    });
    primaries.add(key);
  }

  for (const l of leavers.filter((x) => x.leftOn)) {
    const who = teacher(l.name);
    if (who)
      await db
        .update(academicTeacherAssignments)
        .set({ status: 'ended', endDate: l.leftOn })
        .where(eq(academicTeacherAssignments.staffMemberId, who.staffId as never));
  }

  // One pattern per weekly slot, published the day before the batch started.
  const patternRows = await db
    .insert(academicTimetablePatterns)
    .values(
      rows.map((r) => ({
        batchId: r.batch.id,
        subjectId: r.subject.id,
        staffId: r.who.staffId as never,
        roomId: ctx.roomOf(r.batch.code) as never,
        onlineLink: ctx.onlineLink(r.batch.code),
        weekday: r.weekday,
        startTime: r.time,
        durationMinutes: r.batch.code.startsWith('IPMAT') ? 75 : 60,
        effectiveFrom: r.from,
        effectiveTo: r.to,
        status: (r.to && r.to < anchor ? 'retired' : 'published') as 'retired' | 'published',
        publishedAt: instant(addDays(r.batch.startDate as IsoDate, -1), '12:00'),
        publishedByUserId: ctx.managerUserId as never,
        createdByUserId: ctx.managerUserId as never,
      })),
    )
    .returning({ id: academicTimetablePatterns.id });
  const patterns = rows.map((r, i) => ({ ...r, id: patternRows[i]!.id as string }));

  const chapters = new Map<string, Chapter[]>();
  for (const r of rows)
    if (!chapters.has(r.subject.id))
      chapters.set(
        r.subject.id,
        await db
          .select({ id: academicChapters.id, title: academicChapters.title })
          .from(academicChapters)
          .where(eq(academicChapters.subjectId, r.subject.id))
          .orderBy(academicChapters.sortOrder),
      );
  const rosters = new Map<string, { studentId: string; enrolmentId: string; start: string }[]>();
  for (const b of batches)
    rosters.set(
      b.id,
      (
        await db
          .select({
            studentId: academicEnrolments.studentId,
            enrolmentId: academicEnrolments.id,
            start: academicBatchPlacements.startDate,
          })
          .from(academicBatchPlacements)
          .innerJoin(
            academicEnrolments,
            eq(academicEnrolments.id, academicBatchPlacements.enrolmentId),
          )
          .where(
            and(
              eq(academicBatchPlacements.batchId, b.id),
              isNull(academicBatchPlacements.endDate),
            ),
          )
      )
        .map((x) => ({ ...x, studentId: x.studentId as string, enrolmentId: x.enrolmentId as string }))
        .sort((x, y) => x.studentId.localeCompare(y.studentId)),
    );

  // What is already on the timetable (the demo classes): a batch or teacher is never double-booked.
  const already = await db
    .select({
      batchId: academicClassSessions.batchId,
      teacher: academicClassSessions.teacherStaffId,
      date: academicClassSessions.date,
      time: academicClassSessions.startTime,
      minutes: academicClassSessions.durationMinutes,
    })
    .from(academicClassSessions)
    .where(
      inArray(
        academicClassSessions.batchId,
        batches.map((b) => b.id),
      ),
    );
  // The centre is shut on an approved holiday (Ops's calendar, read only).
  const holidays = await db
    .select({ on: opsHolidays.holidayOn })
    .from(opsHolidays)
    .where(and(inArray(opsHolidays.id, await sampleRowIds(db, 'ops.holidays')), eq(opsHolidays.decisionState, 'approved')));
  const busy = new Map<string, [number, number][]>();
  const hold = (who: string, date: string, time: string, minutes: number) => {
    const k = `${who}:${date}`;
    const start = minutesOf(time);
    busy.set(k, [...(busy.get(k) ?? []), [start, start + minutes]]);
  };
  const free = (who: string, date: string, time: string, minutes: number) => {
    const start = minutesOf(time);
    return !(busy.get(`${who}:${date}`) ?? []).some(([a, b]) => start < b && a < start + minutes);
  };
  for (const a of already) {
    hold(a.batchId, a.date, a.time, a.minutes);
    if (a.teacher) hold(a.teacher, a.date, a.time, a.minutes);
  }
  // A sample test holds its batches too: no class during a test (ruling 6 Nov 2026).
  for (const { a, batchIds } of await datedTests(db, {}))
    if (a.startTime && a.durationMinutes) for (const b of batchIds) hold(b, a.scheduledDate!, a.startTime, a.durationMinutes);

  type Planned = {
    row: SessionRow;
    code: string;
    chapter: Chapter | null;
    actual: Teacher;
    planned: Teacher;
    covered: boolean;
  };
  const planned: Planned[] = [];
  const taken = new Map<string, number>();
  const start = -30;
  const addPlanned = (p: (typeof patterns)[number], date: string, time: string, o: Partial<SessionRow>, actual = p.who) => {
    const key = `${p.batch.id}:${p.subject.id}`;
    const n = taken.get(key) ?? 0;
    taken.set(key, n + 1);
    const list = chapters.get(p.subject.id) ?? [];
    const chapter = list.length ? list[Math.floor(n / 2) % list.length]! : null;
    const minutes = p.batch.code.startsWith('IPMAT') ? 75 : 60;
    hold(p.batch.id, date, time, minutes);
    hold(actual.staffId, date, time, minutes);
    if (actual !== p.who) hold(p.who.staffId, date, time, minutes);
    const row: SessionRow = {
      id: randomUUID() as never,
      batchId: p.batch.id,
      subjectId: p.subject.id,
      teacherStaffId: p.who.staffId as never,
      plannedChapterId: (chapter?.id ?? null) as never,
      roomId: ctx.roomOf(p.batch.code) as never,
      onlineLink: ctx.onlineLink(p.batch.code),
      sessionType: n % 7 === 6 ? 'practice' : 'teaching',
      date,
      startTime: time,
      durationMinutes: minutes,
      status: 'scheduled',
      createdByUserId: ctx.managerUserId as never,
      ...o,
    };
    planned.push({ row, code: p.batch.code, chapter, actual, planned: p.who, covered: actual !== p.who });
    return row.id!;
  };
  // A teacher of the same batch who is free then, for a covered class.
  const coverFor = (p: (typeof patterns)[number], date: string, time: string) =>
    patterns.find(
      (x) =>
        x.batch.id === p.batch.id &&
        x.subject.id === p.subject.id &&
        x.who.staffId !== p.who.staffId &&
        free(x.who.staffId, date, time, 75),
    )?.who ??
    patterns.find(
      (x) =>
        x.batch.id === p.batch.id &&
        x.who.staffId !== p.who.staffId &&
        free(x.who.staffId, date, time, 75),
    )?.who;

  for (let d = start; d <= 14; d += 1) {
    const date = day(d);
    if (date < (batches[0]!.startDate ?? date) || holidays.some((h) => h.on === date)) continue;
    const weekday = isoWeekday(date);
    for (const p of patterns.filter((x) => x.weekday === weekday && x.from <= date && (!x.to || x.to >= date))) {
      const minutes = p.batch.code.startsWith('IPMAT') ? 75 : 60;
      if (!free(p.batch.id, date, p.time, minutes) || !free(p.who.staffId, date, p.time, minutes))
        continue;
      const key = `${p.id}:${date}`;
      const r = roll(key);
      const delivered = (who: Teacher, time: string, onDate = date) => ({
        status: 'held' as const,
        deliveredAt: instant(onDate, time, minutes),
        deliveredByUserId: (who.userId ?? ctx.managerUserId) as never,
        deliveryNote: pick(
          ['Taught as planned.', 'Finished on time.', 'Ran ten minutes over to finish the example.'],
          key,
        ),
      });
      const base = { patternId: p.id as never };
      if (d >= 0) {
        addPlanned(p, date, p.time, base);
        continue;
      }
      if (r < 60) {
        // Cancelled, with a make-up a few days later in a free hour of the same batch.
        const original = addPlanned(p, date, p.time, {
          ...base,
          status: 'cancelled',
          statusReason: pick(CLASS_TEXT.cancelled, key),
        });
        const later = day(d + 3);
        const hour = '17:45';
        if (isoWeekday(later) !== 7 && free(p.batch.id, later, hour, minutes) && free(p.who.staffId, later, hour, minutes))
          addPlanned(p, later, hour, {
            kind: 'makeup',
            makeupForSessionId: original,
            ...(d + 3 < 0 ? delivered(p.who, hour, later) : {}),
          });
      } else if (r < 90) {
        // Moved a day later: the old row says why, the new row points back at it.
        const later = day(d + 1);
        const original = addPlanned(p, date, p.time, {
          ...base,
          status: 'rescheduled',
          statusReason: pick(CLASS_TEXT.moved, key),
        });
        if (isoWeekday(later) !== 7 && free(p.batch.id, later, p.time, minutes) && free(p.who.staffId, later, p.time, minutes))
          addPlanned(p, later, p.time, {
            rescheduledFromSessionId: original,
            ...(d + 1 < 0 ? delivered(p.who, p.time, later) : {}),
          });
      } else if (r < 140) {
        const cover = coverFor(p, date, p.time);
        addPlanned(p, date, p.time, { ...base, ...delivered(cover ?? p.who, p.time) }, cover ?? p.who);
      } else addPlanned(p, date, p.time, { ...base, ...delivered(p.who, p.time) });
    }
    // A doubt class on the last Saturday hour of each fortnight, for every batch.
    if (d < 0 && weekday === 6 && Math.floor(d / 7) % 2 === 0)
      for (const b of batches) {
        const p = patterns.find((x) => x.batch.id === b.id && free(x.who.staffId, date, '16:30', 60));
        if (p && free(b.id, date, '16:30', 60))
          addPlanned(p, date, '16:30', {
            kind: 'doubt',
            sessionType: 'discussion',
            status: 'held',
            deliveredAt: instant(date, '16:30', 60),
            deliveredByUserId: (p.who.userId ?? ctx.managerUserId) as never,
            deliveryNote: 'Students brought their own questions.',
          });
      }
  }

  await chunked(planned, (part) => db.insert(academicClassSessions).values(part.map((p) => p.row)));
  const sessions = planned.map((p) => ({ ...p, id: p.row.id as string }));

  await chunked(
    sessions.flatMap((s) => {
      const out: (typeof academicSessionTeachers.$inferInsert)[] = [
        { sessionId: s.id as never, staffId: s.planned.staffId as never, role: 'primary', participation: 'planned' },
      ];
      if (s.row.status !== 'held') return out;
      out.push(
        s.covered
          ? {
              sessionId: s.id as never,
              staffId: s.actual.staffId as never,
              role: 'substitute',
              participation: 'actual',
              replacesStaffId: s.planned.staffId as never,
              reason: pick(CLASS_TEXT.covered, s.id),
              authorisedByUserId: ctx.managerUserId as never,
            }
          : {
              sessionId: s.id as never,
              staffId: s.actual.staffId as never,
              role: 'primary',
              participation: 'actual',
            },
      );
      return out;
    }),
    (part) => db.insert(academicSessionTeachers).values(part),
  );

  // Attendance: every held class, except the last few days where some are still to be marked.
  const marks: (typeof academicAttendance.$inferInsert)[] = [];
  for (const s of sessions.filter((x) => x.row.status === 'held')) {
    const date = s.row.date;
    const recent = date >= day(-3);
    const r = roll(`${s.id}:mark`) % 10;
    if (recent && r < 2) continue;
    const roster = (rosters.get(s.row.batchId) ?? []).filter((x) => x.start <= date);
    const part = recent && r < 4 ? roster.slice(0, Math.ceil(roster.length / 2)) : roster;
    const at = instant(date, s.row.startTime, s.row.durationMinutes + 10);
    part.forEach((student, place) => {
      const key = `${student.studentId}:${date}:${s.row.startTime}`;
      // Whoever is last on the roster keeps the weakest habit, so every batch has someone to worry about.
      const status = markFor(place === roster.length - 1 ? HABITS.length - 1 : place, key);
      marks.push({
        sessionId: s.id as never,
        studentId: student.studentId as never,
        status,
        minutesPresent:
          status === 'partial'
            ? Math.round(s.row.durationMinutes / 2)
            : status === 'late'
              ? s.row.durationMinutes - 15
              : null,
        note: status === 'present' ? null : pick(CLASS_TEXT[status], key),
        recordedByUserId: (s.actual.userId ?? ctx.managerUserId) as never,
        recordedAt: at,
      });
    });
  }
  await chunked(marks, (part) => db.insert(academicAttendance).values(part));

  // Teaching logs: verified when old, then submitted, drafts and a few still owed near today.
  const logs: (typeof academicClassRecords.$inferInsert)[] = [];
  const corrected: { sessionId: string; chapterId: string; base: (typeof logs)[number] }[] = [];
  const logFor = (s: (typeof sessions)[number]) => {
    const age = -Math.round((new Date(`${s.row.date}T12:00:00Z`).getTime() - new Date(`${anchor}T12:00:00Z`).getTime()) / 86_400_000);
    const r = roll(`${s.id}:log`) % 100;
    if (age >= 8) return r < 80 ? 'verified' : r < 97 ? 'submitted' : null;
    if (age >= 3) return r < 45 ? 'submitted' : r < 75 ? 'verified' : r < 90 ? 'draft' : null;
    return r < 45 ? 'submitted' : r < 70 ? 'draft' : null;
  };
  for (const s of sessions.filter((x) => x.row.status === 'held' && x.chapter)) {
    const state = logFor(s);
    if (!state) continue;
    const title = s.chapter!.title;
    const r = roll(`${s.id}:text`);
    const finish = instant(s.row.date, s.row.startTime, s.row.durationMinutes + 75);
    const partial = r % 5 === 0;
    const row: (typeof logs)[number] = {
      sessionId: s.id as never,
      batchId: s.row.batchId,
      chapterId: s.chapter!.id as never,
      teacherStaffId: s.actual.staffId as never,
      activity:
        s.row.kind === 'doubt' ? 'doubt_solving' : s.row.sessionType === 'practice' ? 'practice' : r % 9 === 0 ? 'revision' : 'main',
      completion: partial ? 'partial' : 'completed',
      actualMinutes: s.row.durationMinutes - (r % 3) * 5,
      notes: CLASS_TEXT.notes[r % CLASS_TEXT.notes.length]!(title),
      evidence: pick(CLASS_TEXT.evidence, s.id),
      materials: pick(CLASS_TEXT.materials, `${s.id}:m`),
      homework: CLASS_TEXT.homework[r % CLASS_TEXT.homework.length]!(title),
      homeworkDueOn: addDays(s.row.date as IsoDate, 2),
      difficulties: pick(CLASS_TEXT.difficulties, `${s.id}:d`),
      nextPlan: pick(CLASS_TEXT.next, `${s.id}:n`),
      catchUpNeeded: partial ? pick(CLASS_TEXT.catchUp, s.id) : null,
      state,
      submittedAt: state === 'draft' ? null : finish,
      recordedByUserId: (s.actual.userId ?? ctx.managerUserId) as never,
      recordedAt: finish,
      verifiedByUserId: (state === 'verified' ? ctx.managerUserId : null) as never,
      verifiedAt: state === 'verified' ? instant(addDays(s.row.date as IsoDate, 1), '11:00') : null,
    };
    // One log in a dozen was corrected: the first version is kept, superseded.
    if (state === 'submitted' && r % 12 === 1) corrected.push({ sessionId: s.id, chapterId: s.chapter!.id, base: row });
    else logs.push(row);
  }
  await chunked(logs, (part) => db.insert(academicClassRecords).values(part));
  for (const c of corrected) {
    const [first] = await db
      .insert(academicClassRecords)
      .values({
        ...c.base,
        state: 'superseded',
        supersededAt: instant(addDays(c.base.homeworkDueOn as IsoDate, -1), '10:00'),
      })
      .returning({ id: academicClassRecords.id });
    await db.insert(academicClassRecords).values({
      ...c.base,
      version: 2,
      correctsRecordId: first!.id,
      correctionReason: pick(
        ['The chapter was named wrongly in the first log.', 'I wrote the wrong homework date.', 'The minutes taught were entered wrongly.'],
        c.sessionId,
      ),
    });
  }

  // A pattern not yet published and an old one retired, so the timetable screen shows all three.
  const [draftAt, oldAt] = [patterns[0]!, patterns[1]!];
  await db.insert(academicTimetablePatterns).values([
    {
      batchId: draftAt.batch.id,
      subjectId: draftAt.subject.id,
      staffId: draftAt.who.staffId as never,
      roomId: ctx.roomOf(draftAt.batch.code) as never,
      weekday: 6,
      startTime: '12:30',
      durationMinutes: 75,
      effectiveFrom: day(7),
      effectiveTo: draftAt.batch.endDate,
      status: 'draft',
      createdByUserId: ctx.managerUserId as never,
    },
    {
      batchId: oldAt.batch.id,
      subjectId: oldAt.subject.id,
      staffId: oldAt.who.staffId as never,
      roomId: ctx.roomOf(oldAt.batch.code) as never,
      weekday: 2,
      startTime: clock(minutesOf(oldAt.time) + 60),
      durationMinutes: 75,
      effectiveFrom: oldAt.batch.startDate!,
      effectiveTo: addDays(oldAt.batch.startDate as IsoDate, 7),
      status: 'retired',
      publishedAt: instant(addDays(oldAt.batch.startDate as IsoDate, -3), '12:00'),
      publishedByUserId: ctx.managerUserId as never,
      createdByUserId: ctx.managerUserId as never,
    },
  ]);
  log(
    `academic.fill-timetable: ${patterns.length} weekly slots, ${sessions.length} classes, ${marks.length} attendance marks, ${logs.length + corrected.length * 2} logs`,
  );
}
