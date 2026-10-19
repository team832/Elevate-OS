import { created, defineRoute, respond } from '@elevate/server-kit';
import { createTask, searchTasks } from '../../../../server/tasks';
import { createTaskBody } from '../../../../server/schemas';
import { taskSearchQuery } from '../../../../server/work-schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/tasks — Tasks (views: mine, overdue, escalated, blocked,
 * awaiting_review, open, all; filters departmentId, staffId + role, q). With
 * `page`/`pageSize` the list is paginated; `meta` carries total/pageNumber/pageSize/pages.
 */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', query: taskSearchQuery },
  async ({ user, db, query }) => {
    const r = await searchTasks(db, user, query);
    return respond(r.items, {
      meta: { total: r.total, pageNumber: r.page, pageSize: r.pageSize, pages: r.pages },
    });
  },
);

/** POST /ops/api/v1/tasks — Create a task. */
export const POST = defineRoute(
  { permission: 'ops:tasks:write', body: createTaskBody },
  async ({ user, db, body, requestId }) => created(await createTask(db, user, body, requestId)),
);
