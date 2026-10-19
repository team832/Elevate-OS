import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { retireChapterBody, uuidParams } from '../../../../../../server/schemas';
import { retireChapter } from '../../../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/chapters/:id/retire — keep the code as an alias of the current chapter. */
export const POST = defineRoute(
  { permission: 'academic:courses:write', params: uuidParams, body: retireChapterBody },
  async (ctx) => retireChapter(ctx.db, actorOf(ctx), ctx.params.id, ctx.body),
);
