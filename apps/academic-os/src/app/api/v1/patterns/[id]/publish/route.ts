import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { publishBody } from '../../../../../../server/schemas-sessions';
import { publishPattern } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/patterns/:id/publish — Generate the pattern's sessions after a conflict check (idempotent; 409 on conflicts or a stale version). */
export const POST = defineRoute({ permission: 'academic:timetable:publish', params: uuidParams, body: publishBody }, async (ctx) => publishPattern(ctx.db, actorOf(ctx), ctx.params.id, ctx.body.version));
