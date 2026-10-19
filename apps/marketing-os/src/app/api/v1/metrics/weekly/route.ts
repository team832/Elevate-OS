import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { isIsoDate, toIsoDate, type IsoDate } from '@elevate/shared-types';
import { weeklyReport } from '../../../../../server';

export const dynamic = 'force-dynamic';

const query = z.object({
  week: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  groupBy: z.enum(['account', 'campaign']).default('account'),
});

/** GET /marketing/api/v1/metrics/weekly?week=YYYY-MM-DD&groupBy=account|campaign (IST Monday–Sunday). */
export const GET = defineRoute(
  { permission: 'marketing:metrics:read', query },
  async ({ db, query }) =>
    weeklyReport(db, { weekOf: (query.week ?? toIsoDate()) as IsoDate, groupBy: query.groupBy }),
);
