/**
 * Sample tests (brief 23 Oct 2026 §17–§21, §25; D-036), called by the platform seed
 * `platform.sample-tests` once the sample admissions are enrolled: Ops admission numbers come from
 * the caller, like the Ops → Academic internal route. Every step goes through the Academic
 * internal assessment services (create, roster snapshot, record scores, finalise, publish), so
 * bounds, the one-writer rule and competition ranking are the real ones. Responsible teachers are
 * SAMPLE teachers only (never the eight owner-supplied teacher records of ops seed/teachers.ts, "Soma" included). Tests and roster rows carry `is_sample`.
 *
 *   SAMPLE-IPMAT-MOCK-01  previous, two batches, +4/−1 negative marking, verified scores with a tie
 *                         (ranks 1, 2, 2, 4), a present student with 0, a negative total, absences;
 *                         finalised and PUBLISHED
 *   SAMPLE-CLAT-CA-01     previous, in progress: some verified, one absent, one present with no
 *                         score, the rest unmarked (the platform seed stages a pending import here)
 *   SAMPLE-C11-MATH-01    previous, finalised, results awaiting publication
 *   SAMPLE-CAF-ACC-01, SAMPLE-C12-MATH-01  upcoming, no roster yet
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthenticatedUser } from '@elevate/authentication';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicBatches,
  academicEnrolments,
  academicStudents,
  academicSubjects,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import type { SessionId } from '@elevate/shared-types';
import { addDays, toIsoDate } from '@elevate/shared-types';
import {
  createAssessmentInternal,
  internalActor,
  publishInternal,
  recordScores,
  snapshotRosterInternal,
} from '../src/server/services/assessment-ops';
import { getAssessmentDetail } from '../src/server/services/assessment-views';
import { allocatePlacement } from '../src/server/services/placements';
import { finaliseAssessment } from '../src/server/services/results';

export { getAssessmentDetail };

type Mark = string | 'A' | '-' | null;
/** Per roster row (by name): a verified score, `A` absent, `-` present with no score, null unmarked. */
interface SampleTest {
  code: string;
  title: string;
  kind: 'chapter_test' | 'sectional' | 'full_mock';
  batches: string[];
  subject: string;
  teacher: string;
  day: number;
  /** Marking rule for every section (marks per correct / wrong answer), or a total-only maximum. */
  rule:
    | {
        perCorrect: string;
        perWrong: string;
        sections: { code: string; name: string; questionCount: number }[];
      }
    | { maxMarks: string };
  marks?: Mark[];
  finalise?: true;
  publish?: true;
}

export const SAMPLE_TESTS: readonly SampleTest[] = [
  {
    code: 'SAMPLE-IPMAT-MOCK-01',
    title: 'IPMAT mock 1 (sample)',
    kind: 'full_mock',
    batches: ['SAMPLE-IPMAT-A', 'SAMPLE-IPMAT-B'],
    subject: 'QUANT',
    teacher: 'arjun.menon@example.test',
    day: -7,
    rule: {
      perCorrect: '4',
      perWrong: '-1',
      sections: [{ code: 'QA', name: 'Quantitative Ability', questionCount: 30 }],
    },
    marks: ['112', '96', '96', '80', '0', '-3', 'A', '64', '72', 'A', '88', '52', '40'],
    finalise: true,
    publish: true,
  },
  {
    code: 'SAMPLE-CLAT-CA-01',
    title: 'CLAT current affairs sectional 1 (sample)',
    kind: 'sectional',
    batches: ['SAMPLE-CLAT-A'],
    subject: 'CA',
    teacher: 'kavya.joshi@example.test',
    day: -2,
    rule: {
      perCorrect: '1',
      perWrong: '-0.25',
      sections: [{ code: 'CA', name: 'Current Affairs', questionCount: 28 }],
    },
    marks: ['21.5', 'A', '18', '-', null, null, null, null],
  },
  {
    code: 'SAMPLE-C11-MATH-01',
    title: 'Class 11 Mathematics chapter test: Sets (sample)',
    kind: 'chapter_test',
    batches: ['SAMPLE-C11-MATH'],
    subject: 'MATH',
    teacher: 'nisha.rao@example.test',
    day: -10,
    rule: { maxMarks: '50' },
    marks: ['42', '35', 'A', '47', '29'],
    finalise: true,
  },
  {
    code: 'SAMPLE-CAF-ACC-01',
    title: 'CA Foundation Accounting test 1 (sample)',
    kind: 'chapter_test',
    batches: ['SAMPLE-CAF'],
    subject: 'ACC',
    teacher: 'aditi.mehra@example.test',
    day: 5,
    rule: { maxMarks: '100' },
  },
  {
    code: 'SAMPLE-C12-MATH-01',
    title: 'Class 12 Mathematics chapter test: Matrices (sample)',
    kind: 'chapter_test',
    batches: ['SAMPLE-C12-MATH'],
    subject: 'MATH',
    teacher: 'nisha.rao@example.test',
    day: 9,
    rule: { maxMarks: '40' },
  },
];
export const PENDING_IMPORT_TEST = 'SAMPLE-CLAT-CA-01';

const userId = async (db: Database, email: string) =>
  (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id ?? null;

/**
 * Place the sample admissions Ops sent for enrolment (awaiting a batch) into the sample batch of
 * their programme, from their enrolment's start date, through the placement service. Students of
 * a programme without a sample batch (CUET) stay "Awaiting batch". `admissionIds`: the admissions
 * Ops still counts as enrolled (the caller's list; held or exited students are not placed).
 */
export async function placeSampleEnrolments(
  db: Database,
  admissionIds: readonly string[],
  coordinatorEmail = 'academic-coordinator@example.test',
) {
  if (!admissionIds.length) return 0;
  const id = await userId(db, coordinatorEmail);
  if (!id) return 0;
  const actor = {
    user: {
      id,
      email: coordinatorEmail,
      displayName: 'Sample Academic Coordinator',
      roles: ['academic_coordinator'],
      sessionId: '' as SessionId,
    } as unknown as AuthenticatedUser,
  };
  const waiting = await db
    .select({
      id: academicEnrolments.id,
      programmeId: academicEnrolments.programmeId,
      startDate: academicEnrolments.startDate,
    })
    .from(academicEnrolments)
    .innerJoin(academicStudents, eq(academicStudents.id, academicEnrolments.studentId))
    .where(
      and(
        eq(academicStudents.isSample, true),
        eq(academicEnrolments.status, 'active'),
        isNull(academicEnrolments.batchId),
        inArray(academicEnrolments.sourceAdmissionId, admissionIds as never[]),
      ),
    );
  const batches = await db
    .select()
    .from(academicBatches)
    .where(eq(academicBatches.isSample, true))
    .orderBy(academicBatches.code);
  let placed = 0;
  for (const e of waiting) {
    const batch = batches.find((b) => b.programmeId === e.programmeId);
    if (!batch) continue;
    await allocatePlacement(db, actor, {
      enrolmentId: e.id,
      batchId: batch.id,
      startDate: e.startDate ?? undefined,
      reason: 'Sample student placed by the development seed.',
    });
    placed += 1;
  }
  return placed;
}

/** Create the sample tests; `admissionNumbers` = Ops numbers of admitted students by core student id. */
export async function seedSampleTests(
  db: Database,
  opts: {
    actorEmail: string;
    admissionNumbers: { coreStudentId: string; admissionNumber: string }[];
  },
) {
  if (await db.$count(academicAssessments, eq(academicAssessments.isSample, true))) return null;
  const uid = await userId(db, opts.actorEmail);
  if (!uid) return null;
  const actor = await internalActor(db, uid, 'sample-seed');
  const today = toIsoDate();
  const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
  const academicYear = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const ids = new Map<string, string>();
  for (const t of SAMPLE_TESTS) {
    const batches = await db
      .select({
        id: academicBatches.id,
        code: academicBatches.code,
        courseId: academicBatches.courseId,
      })
      .from(academicBatches)
      .where(inArray(academicBatches.code, t.batches));
    const batchIds = t.batches.map((c) => batches.find((b) => b.code === c)!.id);
    const [subject] = await db
      .select({ id: academicSubjects.id })
      .from(academicSubjects)
      .where(
        and(
          eq(academicSubjects.courseId, batches[0]!.courseId),
          eq(academicSubjects.code, t.subject),
        ),
      );
    const teacher = await db.select({ id: users.id }).from(users).where(eq(users.email, t.teacher));
    const [staff] = teacher[0]
      ? await db
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .where(eq(staffMembers.userId, teacher[0].id))
      : [];
    const id = await createAssessmentInternal(db, actor, {
      code: t.code,
      title: t.title,
      kind: t.kind,
      academicYear,
      batchIds: batchIds as never,
      subjectId: subject?.id ?? null,
      scheduledDate: addDays(today, t.day),
      startTime: '10:00',
      durationMinutes: 120,
      responsibleTeacherStaffId: (staff?.id ?? null) as never,
      evaluatorStaffId: (staff?.id ?? null) as never,
      ...('sections' in t.rule
        ? {
            sections: t.rule.sections,
            marksPerCorrect: t.rule.perCorrect,
            marksPerWrong: t.rule.perWrong,
            marksUnattempted: '0',
          }
        : { maxMarks: t.rule.maxMarks }),
    });
    ids.set(t.code, id);
    // No route may set the sample flag; the roster copies it at the snapshot.
    await db
      .update(academicAssessments)
      .set({ isSample: true })
      .where(eq(academicAssessments.id, id as never));
    if (!t.marks) continue;
    await snapshotRosterInternal(db, actor, id, { admissionNumbers: opts.admissionNumbers });
    const roster = await db
      .select()
      .from(academicAssessmentRoster)
      .where(eq(academicAssessmentRoster.assessmentId, id as never))
      .orderBy(academicAssessmentRoster.displayNameSnapshot);
    type Row = {
      studentId: string;
      version: number;
      attendance: 'present' | 'absent';
      marksState: 'not_entered' | 'verified';
      score: string | null;
    };
    const rows = roster.flatMap((r, i): Row[] => {
      // Rows past the list (more students placed than planned): absent when results are final.
      const m = i < t.marks!.length ? t.marks![i] : t.finalise ? 'A' : null;
      if (m === null || m === undefined) return [];
      const base = { studentId: r.studentId, version: r.version };
      if (m === 'A')
        return [{ ...base, attendance: 'absent', marksState: 'not_entered', score: null }];
      if (m === '-')
        return [{ ...base, attendance: 'present', marksState: 'not_entered', score: null }];
      return [{ ...base, attendance: 'present', marksState: 'verified', score: m }];
    });
    await recordScores(db, actor, id, {
      source: 'manual',
      rows,
      overwriteVerified: false,
    } as never);
    if (t.finalise) await finaliseAssessment(db, actor, id);
    if (t.publish)
      await publishInternal(db, actor, id, {
        version: 1,
        rankingScope: 'roster',
        provisional: false,
        note: 'Sample results.',
      });
  }
  return ids;
}
