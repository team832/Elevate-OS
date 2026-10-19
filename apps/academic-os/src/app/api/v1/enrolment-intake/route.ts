import { defineRoute } from '@elevate/server-kit';
import { getIntakeQueue } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/enrolment-intake — Intake queue: waiting, processed (confirmed/rejected), failed/dead. */
export const GET = defineRoute({ permission: 'academic:enrolments:read' }, async (ctx) => getIntakeQueue(ctx.db));
