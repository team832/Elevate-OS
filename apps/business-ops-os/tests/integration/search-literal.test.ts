/**
 * A search for a name holding %, _ or \ finds that name and nothing else: those are letters to the
 * person typing them (RV-B: an underscore in a name found nothing). Fictional data only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { opsLeads } from '@elevate/database';
import { setupTestDatabase } from '@elevate/testing';
import { listLeads } from '../../src/server/leads-read';
import { listStudents } from '../../src/server/students';
import { studentSearchQuery } from '../../src/server/students-schemas';
import { setupReference, staffUser, type StaffUser } from './fixtures';
import { caseOf, identity } from './lifecycle-fixtures';

const ctx = setupTestDatabase();
let manager: StaffUser;
const NAMES = ['Sample Un_der', 'Sample UnXder', 'Sample 100% Sure', 'Sample 1000 Sure', 'Sample Back\\slash', 'Sample Backslash'];

beforeAll(async () => {
  await setupReference(ctx.db);
  manager = await staffUser(ctx.db, ['operations_manager']);
  for (const name of NAMES) {
    const a = await caseOf(ctx.db, manager.id, await identity(ctx.db, name), 'enrolled');
    await ctx.db.update(opsLeads).set({ studentName: name }).where(eq(opsLeads.id, a.leadId));
  }
});

describe.each([
  ['leads', async (q: string) => (await listLeads(ctx.db, manager, { q })).map((r) => r.studentName)],
  ['students', async (q: string) => (await listStudents(ctx.db, manager, studentSearchQuery.parse({ q }))).items.map((r) => r.studentName)],
] as const)('%s', (_, search) => {
  it.each([
    ['Un_der', ['Sample Un_der']],
    ['100%', ['Sample 100% Sure']],
    ['Back\\slash', ['Sample Back\\slash']],
  ])('%s finds only %j', async (q, found) => {
    expect(await search(q)).toEqual(found);
  });
});

describe('one way to build a search pattern', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === 'node_modules' || e.name === '.next' || e.name === 'tests'
        ? []
        : e.isDirectory()
          ? sources(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
    );
  it('no search strips or forgets the wildcards', () => {
    const own = sources(join(__dirname, '../../..'))
      .filter((f) => !f.endsWith('search-literal.test.ts'))
      .filter((f) => /ilike\([^)]*`%\$\{|`%\$\{[^`]*replace\(\/\[/.test(readFileSync(f, 'utf8')));
    expect(own).toEqual([]);
  });
});
