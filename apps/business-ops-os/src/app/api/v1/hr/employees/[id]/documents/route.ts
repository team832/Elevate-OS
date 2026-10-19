import { created, defineRoute, respond } from '@elevate/server-kit';
import { addDocument, listDocuments } from '../../../../../../../server/hr/documents';
import { addDocumentBody, staffIdParams } from '../../../../../../../server/hr/schemas';

export const dynamic = 'force-dynamic';

/** GET /ops/api/v1/hr/employees/[id]/documents — Document metadata (identity kinds need private access). */
export const GET = defineRoute(
  { permission: 'ops:employee_documents:read', params: staffIdParams },
  async ({ user, db, params }) => listDocuments(db, user, params.id),
);

/**
 * POST /ops/api/v1/hr/employees/[id]/documents — Record a document. `reference`
 * → 201. `stored` while storage is not configured → 503 `{ stored: false }`, nothing written.
 */
export const POST = defineRoute(
  { permission: 'ops:employee_documents:manage', params: staffIdParams, body: addDocumentBody },
  async ({ user, db, params, body, requestId }) => {
    const result = await addDocument(db, user, params.id, body, requestId);
    return result.stored ? created(result) : respond(result, { status: 503 });
  },
);
