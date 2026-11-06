import { created, csvResponse, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createHomeworkBody, homeworkQuery } from '../../../../server/schemas-homework';
import { createHomework, homeworkListCsv, listHomework } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/homework?batchId&from&to[&format=csv] — Homework with counts (teachers: batches they teach); the CSV is audited. */
export const GET = defineRoute({ permission: 'academic:classes:read', query: homeworkQuery }, async (ctx) => {
  if (ctx.query.format !== 'csv') return listHomework(ctx.db, actorOf(ctx), ctx.query);
  const out = await homeworkListCsv(ctx.db, actorOf(ctx), ctx.query);
  return csvResponse(out.csv, out.filename);
});

/** POST /academic/api/v1/homework — Set homework for a batch (teachers: a batch they teach). */
export const POST = defineRoute({ permission: 'academic:classes:record', body: createHomeworkBody }, async (ctx) => created(await createHomework(ctx.db, actorOf(ctx), ctx.body)));
