import { z } from 'zod';
import { created, defineRoute } from '@elevate/server-kit';
import { createCalendarTask, planIdea, planIdeaBody } from '../../../../../../server/calendar-plan';

export const dynamic = 'force-dynamic';
const params = z.object({ id: z.uuid() });

/**
 * POST /marketing/api/v1/ideas/:id/plan — an approved idea becomes one linked calendar item
 * (201; 200 with the same item when it already exists); `createTask` also creates its Ops task.
 */
export const POST = defineRoute(
  { permission: 'marketing:calendar:write', params, body: planIdeaBody },
  async ({ db, params: p, body, user, requestId }) => {
    const { createTask, ...input } = body;
    const plan = await planIdea(db, user, p.id, input, requestId);
    const task = createTask ? await createCalendarTask(db, user, plan.item.id, requestId) : null;
    const result = { ...plan, taskId: task?.taskId ?? plan.item.relatedTaskId };
    return plan.created ? created(result) : result;
  },
);
