/** Phase 2 (D-073): the shared Ops task/EOD service mounted under /academic for teachers. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { taskDaySummary } from '@elevate/business-ops-os/work';
import { authedRequest, callRoute, createTestUser, setupTestDatabase } from '@elevate/testing';
import { GET as listRoute, POST as createRoute } from '../../src/app/api/v1/staff-tasks/route';
import { TasksDay } from '../../src/ui/my-day';
import { staffFor, users } from './fixtures';

const ctx = setupTestDatabase();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe('tasks and EOD inside Academic OS', () => {
  it('a teacher logs and lists their own tasks through /academic routes; another teacher does not see them; My day shows the counts', async () => {
    const u = await users(ctx.db);
    const staffId = await staffFor(ctx.db, u.teacher, 'Sample Teacher');
    await staffFor(ctx.db, u.teacher2, 'Sample Teacher Two');
    const created = await callRoute<{ id: string }>(
      createRoute,
      authedRequest(u.teacher, '/academic/api/v1/staff-tasks', {
        method: 'POST',
        json: { title: 'Sample worksheet check', staffId, dueOn: today },
      }),
    );
    expect(created.status).toBe(201);

    const mine = await callRoute<{ rows: { id: string }[] }>(
      listRoute,
      authedRequest(u.teacher, '/academic/api/v1/staff-tasks'),
    );
    expect(mine.status).toBe(200);
    expect(mine.data!.rows.map((r) => r.id)).toEqual([created.data!.id]);
    const other = await callRoute<{ rows: unknown[] }>(
      listRoute,
      authedRequest(u.teacher2, '/academic/api/v1/staff-tasks'),
    );
    expect(other.data!.rows).toEqual([]);
    expect(
      (
        await callRoute(
          listRoute,
          authedRequest(
            await createTestUser(ctx.db, { roles: ['platform_admin'] }),
            '/academic/api/v1/staff-tasks',
          ),
        )
      ).status,
    ).toBe(403);

    const block = renderToStaticMarkup(
      <TasksDay summary={await taskDaySummary(ctx.db, u.teacher)} />,
    );
    expect(block).toContain('href="/academic/tasks?due=today"');
    expect(block).toContain('<span class="el-stat-value">1</span>'); // due today
    expect(block).toContain('1 open in all');
    expect(block).toContain('Not started');
    expect(block).toContain('href="/academic/tasks?tab=eod"');
    expect(
      renderToStaticMarkup(<TasksDay summary={await taskDaySummary(ctx.db, u.coordinator)} />),
    ).toContain('No staff record');
  });
});
