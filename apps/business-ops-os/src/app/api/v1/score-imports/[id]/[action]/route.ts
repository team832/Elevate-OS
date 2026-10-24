import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import { confirmImportBody } from '../../../../../../server/assessments-schemas';
import { cancelImport, confirmImport } from '../../../../../../server/score-import-confirm';

export const dynamic = 'force-dynamic';

/** POST /ops/api/v1/score-imports/:id/confirm|cancel: save the reviewed marks in Academic, or drop the import. */
export const POST = defineRoute(
  {
    permission: 'ops:assessments:manage',
    params: z.object({ id: z.uuid(), action: z.enum(['confirm', 'cancel']) }),
    body: confirmImportBody,
  },
  async ({ db, user, params, body, requestId }) =>
    params.action === 'confirm'
      ? confirmImport(db, user, params.id, body, requestId)
      : cancelImport(db, user, params.id, requestId),
);
