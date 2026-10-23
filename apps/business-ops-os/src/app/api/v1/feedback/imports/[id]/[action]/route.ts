import { defineRoute } from '@elevate/server-kit';
import { commitImport, discardImport } from '../../../../../../../server/feedback-import';
import { importActionParams, importCommitBody } from '../../../../../../../server/feedback-schemas';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/feedback/imports/:id/commit|discard — Import the valid rows (again = no change), or discard the preview. */
export const POST = defineRoute(
  { permission: 'ops:teacher_feedback:import', params: importActionParams, body: importCommitBody },
  async ({ user, db, params, body, requestId }) =>
    params.action === 'commit'
      ? commitImport(db, user, params.id, body, requestId)
      : discardImport(db, user, params.id, requestId),
);
