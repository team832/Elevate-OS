import { defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../../server/route-helpers';
import { reportParams, reportQuery } from '../../../../../server/schemas-assessment';
import { buildReport, exportReportCsv } from '../../../../../server';

export const dynamic = 'force-dynamic';

/**
 * GET /academic/api/v1/reports/:kind?batchId|assessmentId|staffId&from&to[&format=csv] —
 * attendance, coverage, assessment or teacher-week report. Each kind checks its screen's
 * permission in the service; a CSV download is audited.
 */
export const GET = defineRoute({ permission: 'academic:module:access', params: reportParams, query: reportQuery }, async (ctx) => {
  if (ctx.query.format !== 'csv') return buildReport(ctx.db, actorOf(ctx), ctx.params.kind, ctx.query);
  const { filename, csv } = await exportReportCsv(ctx.db, actorOf(ctx), ctx.params.kind, ctx.query);
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });
});
