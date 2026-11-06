/** Spreadsheet downloads mounted in Marketing OS (work.ts `exports/[list]`): leads, tasks, My attendance. */
import { beforeAll, describe, expect, it } from 'vitest';
import { opsLeadSources, staffMembers } from '@elevate/database';
import {
  authedRequest,
  buildRequest,
  createTestUser,
  setupTestDatabase,
  type TestUser,
} from '@elevate/testing';
import { GET as exportRoute } from '../../src/app/api/v1/exports/[list]/route';
import { POST as createLead } from '../../src/app/api/v1/leads/route';
import { call } from '../helpers';

const ctx = setupTestDatabase();
let manager: TestUser;
let contributor: TestUser;
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
  .format(new Date())
  .slice(0, 7);

async function staff(role: 'marketing_manager' | 'marketing_contributor', fullName: string) {
  const user = await createTestUser(ctx.db, { roles: [role], displayName: fullName });
  await ctx.db.insert(staffMembers).values({ userId: user.id, fullName });
  return user;
}
const download = async (u: TestUser | null, list: string, query = '') => {
  const url = `/marketing/api/v1/exports/${list}${query}`;
  const res = await exportRoute(u ? authedRequest(u, url) : buildRequest(url), {
    params: Promise.resolve({ list }),
  });
  return { status: res.status, lines: (await res.text()).replace(/^\uFEFF/, '').split('\r\n') };
};
const firstCells = (lines: string[], prefix: string) =>
  lines.filter((l) => l.startsWith(prefix)).map((l) => l.split(',')[0]);

beforeAll(async () => {
  await ctx.db.insert(opsLeadSources).values({ code: 'UNKNOWN', label: 'Unknown' });
  manager = await staff('marketing_manager', 'Sample Marketing Manager');
  contributor = await staff('marketing_contributor', 'Sample Marketing Contributor');
  for (const [user, studentName] of [
    [manager, 'Sample Lead Manager'],
    [contributor, 'Sample Lead Contributor'],
  ] as const) {
    const json = { studentName, studentEmail: `${studentName.replaceAll(' ', '.')}@example.test` };
    expect((await call(createLead, user, '/marketing/api/v1/leads', { json })).status).toBe(201);
  }
});

describe('downloads from Marketing OS', () => {
  it('leads: the manager gets every lead, a contributor only their own; signed out 401', async () => {
    expect((await download(null, 'leads')).status).toBe(401);
    const all = await download(manager, 'leads');
    expect(all.status).toBe(200);
    expect(all.lines[0]!.startsWith('Lead,Student,Interest')).toBe(true);
    const names = (lines: string[]) =>
      lines.map((l) => l.split(',')[1]).filter((n) => n?.startsWith('Sample Lead'));
    expect(names(all.lines).sort()).toEqual(['Sample Lead Contributor', 'Sample Lead Manager']);
    expect(names((await download(contributor, 'leads')).lines)).toEqual([
      'Sample Lead Contributor',
    ]);
  });

  it('the task tracker downloads with its header row', async () => {
    const res = await download(contributor, 'tasks', '?open=1');
    expect(res.status).toBe(200);
    expect(res.lines[0]!.startsWith('Task,Owner,Priority')).toBe(true);
  });

  it("My attendance: mine=1 gives the reader's own month only", async () => {
    for (const [user, name] of [
      [contributor, 'Sample Marketing Contributor'],
      [manager, 'Sample Marketing Manager'],
    ] as const) {
      const res = await download(user, 'attendance', `?month=${month}&mine=1`);
      expect(res.status).toBe(200);
      expect(firstCells(res.lines, 'Sample ')).toEqual([name]);
    }
  });
});
