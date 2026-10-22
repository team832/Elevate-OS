import { defineRoute } from '@elevate/server-kit';
import { pdfResponse } from '../../../../../../server/pdf/document';
import { taskReportFile } from '../../../../../../server/pdf/task-report';
import { idParams } from '../../../../../../server/schemas';
import { taskReportQuery } from '../../../../../../server/staff-tasks-schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/staff-tasks/:id/report?format=pdf|csv — The end-to-end task report (same read rules as the page; audited). */
export const GET = defineRoute(
  { permission: 'ops:tasks:read', params: idParams, query: taskReportQuery },
  async ({ user, db, params, query, requestId }) => {
    const file = await taskReportFile(db, user, params.id, query.format, requestId);
    if (typeof file.body !== 'string') return pdfResponse(file.body, file.filename);
    return new Response(file.body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename}"`,
        'cache-control': 'no-store',
      },
    });
  },
);
