/**
 * Assessment score import, step 3: review against the roster and verified results, the confirm
 * plan, and ranking (owner brief 23 Oct 2026 §18, §20, §21). Pure.
 * - A row only changes what it states: a blank score never clears a verified one, and a row with
 *   no attendance leaves attendance as it is. Re-importing the same file is "no change".
 * - Changing a verified result needs an explicit overwrite confirmation per row.
 * - AI-extracted rows need a per-row human confirmation before they can be written.
 */
import type { Attendance, MarkUnits, StagedRow } from './score-import';
import {
  matchScoreRows,
  type MatchStatus,
  type MatchedRow,
  type RosterEntry,
} from './score-import-match';

/** A verified result already stored for a student (keyed by studentId). */
export interface ExistingResult {
  attendance: Attendance | null;
  scoreUnits: MarkUnits | null;
  sectionUnits: Readonly<Record<string, MarkUnits | null>>;
}
export type ExistingResults = ReadonlyMap<string, ExistingResult>;
export type Change = 'new' | 'no_change' | 'overwrite' | 'not_entered';

/** What writing this row for a student would do to the stored verified result. */
export function changeFor(row: StagedRow, existing: ExistingResult | undefined): Change {
  if (row.attendance === null && row.notEntered) return 'not_entered';
  if (!existing) return 'new';
  const differs =
    (row.attendance !== null && row.attendance !== existing.attendance) ||
    (row.scoreUnits !== null && row.scoreUnits !== existing.scoreUnits) ||
    Object.entries(row.sectionUnits).some(
      ([c, u]) => u !== null && u !== (existing.sectionUnits[c] ?? null),
    );
  return differs ? 'overwrite' : 'no_change';
}

export type ReviewRow = MatchedRow & { change: Change | null };
export interface ScoreImportReview {
  rows: ReviewRow[];
  /** Roster members no row matched (a person decides: absent, not entered, or a row was missed). */
  missingFromFile: RosterEntry[];
  counts: Record<MatchStatus | 'withErrors' | Change, number>;
}

/** Match, then show for each matched row what confirming it would change. */
export function reviewScoreImport(
  rows: readonly StagedRow[],
  roster: readonly RosterEntry[],
  existing: ExistingResults,
): ScoreImportReview {
  const reviewed = matchScoreRows(rows, roster).map((r) => ({
    ...r,
    change: r.match.studentId ? changeFor(r, existing.get(r.match.studentId)) : null,
  }));
  const seen = new Set(reviewed.map((r) => r.match.rosterEntryId));
  const keys = [
    'matched',
    'suggested',
    'ambiguous',
    'unmatched',
    'duplicate',
    'new',
    'no_change',
    'overwrite',
    'not_entered',
  ] as const;
  return {
    rows: reviewed,
    missingFromFile: roster.filter((e) => !seen.has(e.rosterEntryId)),
    counts: {
      ...(Object.fromEntries(
        keys.map((k) => [k, reviewed.filter((r) => r.match.status === k || r.change === k).length]),
      ) as Record<(typeof keys)[number], number>),
      withErrors: reviewed.filter((r) => r.errors.length).length,
    },
  };
}

export interface ScoreDecisions {
  /** rowId → studentId on the roster, or 'skip'. A matched row without one keeps its match. */
  resolutions?: Readonly<Record<string, string>>;
  /** AI-extracted rows a person checked against the document. */
  aiConfirmed?: readonly string[];
  /** Rows a person confirmed may change a verified result. */
  overwriteConfirmed?: readonly string[];
}
export interface ScoreWrite {
  rowId: string;
  rosterEntryId: string;
  studentId: string;
  source: 'file' | 'ai';
  /** null = the file does not say; leave attendance as it is. */
  attendance: Attendance | null;
  /** null = not entered; leave the score as it is (absent/excused clears it). */
  scoreUnits: MarkUnits | null;
  sectionUnits: Record<string, MarkUnits>;
  overwrite: boolean;
}
export type ScoreImportPlan =
  | {
      ok: true;
      writes: ScoreWrite[];
      overwrites: ScoreWrite[];
      unchanged: string[];
      skipped: string[];
    }
  | { ok: false; problems: { rowId: string; message: string }[] };

const UNRESOLVED: Record<MatchStatus, string> = {
  matched: '',
  suggested: 'choose the student from the suggestions or skip the row.',
  ambiguous: 'more than one student fits; choose one or skip the row.',
  unmatched: 'no student on the roster; choose one or skip the row.',
  duplicate: 'another row is for the same student; keep one and skip the others.',
};

/** The exact verified-score writes for a confirmed import, or every reason it cannot go ahead. */
export function planScoreImport(
  rows: readonly MatchedRow[],
  roster: readonly RosterEntry[],
  existing: ExistingResults,
  decisions: ScoreDecisions = {},
): ScoreImportPlan {
  const problems: { rowId: string; message: string }[] = [];
  const writes: ScoreWrite[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const takenBy = new Map<string, number>();
  for (const r of rows) {
    const fail = (message: string) =>
      problems.push({ rowId: r.rowId, message: `Row ${r.rowNumber}: ${message}` });
    const choice =
      decisions.resolutions?.[r.rowId] || (r.match.status === 'matched' ? r.match.studentId : null);
    if (choice === 'skip') {
      skipped.push(r.rowId);
      continue;
    }
    const entry = roster.find((e) => e.studentId === choice);
    if (!choice) fail(UNRESOLVED[r.match.status]);
    else if (!entry) fail('the chosen student is not on this test’s roster.');
    else if (r.errors.length)
      fail(`${r.errors.map((e) => e.message).join(' ')} Correct the file or skip the row.`);
    else if (r.source === 'ai' && !decisions.aiConfirmed?.includes(r.rowId))
      fail('read by AI; a person must check it against the document before it is saved.');
    else if (takenBy.has(entry.studentId))
      fail(`row ${takenBy.get(entry.studentId)} is already for ${entry.displayName}.`);
    else {
      takenBy.set(entry.studentId, r.rowNumber);
      const change = changeFor(r, existing.get(entry.studentId));
      if (change === 'no_change' || change === 'not_entered') unchanged.push(r.rowId);
      else if (change === 'overwrite' && !decisions.overwriteConfirmed?.includes(r.rowId))
        fail(`changes ${entry.displayName}’s verified result; review and confirm the overwrite.`);
      else
        writes.push({
          rowId: r.rowId,
          rosterEntryId: entry.rosterEntryId,
          studentId: entry.studentId,
          source: r.source,
          attendance: r.attendance,
          scoreUnits: r.scoreUnits,
          sectionUnits: Object.fromEntries(
            Object.entries(r.sectionUnits).filter((x): x is [string, MarkUnits] => x[1] !== null),
          ),
          overwrite: change === 'overwrite',
        });
    }
  }
  return problems.length
    ? { ok: false, problems }
    : { ok: true, writes, overwrites: writes.filter((w) => w.overwrite), unchanged, skipped };
}

export type RosterAttendance = Attendance | 'unmarked';
export type MarksState = 'not_entered' | 'imported_for_review' | 'verified';
export interface RankEntry {
  admissionNumber: string | null;
  displayName: string;
  attendance: RosterAttendance;
  marksState: MarksState;
  scoreUnits: MarkUnits | null;
}

/**
 * Competition ranking (1, 2, 2, 4) of present students with a verified score; everyone else
 * (absent, excused, unmarked, unverified, no score) gets rank null — a missing score is never 0.
 * Display order: rank, then admission number, then name (ties keep the same rank); unranked last.
 * Academic OS ranks the same way (domain/scoring.ts aggregateResults); modules cannot share code.
 */
export function rankScores<T extends RankEntry>(
  entries: readonly T[],
): (T & { rank: number | null })[] {
  const eligible = (e: RankEntry) =>
    e.attendance === 'present' && e.marksState === 'verified' && e.scoreUnits !== null;
  const scores = entries.filter(eligible).map((e) => e.scoreUnits!);
  return entries
    .map((e) => ({
      ...e,
      rank: eligible(e) ? scores.filter((s) => s > e.scoreUnits!).length + 1 : null,
    }))
    .sort(
      (a, b) =>
        (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
        (a.admissionNumber ?? '￿').localeCompare(b.admissionNumber ?? '￿') ||
        a.displayName.localeCompare(b.displayName),
    );
}
