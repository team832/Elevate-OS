/**
 * Duplicate-idea detection (MKT-003; docs/ALGORITHMS.md §2).
 *
 * Deterministic: the same inputs always give the same candidates in the same order.
 * 1. Normalise titles (Unicode NFKD, strip accents, lower-case, `&` → `and`, every
 *    non-alphanumeric character → space, collapse spaces).
 * 2. Tokenise: split on spaces, drop a fixed stop-word list (English + common Hinglish
 *    fillers), strip a trailing plural `s` from words longer than 3 letters.
 * 3. Score each existing idea with the Jaccard index of the two token sets.
 * 4. Classify: identical normalised title in the same course → `exact_same_course`
 *    (BLOCK); identical title in another course → `exact_other_course` (warn);
 *    score ≥ sameCourseThreshold in the same course → `similar_same_course` (warn);
 *    score ≥ crossCourseThreshold in another course → `similar_other_course` (warn).
 * 5. Sort by kind priority, score (desc), code (asc); cap at `limit`.
 */
import type { CoursePrefix } from './vocabulary';

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'is',
  'are',
  'be',
  'it',
  'its',
  'vs',
  'your',
  'you',
  'our',
  'we',
  'what',
  'how',
  'why',
  'ka',
  'ki',
  'ke',
  'ko',
  'se',
  'me',
  'mein',
  'hai',
  'aur',
  'kya',
]);

export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(title: string): string[] {
  const out = new Set<string>();
  for (const raw of normalizeTitle(title).split(' ')) {
    if (!raw || STOP_WORDS.has(raw)) continue;
    const word =
      raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    out.add(word);
  }
  return [...out].sort();
}

/** Jaccard index of two token lists (0 when both are empty). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

export type DuplicateKind =
  'exact_same_course' | 'exact_other_course' | 'similar_same_course' | 'similar_other_course';

const KIND_PRIORITY: Record<DuplicateKind, number> = {
  exact_same_course: 0,
  exact_other_course: 1,
  similar_same_course: 2,
  similar_other_course: 3,
};

export interface ExistingIdea {
  id: string;
  /** Live code, or the legacy code for a quarantined row. */
  code: string | null;
  title: string;
  coursePrefix: CoursePrefix;
  status: string;
}

export interface DuplicateCandidate {
  id: string;
  code: string | null;
  title: string;
  coursePrefix: CoursePrefix;
  status: string;
  kind: DuplicateKind;
  /** Jaccard score rounded to 2 decimals (1 for exact matches). */
  score: number;
  sharedTokens: string[];
  reason: string;
}

export interface DuplicateCheckOptions {
  sameCourseThreshold?: number;
  crossCourseThreshold?: number;
  limit?: number;
  /** Ignore this idea id (when re-checking an existing idea). */
  excludeId?: string;
}

export interface DuplicateCheckResult {
  /** block only for an exact normalised match in the same course; otherwise warn or clear. */
  decision: 'block' | 'warn' | 'clear';
  normalizedTitle: string;
  candidates: DuplicateCandidate[];
}

export const DEFAULT_DUPLICATE_OPTIONS = {
  sameCourseThreshold: 0.5,
  crossCourseThreshold: 0.75,
  limit: 5,
} as const;

export function detectDuplicateIdeas(
  candidate: { title: string; coursePrefix: CoursePrefix },
  existing: readonly ExistingIdea[],
  options: DuplicateCheckOptions = {},
): DuplicateCheckResult {
  const sameT = options.sameCourseThreshold ?? DEFAULT_DUPLICATE_OPTIONS.sameCourseThreshold;
  const crossT = options.crossCourseThreshold ?? DEFAULT_DUPLICATE_OPTIONS.crossCourseThreshold;
  const limit = options.limit ?? DEFAULT_DUPLICATE_OPTIONS.limit;
  if (sameT <= 0 || sameT > 1 || crossT <= 0 || crossT > 1) {
    throw new RangeError('Duplicate thresholds must be in (0, 1]');
  }
  const normalized = normalizeTitle(candidate.title);
  const tokens = titleTokens(candidate.title);
  const found: DuplicateCandidate[] = [];
  if (normalized === '') return { decision: 'clear', normalizedTitle: normalized, candidates: [] };

  for (const idea of existing) {
    if (options.excludeId && idea.id === options.excludeId) continue;
    const sameCourse = idea.coursePrefix === candidate.coursePrefix;
    const otherNorm = normalizeTitle(idea.title);
    const otherTokens = titleTokens(idea.title);
    const shared = tokens.filter((t) => otherTokens.includes(t));
    const label = idea.code ?? 'uncoded';
    let kind: DuplicateKind | null = null;
    let score = Math.round(jaccard(tokens, otherTokens) * 100) / 100;
    if (otherNorm === normalized) {
      kind = sameCourse ? 'exact_same_course' : 'exact_other_course';
      score = 1;
    } else if (sameCourse && score >= sameT) {
      kind = 'similar_same_course';
    } else if (!sameCourse && score >= crossT) {
      kind = 'similar_other_course';
    }
    if (!kind) continue;
    const reason =
      kind === 'exact_same_course'
        ? `Same normalised title as ${label} in ${idea.coursePrefix}.`
        : kind === 'exact_other_course'
          ? `Same normalised title as ${label}, but in ${idea.coursePrefix} (different course).`
          : `${shared.length} of ${new Set([...tokens, ...otherTokens]).size} title words shared with ${label} (score ${score.toFixed(2)}${sameCourse ? `, same course ${idea.coursePrefix}` : `, other course ${idea.coursePrefix}`}).`;
    found.push({
      id: idea.id,
      code: idea.code,
      title: idea.title,
      coursePrefix: idea.coursePrefix,
      status: idea.status,
      kind,
      score,
      sharedTokens: shared,
      reason,
    });
  }

  found.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      b.score - a.score ||
      (a.code ?? '￿').localeCompare(b.code ?? '￿') ||
      a.id.localeCompare(b.id),
  );
  const candidates = found.slice(0, Math.max(0, limit));
  const decision = found.some((c) => c.kind === 'exact_same_course')
    ? 'block'
    : candidates.length > 0
      ? 'warn'
      : 'clear';
  return { decision, normalizedTitle: normalized, candidates };
}
