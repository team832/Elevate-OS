/**
 * Business codes (BR-MKT-2, D-009): idea `<PREFIX>-<NNN>` and placement
 * `<IDEA>-<ACCOUNT>[S|L]`. Codes are never reused or renumbered; the allocation itself
 * happens in the database (server/codes.ts) — these are the pure rules around it.
 */
import {
  COURSE_PREFIXES,
  type CoursePrefix,
  type Platform,
  type PlacementVariant,
} from './vocabulary';

const IDEA_CODE_RE = /^(CLAT|IPMAT|CUET|COM|GEN)-(\d{3,})$/;
const ACCOUNT_CODE_RE = /^[A-Z]{2,5}$/;

export interface ParsedIdeaCode {
  prefix: CoursePrefix;
  number: number;
}

/** Parse `CLAT-028` → { prefix: 'CLAT', number: 28 }; null when malformed. */
export function parseIdeaCode(code: string | null | undefined): ParsedIdeaCode | null {
  if (!code) return null;
  const m = IDEA_CODE_RE.exec(code.trim());
  if (!m) return null;
  return { prefix: m[1] as CoursePrefix, number: Number(m[2]) };
}

/** Format an idea code with at least three digits: (CLAT, 7) → CLAT-007; (GEN, 1234) → GEN-1234. */
export function formatIdeaCode(prefix: CoursePrefix, number: number): string {
  if (!(COURSE_PREFIXES as readonly string[]).includes(prefix)) {
    throw new RangeError(`Unknown course prefix ${prefix}`);
  }
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('Idea numbers start at 1');
  }
  return `${prefix}-${String(number).padStart(3, '0')}`;
}

/**
 * The floor for the next number of a prefix: the highest number already used or reserved
 * (live codes, legacy codes held in quarantine, and proposed renumberings that OD-003 may
 * still assign). The next code is `floor + 1`; nothing below or at the floor is handed out.
 */
export function highestReservedNumber(
  prefix: CoursePrefix,
  codes: readonly (string | null | undefined)[],
): number {
  let max = 0;
  for (const code of codes) {
    const parsed = parseIdeaCode(code);
    if (parsed && parsed.prefix === prefix && parsed.number > max) max = parsed.number;
  }
  return max;
}

/** Placement code `<IDEA>-<ACCOUNT>` plus `S`/`L` for a YouTube Short/long variant. */
export function buildPlacementCode(input: {
  ideaCode: string;
  accountCode: string;
  platform: Platform;
  variant?: PlacementVariant | null;
}): string {
  if (!parseIdeaCode(input.ideaCode)) throw new RangeError(`Not an idea code: ${input.ideaCode}`);
  if (!ACCOUNT_CODE_RE.test(input.accountCode)) {
    throw new RangeError(`Not an account code: ${input.accountCode}`);
  }
  if (input.variant && input.platform !== 'youtube') {
    throw new RangeError('Only YouTube placements carry a Short/long variant (S or L)');
  }
  const suffix = input.variant === 'short' ? 'S' : input.variant === 'long' ? 'L' : '';
  return `${input.ideaCode}-${input.accountCode}${suffix}`;
}

/**
 * Split a legacy version id such as `CLAT-005-YTCL` into its idea code, account code and
 * variant, given the registered account codes. Returns null when it does not resolve.
 */
export function parsePlacementCode(
  code: string,
  accountCodes: readonly string[],
): { ideaCode: string; accountCode: string; variant: PlacementVariant | null } | null {
  const m = /^((?:CLAT|IPMAT|CUET|COM|GEN)-\d{3,})-([A-Z]{2,6})$/.exec(code.trim());
  if (!m) return null;
  const ideaCode = m[1]!;
  const tail = m[2]!;
  if (accountCodes.includes(tail)) return { ideaCode, accountCode: tail, variant: null };
  const last = tail.slice(-1);
  const base = tail.slice(0, -1);
  if ((last === 'S' || last === 'L') && accountCodes.includes(base) && base.startsWith('YT')) {
    return { ideaCode, accountCode: base, variant: last === 'S' ? 'short' : 'long' };
  }
  return null;
}

/** Campaign codes: upper-case letters, digits and dashes, 2–40 chars. */
export function isCampaignCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,39}$/.test(code);
}
