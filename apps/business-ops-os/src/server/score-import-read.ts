/**
 * Reading a score file into a review (brief §20): CSV deterministically, a PDF by AI only after
 * the uploader confirms each time (rows marked `ai`). Only the mapped columns are kept; other
 * cells are never stored or shown (their headings stay in the mapping). The same file twice into
 * one test is refused by its SHA-256.
 */
import { createHash } from 'node:crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import {
  isUniqueViolation,
  opsScoreImportRows,
  opsScoreImports,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { ConflictError, isAppError, ValidationError } from '@elevate/shared-contracts';
import { SHEET_COLUMNS } from '../domain/ai-assist';
import { attachmentProblem, cleanFileName } from '../domain/attachments';
import {
  readScoreCsv,
  ScoreRulesError,
  scoreMappingProblems,
  stageScoreRows,
  suggestScoreMapping,
  type ScoreMapping,
  type StagedRow,
} from '../domain/score-import';
import { reviewScoreImport } from '../domain/score-import-validate';
import { aiBlocked } from './ai-drafts';
import { readScoreSheet } from './ai-score-sheet';
import { assertCan, requireTest, type TestDetail } from './assessments';
import type { startImportBody } from './assessments-schemas';
import { first } from './attachment-access';
import { deleteAttachment, uploadAttachment } from './attachments';
import type { Actor } from './context';
import { fieldError } from './ops-common';
import {
  audit,
  EXCEL_HINT,
  markingRules,
  rosterEntries,
  totalsOnly,
  verifiedResults,
} from './score-import';

const fail = (message: string) => fieldError('file', message);

/** Read the file into staged rows (no file is stored when this fails). */
async function readRows(
  db: Database,
  actor: Actor,
  d: TestDetail,
  body: z.output<typeof startImportBody>,
  requestId?: string,
): Promise<{ rows: StagedRow[]; mapping: ScoreMapping }> {
  const rules = markingRules(d);
  const stage = (records: Record<string, string>[], mapping: ScoreMapping, from: 'file' | 'ai') => {
    try {
      return stageScoreRows(records, mapping, rules, from);
    } catch (e) {
      if (e instanceof ScoreRulesError) throw new ConflictError(e.message);
      throw e;
    }
  };
  if (body.source === 'pdf_ai') {
    const blocked = await aiBlocked(db, actor, 'scoreSheet');
    if (blocked)
      throw new ConflictError(`${blocked} Save the sheet as CSV and import that instead.`);
    const sections = d.assessment.sections.map((s) => ({ code: s.code, name: s.name }));
    const records = await readScoreSheet(
      db,
      actor,
      { base64: body.dataBase64, sections },
      requestId,
    ).catch((e: unknown) => {
      throw isAppError(e) && e.status < 500
        ? e
        : new ConflictError(
            'AI could not read this sheet. Try again, or save it as CSV and import that.',
          );
    });
    if (!records.length) throw fail('AI found no student rows in this sheet.');
    const mapping: ScoreMapping = {
      ...Object.fromEntries(Object.entries(SHEET_COLUMNS).map(([f, h]) => [h, f])),
      ...Object.fromEntries(sections.map((s) => [`Section ${s.code}`, `section:${s.code}`])),
    } as ScoreMapping;
    return { rows: stage(records, mapping, 'ai'), mapping };
  }
  const csv = readScoreCsv(Buffer.from(body.dataBase64, 'base64').toString('utf8'));
  if (!csv.ok) throw fail(csv.error);
  const mapping = (body.mapping ??
    suggestScoreMapping(csv.header, rules.sections).mapping) as ScoreMapping;
  const problems = scoreMappingProblems(mapping, rules.sections);
  if (problems.length)
    throw new ValidationError(problems.join(' '), {
      details: problems.map((message) => ({ path: ['mapping'], message })),
    });
  return { rows: stage(csv.rows, mapping, 'file'), mapping };
}

/** Upload, read, stage and match one score file. 201 → the review page. */
export async function startImport(
  db: Database,
  actor: Actor,
  assessmentId: string,
  body: z.output<typeof startImportBody>,
  requestId?: string,
) {
  assertCan(actor, 'ops:assessments:manage');
  const name = cleanFileName(body.name);
  if (/\.xlsx?$/i.test(name)) throw fail(EXCEL_HINT);
  const wanted = body.source === 'csv' ? /\.csv$/i : /\.pdf$/i;
  if (!wanted.test(name))
    throw fail(body.source === 'csv' ? 'Choose a .csv file.' : 'Choose a PDF score sheet.');
  const bytes = Buffer.from(body.dataBase64, 'base64');
  const problem = attachmentProblem(name, body.mime, bytes);
  if (problem) throw fail(problem);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const live = notInArray(opsScoreImports.status, ['cancelled', 'failed']);
  const repeat = () =>
    first(
      db
        .select({ at: opsScoreImports.createdAt })
        .from(opsScoreImports)
        .where(
          and(
            eq(opsScoreImports.assessmentId, assessmentId),
            eq(opsScoreImports.sha256, sha256),
            live,
          ),
        ),
    );
  const refuse = (at?: Date) =>
    new ConflictError(
      `This file was already imported into this test${at ? ` on ${at.toISOString().slice(0, 10)}` : ''}, so nothing was changed. Cancel that import to read the file again.`,
    );
  const earlier = await repeat();
  if (earlier) throw refuse(earlier.at);

  const d = await requireTest(actor, assessmentId);
  if (!d.assessment.rosterSnapshotAt)
    throw new ConflictError('Take the roster snapshot on the test page before importing scores.');
  const { rows, mapping } = await readRows(db, actor, d, body, requestId);
  const review = reviewScoreImport(totalsOnly(rows), rosterEntries(d), verifiedResults(d));
  const file = await uploadAttachment(
    db,
    actor,
    { ...body, name, ownerKind: 'score_import', ownerId: assessmentId, purpose: 'import_source' },
    requestId,
  );
  try {
    return await withTransaction(db, async (tx) => {
      const [imp] = await tx
        .insert(opsScoreImports)
        .values({
          assessmentId,
          attachmentId: file.id as never,
          source: body.source,
          status: 'in_review',
          sha256,
          mapping,
          rowsTotal: rows.length,
          counts: review.counts,
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(opsScoreImportRows).values(
        review.rows.map((r, i) => ({
          importId: imp!.id,
          rowNo: r.rowNumber,
          original: Object.fromEntries(Object.entries(r.original).filter(([k]) => mapping[k])),
          parsed: { ...rows[i]!, original: undefined, warnings: r.warnings } as never,
          matchStatus: r.match.status,
          matchBasis: r.match.basis,
          rosterEntryId: r.match.rosterEntryId,
          studentId: r.match.studentId,
          candidates: r.match.candidates.map((c) => ({ ...c })),
          change: r.change,
          errors: r.errors,
        })),
      );
      await audit(
        tx,
        actor,
        imp!.id,
        'score_import.staged',
        {
          after: { ...imp!, mapping: undefined },
        },
        requestId,
      );
      return { id: imp!.id as string, counts: review.counts };
    });
  } catch (e) {
    // A file this call stored is hidden again (an earlier, shared upload stays with its import).
    if (!file.duplicate)
      await deleteAttachment(db, actor, file.id, requestId).catch(() => undefined);
    if (isUniqueViolation(e, 'score_imports_file_key')) throw refuse((await repeat())?.at);
    throw e;
  }
}
