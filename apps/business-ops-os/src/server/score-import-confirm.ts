/**
 * Confirming a reviewed score import (brief §20): every decision is checked again against the
 * current roster, then the marks go to Academic in ONE call (nothing when unchanged). The import
 * switches to confirmed by compare-and-set, so of two confirmations at once only one counts.
 */
import { and, eq } from 'drizzle-orm';
import {
  opsScoreImportRows,
  opsScoreImports,
  type Database,
  type OpsScoreImportId,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import { InvalidStateTransitionError, ValidationError } from '@elevate/shared-contracts';
import { formatUnits, type StagedRow } from '../domain/score-import';
import { matchScoreRows } from '../domain/score-import-match';
import { planScoreImport, type ScoreWrite } from '../domain/score-import-validate';
import { academicWrite, assertCan, type TestDetail } from './assessments';
import type { ConfirmImportInput } from './assessments-schemas';
import type { Actor } from './context';
import { audit, importReview, rosterEntries, totalsOnly, verifiedResults } from './score-import';

/** One plan row as Academic's roster write (attendance only when the file or the person said so). */
function rosterWrite(w: ScoreWrite, r: TestDetail['roster'][number], markPresent: boolean) {
  const attendance =
    w.attendance ??
    (markPresent && w.scoreUnits !== null && r.attendance === 'unmarked' ? 'present' : undefined);
  const now = attendance ?? r.attendance;
  const base = {
    studentId: r.studentId,
    version: r.version,
    ...(attendance ? { attendance } : {}),
  };
  if (now === 'absent' || now === 'excused')
    return w.scoreUnits === null
      ? { ...base, marksState: 'not_entered' as const, score: null }
      : null;
  if (w.scoreUnits === null) return { ...base, marksState: r.marksState, score: r.score };
  const marksState = now === 'present' ? ('verified' as const) : ('imported' as const);
  return { ...base, marksState, score: formatUnits(w.scoreUnits) };
}

/** Check every decision, then record the marks in Academic in one call (nothing when unchanged). */
export async function confirmImport(
  db: Database,
  actor: Actor,
  importId: string,
  body: ConfirmImportInput,
  requestId?: string,
) {
  assertCan(actor, 'ops:assessments:manage');
  const imp = await importReview(db, actor, importId);
  if (imp.status !== 'in_review')
    throw new InvalidStateTransitionError('This import is no longer waiting for review.');
  const d = imp.test;
  const roster = rosterEntries(d);
  const staged = totalsOnly(
    imp.rows.map((r) => ({ ...(r.parsed as unknown as StagedRow), original: r.original })),
  );
  const resolutions = Object.fromEntries(Object.entries(body.resolutions).filter(([, v]) => v));
  const plan = planScoreImport(matchScoreRows(staged, roster), roster, verifiedResults(d), {
    resolutions,
    aiConfirmed: body.aiConfirmed,
    overwriteConfirmed: body.overwriteConfirmed,
  });
  const problem = (rowId: string, message: string) => ({ path: ['rows', rowId], message });
  if (!plan.ok)
    throw new ValidationError('Some rows need a decision before the import can be saved.', {
      details: plan.problems.map((p) => problem(p.rowId, p.message)),
    });
  if (plan.overwrites.length && !body.reason)
    throw new ValidationError('Say why verified marks are changed.', {
      details: [{ path: ['reason'], message: 'Say why verified marks are changed.' }],
    });
  const byStudent = new Map<string, TestDetail['roster'][number]>(
    d.roster.map((r) => [r.studentId, r]),
  );
  const writes = plan.writes.map((w) => ({
    w,
    row: rosterWrite(w, byStudent.get(w.studentId)!, body.markScoredPresent),
  }));
  const contradictions = writes.filter((x) => !x.row);
  if (contradictions.length)
    throw new ValidationError('Some rows give marks for a student Academic has as absent.', {
      details: contradictions.map(({ w }) =>
        problem(
          w.rowId,
          'Academic has this student as absent or excused; correct the attendance or skip the row.',
        ),
      ),
    });
  // A row restating exactly what Academic holds is not sent (a repeat import changes nothing).
  const rows = writes
    .map((x) => x.row!)
    .filter((w) => {
      const r = byStudent.get(w.studentId)!;
      return (
        (w.attendance ?? r.attendance) !== r.attendance ||
        w.marksState !== r.marksState ||
        w.score !== r.score
      );
    });
  if (rows.length)
    await academicWrite(
      actor,
      `/${d.assessment.id}/scores`,
      {
        source: imp.source,
        importRef: imp.id,
        rows,
        overwriteVerified: plan.overwrites.length > 0,
        ...(body.reason ? { reason: body.reason } : {}),
      },
      {
        id: d.assessment.id,
        landed: (after) =>
          rows.every((s) =>
            after.roster.some(
              (r) => r.studentId === s.studentId && r.version > s.version && r.score === s.score,
            ),
          ),
      },
    );
  const overwrites = new Set(plan.overwrites.map((w) => w.rowId));
  return withTransaction(db, async (tx) => {
    const [after] = await tx
      .update(opsScoreImports)
      .set({ status: 'confirmed', confirmedBy: actor.id, confirmedAt: new Date() })
      .where(and(eq(opsScoreImports.id, imp.id), eq(opsScoreImports.status, 'in_review')))
      .returning();
    if (!after)
      throw new InvalidStateTransitionError('This import was confirmed or cancelled meanwhile.');
    for (const r of imp.rows) {
      const rowId = `row-${r.rowNo}`;
      const choice = resolutions[rowId];
      await tx
        .update(opsScoreImportRows)
        .set({
          resolution: choice === 'skip' ? 'skip' : choice ? 'matched' : null,
          ...(choice && choice !== 'skip'
            ? { studentId: choice, rosterEntryId: byStudent.get(choice)?.rosterId ?? null }
            : {}),
          aiConfirmed: body.aiConfirmed.includes(rowId),
          ...(overwrites.has(rowId)
            ? { change: 'overwrite' as const, overwriteConfirmed: true }
            : { overwriteConfirmed: false }),
        })
        .where(eq(opsScoreImportRows.id, r.id));
    }
    const result = {
      written: rows.length,
      overwritten: plan.overwrites.length,
      unchanged: plan.unchanged.length + writes.length - rows.length,
      skipped: plan.skipped.length,
    };
    await audit(
      tx,
      actor,
      imp.id,
      'score_import.confirmed',
      {
        before: { status: imp.status },
        after: { status: after!.status },
        metadata: { ...result, reason: body.reason ?? null },
      },
      requestId,
    );
    return { id: imp.id, ...result };
  });
}

/** Drop an import that is still in review (its file may then be imported again). */
export async function cancelImport(
  db: Database,
  actor: Actor,
  importId: string,
  requestId?: string,
) {
  assertCan(actor, 'ops:assessments:manage');
  return withTransaction(db, async (tx) => {
    const [after] = await tx
      .update(opsScoreImports)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(opsScoreImports.id, importId as OpsScoreImportId),
          eq(opsScoreImports.status, 'in_review'),
        ),
      )
      .returning();
    if (!after)
      throw new InvalidStateTransitionError('Only an import waiting for review can be cancelled.');
    await audit(
      tx,
      actor,
      after.id,
      'score_import.cancelled',
      { after: { status: 'cancelled' } },
      requestId,
    );
    return { id: after.id as string };
  });
}
