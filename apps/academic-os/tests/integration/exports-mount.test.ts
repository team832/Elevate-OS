/** Spreadsheet downloads mounted in Academic OS (work.ts `exports/[list]`): My attendance and the task tracker for teachers. */
import { describe, expect, it } from 'vitest';
import { authedRequest, buildRequest, setupTestDatabase, type TestUser } from '@elevate/testing';
import { GET as exportRoute } from '../../src/app/api/v1/exports/[list]/route';
import { staffFor, users } from './fixtures';

const ctx = setupTestDatabase();
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);

const download = async (u: TestUser | null, list: string, query = '') => {
  const url = `/academic/api/v1/exports/${list}${query}`;
  const res = await exportRoute(u ? authedRequest(u, url) : buildRequest(url), { params: Promise.resolve({ list }) });
  return { status: res.status, lines: (await res.text()).replace(/^\uFEFF/, '').split('\r\n') };
};

describe('downloads from Academic OS', () => {
  it("My attendance: a teacher gets their own month only; the tracker downloads; students are refused (403); signed out 401", async () => {
    const u = await users(ctx.db);
    await staffFor(ctx.db, u.teacher, 'Sample Teacher Ana');
    await staffFor(ctx.db, u.teacher2, 'Sample Teacher Ben');
    const mine = await download(u.teacher, 'attendance', `?month=${month}&mine=1`);
    expect(mine.status).toBe(200);
    expect(mine.lines[0]!.startsWith('Staff member,Staff code,Department')).toBe(true);
    expect(mine.lines.filter((l) => l.startsWith('Sample Teacher')).map((l) => l.split(',')[0])).toEqual(['Sample Teacher Ana']);
    const tasks = await download(u.teacher, 'tasks', '?open=1');
    expect(tasks.status).toBe(200);
    expect(tasks.lines[0]!.startsWith('Task,Owner,Priority')).toBe(true);
    expect((await download(u.teacher, 'students')).status).toBe(403);
    expect((await download(null, 'attendance')).status).toBe(401);
  });
});
