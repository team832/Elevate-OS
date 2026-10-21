/**
 * Reporting-line helper. Pure and deterministic. Algorithm documentation:
 * docs/ALGORITHMS.md → A-07.
 */

/**
 * Walk a parent chain (e.g. staff → manager) from `start`, stopping at the top
 * or when a node repeats (a corrupt chain must not loop forever). The result
 * starts with `start`.
 */
export function ancestorChain(
  start: string,
  parentOf: (node: string) => string | null | undefined,
  maxDepth = 50,
): { chain: string[]; loop: boolean } {
  const chain = [start];
  const seen = new Set(chain);
  let current = start;
  for (let i = 0; i < maxDepth; i += 1) {
    const parent = parentOf(current);
    if (!parent) return { chain, loop: false };
    if (seen.has(parent)) return { chain, loop: true };
    chain.push(parent);
    seen.add(parent);
    current = parent;
  }
  return { chain, loop: true };
}
