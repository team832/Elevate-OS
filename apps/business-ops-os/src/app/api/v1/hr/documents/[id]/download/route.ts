import { defineRoute, respond } from '@elevate/server-kit';
import { requestDocumentDownload } from '../../../../../../../server/hr/documents';
import { downloadQuery, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /ops/api/v1/hr/documents/[id]/download — Short-lived download URL from the
 * storage adapter. Storage not configured → 503; reference-only → 409
 * (`{ available: false, reason }` in both cases). Every request is audited.
 * `?redirect=1` (links in the UI) answers 302 to the short-lived URL when one is issued.
 */
export const GET = defineRoute(
  { permission: 'ops:employee_documents:read', params: staffIdParams, query: downloadQuery },
  async ({ user, db, params, query, requestId }) => {
    const result = await requestDocumentDownload(db, user, params.id, requestId);
    if (result.available)
      return query.redirect
        ? new Response(null, {
            status: 302,
            headers: { location: result.url, 'cache-control': 'no-store' },
          })
        : result;
    return respond(result, { status: result.reason === 'storage_not_configured' ? 503 : 409 });
  },
);
