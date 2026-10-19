import type { ModuleKey } from '@elevate/shared-types';
import type { Database } from '../client';

/**
 * Seed registry. Each module exports `seeds: SeedDefinition[]` from
 * `apps/<module>/seed/index.ts`; the root `npm run db:seed` script collects
 * core + module seeds and runs them in dependency order, each in its own
 * transaction.
 *
 * Seeds MUST be idempotent (upsert on natural keys such as `code`/`email`) and
 * MUST use fictional people only (D-016). Planned counts are never seeded as
 * delivered work.
 */
export interface SeedContext {
  /** A transaction scoped to this seed. */
  db: Database;
  /** From SEED_USER_PASSWORD. */
  seedUserPassword: string;
  /** Password hasher from @elevate/authentication (injected to avoid a package cycle). */
  hashPassword(password: string): Promise<string>;
  log(message: string): void;
}

export interface SeedDefinition {
  /** Unique, e.g. `core.users`, `academic.courses`. */
  name: string;
  module: ModuleKey;
  description: string;
  /** Names of seeds that must run first. */
  dependsOn?: readonly string[];
  run(ctx: SeedContext): Promise<void>;
}

export function defineSeed(seed: SeedDefinition): SeedDefinition {
  return seed;
}

/** Order seeds so that every seed runs after its dependencies. Throws on unknown names or cycles. */
export function orderSeeds(seeds: readonly SeedDefinition[]): SeedDefinition[] {
  const byName = new Map<string, SeedDefinition>();
  for (const s of seeds) {
    if (byName.has(s.name)) throw new Error(`Duplicate seed name "${s.name}"`);
    byName.set(s.name, s);
  }
  const ordered: SeedDefinition[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (s: SeedDefinition, trail: string[]) => {
    const st = state.get(s.name);
    if (st === 'done') return;
    if (st === 'visiting')
      throw new Error(`Seed dependency cycle: ${[...trail, s.name].join(' -> ')}`);
    state.set(s.name, 'visiting');
    for (const dep of s.dependsOn ?? []) {
      const d = byName.get(dep);
      if (!d) throw new Error(`Seed "${s.name}" depends on unknown seed "${dep}"`);
      visit(d, [...trail, s.name]);
    }
    state.set(s.name, 'done');
    ordered.push(s);
  };
  for (const s of seeds) visit(s, []);
  return ordered;
}

export interface SeedRunResult {
  name: string;
  module: ModuleKey;
  ms: number;
}

export async function runSeeds(
  db: Database,
  seeds: readonly SeedDefinition[],
  context: Omit<SeedContext, 'db'>,
): Promise<SeedRunResult[]> {
  const results: SeedRunResult[] = [];
  for (const seed of orderSeeds(seeds)) {
    const started = Date.now();
    context.log(`seed ${seed.name} — ${seed.description}`);
    await db.transaction(async (tx) => {
      await seed.run({ ...context, db: tx as unknown as Database });
    });
    results.push({ name: seed.name, module: seed.module, ms: Date.now() - started });
  }
  return results;
}
