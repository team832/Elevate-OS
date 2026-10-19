/**
 * Directed-graph helpers for dependencies (tasks, milestones) and reporting
 * lines. Pure and deterministic. Algorithm documentation: docs/ALGORITHMS.md → A-07.
 *
 * An edge `{ from, to }` means "from depends on to" (from is blocked by to).
 */

export interface Edge {
  from: string;
  to: string;
}

function adjacency(edges: readonly Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  for (const list of adj.values()) list.sort();
  return adj;
}

/** A path from `start` to `goal` following edges (BFS, shortest, deterministic), or null. */
export function findPath(edges: readonly Edge[], start: string, goal: string): string[] | null {
  const adj = adjacency(edges);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    if (node === goal) {
      const path: string[] = [];
      for (let n: string | null = node; n !== null; n = previous.get(n) ?? null) path.unshift(n);
      return path;
    }
    for (const next of adj.get(node) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * Would adding `from → to` create a cycle? True when `to` can already reach
 * `from` (or `from === to`). Returns the cycle path when it would.
 */
export function wouldCreateCycle(
  edges: readonly Edge[],
  from: string,
  to: string,
): { cycle: false } | { cycle: true; path: string[] } {
  if (from === to) return { cycle: true, path: [from, to] };
  const back = findPath(edges, to, from);
  return back ? { cycle: true, path: [from, ...back] } : { cycle: false };
}

/** Any cycle in the graph (iterative DFS, nodes visited in sorted order), or null. */
export function findCycle(edges: readonly Edge[]): string[] | null {
  const adj = adjacency(edges);
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort();
  const state = new Map<string, 'visiting' | 'done'>();
  for (const root of nodes) {
    if (state.has(root)) continue;
    const stack: { node: string; i: number }[] = [{ node: root, i: 0 }];
    const path: string[] = [root];
    state.set(root, 'visiting');
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { node: string; i: number };
      const next = (adj.get(top.node) ?? [])[top.i];
      if (next === undefined) {
        state.set(top.node, 'done');
        stack.pop();
        path.pop();
        continue;
      }
      top.i += 1;
      const s = state.get(next);
      if (s === 'visiting') return [...path.slice(path.indexOf(next)), next];
      if (s === undefined) {
        state.set(next, 'visiting');
        stack.push({ node: next, i: 0 });
        path.push(next);
      }
    }
  }
  return null;
}

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
