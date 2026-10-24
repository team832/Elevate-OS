/**
 * A pending score import on a sample test (brief 23 Oct 2026 §20, §25): a small sample score sheet
 * read and matched by the same domain rules as an upload (readScoreCsv → stageScoreRows →
 * reviewScoreImport), staged in ops.score_imports/rows and left "in review": one row matched by
 * admission number, one ambiguous (number of one student, name of another), one by name, one not
 * on the roster. Nothing is recorded in Academic until someone reviews and confirms it. Source is
 * `manual` because the seed stores no file (sample sheet typed here, not uploaded). Called by the
 * platform seed with the test as Academic shows it.
 */
import { opsScoreImportRows, opsScoreImports, type Database } from '@elevate/database';
import { readScoreCsv, stageScoreRows, suggestScoreMapping } from '../src/domain/score-import';
import { reviewScoreImport } from '../src/domain/score-import-validate';
import type { TestDetail } from '../src/server/assessments';
import {
  markingRules,
  rosterEntries,
  totalsOnly,
  verifiedResults,
} from '../src/server/score-import';
import { seedActor } from './samples';

const csvCell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;

export async function seedSampleScoreImport(db: Database, d: TestDetail, actorEmail: string) {
  const actor = await seedActor(db, actorEmail);
  const open = d.roster.filter(
    (r) => !r.removedAt && r.marksState === 'not_entered' && r.attendance !== 'absent',
  );
  if (!actor || open.length < 3) return null;
  const [a, b, c] = open as [
    TestDetail['roster'][number],
    TestDetail['roster'][number],
    TestDetail['roster'][number],
  ];
  const lines = [
    ['Admission number', 'Student code', 'Name', 'Total', 'Attendance'],
    [a.admissionNumber, a.admissionNumber ? null : a.studentCode, a.displayName, '19', 'present'],
    // An id that belongs to one student next to another student's exact name: ambiguous.
    [
      b.admissionNumber,
      b.admissionNumber ? null : b.studentCode,
      c.displayName,
      '15.75',
      'present',
    ],
    [null, null, c.displayName, '22', 'present'],
    [null, null, 'Name not on the roster', '17', 'present'],
  ];
  const csv = readScoreCsv(lines.map((l) => l.map(csvCell).join(',')).join('\n'));
  if (!csv.ok) throw new Error(csv.error);
  const rules = markingRules(d);
  const { mapping } = suggestScoreMapping(csv.header, rules.sections);
  const staged = stageScoreRows(csv.rows, mapping, rules, 'file');
  const review = reviewScoreImport(totalsOnly(staged), rosterEntries(d), verifiedResults(d));
  const [imp] = await db
    .insert(opsScoreImports)
    .values({
      assessmentId: d.assessment.id,
      source: 'manual',
      status: 'in_review',
      mapping,
      rowsTotal: staged.length,
      counts: review.counts,
      createdBy: actor.actor.id,
      isSample: true,
    })
    .returning();
  await db.insert(opsScoreImportRows).values(
    review.rows.map((r, i) => ({
      importId: imp!.id,
      rowNo: r.rowNumber,
      original: r.original,
      parsed: { ...staged[i]!, original: undefined, warnings: r.warnings } as never,
      matchStatus: r.match.status,
      matchBasis: r.match.basis,
      rosterEntryId: r.match.rosterEntryId,
      studentId: r.match.studentId,
      candidates: r.match.candidates.map((x) => ({ ...x })),
      change: r.change,
      errors: r.errors,
    })),
  );
  return { id: imp!.id, counts: review.counts };
}
