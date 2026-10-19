import { defineInternalRoute } from '@elevate/server-kit';
import { ValidationError } from '@elevate/shared-contracts';
import { addDays, type IsoDate } from '@elevate/shared-types';
import { buildAcademicDeliverySummary, todayIst } from '../../../../../server';
import { summaryQuery } from '../../../../../server/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/internal/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * AcademicDeliverySummaryV1 for Business Ops and the platform (bearer
 * INTERNAL_SERVICE_TOKEN + X-Elevate-Caller). Default window: the last 30 days (IST).
 * Missing is never zero.
 */
export const GET = defineInternalRoute({ callers: ['ops', 'platform'], query: summaryQuery }, async ({ db, query }) => {
  const to = query.to ?? todayIst();
  const from = query.from ?? addDays(to as IsoDate, -29);
  if (from > to) throw new ValidationError('from must not be after to.');
  return buildAcademicDeliverySummary(db, { from, to });
});
