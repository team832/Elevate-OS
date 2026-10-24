/**
 * A teacher's assessments with the brief §16/§21 counts: assigned, completed, awaiting marking,
 * published, plus imported scores awaiting review. Read-only over academic.assessments,
 * assessment_batches (through `assessmentInScope`), assessment_roster and result_publications;
 * the assessment services write them. Feeds the teacher's My day and the optional `assessments`
 * counts of the `academic.teacher_activity` v1 contract, so both always agree.
 *
 * - assigned: not cancelled, in the teacher's scope (batch + subject + year of an assignment open
 *   on `today`), and the teacher is the responsible teacher or evaluator, or neither is named; a
 *   window keeps the ones dated in it plus the undated ones (not yet scheduled, still assigned);
 * - completed: conducted or finalised;
 * - awaiting marking (the evaluator's, else the responsible teacher's): held (conducted, finalised,
 *   or scheduled on or before today) and, roster-managed, an active roster row unmarked or present
 *   without a verified score; legacy (no roster snapshot), conducted and not yet finalised;
 * - published: a current (final or provisional) publication, or a legacy published_at;
 * - awaiting review: active roster rows whose score was imported and not verified yet.
 * No staff record or no assignment open today = null (not available), never zeros.
 */
import { and, asc, eq, gte, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  academicAssessmentRoster,
  academicAssessments,
  academicBatches,
  academicResultPublications,
  academicSubjects,
  type Database,
} from '@elevate/database';
import { assessmentInScope, todayIst, type OwnScope } from '../context';

const a = academicAssessments;
const r = academicAssessmentRoster;
const p = academicResultPublications;
const activeRows = (cond: SQL) =>
  sql<number>`(select count(*) from ${r} where ${r.assessmentId} = ${a.id} and ${r.removedAt} is null and ${cond})`.mapWith(
    Number,
  );

export async function teacherAssessments(
  db: Database,
  scope: OwnScope,
  opts: { window?: { from: string; to: string }; today?: string } = {},
) {
  const me = scope.staffId;
  if (!me || scope.assignments.length === 0) return null;
  const today = opts.today ?? todayIst();
  const rows = await db
    .select({
      id: a.id,
      code: a.code,
      title: a.title,
      status: a.status,
      scheduledDate: a.scheduledDate,
      batchCode: academicBatches.code,
      subjectName: academicSubjects.name,
      responsible: a.responsibleTeacherStaffId,
      evaluator: a.evaluatorStaffId,
      rosterManaged: sql<boolean>`${a.rosterSnapshotAt} is not null`,
      unmarked: activeRows(
        sql`(${r.attendance} = 'unmarked' or (${r.attendance} = 'present' and ${r.marksState} <> 'verified'))`,
      ),
      imported: activeRows(sql`${r.marksState} = 'imported'`),
      current: sql<boolean>`exists (select 1 from ${p} where ${p.assessmentId} = ${a.id} and ${p.status} = 'current')`,
      publishedAt: a.publishedAt,
      isSample: a.isSample,
    })
    .from(a)
    .innerJoin(academicBatches, eq(academicBatches.id, a.batchId))
    .leftJoin(academicSubjects, eq(academicSubjects.id, a.subjectId))
    .where(
      and(
        ne(a.status, 'cancelled'),
        assessmentInScope(scope),
        or(
          eq(a.responsibleTeacherStaffId, me),
          eq(a.evaluatorStaffId, me),
          and(isNull(a.responsibleTeacherStaffId), isNull(a.evaluatorStaffId)),
        ),
        opts.window
          ? or(
              isNull(a.scheduledDate),
              and(gte(a.scheduledDate, opts.window.from), lte(a.scheduledDate, opts.window.to)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(a.scheduledDate), asc(a.code));
  return rows.map(
    ({ responsible, evaluator, unmarked, imported, current, publishedAt, ...row }) => {
      const marker = evaluator ? evaluator === me : !responsible || responsible === me;
      const completed = row.status === 'conducted' || row.status === 'finalised';
      const held =
        completed ||
        (row.status === 'scheduled' && row.scheduledDate !== null && row.scheduledDate <= today);
      return {
        ...row,
        completed,
        awaitingMarking:
          marker && held && (row.rosterManaged ? unmarked > 0 : row.status === 'conducted'),
        awaitingReview: marker ? imported : 0,
        published: current || publishedAt !== null,
      };
    },
  );
}

export type TeacherAssessmentRow = NonNullable<
  Awaited<ReturnType<typeof teacherAssessments>>
>[number];

export function countAssessments(rows: readonly TeacherAssessmentRow[]) {
  return {
    assigned: rows.length,
    completed: rows.filter((x) => x.completed).length,
    awaitingMarking: rows.filter((x) => x.awaitingMarking).length,
    published: rows.filter((x) => x.published).length,
    awaitingReview: rows.filter((x) => x.awaitingReview > 0).length,
  };
}
