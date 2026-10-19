import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { createSubjectBody, uuidParams } from '../../../../../../server/schemas';
import { createSubject } from '../../../../../../server/services/curriculum';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/courses/:id/subjects */
export const POST = defineRoute(
  { permission: 'academic:courses:write', params: uuidParams, body: createSubjectBody },
  async (ctx) => created(await createSubject(ctx.db, actorOf(ctx), ctx.params.id, ctx.body)),
);
