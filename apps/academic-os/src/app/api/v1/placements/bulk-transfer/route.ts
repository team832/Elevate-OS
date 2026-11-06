import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { bulkTransferBody } from '../../../../../server/schemas-placements';
import { bulkTransferPlacements } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/placements/bulk-transfer — Move several students of one batch from a date (F4-07); all or none. */
export const POST = defineRoute({ permission: 'academic:enrolments:decide', body: bulkTransferBody }, async (ctx) => bulkTransferPlacements(ctx.db, actorOf(ctx), ctx.body));
