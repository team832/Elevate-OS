/**
 * Reads behind the Academic internal assessment API (contracts academic.assessments v1 and
 * academic.assessment v1). Views use today's date in Asia/Kolkata: upcoming = draft, or scheduled
 * for a later date (or no date); in progress = conducted, or scheduled for today or earlier;
 * previous = finalised or cancelled; awaiting publication = finalised and not (finally) published.
 * Counts come from stored records under the same filters. Missing is never zero.
 */
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  academicAnswerKeys,
  academicAssessmentBatches,
  academicAssessmentRoster,
  academicAssessmentSections,
  academicAssessments,
  academicBatches,
  academicCourses,
  academicResultPublications,
  academicResultRuns,
  academicResults,
  academicStudents,
  academicSubjects,
  staffMembers,
  users,
  type Database,
} from '@elevate/database';
import {
  ASSESSMENT_TYPE_OF_KIND,
  ASSESSMENT_VIEWS,
  NotFoundError,
  type academicAssessmentDetailV1Schema,
  type academicAssessmentListV1Schema,
  type assessmentListQuerySchema,
} from '@elevate/shared-contracts';
import type { BatchId } from '@elevate/shared-types';
import type { z } from 'zod';
import { assessmentBounds, formatMarks, parseMarks, resolveRules, scoreBounds } from '../../domain';
import { todayIst } from '../context';
import { publicationState } from './assessment-publish';
import { rosterTally, sectionsAndKey, type AssessmentRow } from './assessment-roster';
import { rankVisible } from './results';

const A = academicAssessments;
const P = academicResultPublications;
const ab = academicAssessmentBatches;
const mark = (v: string | null) => (v === null ? null : formatMarks(parseMarks(v)!));

function viewWhere(db: Database, today: string): Record<(typeof ASSESSMENT_VIEWS)[number], SQL> {
  const current = (provisional?: boolean) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(P)
        .where(
          and(
            eq(P.assessmentId, A.id),
            eq(P.status, 'current'),
            provisional === undefined ? undefined : eq(P.provisional, provisional),
          ),
        ),
    );
  const published = or(current(false), and(sql`${A.publishedAt} is not null`, not(current())))!;
  return {
    upcoming: or(
      eq(A.status, 'draft'),
      and(eq(A.status, 'scheduled'), or(isNull(A.scheduledDate), gt(A.scheduledDate, today))),
    )!,
    in_progress: or(
      eq(A.status, 'conducted'),
      and(eq(A.status, 'scheduled'), lte(A.scheduledDate, today)),
    )!,
    previous: inArray(A.status, ['finalised', 'cancelled']),
    awaiting_publication: and(eq(A.status, 'finalised'), not(published))!,
  };
}

type Row = { a: AssessmentRow; courseName: string; courseId: string; primaryCode: string };
const base = (db: Database) =>
  db
    .select({
      a: A,
      courseName: academicCourses.name,
      courseId: academicCourses.id,
      primaryCode: academicBatches.code,
    })
    .from(A)
    .innerJoin(academicBatches, eq(academicBatches.id, A.batchId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId));

/** Contract summaries for a page of assessments (batched lookups, no per-row queries). */
async function summaries(db: Database, rows: Row[]) {
  const ids = rows.map((r) => r.a.id);
  if (ids.length === 0) return [];
  const extra = await db
    .select({ id: ab.assessmentId, batchId: ab.batchId, code: academicBatches.code })
    .from(ab)
    .innerJoin(academicBatches, eq(academicBatches.id, ab.batchId))
    .where(inArray(ab.assessmentId, ids));
  const staffIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.a.responsibleTeacherStaffId, r.a.evaluatorStaffId])
        .filter((s) => s !== null),
    ),
  ];
  const staff = new Map(
    staffIds.length
      ? (
          await db
            .select({ id: staffMembers.id, name: staffMembers.fullName })
            .from(staffMembers)
            .where(inArray(staffMembers.id, staffIds))
        ).map((s) => [s.id as string, s.name])
      : [],
  );
  const pubs = await db
    .select({ id: P.assessmentId, status: P.status, provisional: P.provisional })
    .from(P)
    .where(inArray(P.assessmentId, ids));
  const tally = await rosterTally(db, ids);
  const sections = await db
    .select()
    .from(academicAssessmentSections)
    .where(inArray(academicAssessmentSections.assessmentId, ids))
    .orderBy(asc(academicAssessmentSections.sortOrder));
  const keys = await db
    .select({ id: academicAnswerKeys.assessmentId, answers: academicAnswerKeys.answers })
    .from(academicAnswerKeys)
    .where(inArray(academicAnswerKeys.assessmentId, ids))
    .orderBy(desc(academicAnswerKeys.version));
  const ref = (id: string | null) =>
    id ? { staffId: id as never, name: staff.get(id) ?? 'Unknown staff member' } : null;
  return rows.map(({ a, courseName, courseId, primaryCode }) => {
    const bounds = assessmentBounds({
      assessmentRule: a,
      sections: sections.filter((s) => s.assessmentId === a.id),
      key: keys.find((k) => k.id === a.id)?.answers ?? null,
      maxMarks: a.maxMarks,
    });
    const others = extra.filter((b) => b.id === a.id && b.batchId !== a.batchId);
    return {
      id: a.id,
      code: a.code,
      title: a.title,
      kind: a.kind,
      type: ASSESSMENT_TYPE_OF_KIND[a.kind],
      status: a.status,
      academicYear: a.academicYear,
      courseId,
      courseName,
      batches: [
        { batchId: a.batchId, code: primaryCode, primary: true },
        ...others.map((b) => ({ batchId: b.batchId, code: b.code, primary: false })),
      ],
      scheduledDate: a.scheduledDate,
      startTime: a.startTime,
      maxMarks: mark(a.maxMarks) ?? (bounds ? formatMarks(bounds.maxUnits) : null),
      responsibleTeacher: ref(a.responsibleTeacherStaffId),
      evaluator: ref(a.evaluatorStaffId),
      publicationState: publicationState(
        pubs.filter((p) => p.id === a.id),
        a.publishedAt,
      ),
      rosterCounts: a.rosterSnapshotAt ? tally.get(a.id)!.counts : null,
      isSample: a.isSample,
    };
  });
}

export async function listAssessmentsInternal(
  db: Database,
  q: z.output<typeof assessmentListQuerySchema>,
  today: string = todayIst(),
): Promise<z.input<typeof academicAssessmentListV1Schema>> {
  const eligibleIn = (batchId: SQL | BatchId) =>
    or(
      eq(A.batchId, batchId as BatchId),
      exists(
        db
          .select({ one: sql`1` })
          .from(ab)
          .where(and(eq(ab.assessmentId, A.id), eq(ab.batchId, batchId as BatchId))),
      ),
    );
  const common = and(
    q.teacherStaffId
      ? or(
          eq(A.responsibleTeacherStaffId, q.teacherStaffId as never),
          eq(A.evaluatorStaffId, q.teacherStaffId as never),
        )
      : undefined,
    q.from ? sql`${A.scheduledDate} >= ${q.from}` : undefined,
    q.to ? lte(A.scheduledDate, q.to) : undefined,
  );
  const filters = and(
    common,
    q.courseId ? eq(academicCourses.id, q.courseId as never) : undefined,
    q.batchId ? eligibleIn(q.batchId as BatchId) : undefined,
  );
  const views = viewWhere(db, today);
  const inView = and(common, views[q.view]);
  const courses = await db
    .selectDistinct({ id: academicCourses.id, label: academicCourses.name })
    .from(A)
    .innerJoin(academicBatches, eq(academicBatches.id, A.batchId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId))
    .where(inView)
    .orderBy(academicCourses.name);
  const B = academicBatches;
  const batches = await db
    .selectDistinct({ id: B.id, label: B.code })
    .from(A)
    .innerJoin(B, eligibleIn(sql`${B.id}`)!)
    .where(inView)
    .orderBy(B.code);
  const [c] = await db
    .select(
      Object.fromEntries(
        ASSESSMENT_VIEWS.map((v) => [
          v,
          sql<number>`count(*) filter (where ${views[v]})`.mapWith(Number),
        ]),
      ) as unknown as Record<(typeof ASSESSMENT_VIEWS)[number], SQL<number>>,
    )
    .from(A)
    .innerJoin(academicBatches, eq(academicBatches.id, A.batchId))
    .innerJoin(academicCourses, eq(academicCourses.id, academicBatches.courseId))
    .where(filters);
  const viewCounts = Object.fromEntries(
    ASSESSMENT_VIEWS.map((v) => [v, (c as unknown as Record<string, number>)[v] ?? 0]),
  ) as Record<(typeof ASSESSMENT_VIEWS)[number], number>;
  const newestFirst = q.view === 'previous' || q.view === 'awaiting_publication';
  const rows = await base(db)
    .where(and(filters, views[q.view]))
    .orderBy(
      newestFirst
        ? sql`${A.scheduledDate} desc nulls last`
        : sql`${A.scheduledDate} asc nulls last`,
      asc(A.code),
    )
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return {
    contract: 'academic.assessments',
    version: 1,
    generatedAt: new Date().toISOString(),
    view: q.view,
    total: viewCounts[q.view],
    page: q.page,
    pageSize: q.pageSize,
    viewCounts,
    filterOptions: { courses, batches },
    items: await summaries(db, rows),
  };
}

export async function getAssessmentDetail(
  db: Database,
  id: string,
): Promise<z.input<typeof academicAssessmentDetailV1Schema>> {
  const [row] = await base(db).where(eq(A.id, id as never));
  if (!row) throw new NotFoundError('Assessment not found.');
  const a = row.a;
  const [summary] = await summaries(db, [row]);
  const [subject] = a.subjectId
    ? await db
        .select({ name: academicSubjects.name })
        .from(academicSubjects)
        .where(eq(academicSubjects.id, a.subjectId))
    : [];
  const { sections, key } = await sectionsAndKey(db, a.id);
  const sectionMax = (s: (typeof sections)[number]) => {
    const { rules, problems } = resolveRules(a, [s]);
    return problems.length
      ? null
      : formatMarks(scoreBounds([s], rules, key?.answers ?? null).maxUnits);
  };
  const showRank = await rankVisible(db);
  const R = academicAssessmentRoster;
  const roster = await db
    .select({
      r: R,
      studentCode: academicStudents.code,
      coreStudentId: academicStudents.coreStudentId,
      batchCode: academicBatches.code,
    })
    .from(R)
    .innerJoin(academicStudents, eq(academicStudents.id, R.studentId))
    .innerJoin(academicBatches, eq(academicBatches.id, R.batchId))
    .where(eq(R.assessmentId, a.id))
    .orderBy(asc(R.displayNameSnapshot), asc(academicStudents.code));
  const [run] = await db
    .select()
    .from(academicResultRuns)
    .where(and(eq(academicResultRuns.assessmentId, a.id), eq(academicResultRuns.status, 'final')));
  const [runMax] = run
    ? await db
        .select({ max: academicResults.maxScore })
        .from(academicResults)
        .where(eq(academicResults.runId, run.id))
        .limit(1)
    : [];
  const pubs = await db
    .select({ p: P, by: users.displayName, resultVersion: academicResultRuns.version })
    .from(P)
    .innerJoin(users, eq(users.id, P.publishedByUserId))
    .innerJoin(academicResultRuns, eq(academicResultRuns.id, P.resultRunId))
    .where(eq(P.assessmentId, a.id))
    .orderBy(desc(P.version));
  const history = pubs.map(({ p, by, resultVersion }) => ({
    version: p.version,
    resultVersion,
    status: p.status,
    rankingScope: p.rankingScope,
    cohortBatchIds: p.cohortBatchIds,
    tiePolicy: p.tiePolicy,
    provisional: p.provisional,
    completeness: p.completeness,
    publishedAt: p.publishedAt.toISOString(),
    publishedByName: by,
    withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: p.withdrawnReason,
    note: p.note,
  }));
  return {
    contract: 'academic.assessment',
    version: 1,
    generatedAt: new Date().toISOString(),
    assessment: {
      ...summary!,
      subjectId: a.subjectId,
      subjectName: subject?.name ?? null,
      durationMinutes: a.durationMinutes,
      marking: {
        marksPerCorrect: mark(a.marksPerCorrect),
        marksPerWrong: mark(a.marksPerWrong),
        marksUnattempted: mark(a.marksUnattempted),
      },
      sections: sections.map((s) => ({
        code: s.code,
        name: s.name,
        questionCount: s.questionCount,
        maxMarks: sectionMax(s),
        perCorrect: mark(s.marksPerCorrect ?? a.marksPerCorrect),
        perWrong: mark(s.marksPerWrong ?? a.marksPerWrong),
        perUnattempted: mark(s.marksUnattempted ?? a.marksUnattempted),
        capMarks: mark(s.capMarks),
      })),
      rosterSnapshotAt: a.rosterSnapshotAt?.toISOString() ?? null,
    },
    roster: roster.map(({ r, studentCode, coreStudentId, batchCode }) => ({
      rosterId: r.id,
      studentId: r.studentId,
      coreStudentId,
      studentCode,
      admissionNumber: r.admissionNumberSnapshot,
      displayName: r.displayNameSnapshot,
      batchId: r.batchId,
      batchCode,
      attendance: r.attendance,
      marksState: r.marksState,
      score: mark(r.score),
      rank: showRank ? r.rank : null,
      addedReason: r.addedReason,
      removedAt: r.removedAt?.toISOString() ?? null,
      removedReason: r.removedReason,
      version: r.version,
      isSample: r.isSample,
    })),
    results: run
      ? {
          resultVersion: run.version,
          finalisedAt: run.finalisedAt.toISOString(),
          maxScore: (mark(runMax?.max ?? null) ?? summary!.maxMarks)!,
        }
      : null,
    publication: {
      state: summary!.publicationState,
      rankVisible: showRank,
      current: history.find((h) => h.status === 'current') ?? null,
      history,
    },
  };
}
