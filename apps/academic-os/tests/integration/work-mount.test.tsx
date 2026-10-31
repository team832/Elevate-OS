/** Phase 2 (D-073): the shared Ops task/EOD service mounted under /academic for teachers. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { allTaskFilters, listTasks, myReports, taskDaySummary } from '@elevate/business-ops-os/work';
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
      <TasksDay
        summary={await taskDaySummary(ctx.db, u.teacher)}
        week={await myReports(ctx.db, u.teacher, 'week')}
        month={await myReports(ctx.db, u.teacher, 'month')}
      />,
    );
    // RVB-010: each tile opens exactly what it counts, even when the reader can see other tasks.
    const summary = (await taskDaySummary(ctx.db, u.teacher))!;
    for (const [label, count] of [
      ['Tasks due today', summary.dueToday],
      ['Overdue tasks', summary.overdue],
      ['Work awaiting HR review', summary.submitted],
    ] as const) {
      const href = new RegExp(`href="([^"]+)"[^>]*><span class="el-stat-label">${label}`).exec(block)![1]!;
      const params = new URLSearchParams(href.replaceAll('&amp;', '&').split('?')[1]);
      expect(params.get('tab')).toBe('all');
      // Through the page's own reader: a filter the page ignores would pass a schema parse (RL1-001).
      const list = await listTasks(ctx.db, u.teacher, allTaskFilters(Object.fromEntries(params)));
      expect([label, list.total]).toEqual([label, count]);
    }
    expect(block).toContain('<span class="el-stat-value">1</span>'); // due today
    expect(block).toContain('1 open in all');
    expect(block).toContain('Not started');
    expect(block).toContain('href="/academic/tasks?tab=eod"');
    expect(block).toContain('href="/academic/my-reports?kind=week"');
    expect(block).not.toContain('Open My reports');
    expect(
      renderToStaticMarkup(
        <TasksDay
          summary={await taskDaySummary(ctx.db, u.coordinator)}
          week={await myReports(ctx.db, u.coordinator, 'week')}
          month={null}
        />,
      ),
    ).toContain('No staff record');
  });
});
