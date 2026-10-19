import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { attemptsBody, uuidParams } from '../../../../../../server/schemas';
import { upsertAttempts } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/attempts — Enter or import responses (CSV or JSON); duplicates reject the import. */
export const POST = defineRoute({ permission: 'academic:assessments:write', params: uuidParams, body: attemptsBody }, async (ctx) => upsertAttempts(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
