import { defineRoute } from '@elevate/server-kit';
import { admitCardWriteBody } from '@elevate/shared-contracts';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { writeAdmitCards } from '../../../../../../server/services/admit-cards';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assessments/:id/admit-cards — coordinators: give roll numbers, or set the venue and instructions (F4-03). */
export const POST = defineRoute(
  { permission: 'academic:assessments:write', params: uuidParams, body: admitCardWriteBody },
  async (ctx) => writeAdmitCards(ctx.db, actorOf(ctx), ctx.params.id, ctx.body),
);
