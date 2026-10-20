import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../../server/route-helpers';
import { coverageQuery, uuidParams } from '../../../../../../server/schemas';
import { getBatchCoverage } from '../../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/batches/:id/coverage — Planned vs completed (verified) hours per chapter, subject and course. */
export const GET = defineRoute({ permission: 'academic:batches:read', params: uuidParams, query: coverageQuery }, async (ctx) => getBatchCoverage(ctx.db, actorOf(ctx), ctx.params.id, ctx.query.asOf ?? null));
