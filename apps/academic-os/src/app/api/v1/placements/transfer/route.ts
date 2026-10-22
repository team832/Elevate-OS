import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { transferBody } from '../../../../../server/schemas-placements';
import { transferPlacement } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/placements/transfer — Move an enrolment to another batch from a date; returns a proposed catch-up list. */
export const POST = defineRoute({ permission: 'academic:enrolments:decide', body: transferBody }, async (ctx) => transferPlacement(ctx.db, actorOf(ctx), ctx.body));
