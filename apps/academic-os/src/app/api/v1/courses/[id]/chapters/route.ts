import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { createChapterBody, uuidParams } from '../../../../../../server/schemas';
import { createChapter } from '../../../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/courses/:id/chapters — stable chapter code (never renumbered). */
export const POST = defineRoute(
  { permission: 'academic:courses:write', params: uuidParams, body: createChapterBody },
  async (ctx) => created(await createChapter(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)),
);
