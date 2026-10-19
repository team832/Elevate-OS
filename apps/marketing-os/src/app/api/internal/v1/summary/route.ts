import { z } from 'zod';
import { ValidationError, defineInternalRoute } from '@elevate/server-kit';
import { addDays, isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { buildMarketingSummary } from '../../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({
  from: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  to: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
});

/**
 * GET /marketing/api/internal/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD → MarketingSummaryV1.
 * Server-to-server only (bearer INTERNAL_SERVICE_TOKEN + X-Elevate-Caller: ops | platform).
 * Default window: the last 7 IST days. Missing metrics are `missing`, never 0.
 */
export const GET = defineInternalRoute(
  { callers: ['ops', 'platform'], query },
  async ({ db, query }) => {
    const to = (query.to ?? toIsoDate()) as IsoDate;
    const from = (query.from ?? addDays(to, -6)) as IsoDate;
    if (from > to) throw new ValidationError('from must not be after to.');
    if (addDays(from, 366) < to) throw new ValidationError('The window is limited to one year.');
    return buildMarketingSummary(db, { from, to });
  },
);
