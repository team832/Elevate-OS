/**
 * Teacher visibility of assessments and of their per-student marks (own scope).
 * - Assessment level: `assessmentInScope` in ../context — one of its batches (primary or
 *   assessment_batches) with the teacher's active assignment for its subject and year.
 * - Per-student marks and ranks: `markStudentIds` — THE filter for every teacher-facing path that
 *   returns a student's mark, rank or result (marks sheet, results, reports/CSV, analysis,
 *   progress). A teacher sees a row only in a batch where they teach the assessment's subject.
 * `all` scope sees everything.
 */
import { and, eq } from 'drizzle-orm';
import { academicAssessmentRoster, academicAssessments, type Database } from '@elevate/database';
import { NotFoundError } from '@elevate/shared-contracts';
import { assessmentInScope, studentIdsInScope, type Scope } from '../context';

type MarkedAssessment = Pick<
  typeof academicAssessments.$inferSelect,
  'id' | 'batchId' | 'subjectId' | 'academicYear' | 'rosterSnapshotAt'
>;

/** Throw NOT_FOUND (do not leak existence) unless the assessment is visible under the scope. */
export async function assertAssessmentInScope(
  db: Database,
  scope: Scope,
  assessmentId: string,
): Promise<void> {
  const where = assessmentInScope(scope);
  if (!where) return;
  const [row] = await db
    .select({ id: academicAssessments.id })
    .from(academicAssessments)
    .where(and(eq(academicAssessments.id, assessmentId as never), where))
    .limit(1);
  if (!row) throw new NotFoundError('Assessment not found.');
}

/** Batches where the scope teaches this assessment's subject (any subject when it has none) in a matching year; null = all. */
export function markBatchesInScope(
  scope: Scope,
  a: Pick<MarkedAssessment, 'subjectId' | 'academicYear'>,
): string[] | null {
  if (scope.kind === 'all') return null;
  const fits = scope.assignments.filter(
    (f) =>
      (!a.subjectId || f.subjectId === a.subjectId) &&
      (!a.academicYear || !f.academicYear || f.academicYear === a.academicYear),
  );
  return [...new Set(fits.map((f) => f.batchId as string))];
}

/**
 * Students whose marks / ranks on this assessment the scope may see; null = all. Roster-managed:
 * the row's batch at snapshot must be one of `markBatchesInScope`; legacy (one batch): that batch,
 * and the students the teacher can see there.
 */
export async function markStudentIds(
  db: Database,
  scope: Scope,
  a: MarkedAssessment,
): Promise<string[] | null> {
  const batches = markBatchesInScope(scope, a);
  if (!batches) return null;
  if (!a.rosterSnapshotAt)
    return batches.includes(a.batchId) ? ((await studentIdsInScope(db, scope)) ?? []) : [];
  const R = academicAssessmentRoster;
  const rows = await db
    .select({ studentId: R.studentId, batchId: R.batchId })
    .from(R)
    .where(eq(R.assessmentId, a.id));
  return rows.filter((r) => batches.includes(r.batchId)).map((r) => r.studentId as string);
}
