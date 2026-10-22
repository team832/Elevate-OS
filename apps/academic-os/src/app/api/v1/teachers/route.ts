import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { listTeachers } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/teachers — Teacher directory from assignments (teachers: themselves). */
export const GET = defineRoute({ permission: 'academic:assignments:read' }, async (ctx) => listTeachers(ctx.db, actorOf(ctx)));
