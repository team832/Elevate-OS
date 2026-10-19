/**
 * Concurrency-safe idea-code allocation (D-009, MKT-003; docs/ALGORITHMS.md §1).
 *
 * 1. floor = highest number already used or reserved for the prefix: live codes, legacy
 *    codes held in quarantine and proposed renumberings (OD-003) — none may be reissued.
 * 2. `INSERT … ON CONFLICT (scope) DO UPDATE SET last_number = GREATEST(last_number, floor) + 1
 *    RETURNING last_number` — the counter row lock serialises concurrent creators; the
 *    counter only grows, so a number is never handed out twice, even after archiving.
 * 3. The idea insert is guarded by the unique index `ideas_code_key`; on a collision the
 *    caller retries inside a savepoint (server/ideas.ts).
 */
import { eq, like, or, sql } from 'drizzle-orm';
import { marketingCodeCounters, marketingIdeas, type Database } from '@elevate/database';
import { formatIdeaCode, highestReservedNumber, type CoursePrefix } from '../domain';

export async function reservedFloor(db: Database, prefix: CoursePrefix): Promise<number> {
  const rows = await db
    .select({
      code: marketingIdeas.code,
      legacyCode: marketingIdeas.legacyCode,
      proposedCode: marketingIdeas.proposedCode,
    })
    .from(marketingIdeas)
    .where(
      or(
        eq(marketingIdeas.coursePrefix, prefix),
        like(marketingIdeas.legacyCode, `${prefix}-%`),
        like(marketingIdeas.proposedCode, `${prefix}-%`),
      ),
    );
  return highestReservedNumber(
    prefix,
    rows.flatMap((r) => [r.code, r.legacyCode, r.proposedCode]),
  );
}

export type CodeAllocator = (db: Database, prefix: CoursePrefix) => Promise<string>;

/** Allocate the next idea code for a prefix (call inside the creating transaction). */
export const allocateIdeaCode: CodeAllocator = async (db, prefix) => {
  const floor = await reservedFloor(db, prefix);
  const [row] = await db
    .insert(marketingCodeCounters)
    .values({ scope: prefix, lastNumber: floor + 1 })
    .onConflictDoUpdate({
      target: marketingCodeCounters.scope,
      set: { lastNumber: sql`GREATEST(${marketingCodeCounters.lastNumber}, ${floor}) + 1` },
    })
    .returning({ lastNumber: marketingCodeCounters.lastNumber });
  if (!row) throw new Error('code counter returned no row');
  return formatIdeaCode(prefix, row.lastNumber);
};

/** Make sure a counter is at least `floor` (used after legacy import reserves numbers). */
export async function bumpCounter(db: Database, prefix: CoursePrefix): Promise<number> {
  const floor = await reservedFloor(db, prefix);
  const [row] = await db
    .insert(marketingCodeCounters)
    .values({ scope: prefix, lastNumber: floor })
    .onConflictDoUpdate({
      target: marketingCodeCounters.scope,
      set: { lastNumber: sql`GREATEST(${marketingCodeCounters.lastNumber}, ${floor})` },
    })
    .returning({ lastNumber: marketingCodeCounters.lastNumber });
  return row?.lastNumber ?? floor;
}
