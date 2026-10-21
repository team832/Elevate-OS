/**
 * Programme combinations a student can be admitted to (owner, 20 and 21 Oct 2026,
 * D-034, D-037). A combination is a cohort (Class 11 Commerce, Class 12 Commerce,
 * Dropper), an entrance programme, or one of each — never two entrance programmes.
 * Class 11/12 alone are allowed; a dropper always prepares for an exam. Codes are
 * core.programmes codes.
 */
export const COHORT_PROGRAMMES = ['CLASS_11', 'CLASS_12', 'DROPPER'] as const;

export const ALLOWED_PROGRAMME_COMBINATIONS: readonly (readonly string[])[] = [
  ['DROPPER', 'CLAT'],
  ['DROPPER', 'IPMAT'],
  ['DROPPER', 'CUET'],
  ['DROPPER', 'CA_FOUNDATION'],
  ['CLASS_11', 'CLAT'],
  ['CLASS_12', 'CLAT'],
  ['CLAT'],
  ['CLASS_11', 'IPMAT'],
  ['CLASS_12', 'IPMAT'],
  ['CLASS_12', 'CA_FOUNDATION'],
  ['CLASS_11', 'CUET'],
  ['CLASS_12', 'CUET'],
  ['CLASS_11'],
  ['CLASS_12'],
];

export const STUDY_MODES = ['online', 'offline_sikar'] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

const key = (codes: readonly string[]) => [...codes].sort().join('+');
const ALLOWED = new Set(ALLOWED_PROGRAMME_COMBINATIONS.map(key));

export function isAllowedCombination(codes: readonly string[]): boolean {
  return new Set(codes).size === codes.length && ALLOWED.has(key(codes));
}

export function combinationLabel(codes: readonly string[], names: Record<string, string>): string {
  const cohortFirst = [...codes].sort(
    (a, b) =>
      Number(!(COHORT_PROGRAMMES as readonly string[]).includes(a)) -
      Number(!(COHORT_PROGRAMMES as readonly string[]).includes(b)),
  );
  return cohortFirst.map((c) => names[c] ?? c).join(' + ');
}
