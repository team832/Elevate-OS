import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { feasibilityQuery, uuidParams } from '../../../../../../server/schemas';
import { getBatchFeasibility } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/batches/:id/feasibility — Capacity feasibility (gross − exclusions = net vs required); never "optimal". */
export const GET = defineRoute({ permission: 'academic:timetable:read', params: uuidParams, query: feasibilityQuery }, async (ctx) => getBatchFeasibility(ctx.db, actorOf(ctx), ctx.params.id, ctx.query));
