/**
 * What the portal shows of ONE student (F4-13), read in-process from Academic (coordinator ruling:
 * the platform may compose modules). No permission check: the caller passes a student already
 * checked against the login's live links. Only this student's rows: no classmates' names, no staff
 * contacts (teacher names only). `null` = the student is not set up in Academic yet.
 * - Attendance: held classes inside the student's batch placement windows, per batch, with the
 *   Academic `attendance.denominator` rule; unmarked classes are "not recorded", never absent.
 * - Results: published tests only (assessments.published_at, cleared on withdrawal), final run;
 *   a rank only when Academic shows ranks (`progress.show_rank_percentile` approved) and this
 *   publication ranked the student; given as "position of N ranked".
 * - Timetable: the next 14 days of the batches the student is placed in on each day.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import {
  attendanceDefinition,
  formatMarks,
  parseMarks,
  summariseAttendance,
} from '@elevate/academic-os/domain';
import { getSetting, inPlacement, placementsOf, rankVisible } from '@elevate/academic-os/server';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicAttendance,
  academicBatches,
  academicClassSessions,
  academicEnrolments,
  academicResultPublications,
  academicResultRuns,
  academicResults,
  academicRooms,
  academicStudents,
  academicSubjects,
  staffMembers,
  type Database,
} from '@elevate/database';
import { addDays, type IsoDate } from '@elevate/shared-types';

const S = academicClassSessions;

async function academicIdOf(db: Database, studentId: string) {
  const [row] = await db
    .select({ id: academicStudents.id })
    .from(academicStudents)
    .where(eq(academicStudents.coreStudentId, studentId as never));
  return row?.id ?? null;
}

/** The batches the student was ever placed in, each with its placement windows. */
async function batchesOf(db: Database, academicId: string) {
  const enrolments = await db
    .select({ id: academicEnrolments.id })
    .from(academicEnrolments)
    .where(eq(academicEnrolments.studentId, academicId as never));
  const windows = await placementsOf(
    db,
    enrolments.map((e) => e.id),
  );
  const ids = [...new Set(windows.map((w) => w.batchId as string))];
  const batches = ids.length
    ? await db
        .select({ id: academicBatches.id, name: academicBatches.name })
        .from(academicBatches)
        .where(inArray(academicBatches.id, ids as never[]))
        .orderBy(asc(academicBatches.name))
    : [];
  return batches.map((b) => ({ ...b, windows: windows.filter((w) => w.batchId === b.id) }));
}

const placedOn = (
  batches: Awaited<ReturnType<typeof batchesOf>>,
  s: { batchId: string; date: string },
) => inPlacement(s.date, batches.find((b) => b.id === s.batchId)?.windows ?? []);

export async function portalAttendance(db: Database, studentId: string) {
  const aid = await academicIdOf(db, studentId);
  if (!aid) return null;
  const [batches, rule] = [
    await batchesOf(db, aid),
    (await getSetting(db, 'attendance.denominator')).value,
  ];
  const held = batches.length
    ? (
        await db
          .select({
            id: S.id,
            batchId: S.batchId,
            date: S.date,
            startTime: S.startTime,
            subject: academicSubjects.name,
          })
          .from(S)
          .leftJoin(academicSubjects, eq(academicSubjects.id, S.subjectId))
          .where(
            and(
              inArray(
                S.batchId,
                batches.map((b) => b.id),
              ),
              eq(S.status, 'held'),
            ),
          )
      ).filter((s) => placedOn(batches, s))
    : [];
  const marks = held.length
    ? await db
        .select({ sessionId: academicAttendance.sessionId, status: academicAttendance.status })
        .from(academicAttendance)
        .where(
          and(
            eq(academicAttendance.studentId, aid as never),
            inArray(
              academicAttendance.sessionId,
              held.map((h) => h.id),
            ),
          ),
        )
    : [];
  const absent = new Set(
    marks.filter((m) => m.status === 'absent').map((m) => m.sessionId as string),
  );
  return {
    definition: attendanceDefinition(rule),
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      ...summariseAttendance(
        held.filter((h) => h.batchId === b.id).map((h) => h.id),
        marks,
        rule,
      ),
    })),
    recentAbsences: held
      .filter((h) => absent.has(h.id))
      .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
      .slice(0, 10)
      .map((h) => ({ ...h, batch: batches.find((b) => b.id === h.batchId)!.name })),
  };
}

export async function portalResults(db: Database, studentId: string) {
  const aid = await academicIdOf(db, studentId);
  if (!aid) return null;
  const A = academicAssessments;
  const R = academicAssessmentRoster;
  const rows = await db
    .select({
      id: A.id,
      title: A.title,
      kind: A.kind,
      date: A.scheduledDate,
      roster: A.rosterSnapshotAt,
      subject: academicSubjects.name,
      state: academicResults.state,
      score: academicResults.totalScore,
      max: academicResults.maxScore,
      rank: academicResults.rank,
      scored: academicResultRuns.studentsScored,
    })
    .from(academicResults)
    .innerJoin(
      academicResultRuns,
      and(eq(academicResultRuns.id, academicResults.runId), eq(academicResultRuns.status, 'final')),
    )
    .innerJoin(A, and(eq(A.id, academicResults.assessmentId), isNotNull(A.publishedAt)))
    .leftJoin(academicSubjects, eq(academicSubjects.id, A.subjectId))
    .where(and(eq(academicResults.studentId, aid as never), ne(academicResults.state, 'withheld')))
    .orderBy(desc(A.scheduledDate), asc(A.title));
  const ids = rows.map((r) => r.id);
  const showRank = await rankVisible(db);
  const [roster, current] = ids.length
    ? [
        showRank
          ? await db
              .select({ assessmentId: R.assessmentId, studentId: R.studentId, rank: R.rank })
              .from(R)
              .where(and(inArray(R.assessmentId, ids), isNotNull(R.rank)))
          : [],
        await db
          .select({
            assessmentId: academicResultPublications.assessmentId,
            provisional: academicResultPublications.provisional,
          })
          .from(academicResultPublications)
          .where(
            and(
              inArray(academicResultPublications.assessmentId, ids),
              eq(academicResultPublications.status, 'current'),
            ),
          ),
      ]
    : [[], []];
  const mark = (v: string | null) => (v === null ? null : formatMarks(parseMarks(v)!));
  return rows.map((r) => {
    // Roster tests rank in their current publication; older tests carry the run's rank.
    const ranked = roster.filter((x) => x.assessmentId === r.id);
    const position = r.roster ? (ranked.find((x) => x.studentId === aid)?.rank ?? null) : r.rank;
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      date: r.date,
      subject: r.subject,
      absent: r.state === 'absent',
      score: r.state === 'scored' ? mark(r.score) : null,
      max: mark(r.max),
      provisional: current.find((p) => p.assessmentId === r.id)?.provisional ?? false,
      rank:
        showRank && position !== null
          ? { position, of: r.roster ? ranked.length : r.scored }
          : null,
    };
  });
}

export async function portalTimetable(db: Database, studentId: string, today: IsoDate) {
  const aid = await academicIdOf(db, studentId);
  if (!aid) return null;
  const batches = await batchesOf(db, aid);
  if (!batches.length) return [];
  const rows = await db
    .select({
      id: S.id,
      batchId: S.batchId,
      date: S.date,
      startTime: S.startTime,
      minutes: S.durationMinutes,
      status: S.status,
      subject: academicSubjects.name,
      teacher: staffMembers.fullName,
      room: academicRooms.name,
    })
    .from(S)
    .leftJoin(academicSubjects, eq(academicSubjects.id, S.subjectId))
    .leftJoin(staffMembers, eq(staffMembers.id, S.teacherStaffId))
    .leftJoin(academicRooms, eq(academicRooms.id, S.roomId))
    .where(
      and(
        inArray(
          S.batchId,
          batches.map((b) => b.id),
        ),
        gte(S.date, today),
        lte(S.date, addDays(today, 13)),
        inArray(S.status, ['scheduled', 'held', 'cancelled']),
      ),
    )
    .orderBy(asc(S.date), asc(S.startTime));
  return rows
    .filter((s) => placedOn(batches, s))
    .map((s) => ({ ...s, batch: batches.find((b) => b.id === s.batchId)!.name }));
}
