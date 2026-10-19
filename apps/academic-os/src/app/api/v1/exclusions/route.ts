import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createExclusionBody, exclusionsQuery } from '../../../../server/schemas';
import { createExclusion, listExclusions } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/exclusions — Holiday / closure / exam-blackout calendar (?batchId= adds centre-wide rows). */
export const GET = defineRoute({ permission: 'academic:timetable:read', query: exclusionsQuery }, async (ctx) => listExclusions(ctx.db, ctx.query.batchId));

/** POST /academic/api/v1/exclusions — Add a dated closure, an undated allowance or a blackout window. */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: createExclusionBody }, async (ctx) => created(await createExclusion(ctx.db, actorOf(ctx), ctx.body)));
