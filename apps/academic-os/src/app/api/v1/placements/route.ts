import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { allocateBody, placementsQuery } from '../../../../server/schemas-placements';
import { allocatePlacement, listPlacementViews } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/placements?view=awaiting|placed|transfers|ended — Enrolment lists with tab counts. */
export const GET = defineRoute({ permission: 'academic:enrolments:read', query: placementsQuery }, async (ctx) => listPlacementViews(ctx.db, actorOf(ctx), ctx.query.view));

/** POST /academic/api/v1/placements — Place an enrolment that is awaiting a batch (seat and clash checked). */
export const POST = defineRoute({ permission: 'academic:enrolments:decide', body: allocateBody }, async (ctx) => created(await allocatePlacement(ctx.db, actorOf(ctx), ctx.body)));
