import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { previewPattern } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/patterns/:id/preview — Occurrences to be generated and their conflicts (writes nothing). */
export const GET = defineRoute({ permission: 'academic:timetable:read', params: uuidParams }, async (ctx) => previewPattern(ctx.db, actorOf(ctx), ctx.params.id));
