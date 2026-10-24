/**
 * Score imports into a test (owner brief 23 Oct 2026 §20; owner answers 2 and 6). Upload → read
 * (CSV deterministically; a PDF by AI only after the uploader confirms, rows marked `ai`) → stage
 * in ops.score_imports/rows → match against the Academic roster → review → confirm: ONE call that
 * records the marks in Academic. Publishing is a separate step (assessments.ts). Shared parts and
 * the review read; reading a file: score-import-read.ts; confirming: score-import-confirm.ts.
 */
import { asc, eq } from 'drizzle-orm';
import {
  opsAttachments,
  opsScoreImportRows,
  opsScoreImports,
  type Database,
  type OpsScoreImportId,
} from '@elevate/database';
import {
  markUnits,
  type MarkingRules,
  type ScoreSection,
  type StagedRow,
} from '../domain/score-import';
import type { RosterEntry } from '../domain/score-import-match';
import type { ExistingResults } from '../domain/score-import-validate';
import { assertCan, requireTest, type TestDetail } from './assessments';
import { first } from './attachment-access';
import { notFound, type Actor } from './context';
import { opsAudit } from './ops-common';

export const audit = opsAudit('score_import');
export const EXCEL_HINT =
  'Excel files are not read. Save the sheet as CSV (File → Save as → CSV) and upload that.';

type Section = TestDetail['assessment']['sections'][number];
/**
 * The test's marking rules as the domain reads them: each section's own rule from Academic, the
 * test-level marking where a section value is unknown, else one total.
 */
export function markingRules(d: TestDetail): MarkingRules {
  const { marking: m, sections, maxMarks } = d.assessment;
  const rule = (
    s: Pick<Section, 'code' | 'name' | 'maxMarks'> & Partial<Section>,
  ): ScoreSection => {
    const perCorrect = s.perCorrect ?? m.marksPerCorrect;
    // Without marks per correct answer only the maximum is known (one "question" worth it).
    const count = perCorrect !== null ? (s.questionCount ?? null) : null;
    return {
      code: s.code,
      name: s.name,
      questionCount: count,
      perCorrect: perCorrect ?? s.maxMarks ?? '0',
      perWrong: s.perWrong ?? m.marksPerWrong ?? '0',
      perUnattempted: s.perUnattempted ?? m.marksUnattempted ?? '0',
      capMarks: s.capMarks ?? (count === null ? s.maxMarks : null),
    };
  };
  return {
    sections: sections.length
      ? sections.map(rule)
      : [rule({ code: 'TOTAL', name: 'Total', maxMarks })],
  };
}

export const rosterEntries = (d: TestDetail): RosterEntry[] =>
  d.roster
    .filter((r) => !r.removedAt)
    .map((r) => ({
      rosterEntryId: r.rosterId,
      studentId: r.studentId,
      admissionNumber: r.admissionNumber,
      studentCode: r.studentCode,
      displayName: r.displayName,
      batchLabel: r.batchCode,
    }));

/** Verified results only (what an import may overwrite); Academic keeps no section marks. */
export const verifiedResults = (d: TestDetail): ExistingResults =>
  new Map(
    d.roster
      .filter((r) => !r.removedAt && r.marksState === 'verified')
      .map((r) => [
        r.studentId,
        {
          attendance: r.attendance === 'unmarked' ? null : r.attendance,
          scoreUnits: r.score === null ? null : (markUnits(r.score) ?? null),
          sectionUnits: {},
        },
      ]),
  );
/** Section marks are checked when staged; Academic stores totals, so they never decide a change. */
export const totalsOnly = (rows: readonly StagedRow[]) =>
  rows.map((r) => ({ ...r, sectionUnits: {} }));

/**
 * The import with its rows (only the mapped cells were stored), the file name, and the test from
 * Academic. `testId` (from the page URL) must be the import's own test.
 */
export async function importReview(db: Database, actor: Actor, importId: string, testId?: string) {
  assertCan(actor, 'ops:assessments:read');
  const imp = await first(
    db
      .select({ i: opsScoreImports, fileName: opsAttachments.originalName })
      .from(opsScoreImports)
      .leftJoin(opsAttachments, eq(opsAttachments.id, opsScoreImports.attachmentId))
      .where(eq(opsScoreImports.id, importId as OpsScoreImportId)),
  );
  if (!imp || (testId && imp.i.assessmentId !== testId)) notFound('Import');
  const rows = await db
    .select()
    .from(opsScoreImportRows)
    .where(eq(opsScoreImportRows.importId, importId as OpsScoreImportId))
    .orderBy(asc(opsScoreImportRows.rowNo));
  return {
    ...imp.i,
    fileName: imp.fileName,
    rows,
    test: await requireTest(actor, imp.i.assessmentId),
  };
}
export type ImportReview = Awaited<ReturnType<typeof importReview>>;

/** Imports of one test, newest first. */
export function testImports(db: Database, testId: string) {
  return db
    .select({
      id: opsScoreImports.id,
      source: opsScoreImports.source,
      status: opsScoreImports.status,
      rowsTotal: opsScoreImports.rowsTotal,
      counts: opsScoreImports.counts,
      createdAt: opsScoreImports.createdAt,
      fileName: opsAttachments.originalName,
    })
    .from(opsScoreImports)
    .leftJoin(opsAttachments, eq(opsAttachments.id, opsScoreImports.attachmentId))
    .where(eq(opsScoreImports.assessmentId, testId))
    .orderBy(asc(opsScoreImports.createdAt));
}
