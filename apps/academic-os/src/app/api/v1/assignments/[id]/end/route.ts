import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { uuidParams } from '../../../../../../server/schemas';
import { endAssignmentBody } from '../../../../../../server/schemas-placements';
import { endAssignment } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** POST /academic/api/v1/assignments/:id/end — Set the last day of a teaching assignment (history and past sessions kept). */
export const POST = defineRoute({ permission: 'academic:assignments:write', params: uuidParams, body: endAssignmentBody }, async (ctx) => endAssignment(ctx.db, actorOf(ctx), ctx.params.id, ctx.body));
