import { csvResponse, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { homeworkQuery } from '../../../../../server/schemas-homework';
import { homeworkCompletion, homeworkCompletionCsv } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/homework/completion?batchId&from&to[&format=csv] — Completion by batch and by teacher (default: due in the last 30 days). */
export const GET = defineRoute({ permission: 'academic:classes:read', query: homeworkQuery }, async (ctx) => {
  if (ctx.query.format !== 'csv') return homeworkCompletion(ctx.db, actorOf(ctx), ctx.query);
  const out = await homeworkCompletionCsv(ctx.db, actorOf(ctx), ctx.query);
  return csvResponse(out.csv, out.filename);
});
