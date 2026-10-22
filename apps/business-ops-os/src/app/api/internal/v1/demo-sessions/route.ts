import { z } from 'zod';
import { defineInternalRoute } from '@elevate/server-kit';
import { isoDateSchema, opsDemoSessionsForDayV1Schema } from '@elevate/shared-contracts';
import { demoSessionsForDay } from '../../../../../server/demos-read';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/internal/v1/demo-sessions?date=YYYY-MM-DD — OpsDemoSessionsForDayV1 for Academic OS
 * only (bearer INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: academic). Minimal fields (R5).
 */
export const GET = defineInternalRoute(
  { callers: ['academic'], query: z.object({ date: isoDateSchema }) },
  async ({ db, query }) =>
    opsDemoSessionsForDayV1Schema.parse(await demoSessionsForDay(db, query.date)),
);
