import { defineRoute, respond } from '@elevate/server-kit';
import { importMetricsBody, importMetricsCsv, listMetricImports } from '../../../../../server';

export const dynamic = 'force-dynamic';

/** GET /marketing/api/v1/metrics/imports — recent imports with rejected-row counts. */
export const GET = defineRoute({ permission: 'marketing:metrics:read' }, async ({ db }) =>
  listMetricImports(db),
);

/**
 * POST /marketing/api/v1/metrics/imports — CSV text + declared date format. dryRun → preview
 * only. 201 when stored; 200 for a dry run or a file already imported (duplicate: true).
 */
export const POST = defineRoute(
  { permission: 'marketing:metrics:import', body: importMetricsBody },
  async ({ db, body, user, requestId }) => {
    const report = await importMetricsCsv(db, user, body, requestId);
    return respond(report, { status: report.dryRun || report.duplicate ? 200 : 201 });
  },
);
