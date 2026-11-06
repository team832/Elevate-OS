/** Which journal migrations `npm run db:migrate` would still apply. Shared by db:check and dev.mjs. */
import { readFileSync } from 'node:fs';
import type { Client } from 'pg';

const JOURNAL = new URL('../../packages/database/migrations/meta/_journal.json', import.meta.url);

/** Drizzle applies every journal entry newer than the newest one recorded (`created_at` = `when`). */
export const pendingTags = (
  entries: { tag: string; when: number }[],
  applied: number[],
): string[] => {
  const last = Math.max(0, ...applied);
  return entries.filter((entry) => entry.when > last).map((entry) => entry.tag);
};

export async function pendingMigrations(client: Pick<Client, 'query'>): Promise<string[]> {
  const { rows } = await client.query(`select to_regclass('drizzle.__drizzle_migrations') t`);
  const applied = rows[0].t
    ? (await client.query('select created_at from drizzle.__drizzle_migrations')).rows.map((r) =>
        Number(r.created_at),
      )
    : [];
  return pendingTags(JSON.parse(readFileSync(JOURNAL, 'utf8')).entries, applied);
}
