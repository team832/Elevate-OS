import { created, defineRoute } from '@elevate/server-kit';
import { startImportBody } from '../../../../../../server/assessments-schemas';
import { idParams } from '../../../../../../server/schemas';
import { startImport } from '../../../../../../server/score-import-read';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/assessments/:id/score-imports: read a CSV (or a PDF with AI, once confirmed) into a review. */
export const POST = defineRoute(
  {
    permission: 'ops:assessments:manage',
    params: idParams,
    body: startImportBody,
    maxBodyBytes: 12 * 1024 * 1024,
  },
  async ({ db, user, params, body, requestId }) =>
    created(await startImport(db, user, params.id, body, requestId)),
);
