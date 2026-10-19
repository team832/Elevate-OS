import { defineRoute } from '@elevate/server-kit';
import { uuidParams } from '../../../../../server/schemas';
import { getPlan } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/plans/:id — Plan with items, totals by subject and approval history. */
export const GET = defineRoute({ permission: 'academic:courses:read', params: uuidParams }, async (ctx) => getPlan(ctx.db, ctx.params.id));
