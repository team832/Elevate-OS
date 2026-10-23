import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createAssignmentBody } from '../../../../server/schemas';
import { createAssignment, listAssignments } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/assignments — Teaching assignments (teachers: their own). */
export const GET = defineRoute({ permission: 'academic:assignments:read' }, async (ctx) => listAssignments(ctx.db, actorOf(ctx)));

/** POST /academic/api/v1/assignments — Assign a core staff member to a subject of a batch, or record it pending (no batch yet). */
export const POST = defineRoute({ permission: 'academic:assignments:write', body: createAssignmentBody }, async (ctx) => created(await createAssignment(ctx.db, actorOf(ctx), ctx.body)));
