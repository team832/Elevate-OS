import { z } from 'zod';
import { ForbiddenError, defineRoute } from '@elevate/server-kit';
import { isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { teamWide, weeklyReport } from '../../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({
  week: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  groupBy: z.enum(['account', 'campaign']).default('account'),
});

/** GET /marketing/api/v1/metrics/weekly?week=YYYY-MM-DD&groupBy=account|campaign (IST Monday–Sunday). */
export const GET = defineRoute(
  { permission: 'marketing:metrics:read', query },
  async ({ db, query, user }) => {
    // Per-campaign figures cover every campaign, so only team-wide readers get them.
    if (query.groupBy === 'campaign' && !teamWide(user))
      throw new ForbiddenError('Results by campaign are for managers; open Assigned campaigns.');
    return weeklyReport(db, {
      weekOf: (query.week ?? toIsoDate()) as IsoDate,
      groupBy: query.groupBy,
    });
  },
);
