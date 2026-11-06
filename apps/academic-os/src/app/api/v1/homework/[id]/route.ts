import { csvResponse, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { uuidParams } from '../../../../../server/schemas';
import { homeworkCsvQuery } from '../../../../../server/schemas-homework';
import { getHomework, homeworkMarksCsv } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/homework/:id[?format=csv] — One homework with its students and marks (null = not marked yet). */
export const GET = defineRoute({ permission: 'academic:classes:read', params: uuidParams, query: homeworkCsvQuery }, async (ctx) => {
  if (ctx.query.format !== 'csv') return getHomework(ctx.db, actorOf(ctx), ctx.params.id);
  const out = await homeworkMarksCsv(ctx.db, actorOf(ctx), ctx.params.id);
  return csvResponse(out.csv, out.filename);
});
