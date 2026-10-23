/**
 * Assessment score import, step 2: match staged rows to the test's roster snapshot (owner brief
 * 23 Oct 2026 §20). Pure. Order: exact admission number → student code → exact name (only when
 * one roster entry has it) → similar names as suggestions only. The first identifier a row gives
 * decides: if it is not on the roster, weaker identifiers become suggestions, never a match.
 * Several rows for one student are all marked duplicate; a person keeps one.
 */
import type { Issue, StagedRow } from './score-import';

export interface RosterEntry {
  rosterEntryId: string;
  studentId: string;
  admissionNumber: string | null;
  studentCode: string | null;
  displayName: string;
  batchLabel: string;
}
export type MatchStatus = 'matched' | 'suggested' | 'ambiguous' | 'unmatched' | 'duplicate';
export type MatchBasis = 'admission_number' | 'student_code' | 'exact_name' | 'none';
export type Candidate = RosterEntry & { similarity: number };
export interface RowMatch {
  status: MatchStatus;
  basis: MatchBasis;
  /** Set for matched and duplicate rows only. */
  rosterEntryId: string | null;
  studentId: string | null;
  candidates: Candidate[];
  message: string | null;
}
export type MatchedRow = StagedRow & { match: RowMatch };

/** Lower case, accents and punctuation removed, single spaces. */
export const normaliseName = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
const ident = (s: string | null) => s?.trim().toUpperCase() || '';

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0–1: best of spelling closeness, closeness with words reordered, and one name's words inside the other's. */
export function nameSimilarity(a: string, b: string): number {
  const ratio = (x: string, y: string) => 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
  const ta = a.split(' ');
  const tb = b.split(' ');
  const subset = ta.every((t) => tb.includes(t)) || tb.every((t) => ta.includes(t));
  return Math.max(
    ratio(a, b),
    ratio([...ta].sort().join(' '), [...tb].sort().join(' ')),
    subset ? 0.8 : 0,
  );
}
export const SUGGEST_AT = 0.75;
const MAX_CANDIDATES = 5;

function matchOne(row: StagedRow, roster: readonly RosterEntry[]): [RowMatch, Issue[]] {
  const name = row.name ? normaliseName(row.name) : '';
  const tiers: [MatchBasis, string, string, (e: RosterEntry) => string][] = [
    [
      'admission_number',
      'Admission number',
      ident(row.admissionNumber),
      (e) => ident(e.admissionNumber),
    ],
    ['student_code', 'Student code', ident(row.studentCode), (e) => ident(e.studentCode)],
    ['exact_name', 'Name', name, (e) => normaliseName(e.displayName)],
  ];
  const hits = tiers.map(([, , given, of]) => (given ? roster.filter((e) => of(e) === given) : []));
  const candidate = (e: RosterEntry): Candidate => ({
    ...e,
    similarity: name ? nameSimilarity(name, normaliseName(e.displayName)) : 0,
  });
  const none = { basis: 'none' as const, rosterEntryId: null, studentId: null };
  const first = tiers.findIndex(([, , given]) => given);
  if (first < 0)
    return [
      {
        ...none,
        status: 'unmatched',
        candidates: [],
        message: 'The row has no admission number, student code or name.',
      },
      [],
    ];
  const [basis, label, given] = tiers[first]!;
  const found = hits[first]!;
  const hit = found[0];
  const clash =
    basis === 'admission_number' && hits[1]!.some((e) => e.rosterEntryId !== hit?.rosterEntryId);
  if (found.length === 1 && !clash) {
    const rosterName = normaliseName(hit!.displayName);
    const differs = basis !== 'exact_name' && name && name !== rosterName;
    // Ambiguous when the name is clearly someone else, or exactly another roster student's.
    if (differs && (hits[2]!.length || nameSimilarity(name, rosterName) < SUGGEST_AT))
      return [
        {
          ...none,
          status: 'ambiguous',
          candidates: [...new Set([hit!, ...hits[2]!])].map(candidate),
          message: `${label} “${given}” is ${hit!.displayName} on the roster, but the row says “${row.name}”.`,
        },
        [],
      ];
    return [
      {
        status: 'matched',
        basis,
        rosterEntryId: hit!.rosterEntryId,
        studentId: hit!.studentId,
        candidates: [],
        message: null,
      },
      differs
        ? [
            {
              code: 'name_mismatch',
              message: `The row says “${row.name}”; the roster says ${hit!.displayName}.`,
            },
          ]
        : [],
    ];
  }
  if (found.length)
    return [
      {
        ...none,
        status: 'ambiguous',
        candidates: [...new Set([...found, ...hits[1]!])].map(candidate),
        message: clash
          ? 'Admission number and student code point to different students.'
          : `${found.length} students on the roster have ${label.toLowerCase()} “${given}”; choose one.`,
      },
      [],
    ];
  const exact = [...new Set(hits.slice(first + 1).flat())];
  const similar = roster
    .filter((e) => name && !exact.includes(e))
    .map(candidate)
    .filter((c) => c.similarity >= SUGGEST_AT)
    .sort((a, b) => b.similarity - a.similarity || a.displayName.localeCompare(b.displayName));
  const candidates = [...exact.map(candidate), ...similar].slice(0, MAX_CANDIDATES);
  return [
    {
      ...none,
      status: candidates.length ? 'suggested' : 'unmatched',
      candidates,
      message: `${label} “${given}” is not on this test’s roster.`,
    },
    [],
  ];
}

/** Match every staged row; rows that land on the same student become duplicates. */
export function matchScoreRows(
  rows: readonly StagedRow[],
  roster: readonly RosterEntry[],
): MatchedRow[] {
  const matched = rows.map((r) => {
    const [match, warnings] = matchOne(r, roster);
    return { ...r, match, warnings: [...r.warnings, ...warnings] };
  });
  const count = new Map<string, number>();
  for (const r of matched)
    if (r.match.rosterEntryId)
      count.set(r.match.rosterEntryId, (count.get(r.match.rosterEntryId) ?? 0) + 1);
  return matched.map((r) => {
    const n = count.get(r.match.rosterEntryId ?? '') ?? 0;
    return n > 1
      ? {
          ...r,
          match: {
            ...r.match,
            status: 'duplicate',
            message: `${n} rows in this file are for this student; keep one and skip the others.`,
          },
        }
      : r;
  });
}
