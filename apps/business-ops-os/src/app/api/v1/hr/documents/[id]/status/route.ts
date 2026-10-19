import { defineRoute } from '@elevate/server-kit';
import { changeDocumentStatus } from '../../../../../../../server/hr/documents';
import { documentActionBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/hr/documents/[id]/status — Hold, release, request or decide a deletion. */
export const POST = defineRoute(
  { permission: 'ops:employee_documents:manage', params: staffIdParams, body: documentActionBody },
  async ({ user, db, params, body, requestId }) =>
    changeDocumentStatus(db, user, params.id, body, requestId),
);
