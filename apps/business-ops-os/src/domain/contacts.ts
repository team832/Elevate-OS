/**
 * Contact normalisation and duplicate-contact detection (OPS-003).
 * Algorithm documentation: docs/ALGORITHMS.md → A-01 and A-02.
 *
 * Deterministic and pure. Strong signals are exact matches of NORMALISED
 * phones/emails; names are only ever a weak signal that can upgrade a
 * guardian-contact match or combine with the same school. Nothing here merges
 * anything: callers warn and offer a merge review.
 */

// --- phones: the one rule lives in shared-contracts, so Academic accepts the same text.
export { normalisePhone, PHONE_ERROR_MESSAGES, type PhoneResult } from '@elevate/shared-contracts';

// --- emails -----------------------------------------------------------------------------------

export type EmailResult =
  { ok: true; email: string } | { ok: false; reason: 'missing' | 'invalid' };

/**
 * Trim and lower-case. Provider-specific rewriting (Gmail dots, `+tags`) is NOT
 * applied: it would merge addresses that really are different people.
 */
export function normaliseEmail(raw: string | null | undefined): EmailResult {
  const email = (raw ?? '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'missing' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, email };
}

// --- names (weak signal) ----------------------------------------------------------------------

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kumari', 'master']);

/** Lower-case, strip accents, punctuation and honorifics. */
export function normaliseName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
    .join(' ');
}

/** Jaro-Winkler similarity in [0, 1] (prefix scale 0.1, max prefix 4). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Name similarity used by duplicate detection: a token-level match. Each token
 * of the shorter name is paired with its best unused token of the other name
 * (Jaro-Winkler); the score is the sum of pair scores divided by the number of
 * tokens of the LONGER name. So word order does not matter ("Sharma Riya" =
 * "Riya Sharma"), a typo scores high, but a shared surname alone (siblings:
 * "Kabir Sharma" vs "Riya Sharma") scores low. Empty names score 0.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = normaliseName(a).split(' ').filter(Boolean);
  const tb = normaliseName(b).split(' ').filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const pairs: { i: number; j: number; score: number }[] = [];
  short.forEach((x, i) => long.forEach((y, j) => pairs.push({ i, j, score: jaroWinkler(x, y) })));
  pairs.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  let total = 0;
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i);
    usedJ.add(p.j);
    total += p.score;
  }
  return total / long.length;
}

/** Default threshold for "similar name" (weak signal). */
export const NAME_SIMILARITY_THRESHOLD = 0.88;

export function normaliseSchool(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(school|sr|senior|secondary|sec|public|the)\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

// --- duplicate detection ------------------------------------------------------------------------

/** Already-normalised contact data of one lead. */
export interface ContactRecord {
  id: string;
  code: string;
  studentName: string;
  studentPhone: string | null;
  studentEmail: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  previousSchool: string | null;
}

export type DuplicateSignal =
  | 'student_phone'
  | 'student_email'
  | 'student_contact_is_guardian_contact'
  | 'guardian_phone'
  | 'guardian_email'
  | 'similar_name'
  | 'same_school';

export type DuplicateLevel = 'exact' | 'possible';

export interface DuplicateMatch {
  leadId: string;
  code: string;
  level: DuplicateLevel;
  signals: DuplicateSignal[];
  nameSimilarity: number;
}

type Role = 'student' | 'guardian';
interface Contact {
  role: Role;
  type: 'phone' | 'email';
  value: string;
}

function contactsOf(r: ContactRecord): Contact[] {
  const out: Contact[] = [];
  if (r.studentPhone) out.push({ role: 'student', type: 'phone', value: r.studentPhone });
  if (r.studentEmail) out.push({ role: 'student', type: 'email', value: r.studentEmail });
  if (r.guardianPhone) out.push({ role: 'guardian', type: 'phone', value: r.guardianPhone });
  if (r.guardianEmail) out.push({ role: 'guardian', type: 'email', value: r.guardianEmail });
  return out;
}

/**
 * Compare one candidate with one existing record. Rules (first match wins):
 * 1. EXACT — a normalised phone/email is shared and at least one side of the
 *    shared contact is a STUDENT contact (student↔student or student↔guardian).
 * 2. EXACT — only guardian contacts are shared AND the names are similar
 *    (same family, same child).
 * 3. POSSIBLE — only guardian contacts are shared (a sibling or the same child
 *    under another name: a human decides).
 * 4. POSSIBLE — similar name AND same previous school (no shared contact).
 * 5. Otherwise no match. A similar name alone is never reported (weak signal).
 */
export function compareContacts(
  candidate: ContactRecord,
  existing: ContactRecord,
  threshold = NAME_SIMILARITY_THRESHOLD,
): DuplicateMatch | null {
  if (candidate.id && candidate.id === existing.id) return null;
  const signals = new Set<DuplicateSignal>();
  let studentSideShared = false;
  let guardianOnlyShared = false;
  const theirs = contactsOf(existing);
  for (const mine of contactsOf(candidate)) {
    for (const other of theirs) {
      if (mine.type !== other.type || mine.value !== other.value) continue;
      if (mine.role === 'student' && other.role === 'student') {
        studentSideShared = true;
        signals.add(mine.type === 'phone' ? 'student_phone' : 'student_email');
      } else if (mine.role === 'guardian' && other.role === 'guardian') {
        guardianOnlyShared = true;
        signals.add(mine.type === 'phone' ? 'guardian_phone' : 'guardian_email');
      } else {
        studentSideShared = true;
        signals.add('student_contact_is_guardian_contact');
      }
    }
  }
  const similarity = nameSimilarity(candidate.studentName, existing.studentName);
  const similar = similarity >= threshold;
  if (similar) signals.add('similar_name');
  const schoolA = normaliseSchool(candidate.previousSchool);
  const sameSchool = schoolA !== '' && schoolA === normaliseSchool(existing.previousSchool);
  if (sameSchool) signals.add('same_school');

  let level: DuplicateLevel | null = null;
  if (studentSideShared) level = 'exact';
  else if (guardianOnlyShared) level = similar ? 'exact' : 'possible';
  else if (similar && sameSchool) level = 'possible';
  if (!level) return null;
  return {
    leadId: existing.id,
    code: existing.code,
    level,
    signals: [...signals].sort(),
    nameSimilarity: Math.round(similarity * 1000) / 1000,
  };
}

/**
 * All matches for a candidate, ordered deterministically: exact before
 * possible, then more signals first, then by lead code.
 */
export function findDuplicateMatches(
  candidate: ContactRecord,
  existing: readonly ContactRecord[],
  threshold = NAME_SIMILARITY_THRESHOLD,
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const record of existing) {
    const match = compareContacts(candidate, record, threshold);
    if (match) matches.push(match);
  }
  return matches.sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'exact' ? -1 : 1) ||
      b.signals.length - a.signals.length ||
      a.code.localeCompare(b.code),
  );
}
